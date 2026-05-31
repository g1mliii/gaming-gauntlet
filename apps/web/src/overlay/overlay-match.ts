import { deriveLobbyTitle } from "@gaming-gauntlet/core";
import type { PublicLobbyState } from "@gaming-gauntlet/core";

// View model the overlay graphics render from. It mirrors the shape used by the
// match room (toMatchRoomLobby) but exposes only the public fields an overlay
// needs — never the management passcode or any write affordance.

export type OverlayMatchPlayer = {
  displayName: string;
  wins: number;
};

export type OverlayMatchGame = {
  id: string;
  title: string;
  enabled: boolean;
};

export type OverlayMatch = {
  title: string;
  players: OverlayMatchPlayer[];
  targetWins: number | null;
  games: OverlayMatchGame[];
  currentGameId: string | null;
};

export function toOverlayMatch(state: PublicLobbyState): OverlayMatch {
  const title =
    state.lobby.title ||
    deriveLobbyTitle(state.lobby.playerOneName, state.lobby.playerTwoName);

  return {
    title,
    players: [
      {
        displayName: state.lobby.playerOneName,
        wins: state.lobby.playerOneScore,
      },
      {
        displayName: state.lobby.playerTwoName,
        wins: state.lobby.playerTwoScore,
      },
    ],
    targetWins: state.lobby.targetScore,
    games: state.games.map((game) => ({
      id: game.id,
      title: game.title,
      enabled: game.enabled,
    })),
    currentGameId: state.lobby.currentGameId,
  };
}

export function currentGameTitle(match: OverlayMatch): string {
  if (!match.currentGameId) {
    return "Awaiting spin";
  }

  const current = match.games.find((game) => game.id === match.currentGameId);

  return current?.title ?? "Selected game unavailable";
}

export function nextPooledGameTitle(match: OverlayMatch): string | null {
  if (!match.currentGameId) {
    const firstEnabled = match.games.find((game) => game.enabled);

    return firstEnabled?.title ?? null;
  }

  const enabled = match.games.filter((game) => game.enabled);
  const currentIndex = enabled.findIndex(
    (game) => game.id === match.currentGameId
  );

  if (currentIndex < 0 || enabled.length < 2) {
    return null;
  }

  const next = enabled[(currentIndex + 1) % enabled.length];

  return next?.title ?? null;
}
