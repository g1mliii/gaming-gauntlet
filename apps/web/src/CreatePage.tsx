import { useState } from "react";
import type { FormEvent } from "react";
import {
  KitButton,
  KitNotice,
  KitPanel,
  KitTextField,
  KitTextareaField,
  PageShell,
} from "@gaming-gauntlet/ui";
import type { CreateLobbyRequestInput } from "@gaming-gauntlet/core";

import { createLobby, verifyLobbyPasscode } from "./lobby-api";
import {
  buildMatchUrl,
  extractLobbyIdFromMatchReference,
  storeManagementPasscode,
} from "./management-passcodes";
import { navigateTo } from "./navigation";

const maskedPasscode = "GG-••••-••••-••••";

export default function CreatePage() {
  const [playerOneName, setPlayerOneName] = useState("");
  const [playerTwoName, setPlayerTwoName] = useState("");
  const [startingGames, setStartingGames] = useState("");
  const [targetScore, setTargetScore] = useState("");
  const [matchReference, setMatchReference] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    const payload = createPayload();

    if (!payload) {
      setCreateError("Player names are required.");
      return;
    }

    setIsCreating(true);

    try {
      const created = await createLobby(payload);
      storeManagementPasscode(created.lobbyId, created.managementCode);
      // Straight into the match room — it auto-unlocks from the stored passcode
      // and hosts the share + passcode controls now, so there is no interstitial.
      navigateTo(buildMatchUrl(created.lobbyId));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Create failed.");
      setIsCreating(false);
    }
  }

  async function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinError(null);

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
      navigateTo(buildMatchUrl(lobbyId));
    } catch (error) {
      setJoinError(
        error instanceof Error ? error.message : "Verification failed."
      );
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
      playerTwoName: trimmedPlayerTwoName,
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
              Already created a match in this browser session? Your passcode is
              remembered automatically — just open the match room.
            </p>
          </form>
        </KitPanel>
      </div>
    </PageShell>
  );
}
