import { useEffect, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  Ico,
  KitButton,
  KitButtonLink,
  KitChip,
  KitNotice,
  KitPanel,
  KitTextField,
  Wheel,
  mergeClassNames,
} from "@gaming-gauntlet/ui";
import type { GauntletMatchSurface } from "@gaming-gauntlet/ui";
import { TargetScoreSchema } from "@gaming-gauntlet/core";

import { isTheme, THEME_OPTIONS } from "../overlay/catalog";
import type { OverlayTheme } from "../overlay/catalog";
import { buildMatchUrl, buildOverlaysUrl } from "../management-passcodes";
import { themeClassName, useOverlayTheme } from "../overlay-theme";
import { buildPublicUrl } from "../public-urls";
import { useMatchRoom } from "./use-match-room";
import type {
  MatchRoomActions,
  MatchRoomGame,
  MatchRoomLobby,
} from "./use-match-room";

type MatchRoomProps = {
  lobbyId: string;
};

type DragState = {
  dragId: string | null;
  overId: string | null;
  outside: boolean;
  onStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    gameId: string,
    isEditing: boolean
  ) => void;
};

function handleCommitKeys(
  event: KeyboardEvent<HTMLInputElement>,
  resetDraft: () => void
) {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  } else if (event.key === "Escape") {
    resetDraft();
    event.currentTarget.blur();
  }
}

export default function MatchRoom({ lobbyId }: MatchRoomProps) {
  const {
    actions,
    error,
    isLoading,
    isWriting,
    isUnlocked,
    lobby,
    managementCode,
    spin,
    surface,
    unlock,
    unlockError,
  } = useMatchRoom(lobbyId);
  const [wheelStyle, setWheelStyle] = useState<"radial" | "reel">("radial");
  const [theme, setTheme] = useOverlayTheme(lobbyId);
  const themeClass = themeClassName(theme);

  if (!lobby || !surface) {
    return (
      <UnavailableMatchState
        error={error}
        isLoading={isLoading}
        themeClass={themeClass}
      />
    );
  }

  if (!isUnlocked) {
    return (
      <LockedRoom
        error={error}
        lobby={lobby}
        onUnlock={unlock}
        surface={surface}
        themeClass={themeClass}
        unlockError={unlockError}
      />
    );
  }

  return (
    <div
      aria-busy={isWriting ? "true" : undefined}
      className={mergeClassNames("gg-content__inner", themeClass)}
    >
      <span
        aria-atomic="true"
        aria-live="polite"
        className="gg-sr-only"
        role="status"
      >
        {isWriting ? "Saving changes." : ""}
      </span>
      <ShareBar lobbyId={lobby.lobbyId} managementCode={managementCode} />
      <MatchHeader
        actions={actions}
        lobby={lobby}
        onThemeChange={setTheme}
        theme={theme}
      />
      {error ? (
        <KitNotice aria-live="polite" role="status" tone="warning">
          {error}
        </KitNotice>
      ) : null}
      <ScoreboardPanel actions={actions} lobby={lobby} surface={surface} />
      <div className="gg-board-grid">
        <SpinPanel
          lobby={lobby}
          onWheelStyleChange={setWheelStyle}
          spin={spin}
          surface={surface}
          wheelStyle={wheelStyle}
        />
        <GamePoolEditor actions={actions} lobby={lobby} />
      </div>
    </div>
  );
}

function UnavailableMatchState({
  error,
  isLoading,
  themeClass,
}: {
  error: string | null;
  isLoading: boolean;
  themeClass: string;
}) {
  return (
    <div
      aria-busy={isLoading ? "true" : undefined}
      className={mergeClassNames("gg-content__inner", themeClass)}
    >
      <KitPanel
        eyebrow="Match room"
        title={isLoading ? "Loading" : "Unavailable"}
      >
        <KitNotice
          aria-live="polite"
          role="status"
          tone={error ? "warning" : "default"}
        >
          {error ?? "Loading match state."}
        </KitNotice>
        {!isLoading && error ? (
          <div className="gg-row">
            <KitButton
              onClick={() => window.location.reload()}
              type="button"
              variant="ghost"
            >
              Retry
            </KitButton>
            <KitButtonLink href="/" variant="primary">
              Create a new match
            </KitButtonLink>
          </div>
        ) : null}
      </KitPanel>
    </div>
  );
}

function LockedRoom({
  error,
  lobby,
  onUnlock,
  surface,
  themeClass,
  unlockError,
}: {
  error: string | null;
  lobby: MatchRoomLobby;
  onUnlock: (managementCode: string) => Promise<void>;
  surface: GauntletMatchSurface;
  themeClass: string;
  unlockError: string | null;
}) {
  const [passcode, setPasscode] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const isMountedRef = useRef(true);
  const currentGameTitle = getCurrentGameTitle(surface);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUnlocking(true);

    try {
      await onUnlock(passcode);
      if (isMountedRef.current) {
        setPasscode("");
      }
    } finally {
      if (isMountedRef.current) {
        setIsUnlocking(false);
      }
    }
  }

  return (
    <div className={mergeClassNames("gg-content__inner", themeClass)}>
      <div className="gg-lockscreen">
        <KitPanel className="gg-lockcard" eyebrow="Control room" title="Locked">
          <Ico name="lock" className="gg-lock-ico" />
          <div className="gg-lockcard__score" data-testid="public-score">
            <p className="gg-pick__label">{surface.title}</p>
            <p className="gg-pick__title">
              {lobby.players[0]?.displayName} {lobby.players[0]?.wins} /{" "}
              {lobby.players[1]?.wins} {lobby.players[1]?.displayName}
            </p>
            <p className="gg-field__hint">
              {lobby.currentGameId
                ? `Now playing ${currentGameTitle}`
                : "No pick yet"}
            </p>
          </div>
          <p
            className="gg-panel__summary"
            style={{ margin: 0, textAlign: "center" }}
          >
            This room is for streamers and mods. Enter the management passcode
            to take control. Viewers watch through your OBS overlays, not here.
          </p>
          <form
            aria-busy={isUnlocking ? "true" : undefined}
            onSubmit={handleUnlock}
          >
            <KitTextField
              autoComplete="off"
              autoFocus
              error={unlockError}
              label="Management passcode"
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="GG-••••-••••-••••"
              value={passcode}
            />
            <KitButton
              block
              disabled={isUnlocking}
              type="submit"
              variant="primary"
            >
              {isUnlocking ? "Unlocking…" : "Unlock controls"}
            </KitButton>
          </form>
          {error ? (
            <KitNotice aria-live="polite" role="status" tone="warning">
              {error}
            </KitNotice>
          ) : null}
        </KitPanel>
      </div>
    </div>
  );
}

function MatchHeader({
  actions,
  lobby,
  onThemeChange,
  theme,
}: {
  actions: MatchRoomActions;
  lobby: MatchRoomLobby;
  onThemeChange: (theme: OverlayTheme) => void;
  theme: OverlayTheme;
}) {
  const [titleDraft, setTitleDraft] = useState(lobby.title);

  useEffect(() => {
    setTitleDraft(lobby.title);
  }, [lobby.title]);

  function commitTitle() {
    const trimmedTitle = titleDraft.trim();

    if (trimmedTitle && trimmedTitle !== lobby.title) {
      actions.setTitle(trimmedTitle);
      return;
    }

    setTitleDraft(lobby.title);
  }

  return (
    <header className="gg-match-head">
      <div className="gg-match-head__title">
        <input
          aria-label="Match title"
          className="gg-title-input"
          maxLength={60}
          onBlur={commitTitle}
          onChange={(event) => setTitleDraft(event.target.value)}
          onKeyDown={(event) =>
            handleCommitKeys(event, () => setTitleDraft(lobby.title))
          }
          value={titleDraft}
        />
      </div>
      <div className="gg-shell__actions">
        <label className="gg-theme-pick">
          <span>Theme</span>
          <select
            aria-label="Overlay theme"
            onChange={(event) => {
              if (isTheme(event.target.value)) {
                onThemeChange(event.target.value);
              }
            }}
            value={theme}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <KitButtonLink href={buildOverlaysUrl(lobby.lobbyId)} variant="ghost">
          <Ico name="obs" /> Add to OBS
        </KitButtonLink>
      </div>
    </header>
  );
}

const MASKED_PASSCODE = "GG-••••-••••-••••";

// Slim share strip across the top of the unlocked room (it reclaims the space
// the page brand used to occupy). Surfaces the one shareable link plus the
// management passcode behind a reveal guard so it never sits on screen while the
// streamer is live.
function ShareBar({
  lobbyId,
  managementCode,
}: {
  lobbyId: string;
  managementCode: string | null;
}) {
  const matchPath = buildMatchUrl(lobbyId);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isConfirmingReveal, setIsConfirmingReveal] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const statusResetRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (statusResetRef.current !== null) {
        window.clearTimeout(statusResetRef.current);
      }
    },
    []
  );

  function absoluteMatchUrl(): string {
    return buildPublicUrl(matchPath);
  }

  async function copy(text: string, label: string) {
    let ok = true;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }

    setStatus({ message: ok ? `${label} copied.` : `${label} copy failed.`, ok });

    if (statusResetRef.current !== null) {
      window.clearTimeout(statusResetRef.current);
    }

    statusResetRef.current = window.setTimeout(() => {
      setStatus(null);
      statusResetRef.current = null;
    }, 1800);
  }

  async function shareMatch() {
    const url = absoluteMatchUrl();

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Gaming Gauntlet match", url });
      } catch {
        // The streamer dismissed the share sheet, or it failed — leave the
        // copy/share controls untouched so they can try again.
      }

      return;
    }

    await copy(url, "Match URL");
  }

  return (
    <div className="gg-sharebar">
      <div className="gg-sharebar__field">
        <span className="gg-sharebar__label">Match URL</span>
        <code className="gg-sharebar__value">{matchPath}</code>
        <KitButton
          onClick={() => copy(absoluteMatchUrl(), "Match URL")}
          size="sm"
          type="button"
        >
          <Ico name="copy" /> Copy
        </KitButton>
        <KitButton onClick={shareMatch} size="sm" type="button" variant="ghost">
          <Ico name="share" /> Share
        </KitButton>
      </div>

      <div className="gg-sharebar__field">
        <span className="gg-sharebar__label">Passcode</span>
        <code className="gg-sharebar__value gg-sharebar__value--code">
          {isRevealed && managementCode ? managementCode : MASKED_PASSCODE}
        </code>
        {isRevealed ? (
          <KitButton
            onClick={() => {
              setIsRevealed(false);
              setIsConfirmingReveal(false);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Ico name="eye" /> Hide
          </KitButton>
        ) : isConfirmingReveal ? (
          <>
            <KitButton
              onClick={() => {
                setIsRevealed(true);
                setIsConfirmingReveal(false);
              }}
              size="sm"
              type="button"
              variant="primary"
            >
              Yes, reveal
            </KitButton>
            <KitButton
              onClick={() => setIsConfirmingReveal(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </KitButton>
          </>
        ) : (
          <KitButton
            onClick={() => setIsConfirmingReveal(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Ico name="eye" /> Reveal
          </KitButton>
        )}
        <KitButton
          disabled={!managementCode}
          onClick={() => managementCode && copy(managementCode, "Passcode")}
          size="sm"
          type="button"
        >
          <Ico name="copy" /> Copy
        </KitButton>
      </div>

      {isConfirmingReveal ? (
        <p className="gg-sharebar__warn" role="status">
          Anyone watching your stream can read this — make sure you’re not live.
        </p>
      ) : null}
      {status ? (
        <p
          aria-atomic="true"
          aria-live="polite"
          className={mergeClassNames(
            "gg-sharebar__status",
            !status.ok && "gg-sharebar__status--error"
          )}
          role="status"
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function ScoreboardPanel({
  actions,
  lobby,
  surface,
}: {
  actions: MatchRoomActions;
  lobby: MatchRoomLobby;
  surface: GauntletMatchSurface;
}) {
  const targetText =
    lobby.targetScore === null ? "" : String(lobby.targetScore);
  const [targetDraft, setTargetDraft] = useState(targetText);

  useEffect(() => {
    setTargetDraft(targetText);
  }, [targetText]);

  function commitTarget() {
    const trimmedTarget = targetDraft.trim();

    if (!trimmedTarget) {
      if (lobby.targetScore !== null) {
        actions.setTarget(null);
      }

      return;
    }

    const parsedTarget = TargetScoreSchema.safeParse(Number(trimmedTarget));

    if (parsedTarget.success) {
      if (parsedTarget.data !== lobby.targetScore) {
        actions.setTarget(parsedTarget.data);
      }

      return;
    }

    setTargetDraft(targetText);
  }

  return (
    <KitPanel eyebrow="Live" title="Scoreboard">
      <ScoreBar actions={actions} surface={surface} />
      <div className="gg-scorebar__meta">
        <label className="gg-field">
          <span>Set target score</span>
          <input
            aria-label="Set target score"
            inputMode="numeric"
            max={99}
            min={1}
            onBlur={commitTarget}
            onChange={(event) => setTargetDraft(event.target.value)}
            onKeyDown={(event) =>
              handleCommitKeys(event, () => setTargetDraft(targetText))
            }
            placeholder="Open"
            type="number"
            value={targetDraft}
          />
        </label>
        <div className="gg-scorebar__meta-actions">
          <KitButton onClick={actions.resetScores} size="sm" variant="ghost">
            Reset scores
          </KitButton>
          <KitButton
            disabled={!lobby.currentGameId}
            onClick={actions.clearCurrentGame}
            size="sm"
            variant="ghost"
          >
            Clear pick
          </KitButton>
          <KitButton onClick={actions.resetMatch} size="sm" variant="danger">
            Reset match
          </KitButton>
        </div>
      </div>
    </KitPanel>
  );
}

function ScoreBar({
  actions,
  surface,
}: {
  actions: MatchRoomActions;
  surface: GauntletMatchSurface;
}) {
  return (
    <div className="gg-scorebar">
      <ScoreTeam
        actions={actions}
        playerIndex={0}
        surface={surface}
        tone="alpha"
      />
      <div className="gg-scorebar__vs">
        <b>VS</b>
        <span>
          {surface.targetWins ? `First to ${surface.targetWins}` : "Open mode"}
        </span>
      </div>
      <ScoreTeam
        actions={actions}
        playerIndex={1}
        surface={surface}
        tone="bravo"
      />
    </div>
  );
}

function ScoreTeam({
  actions,
  playerIndex,
  surface,
  tone,
}: {
  actions: MatchRoomActions;
  playerIndex: 0 | 1;
  surface: GauntletMatchSurface;
  tone: "alpha" | "bravo";
}) {
  const player = surface.players[playerIndex];
  const playerName = player?.displayName ?? `Player ${playerIndex + 1}`;
  const [nameDraft, setNameDraft] = useState(playerName);

  useEffect(() => {
    setNameDraft(playerName);
  }, [playerName]);

  function commitName() {
    const trimmedName = nameDraft.trim();

    if (trimmedName && trimmedName !== playerName) {
      actions.renamePlayer(playerIndex, trimmedName);
      return;
    }

    setNameDraft(playerName);
  }

  return (
    <div className={`gg-scorebar__team gg-scorebar__team--${tone}`}>
      <input
        aria-label={`Player ${playerIndex + 1} name`}
        className="gg-scorebar__name"
        maxLength={40}
        onBlur={commitName}
        onChange={(event) => setNameDraft(event.target.value)}
        onKeyDown={(event) =>
          handleCommitKeys(event, () => setNameDraft(playerName))
        }
        value={nameDraft}
      />
      <div className="gg-scorebar__ctrl">
        <button
          aria-label={`Decrease ${playerName} score`}
          className="gg-scorebar__step"
          onClick={() => actions.setScore(playerIndex, -1)}
          type="button"
        >
          -
        </button>
        <span className="gg-scorebar__score">{player?.wins ?? 0}</span>
        <button
          aria-label={`Increase ${playerName} score`}
          className="gg-scorebar__step"
          onClick={() => actions.setScore(playerIndex, 1)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SpinPanel({
  lobby,
  onWheelStyleChange,
  spin,
  surface,
  wheelStyle,
}: {
  lobby: MatchRoomLobby;
  onWheelStyleChange: (style: "radial" | "reel") => void;
  spin: () => Promise<string | null>;
  surface: GauntletMatchSurface;
  wheelStyle: "radial" | "reel";
}) {
  const [spinSignal, setSpinSignal] = useState(0);
  const [winnerGameId, setWinnerGameId] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const isMountedRef = useRef(true);
  const enabledGames = lobby.games.filter((game) => game.enabled);
  const currentGameTitle = getCurrentGameTitle(surface);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );

  async function handleSpin() {
    if (spinning || enabledGames.length === 0) {
      return;
    }

    setSpinning(true);

    const winner = await spin();

    if (!isMountedRef.current) {
      return;
    }

    if (winner) {
      setWinnerGameId(winner);
      setSpinSignal((signal) => signal + 1);
    } else {
      setSpinning(false);
    }
  }

  return (
    <KitPanel
      actions={
        <div className="gg-row" style={{ gap: "0.5rem" }}>
          <div aria-label="Wheel style" className="gg-seg" role="group">
            <button
              aria-pressed={wheelStyle === "radial"}
              className={mergeClassNames(
                wheelStyle === "radial" && "is-active"
              )}
              onClick={() => onWheelStyleChange("radial")}
              type="button"
            >
              Radial
            </button>
            <button
              aria-pressed={wheelStyle === "reel"}
              className={mergeClassNames(wheelStyle === "reel" && "is-active")}
              onClick={() => onWheelStyleChange("reel")}
              type="button"
            >
              Reel
            </button>
          </div>
          <KitChip tone="soft">{enabledGames.length} games</KitChip>
        </div>
      }
      eyebrow="The gauntlet"
      title="Spin to pick"
    >
      <div className="gg-wheel-stage" data-testid="wheel-shell">
        <Wheel
          games={lobby.games}
          onResult={() => setSpinning(false)}
          spinSignal={spinSignal}
          style={wheelStyle}
          winnerGameId={winnerGameId}
        />
        <div className="gg-row" style={{ justifyContent: "center" }}>
          <KitButton
            disabled={spinning || enabledGames.length === 0}
            onClick={handleSpin}
            type="button"
            variant="primary"
          >
            {spinning ? "Spinning…" : "Spin the gauntlet"}
          </KitButton>
        </div>
      </div>
      <div className="gg-pick">
        <p className="gg-pick__label">
          {spinning
            ? "Spinning…"
            : lobby.currentGameId
              ? "Now playing"
              : "No pick yet"}
        </p>
        <p
          className={mergeClassNames(
            "gg-pick__title",
            (spinning || !lobby.currentGameId) && "is-empty"
          )}
        >
          {spinning ? "—" : currentGameTitle}
        </p>
      </div>
    </KitPanel>
  );
}

function GamePoolEditor({
  actions,
  lobby,
}: {
  actions: MatchRoomActions;
  lobby: MatchRoomLobby;
}) {
  const [adding, setAdding] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [outside, setOutside] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    []
  );

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = adding.trim();

    if (!trimmedTitle) {
      return;
    }

    actions.addGame(trimmedTitle);
    setAdding("");
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    gameId: string,
    isEditing: boolean
  ) {
    if (isEditing || (event.button !== undefined && event.button !== 0)) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const startedOnGrip = Boolean(target?.closest(".gg-game__grip"));
    const startedOnControl = Boolean(
      target?.closest('button, input, [role="switch"]')
    );

    if (!startedOnGrip && startedOnControl) {
      return;
    }

    dragCleanupRef.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let currentOverId = gameId;
    let currentOutside = false;
    let isCleanedUp = false;
    let listBounds: DOMRect | null = null;
    let rowTargets: Array<{ bottom: number; id: string; top: number }> = [];

    const captureHitTargets = () => {
      const list = listRef.current;

      listBounds = list?.getBoundingClientRect() ?? null;
      rowTargets = list
        ? Array.from(
            list.querySelectorAll<HTMLElement>("[data-game-id]")
          ).flatMap((row) => {
            const id = row.getAttribute("data-game-id");

            if (!id) {
              return [];
            }

            const rect = row.getBoundingClientRect();

            return [{ bottom: rect.bottom, id, top: rect.top }];
          })
        : [];
    };

    const activate = () => {
      active = true;
      captureHitTargets();
      setDragId(gameId);
      setOverId(gameId);
      setOutside(false);
      document.body.style.userSelect = "none";
    };

    const move = (moveEvent: PointerEvent) => {
      if (!active) {
        const hasMovedEnough =
          Math.abs(moveEvent.clientX - startX) >= 5 ||
          Math.abs(moveEvent.clientY - startY) >= 5;

        if (!hasMovedEnough) {
          return;
        }

        activate();
      }

      const isInside = listBounds
        ? moveEvent.clientX >= listBounds.left - 6 &&
          moveEvent.clientX <= listBounds.right + 6 &&
          moveEvent.clientY >= listBounds.top - 6 &&
          moveEvent.clientY <= listBounds.bottom + 6
        : true;

      if (currentOutside !== !isInside) {
        currentOutside = !isInside;
        setOutside(currentOutside);
      }

      if (!isInside) {
        return;
      }

      let targetId: string | null = null;

      for (const rowTarget of rowTargets) {
        if (
          moveEvent.clientY >= rowTarget.top &&
          moveEvent.clientY <= rowTarget.bottom
        ) {
          targetId = rowTarget.id;
          break;
        }
      }

      if (!targetId && rowTargets.length > 0) {
        const firstRow = rowTargets[0];
        const fallbackRow =
          firstRow && moveEvent.clientY < firstRow.top
            ? firstRow
            : rowTargets[rowTargets.length - 1];

        targetId = fallbackRow?.id ?? null;
      }

      if (targetId && targetId !== currentOverId) {
        currentOverId = targetId;
        setOverId(targetId);
      }
    };

    const finishDrag = (shouldCommit: boolean) => {
      if (isCleanedUp) {
        return;
      }

      isCleanedUp = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.body.style.userSelect = "";
      dragCleanupRef.current = null;

      if (shouldCommit && active) {
        if (currentOutside) {
          actions.removeGame(gameId);
        } else if (currentOverId && currentOverId !== gameId) {
          actions.reorderGames(gameId, currentOverId);
        }
      }

      setDragId(null);
      setOverId(null);
      setOutside(false);
    };

    const up = () => {
      finishDrag(true);
    };

    const cancel = () => {
      finishDrag(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    dragCleanupRef.current = cancel;
  }

  const drag: DragState = { dragId, overId, outside, onStart: beginDrag };
  const enabledCount = lobby.games.filter((game) => game.enabled).length;

  return (
    <KitPanel
      actions={
        <KitChip tone="soft">{`${enabledCount}/${lobby.games.length} active`}</KitChip>
      }
      eyebrow="Game pool"
      title="Games"
    >
      <form className="gg-share" onSubmit={add}>
        <input
          aria-label="Add game title"
          maxLength={80}
          onChange={(event) => setAdding(event.target.value)}
          placeholder="Add a game..."
          value={adding}
        />
        <KitButton type="submit" variant="primary">
          Add
        </KitButton>
      </form>

      {lobby.games.length === 0 ? (
        <KitNotice style={{ margin: 0 }}>
          No games yet. Add a few above to fill the wheel.
        </KitNotice>
      ) : (
        <div
          className={mergeClassNames(
            "gg-games",
            dragId && "is-dragging-list",
            dragId && outside && "is-deleting"
          )}
          ref={listRef}
        >
          {lobby.games.map((game, index) => (
            <GameRow
              actions={actions}
              drag={drag}
              game={game}
              index={index}
              isCurrent={game.id === lobby.currentGameId}
              key={game.id}
              total={lobby.games.length}
            />
          ))}
        </div>
      )}
      <p
        className={mergeClassNames(
          "gg-field__hint",
          dragId && outside && "gg-field__hint--danger"
        )}
      >
        {dragId
          ? outside
            ? "Release here to remove this game."
            : "Drag onto another row to reorder, or outside the list to remove."
          : "Drag a row to reorder, or drag it outside the list to remove. Double-click a name to rename; toggle the switch to keep it out of the spin."}
      </p>
    </KitPanel>
  );
}

function GameRow({
  actions,
  drag,
  game,
  index,
  isCurrent,
  total,
}: {
  actions: MatchRoomActions;
  drag: DragState;
  game: MatchRoomGame;
  index: number;
  isCurrent: boolean;
  total: number;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(game.title);

  function commit() {
    const trimmedDraft = draft.trim();

    if (trimmedDraft) {
      actions.renameGame(game.id, trimmedDraft);
    }

    setIsEditing(false);
  }

  function startEditing() {
    setDraft(game.title);
    setIsEditing(true);
  }

  function handleToggleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.toggleGame(game.id);
    }
  }

  return (
    <div
      className={mergeClassNames(
        "gg-game",
        !game.enabled && "is-disabled",
        isCurrent && "is-current",
        drag.dragId === game.id && "is-dragging",
        drag.dragId === game.id && drag.outside && "is-removing",
        drag.overId === game.id && drag.dragId !== game.id && "is-over"
      )}
      data-game-id={game.id}
      onPointerDown={(event) => drag.onStart(event, game.id, isEditing)}
    >
      <div
        aria-hidden="true"
        className="gg-game__grip"
        style={{ cursor: "grab", touchAction: "none" }}
        title="Drag the row to reorder"
      >
        <span />
        <span />
        <span />
      </div>
      <div className="gg-game__order">
        <button
          aria-label={`Move ${game.title} up`}
          disabled={index === 0}
          onClick={() => actions.moveGame(game.id, -1)}
          type="button"
        >
          ▲
        </button>
        <button
          aria-label={`Move ${game.title} down`}
          disabled={index === total - 1}
          onClick={() => actions.moveGame(game.id, 1)}
          type="button"
        >
          ▼
        </button>
      </div>
      <div
        aria-label={
          game.enabled
            ? `${game.title} is enabled for spins`
            : `${game.title} is disabled for spins`
        }
        aria-checked={game.enabled}
        className={mergeClassNames("gg-toggle", game.enabled && "is-on")}
        onClick={() => actions.toggleGame(game.id)}
        onKeyDown={handleToggleKey}
        role="switch"
        tabIndex={0}
        title={
          game.enabled ? "Enabled - in the pool" : "Disabled - skipped on spin"
        }
      />
      <div className="gg-game__title">
        {isEditing ? (
          <input
            aria-label={`Rename ${game.title}`}
            autoFocus
            onBlur={commit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
              }

              if (event.key === "Escape") {
                setIsEditing(false);
              }
            }}
            value={draft}
          />
        ) : (
          <span onDoubleClick={startEditing}>{game.title}</span>
        )}
      </div>
      <div className="gg-game__actions">
        {isCurrent ? (
          <span
            aria-label="Live now"
            className="gg-live-dot"
            role="img"
            title="Live now"
          />
        ) : null}
        <KitButton
          onClick={startEditing}
          size="sm"
          type="button"
          variant="ghost"
        >
          Edit
        </KitButton>
        <KitButton
          aria-label={`Delete ${game.title}`}
          onClick={() => actions.removeGame(game.id)}
          size="sm"
          type="button"
          variant="danger"
        >
          <Ico name="trash" />
        </KitButton>
      </div>
    </div>
  );
}

function getCurrentGameTitle(surface: GauntletMatchSurface): string {
  if (!surface.currentGameId) {
    return "Awaiting spin";
  }

  return surface.currentGame?.title ?? "Selected game unavailable";
}
