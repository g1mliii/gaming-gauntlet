import { useState } from "react";
import type { FormEvent } from "react";
import {
  Ico,
  KitButton,
  KitNotice,
  KitPanel,
  KitTextField,
  KitTextareaField,
  PageShell
} from "@gaming-gauntlet/ui";
import type { CreateLobbyRequestInput } from "@gaming-gauntlet/core";

import { createLobby, verifyLobbyPasscode } from "./lobby-api";
import {
  buildManageUrl,
  buildMatchUrl,
  extractLobbyIdFromMatchReference,
  storeManagementPasscode
} from "./management-passcodes";

type CreateResult = {
  type: "created";
  lobbyId: string;
  managementCode: string;
};

type JoinResult = {
  type: "verified";
  lobbyId: string;
};

type FlowResult = CreateResult | JoinResult;

const maskedPasscode = "GG-••••-••••-••••";

function CopyField({
  label,
  value,
  onCopy
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="gg-copyfield">
      {label ? <span className="gg-copyfield__label">{label}</span> : null}
      <div className="gg-share">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.target.select()}
          aria-label={label}
        />
        <KitButton type="button" onClick={onCopy}>
          <Ico name="copy" /> Copy
        </KitButton>
      </div>
    </div>
  );
}

export default function CreatePage() {
  const [playerOneName, setPlayerOneName] = useState("");
  const [playerTwoName, setPlayerTwoName] = useState("");
  const [startingGames, setStartingGames] = useState("");
  const [targetScore, setTargetScore] = useState("");
  const [matchReference, setMatchReference] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [result, setResult] = useState<FlowResult | null>(null);
  const [isPasscodeRevealed, setIsPasscodeRevealed] = useState(false);
  const [isConfirmingReveal, setIsConfirmingReveal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setCopyStatus(null);

    const payload = createPayload();

    if (!payload) {
      setCreateError("Player names are required.");
      return;
    }

    setIsCreating(true);

    try {
      const created = await createLobby(payload);
      storeManagementPasscode(created.lobbyId, created.managementCode);
      setResult({
        type: "created",
        lobbyId: created.lobbyId,
        managementCode: created.managementCode
      });
      setIsPasscodeRevealed(false);
      setIsConfirmingReveal(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Create failed.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinError(null);
    setCopyStatus(null);

    const lobbyId = extractLobbyIdFromMatchReference(matchReference);
    const trimmedPasscode = joinPasscode.trim();

    if (!lobbyId) {
      setJoinError("Enter a valid match URL or lobby id.");
      return;
    }

    if (!trimmedPasscode) {
      setJoinError("Management passcode is required.");
      return;
    }

    setIsVerifying(true);

    try {
      await verifyLobbyPasscode(lobbyId, trimmedPasscode);
      storeManagementPasscode(lobbyId, trimmedPasscode);
      setResult({ type: "verified", lobbyId });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setIsVerifying(false);
    }
  }

  function createPayload(): CreateLobbyRequestInput | null {
    const trimmedPlayerOneName = playerOneName.trim();
    const trimmedPlayerTwoName = playerTwoName.trim();

    if (!trimmedPlayerOneName || !trimmedPlayerTwoName) {
      return null;
    }

    const games = startingGames
      .split(/\r?\n/)
      .map((game) => game.trim())
      .filter(Boolean);
    const payload: CreateLobbyRequestInput = {
      playerOneName: trimmedPlayerOneName,
      playerTwoName: trimmedPlayerTwoName
    };
    const parsedTargetScore = Number(targetScore);

    if (games.length > 0) {
      payload.games = games;
    }

    if (targetScore.trim() && Number.isInteger(parsedTargetScore)) {
      payload.targetScore = parsedTargetScore;
    }

    return payload;
  }

  function requestReveal() {
    setIsConfirmingReveal(true);
  }

  function confirmReveal() {
    setIsPasscodeRevealed(true);
    setIsConfirmingReveal(false);
  }

  function cancelReveal() {
    setIsConfirmingReveal(false);
  }

  function hidePasscode() {
    setIsPasscodeRevealed(false);
    setIsConfirmingReveal(false);
  }

  async function copyManagementPasscode() {
    if (result?.type !== "created") {
      return;
    }

    setCopyStatus(null);

    try {
      await navigator.clipboard.writeText(result.managementCode);
      setCopyStatus("Passcode copied.");
    } catch {
      setCopyStatus("Passcode copy failed.");
    }
  }

  async function copyMatchUrl() {
    setCopyStatus(null);

    try {
      await navigator.clipboard.writeText(matchUrl);
      setCopyStatus("Match URL copied.");
    } catch {
      setCopyStatus("Match URL copy failed.");
    }
  }

  const resultLobbyId = result?.lobbyId ?? null;
  const matchUrl = resultLobbyId ? buildMatchUrl(resultLobbyId) : "";

  return (
    <PageShell
      eyebrow="Lobby setup"
      title="Create lobby"
      deck="Spin up a two-player gauntlet, then share one match URL. The management passcode is yours alone — it never lands in a link."
      emphasis="section"
    >
      <div className="gg-create-grid">
        <KitPanel eyebrow="New match" title="Create">
          <form className="gg-form" onSubmit={handleCreateSubmit}>
            <div className="gg-form-pair">
              <KitTextField
                autoComplete="off"
                label="Player 1 name"
                maxLength={40}
                name="playerOneName"
                onChange={(event) => setPlayerOneName(event.target.value)}
                placeholder="NOVA"
                required
                value={playerOneName}
              />
              <KitTextField
                autoComplete="off"
                label="Player 2 name"
                maxLength={40}
                name="playerTwoName"
                onChange={(event) => setPlayerTwoName(event.target.value)}
                placeholder="RIPTIDE"
                required
                value={playerTwoName}
              />
            </div>
            <KitTextareaField
              label="Starting games (optional)"
              name="startingGames"
              onChange={(event) => setStartingGames(event.target.value)}
              placeholder={"Rocket League\nTetris\nStreet Fighter 6"}
              rows={5}
              value={startingGames}
            />
            <KitTextField
              hint="Leave blank for open mode — play as long as you like."
              inputMode="numeric"
              label="Target score (optional)"
              min={1}
              max={99}
              name="targetScore"
              onChange={(event) => setTargetScore(event.target.value)}
              placeholder="5"
              type="number"
              value={targetScore}
            />
            <div className="gg-row">
              <KitButton disabled={isCreating} type="submit" variant="primary">
                {isCreating ? "Creating…" : "Create match"}
              </KitButton>
            </div>
            {createError ? (
              <KitNotice aria-live="polite" role="status" tone="warning">
                {createError}
              </KitNotice>
            ) : null}
          </form>
        </KitPanel>

        <KitPanel eyebrow="Existing match" title="Join to manage">
          <form className="gg-form" onSubmit={handleJoinSubmit}>
            <KitTextField
              autoComplete="off"
              label="Match URL or ID"
              name="matchReference"
              onChange={(event) => setMatchReference(event.target.value)}
              placeholder="gaminggauntlet.com/g/lob_8fk2n4qz"
              value={matchReference}
            />
            <KitTextField
              autoComplete="off"
              label="Management passcode"
              name="managementPasscode"
              onChange={(event) => setJoinPasscode(event.target.value)}
              placeholder={maskedPasscode}
              value={joinPasscode}
            />
            <div className="gg-row">
              <KitButton disabled={isVerifying} type="submit" variant="primary">
                {isVerifying ? "Verifying…" : "Verify passcode"}
              </KitButton>
            </div>
            {joinError ? (
              <KitNotice aria-live="polite" role="status" tone="warning">
                {joinError}
              </KitNotice>
            ) : null}
            <p className="gg-field__hint">
              Already created a match on this device? Your passcode is remembered
              automatically — just open the match room.
            </p>
          </form>
        </KitPanel>
      </div>

      {result ? (
        <KitPanel
          className="gg-create-result"
          eyebrow={result.type === "created" ? "Created" : "Verified"}
          title="Match ready"
          actions={
            <>
              <a className="gg-button gg-button--primary" href={matchUrl}>
                Open match room
              </a>
              <a className="gg-button gg-button--ghost" href={buildManageUrl(result.lobbyId)}>
                Manage this match
              </a>
            </>
          }
        >
          <p className="gg-panel__summary" style={{ marginTop: 0 }}>
            Share the match URL with your opponent, chat, and OBS. Keep the
            passcode private — anyone with it can control the scoreboard.
          </p>
          <CopyField
            label="Match URL — the only link you share"
            value={matchUrl}
            onCopy={copyMatchUrl}
          />

          {result.type === "created" ? (
            <div className="gg-passcode">
              <div className="gg-spread">
                <div>
                  <p className="gg-passcode__label">Management passcode</p>
                  <p
                    className={`gg-passcode__value${
                      isPasscodeRevealed ? "" : " is-masked"
                    }`}
                  >
                    {isPasscodeRevealed ? result.managementCode : maskedPasscode}
                  </p>
                </div>
                <div className="gg-row">
                  {isPasscodeRevealed ? (
                    <KitButton
                      aria-expanded
                      onClick={hidePasscode}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Ico name="eye" /> Hide
                    </KitButton>
                  ) : isConfirmingReveal ? (
                    <>
                      <KitButton
                        onClick={confirmReveal}
                        size="sm"
                        type="button"
                        variant="primary"
                      >
                        Yes, reveal
                      </KitButton>
                      <KitButton
                        onClick={cancelReveal}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Cancel
                      </KitButton>
                    </>
                  ) : (
                    <KitButton
                      aria-expanded={false}
                      onClick={requestReveal}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Ico name="eye" /> Reveal
                    </KitButton>
                  )}
                  <KitButton
                    disabled={!isPasscodeRevealed}
                    onClick={copyManagementPasscode}
                    size="sm"
                    type="button"
                  >
                    <Ico name="copy" /> Copy passcode
                  </KitButton>
                </div>
              </div>
              {isConfirmingReveal ? (
                <KitNotice style={{ margin: 0 }} tone="danger">
                  Reveal your passcode on screen? Anyone watching your stream can
                  read and copy it — make sure you’re not live.
                </KitNotice>
              ) : (
                <KitNotice style={{ margin: 0 }} tone="warning">
                  Saved to this device. Store it somewhere safe — we only keep a
                  hash, so we can’t recover it for you.
                </KitNotice>
              )}
            </div>
          ) : (
            <KitNotice style={{ margin: 0 }} tone="success">
              Passcode verified.
            </KitNotice>
          )}
          {copyStatus ? (
            <KitNotice aria-live="polite" role="status" tone="success">
              {copyStatus}
            </KitNotice>
          ) : null}
        </KitPanel>
      ) : null}
    </PageShell>
  );
}
