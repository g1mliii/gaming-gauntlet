import type {
  MatchControlAction,
  MatchSnapshot,
  MatchSummary,
} from "@gaming-gauntlet/contracts";
import { PageShell } from "@gaming-gauntlet/ui";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { EdgeError, edgeSendJson } from "../lib/edge";
import { useOperatorSnapshot } from "../lib/operator-snapshot";

const AUTO_COMPLETE_LIVE_HOURS = 3;
const AUTO_COMPLETE_PAUSED_MINUTES = 15;
const QUEUE_WHEEL_STATUS_DEFAULT =
  "Draw the next round from the queue or fall back to the top seed.";

type QueueWheelState = {
  open: boolean;
  phase: "idle" | "spinning" | "result";
  highlightedQueueItemId: string | null;
  selectedQueueItemId: string | null;
  selectedTitle: string | null;
  statusText: string;
};

type QueueWheelSpinFrame = {
  item: MatchSnapshot["queue"][number];
  delayMs: number;
};

function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getQueuedItems(
  snapshot: MatchSnapshot | null
): MatchSnapshot["queue"] {
  return snapshot?.queue.filter((entry) => entry.status === "queued") ?? [];
}

function createQueueWheelSpinPlan(
  items: MatchSnapshot["queue"],
  selectedIndex: number
): QueueWheelSpinFrame[] {
  if (items.length === 0) {
    return [];
  }

  const fullCycles = Math.max(2, Math.min(4, Math.ceil(9 / items.length)));
  const totalSteps = fullCycles * items.length + selectedIndex + 1;

  return Array.from({ length: totalSteps }, (_, index) => ({
    item: items[index % items.length]!,
    delayMs:
      index < totalSteps - 3
        ? 80
        : index === totalSteps - 3
          ? 120
          : index === totalSteps - 2
            ? 170
            : 230,
  }));
}

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The edge worker is offline. Start the worker on port 8787 to load the control room.";
  }

  if (!(error instanceof EdgeError)) {
    return "The control room failed to sync. Try again.";
  }

  switch (error.code) {
    case "match_not_found":
      return "That match could not be found for the signed-in broadcaster.";
    case "live_match_exists":
      return "Another match already owns chat ingestion for this broadcaster pair.";
    default:
      return error.code.replaceAll("_", " ");
  }
}

function getQueueRowMeta(
  entry: MatchSnapshot["queue"][number],
  suggestionById: Map<string, MatchSnapshot["suggestions"][number]>
): string {
  if (!entry.sourceSuggestionId) {
    return "Manual queue item";
  }

  const suggestion = suggestionById.get(entry.sourceSuggestionId);

  return suggestion
    ? `From board #${suggestion.boardId}`
    : "From approved board pick";
}

function formatMatchStatusLabel(status: MatchSummary["status"]): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "live":
      return "Live";
    case "paused":
      return "Paused";
    case "complete":
      return "Complete";
    default:
      return status;
  }
}

function formatChatStateLabel(chatState: MatchSnapshot["chatState"]): string {
  switch (chatState) {
    case "idle":
      return "Idle";
    case "live":
      return "Live";
    case "paused_grace":
      return "Paused grace";
    case "expired":
      return "Expired";
    default:
      return String(chatState).replaceAll("_", " ");
  }
}

function getLifecycleAction(status: MatchSummary["status"]): {
  label: string;
  nextStatus: MatchSummary["status"];
} | null {
  switch (status) {
    case "draft":
      return { label: "Start match", nextStatus: "live" };
    case "live":
      return { label: "Pause match", nextStatus: "paused" };
    case "paused":
      return { label: "Resume match", nextStatus: "live" };
    case "complete":
      return null;
    default:
      return null;
  }
}

function getLifecycleSummary(snapshot: MatchSnapshot): string {
  switch (snapshot.status) {
    case "draft":
      return "Match is drafted but not on air yet.";
    case "live":
      return `Match is live and viewer chat routing is active. If match activity stops for about ${AUTO_COMPLETE_LIVE_HOURS} hours, it auto-completes.`;
    case "paused":
      return snapshot.chatState === "paused_grace"
        ? `Match is paused and chat is still in the grace window. It auto-completes after about ${AUTO_COMPLETE_PAUSED_MINUTES} minutes paused unless you resume.`
        : `Match is paused and chat routing is fully off. It auto-completes after about ${AUTO_COMPLETE_PAUSED_MINUTES} minutes paused unless you resume.`;
    case "complete":
      return "Match is complete. Board and queue mutations are locked, and live routing is off.";
    default:
      return "Match lifecycle is syncing.";
  }
}

function getChatRouteSummary(snapshot: MatchSnapshot): string {
  switch (snapshot.chatState) {
    case "idle":
      return snapshot.status === "draft"
        ? "Chat will route when the match is started."
        : "Chat routing is currently off.";
    case "live":
      return "Viewer chat picks are routing into the live board.";
    case "paused_grace":
      return "Chat routing is paused with a temporary grace window.";
    case "expired":
      return "The pause grace window expired and routing is off.";
    default:
      return "Chat routing is syncing.";
  }
}

function getQueueStateLabel(snapshot: MatchSnapshot): string {
  if (snapshot.status === "complete") {
    return "Locked";
  }

  const hasLiveRound = Boolean(snapshot.currentGameId);
  const hasQueuedItems = snapshot.queue.some(
    (entry) => entry.status === "queued"
  );

  if (hasLiveRound) {
    return "Round live";
  }

  if (hasQueuedItems) {
    return "Ready to start";
  }

  return "Waiting for picks";
}

function getCompletionGuidance(snapshot: MatchSnapshot): string {
  if (snapshot.status === "complete") {
    return `Complete is the shutdown state. Chat routing is off, live subscription upkeep is torn down, and final pages stop active realtime refresh. If you forget, the system auto-completes after about ${AUTO_COMPLETE_PAUSED_MINUTES} minutes paused or ${AUTO_COMPLETE_LIVE_HOURS} hours without match activity.`;
  }

  return `When the set is over, complete the match. That is the cheapest resting state on Cloudflare and shuts down the live routing path immediately. If nobody does it, the system auto-completes after about ${AUTO_COMPLETE_PAUSED_MINUTES} minutes paused or ${AUTO_COMPLETE_LIVE_HOURS} hours without match activity.`;
}

function mergeMatchSummaryIntoSnapshot(
  snapshot: MatchSnapshot,
  match: MatchSummary
): MatchSnapshot {
  return {
    ...snapshot,
    slug: match.slug,
    title: match.title,
    status: match.status,
    chatState: match.chatState,
    chatEnabledUntil: match.chatEnabledUntil,
    boardRevision: match.boardRevision,
    subscriptionHealth: match.subscriptionHealth,
    targetWins: match.targetWins,
    players: match.players,
    updatedAt: match.updatedAt,
  };
}

export function ControlRoomPage() {
  const { matchId = "" } = useParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [queueWheel, setQueueWheel] = useState<QueueWheelState>({
    open: false,
    phase: "idle",
    highlightedQueueItemId: null,
    selectedQueueItemId: null,
    selectedTitle: null,
    statusText: QUEUE_WHEEL_STATUS_DEFAULT,
  });
  const { isLoading, pageError, replaceSnapshot, snapshot } =
    useOperatorSnapshot({
      matchId: matchId || null,
      missingMatchError: "No match id was provided.",
      toFriendlyError,
    });
  const latestSnapshotRef = useRef<MatchSnapshot | null>(null);
  const queueWheelTimerRef = useRef<number | null>(null);

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    return () => {
      if (queueWheelTimerRef.current !== null) {
        window.clearTimeout(queueWheelTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (queueWheel.phase !== "spinning") {
      return;
    }

    if (!snapshot || snapshot.currentGameId || snapshot.status === "complete") {
      clearQueueWheelTimer();
      setQueueWheel((current) =>
        current.phase !== "spinning"
          ? current
          : {
              ...current,
              phase: "result",
              statusText: snapshot?.currentGameId
                ? "Wheel stopped because a round is already live."
                : "Wheel stopped because the match state changed.",
            }
      );
    }
  }, [queueWheel.phase, snapshot]);

  function commitSnapshot(nextSnapshot: MatchSnapshot) {
    latestSnapshotRef.current = nextSnapshot;
    replaceSnapshot(nextSnapshot);
  }

  function clearQueueWheelTimer() {
    if (queueWheelTimerRef.current !== null) {
      window.clearTimeout(queueWheelTimerRef.current);
      queueWheelTimerRef.current = null;
    }
  }

  const boardSuggestions =
    snapshot?.suggestions.filter(
      (suggestion) => suggestion.status === "board"
    ) ?? [];
  const suggestionById = new Map(
    snapshot?.suggestions.map((suggestion) => [suggestion.id, suggestion]) ?? []
  );
  const playerById = new Map(
    snapshot?.players.map((player) => [player.id, player.displayName]) ?? []
  );
  const queuedItems = getQueuedItems(snapshot);
  const queuedPositionById = new Map(
    queuedItems.map((entry, index) => [entry.id, index])
  );
  const hasLiveRound = Boolean(snapshot?.currentGameId);
  const hasQueuedItems = queuedItems.length > 0;
  const lifecycleAction = snapshot ? getLifecycleAction(snapshot.status) : null;
  const controlsLocked = snapshot?.status === "complete";
  const mutationDisabled =
    Boolean(busyAction) || controlsLocked || queueWheel.phase === "spinning";

  async function handleStatusChange(status: MatchSummary["status"]) {
    if (!matchId || !latestSnapshotRef.current) {
      return;
    }

    setBusyAction(`status:${status}`);
    setActionError(null);

    try {
      const payload = await edgeSendJson<{ ok: true; match: MatchSummary }>(
        `/api/matches/${matchId}/status`,
        { status },
        { method: "PATCH" }
      );
      if (latestSnapshotRef.current) {
        commitSnapshot(
          mergeMatchSummaryIntoSnapshot(
            latestSnapshotRef.current,
            payload.match
          )
        );
      }
    } catch (error) {
      setActionError(toFriendlyError(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleControlAction(action: MatchControlAction) {
    if (!matchId) {
      return;
    }

    setBusyAction(action.type);
    setActionError(null);

    try {
      const payload = await edgeSendJson<{ ok: true; snapshot: MatchSnapshot }>(
        `/api/matches/${matchId}/control/actions`,
        action,
        { method: "POST" }
      );

      commitSnapshot(payload.snapshot);

      if (action.type === "add_manual_queue_item") {
        setManualTitle("");
      }
      if (action.type === "start_selected_round") {
        setQueueWheel((current) => ({
          ...current,
          open: true,
          phase: "result",
          highlightedQueueItemId: action.queueItemId,
          selectedQueueItemId: action.queueItemId,
          statusText: current.selectedTitle
            ? `Wheel landed on ${current.selectedTitle}. Round is live.`
            : "Wheel draw locked in the next round.",
        }));
      }
    } catch (error) {
      setActionError(toFriendlyError(error));
      if (action.type === "start_selected_round") {
        setQueueWheel((current) => ({
          ...current,
          open: true,
          phase: "result",
          statusText: current.selectedTitle
            ? `Wheel landed on ${current.selectedTitle}, but the round could not start.`
            : "The wheel draw could not start the round.",
        }));
      }
    } finally {
      setBusyAction(null);
    }
  }

  function handleQueueWheelSpin() {
    if (!snapshot || hasLiveRound || queuedItems.length === 0) {
      return;
    }

    clearQueueWheelTimer();

    const selectedIndex = Math.floor(Math.random() * queuedItems.length);
    const selectedItem = queuedItems[selectedIndex];

    if (!selectedItem) {
      return;
    }

    const finishSpin = () => {
      setQueueWheel({
        open: true,
        phase: "result",
        highlightedQueueItemId: selectedItem.id,
        selectedQueueItemId: selectedItem.id,
        selectedTitle: selectedItem.title,
        statusText: `Wheel landed on ${selectedItem.title}. Starting round...`,
      });
      void handleControlAction({
        type: "start_selected_round",
        queueItemId: selectedItem.id,
      });
    };

    if (prefersReducedMotion()) {
      finishSpin();
      return;
    }

    const spinPlan = createQueueWheelSpinPlan(queuedItems, selectedIndex);

    if (spinPlan.length === 0) {
      finishSpin();
      return;
    }

    let frameIndex = 0;
    setQueueWheel({
      open: true,
      phase: "spinning",
      highlightedQueueItemId: spinPlan[0]?.item.id ?? selectedItem.id,
      selectedQueueItemId: selectedItem.id,
      selectedTitle: selectedItem.title,
      statusText: "Wheel is drawing the next round...",
    });

    const step = () => {
      const frame = spinPlan[frameIndex];

      if (!frame) {
        queueWheelTimerRef.current = null;
        finishSpin();
        return;
      }

      setQueueWheel((current) => ({
        ...current,
        open: true,
        phase: "spinning",
        highlightedQueueItemId: frame.item.id,
      }));
      frameIndex += 1;
      queueWheelTimerRef.current = window.setTimeout(step, frame.delayMs);
    };

    step();
  }

  if (!snapshot && isLoading) {
    return (
      <PageShell
        eyebrow="Control room"
        title="Syncing control room"
        deck="Loading the live match operator surface."
      >
        <div className="dashboard-skeleton">
          <div className="dashboard-skeleton__bar" />
          <div className="dashboard-skeleton__grid">
            <div className="dashboard-skeleton__panel" />
            <div className="dashboard-skeleton__panel" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (!snapshot) {
    return (
      <PageShell
        eyebrow="Control room"
        title="Control room unavailable"
        deck={pageError ?? "The live operator surface could not be loaded."}
      >
        {pageError ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {pageError}
          </p>
        ) : null}
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Control room"
      title={snapshot.title}
      deck="Operate the live board from one lean surface. Every button here is a real match mutation, not a duplicate viewer panel."
      actions={
        <div className="dashboard-header-actions">
          <span
            className={`gg-chip control-room__status-chip control-room__status-chip--${snapshot.status} ${snapshot.status === "live" ? "gg-chip--live" : "gg-chip--soft"}`}
          >
            match {formatMatchStatusLabel(snapshot.status)}
          </span>
          <span className="gg-chip">chat {snapshot.chatState}</span>
          <span className="gg-chip gg-chip--soft">
            subs {snapshot.subscriptionHealth}
          </span>
          <span className="gg-chip gg-chip--soft">
            rev {snapshot.boardRevision}
          </span>
        </div>
      }
    >
      {pageError ? (
        <p
          className="dashboard-message dashboard-message--warning"
          role="status"
          aria-live="polite"
        >
          {pageError}
        </p>
      ) : null}
      {actionError ? (
        <p
          className="dashboard-message dashboard-message--warning"
          role="status"
          aria-live="polite"
        >
          {actionError}
        </p>
      ) : null}

      <div className="control-room">
        <section className="control-room__summary">
          <article className="control-room__score">
            {snapshot.players.map((player) => (
              <div key={player.id} className="control-room__score-line">
                <span className="control-room__score-name">
                  {player.displayName}
                </span>
                <strong className="control-room__score-value">
                  {player.wins}
                </strong>
              </div>
            ))}
          </article>
          <article className="control-room__meta-block">
            <p className="control-room__label">Current game</p>
            <strong className="control-room__value">
              {snapshot.queue.find(
                (entry) => entry.id === snapshot.currentGameId
              )?.title ?? "Waiting for next start"}
            </strong>
          </article>
          <article className="control-room__meta-block">
            <div className="control-room__status-line">
              <p className="control-room__label">Match status</p>
              <span
                className={`gg-chip control-room__status-chip control-room__status-chip--${snapshot.status} ${snapshot.status === "live" ? "gg-chip--live" : "gg-chip--soft"}`}
              >
                {formatMatchStatusLabel(snapshot.status)}
              </span>
            </div>
            <p className="control-room__status-copy">
              {getLifecycleSummary(snapshot)}
            </p>
          </article>
          <article className="control-room__meta-block">
            <p className="control-room__label">Chat route</p>
            <strong className="control-room__value">
              {formatChatStateLabel(snapshot.chatState)}
            </strong>
            <p className="control-room__status-copy">
              {getChatRouteSummary(snapshot)}
            </p>
          </article>
          <article className="control-room__meta-block">
            <p className="control-room__label">Queue state</p>
            <strong className="control-room__value">
              {getQueueStateLabel(snapshot)}
            </strong>
            <p className="control-room__status-copy">
              {snapshot.targetWins
                ? `Format is first to ${snapshot.targetWins}.`
                : "Format is open mode."}
            </p>
          </article>
        </section>

        <section className="control-room__panel">
          <div className="control-room__panel-header">
            <div>
              <p className="control-room__label">Match lifecycle</p>
              <h2 className="control-room__title">Keep the show moving</h2>
              <p className="control-room__status-copy">
                {getLifecycleSummary(snapshot)}
              </p>
              <p className="control-room__status-copy">
                {getCompletionGuidance(snapshot)}
              </p>
            </div>
            <span
              className={`gg-chip control-room__status-chip control-room__status-chip--${snapshot.status} ${snapshot.status === "live" ? "gg-chip--live" : "gg-chip--soft"}`}
            >
              {formatMatchStatusLabel(snapshot.status)}
            </span>
          </div>
          <div className="control-room__button-row">
            {lifecycleAction ? (
              <button
                className="dashboard-button"
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  void handleStatusChange(lifecycleAction.nextStatus)
                }
              >
                {lifecycleAction.label}
              </button>
            ) : null}
            {snapshot.status !== "complete" ? (
              <button
                className="dashboard-button dashboard-button--ghost"
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void handleStatusChange("complete")}
              >
                Complete match
              </button>
            ) : null}
          </div>
          {controlsLocked ? (
            <p className="gg-empty">
              This match is complete. Queue and board controls are locked.
            </p>
          ) : null}
        </section>

        <section className="control-room__panel">
          <div className="control-room__panel-header">
            <div>
              <p className="control-room__label">Board</p>
              <h2 className="control-room__title">
                Approve or reject chat picks
              </h2>
            </div>
            <span className="gg-chip gg-chip--soft">
              {boardSuggestions.length} awaiting review
            </span>
          </div>

          {boardSuggestions.length > 0 ? (
            <ol className="control-room__list">
              {boardSuggestions.map((suggestion) => (
                <li key={suggestion.id} className="control-room__list-item">
                  <div className="control-room__list-copy">
                    <strong>{suggestion.title}</strong>
                    <p>
                      #{suggestion.boardId} • {suggestion.voteCount} votes
                    </p>
                  </div>
                  <div className="control-room__actions">
                    <button
                      className="dashboard-button"
                      type="button"
                      disabled={mutationDisabled}
                      onClick={() =>
                        void handleControlAction({
                          type: "approve_suggestion",
                          suggestionId: suggestion.id,
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="dashboard-button dashboard-button--ghost"
                      type="button"
                      disabled={mutationDisabled}
                      onClick={() =>
                        void handleControlAction({
                          type: "reject_suggestion",
                          suggestionId: suggestion.id,
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="gg-empty">
              No board suggestions are waiting for review.
            </p>
          )}
        </section>

        <section className="control-room__panel">
          <div className="control-room__panel-header">
            <div>
              <p className="control-room__label">Queue</p>
              <h2 className="control-room__title">Run rounds from one list</h2>
              <p className="control-room__status-copy">
                Shuffle the full queue, launch the top seed, or let the wheel
                draw the next round for you.
              </p>
            </div>
            <div className="control-room__actions">
              <button
                className="dashboard-button dashboard-button--ghost"
                type="button"
                disabled={mutationDisabled || !hasQueuedItems}
                onClick={() =>
                  void handleControlAction({
                    type: "randomize_queue",
                  })
                }
              >
                Randomize upcoming
              </button>
              <button
                className="dashboard-button dashboard-button--ghost control-room__wheel-button"
                type="button"
                disabled={mutationDisabled || hasLiveRound || !hasQueuedItems}
                onClick={() => {
                  handleQueueWheelSpin();
                }}
              >
                Spin wheel round
              </button>
              <button
                className="dashboard-button"
                type="button"
                disabled={mutationDisabled || hasLiveRound || !hasQueuedItems}
                onClick={() =>
                  void handleControlAction({
                    type: "start_next_round",
                  })
                }
              >
                Start next round
              </button>
            </div>
          </div>

          {queueWheel.open ? (
            <section className="control-room__wheel-panel" aria-live="polite">
              <div
                className={`control-room__wheel-stage control-room__wheel-stage--${queueWheel.phase}`}
              >
                <div
                  className="control-room__wheel-pointer"
                  aria-hidden="true"
                />
                <div className="control-room__wheel-ring" aria-hidden="true" />
                <div className="control-room__wheel-core">
                  <p className="control-room__label">Round wheel</p>
                  <strong>
                    {queuedItems.find(
                      (entry) => entry.id === queueWheel.highlightedQueueItemId
                    )?.title ??
                      queueWheel.selectedTitle ??
                      "Spin to draw"}
                  </strong>
                  <p className="control-room__status-copy">
                    {queueWheel.statusText}
                  </p>
                </div>
              </div>
              <div className="control-room__wheel-slots">
                {queuedItems.map((entry) => {
                  const isHighlighted =
                    entry.id === queueWheel.highlightedQueueItemId;
                  const isSelected =
                    entry.id === queueWheel.selectedQueueItemId;

                  return (
                    <span
                      key={entry.id}
                      className={`gg-chip control-room__wheel-slot ${isHighlighted ? "control-room__wheel-slot--active" : "gg-chip--soft"} ${isSelected ? "control-room__wheel-slot--selected" : ""}`}
                    >
                      {entry.title}
                    </span>
                  );
                })}
              </div>
            </section>
          ) : null}

          <form
            className="control-room__composer"
            onSubmit={(event) => {
              event.preventDefault();

              if (!manualTitle.trim()) {
                return;
              }

              void handleControlAction({
                type: "add_manual_queue_item",
                title: manualTitle,
              });
            }}
          >
            <label className="dashboard-field">
              <span>Manual add</span>
              <input
                name="manualQueueTitle"
                value={manualTitle}
                onChange={(event) => {
                  setManualTitle(event.currentTarget.value);
                }}
                disabled={controlsLocked}
                placeholder="Street Fighter 6"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              className="dashboard-button"
              type="submit"
              disabled={mutationDisabled || manualTitle.trim().length === 0}
            >
              Add to queue
            </button>
          </form>

          {snapshot.queue.length > 0 ? (
            <ul className="control-room__list">
              {snapshot.queue.map((entry) => {
                const queuedPosition = queuedPositionById.get(entry.id) ?? -1;
                const winnerName = entry.winnerPlayerId
                  ? playerById.get(entry.winnerPlayerId)
                  : null;

                return (
                  <li key={entry.id} className="control-room__list-item">
                    <div className="control-room__list-copy">
                      <strong>{entry.title}</strong>
                      <p>
                        {getQueueRowMeta(entry, suggestionById)}
                        {winnerName ? ` • Winner ${winnerName}` : ""}
                      </p>
                    </div>
                    <div className="control-room__actions">
                      <span
                        className={`gg-chip ${entry.status === "live" ? "gg-chip--live" : "gg-chip--soft"}`}
                      >
                        {entry.status}
                      </span>
                      {entry.status === "queued" ? (
                        <>
                          <button
                            className="dashboard-button dashboard-button--ghost"
                            type="button"
                            disabled={mutationDisabled || queuedPosition <= 0}
                            onClick={() =>
                              void handleControlAction({
                                type: "move_queue_item",
                                queueItemId: entry.id,
                                direction: "up",
                              })
                            }
                          >
                            Move up
                          </button>
                          <button
                            className="dashboard-button dashboard-button--ghost"
                            type="button"
                            disabled={
                              mutationDisabled ||
                              queuedPosition === -1 ||
                              queuedPosition === queuedPositionById.size - 1
                            }
                            onClick={() =>
                              void handleControlAction({
                                type: "move_queue_item",
                                queueItemId: entry.id,
                                direction: "down",
                              })
                            }
                          >
                            Move down
                          </button>
                          <button
                            className="dashboard-button dashboard-button--ghost"
                            type="button"
                            disabled={mutationDisabled}
                            onClick={() =>
                              void handleControlAction({
                                type: "remove_queue_item",
                                queueItemId: entry.id,
                              })
                            }
                          >
                            Remove
                          </button>
                        </>
                      ) : null}
                      {entry.status === "live" ? (
                        <>
                          {snapshot.players.map((player) => (
                            <button
                              key={player.id}
                              className="dashboard-button"
                              type="button"
                              disabled={mutationDisabled}
                              onClick={() =>
                                void handleControlAction({
                                  type: "record_round_winner",
                                  queueItemId: entry.id,
                                  winnerPlayerId: player.id,
                                })
                              }
                            >
                              {player.displayName} wins
                            </button>
                          ))}
                          <button
                            className="dashboard-button dashboard-button--ghost"
                            type="button"
                            disabled={mutationDisabled}
                            onClick={() =>
                              void handleControlAction({
                                type: "close_round",
                                queueItemId: entry.id,
                              })
                            }
                          >
                            Close round
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="gg-empty">No games are queued yet.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
