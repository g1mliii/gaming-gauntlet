import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampScore, deriveLobbyTitle } from "@gaming-gauntlet/core";
import type {
  Game,
  LobbyStatus,
  PublicLobbyState,
  UpdateLobbyRequest,
} from "@gaming-gauntlet/core";
import type { GauntletMatchSurface } from "@gaming-gauntlet/ui";

import {
  addGame as apiAddGame,
  deleteGame as apiDeleteGame,
  fetchPublicLobbyState,
  reorderGames as apiReorderGames,
  updateGame as apiUpdateGame,
  updateLobby as apiUpdateLobby,
  verifyLobbyPasscode,
} from "../lobby-api";
import {
  getManagementPasscodeStorageKey,
  storeManagementPasscode,
} from "../management-passcodes";

export type MatchRoomGame = Pick<Game, "enabled" | "id" | "position" | "title">;

export type MatchRoomLobby = {
  lobbyId: string;
  title: string;
  status: "done" | "live" | "ready";
  targetScore: number | null;
  players: Array<{ displayName: string; wins: number }>;
  games: MatchRoomGame[];
  currentGameId: string | null;
  version: number;
  updatedAt: string;
};

export type MatchRoomActions = {
  setScore: (playerIndex: number, delta: number) => void;
  resetScores: () => void;
  renamePlayer: (playerIndex: number, name: string) => void;
  setTarget: (targetScore: number | null) => void;
  setTitle: (title: string) => void;
  addGame: (title: string) => void;
  renameGame: (gameId: string, title: string) => void;
  removeGame: (gameId: string) => void;
  toggleGame: (gameId: string) => void;
  moveGame: (gameId: string, direction: -1 | 1) => void;
  reorderGames: (fromId: string, toId: string) => void;
  clearCurrentGame: () => void;
  resetMatch: () => void;
};

export type MatchRoomModel = {
  state: PublicLobbyState | null;
  lobby: MatchRoomLobby | null;
  surface: GauntletMatchSurface | null;
  actions: MatchRoomActions;
  isLoading: boolean;
  isUnlocked: boolean;
  isWriting: boolean;
  error: string | null;
  unlockError: string | null;
  unlock: (managementCode: string) => Promise<void>;
};

const CONTROL_POLL_INTERVAL_MS = 1500;
const LOCKED_POLL_INTERVAL_MS = 5000;
const HIDDEN_POLL_INTERVAL_MS = 30000;

export function useMatchRoom(lobbyId: string): MatchRoomModel {
  const [state, setState] = useState<PublicLobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [managementCode, setManagementCode] = useState<string | null>(() =>
    readStoredPasscode(lobbyId)
  );
  const stateRef = useRef<PublicLobbyState | null>(null);
  const lastWrittenVersionRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const managementCodeRef = useRef(managementCode);
  const mountedRef = useRef(true);
  const pendingWritesRef = useRef(0);
  const writeSequenceRef = useRef(0);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    managementCodeRef.current = managementCode;
  }, [managementCode]);

  const isCurrentGeneration = useCallback((generation: number) => {
    return mountedRef.current && lifecycleGenerationRef.current === generation;
  }, []);

  const acceptState = useCallback(
    (nextState: PublicLobbyState, options: { force?: boolean } = {}) => {
      const currentState = stateRef.current;
      const currentVersion = currentState?.version ?? 0;
      const lastWrittenVersion = lastWrittenVersionRef.current;

      if (
        !options.force &&
        (nextState.version <= currentVersion ||
          nextState.version < lastWrittenVersion)
      ) {
        return;
      }

      stateRef.current = nextState;
      setState(nextState);
      setError(null);
    },
    []
  );

  const refresh = useCallback(
    async (
      options: {
        force?: boolean;
        isActive?: () => boolean;
        signal?: AbortSignal;
      } = {}
    ) => {
      const isActive = options.isActive ?? (() => !options.signal?.aborted);

      try {
        const nextState = await fetchPublicLobbyState(lobbyId, {
          signal: options.signal,
        });

        if (!isActive()) {
          return;
        }

        acceptState(nextState, options);
      } catch (refreshError) {
        if (isAbortError(refreshError) || !isActive()) {
          return;
        }

        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Match state could not be loaded."
        );
      } finally {
        if (isActive()) {
          setIsLoading(false);
        }
      }
    },
    [acceptState, lobbyId]
  );

  useEffect(() => {
    const abortController = new AbortController();
    const generation = lifecycleGenerationRef.current + 1;
    let isMounted = true;
    let refreshInFlight = false;
    let pollTimeoutId: number | null = null;

    lifecycleGenerationRef.current = generation;
    setIsLoading(true);
    setError(null);
    stateRef.current = null;
    setState(null);
    lastWrittenVersionRef.current = 0;
    pendingWritesRef.current = 0;
    writeSequenceRef.current = 0;
    setIsWriting(false);
    setManagementCode(readStoredPasscode(lobbyId));

    const isActive = () =>
      isMounted &&
      isCurrentGeneration(generation) &&
      !abortController.signal.aborted;

    const scheduleRefresh = (
      delayMs = getPollInterval(Boolean(managementCodeRef.current))
    ) => {
      if (!isActive()) {
        return;
      }

      pollTimeoutId = window.setTimeout(() => {
        void refreshIfMounted().finally(() => {
          scheduleRefresh();
        });
      }, delayMs);
    };

    const clearScheduledRefresh = () => {
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
    };

    const refreshIfMounted = async (options: { force?: boolean } = {}) => {
      if (!isActive() || refreshInFlight) {
        return;
      }

      refreshInFlight = true;

      try {
        await refresh({
          ...options,
          isActive,
          signal: abortController.signal,
        });
      } finally {
        refreshInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      clearScheduledRefresh();
      scheduleRefresh(
        document.visibilityState === "hidden" ? HIDDEN_POLL_INTERVAL_MS : 0
      );
    };

    void refreshIfMounted({ force: true }).finally(() => {
      scheduleRefresh();
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      abortController.abort();
      clearScheduledRefresh();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isCurrentGeneration, lobbyId, refresh]);

  const runStateWrite = useCallback(
    async (
      optimistic: (current: PublicLobbyState) => PublicLobbyState,
      write: () => Promise<PublicLobbyState>
    ) => {
      if (!managementCode || !stateRef.current) {
        return;
      }

      const generation = lifecycleGenerationRef.current;
      const previousState = stateRef.current;
      const optimisticState = optimistic(previousState);
      const writeId = writeSequenceRef.current + 1;

      writeSequenceRef.current = writeId;
      pendingWritesRef.current += 1;
      lastWrittenVersionRef.current = Math.max(
        lastWrittenVersionRef.current,
        optimisticState.version
      );
      stateRef.current = optimisticState;
      setState(optimisticState);
      setIsWriting(true);

      try {
        const nextState = await write();

        if (
          isCurrentGeneration(generation) &&
          writeId === writeSequenceRef.current
        ) {
          acceptState(nextState, { force: true });
        }
      } catch (writeError) {
        if (
          isCurrentGeneration(generation) &&
          writeId === writeSequenceRef.current
        ) {
          stateRef.current = previousState;
          setState(previousState);
          setError(
            writeError instanceof Error ? writeError.message : "Write failed."
          );
        }
      } finally {
        if (isCurrentGeneration(generation)) {
          pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
          setIsWriting(pendingWritesRef.current > 0);
        }
      }
    },
    [acceptState, isCurrentGeneration, managementCode]
  );

  const runLobbyWrite = useCallback(
    (
      patch: UpdateLobbyRequest,
      optimistic: (current: PublicLobbyState) => PublicLobbyState
    ) => {
      if (!managementCode) {
        return Promise.resolve();
      }

      const code = managementCode;

      return runStateWrite(optimistic, () => apiUpdateLobby(lobbyId, code, patch));
    },
    [lobbyId, managementCode, runStateWrite]
  );

  const patchLobby = useCallback(
    (patch: UpdateLobbyRequest) => {
      void runLobbyWrite(patch, (stateToPatch) => bumpLobby(stateToPatch, patch));
    },
    [runLobbyWrite]
  );

  const reorderByIds = useCallback(
    (gameIds: string[]) => {
      if (!managementCode) {
        return;
      }

      void runStateWrite(
        (stateToPatch) => {
          const byId = new Map(
            stateToPatch.games.map((game) => [game.id, game])
          );
          const games = normalizePositions(
            gameIds
              .map((gameId) => byId.get(gameId))
              .filter((game): game is Game => Boolean(game))
          );

          return bumpState(stateToPatch, { games });
        },
        () => apiReorderGames(lobbyId, managementCode, gameIds)
      );
    },
    [lobbyId, managementCode, runStateWrite]
  );

  const actions = useMemo<MatchRoomActions>(
    () => ({
      setScore(playerIndex, delta) {
        const current = stateRef.current;

        if (!current) {
          return;
        }

        const currentScore =
          playerIndex === 0
            ? current.lobby.playerOneScore
            : current.lobby.playerTwoScore;
        const nextScore = clampScore(currentScore + delta);
        const patch: UpdateLobbyRequest =
          playerIndex === 0
            ? { playerOneScore: nextScore }
            : { playerTwoScore: nextScore };

        patchLobby(patch);
      },
      resetScores() {
        const patch = { playerOneScore: 0, playerTwoScore: 0 };

        patchLobby(patch);
      },
      renamePlayer(playerIndex, name) {
        const trimmedName = name.trim();

        if (!trimmedName) {
          return;
        }

        const patch: UpdateLobbyRequest =
          playerIndex === 0
            ? { playerOneName: trimmedName }
            : { playerTwoName: trimmedName };

        patchLobby(patch);
      },
      setTarget(targetScore) {
        const patch = { targetScore };

        patchLobby(patch);
      },
      setTitle(title) {
        const trimmedTitle = title.trim();

        if (!trimmedTitle) {
          return;
        }

        const patch = { title: trimmedTitle };

        patchLobby(patch);
      },
      addGame(title) {
        const trimmedTitle = title.trim();

        if (!trimmedTitle || !managementCode) {
          return;
        }

        void runStateWrite(
          (stateToPatch) => stateToPatch,
          () => apiAddGame(lobbyId, managementCode, { title: trimmedTitle })
        );
      },
      renameGame(gameId, title) {
        const trimmedTitle = title.trim();

        if (!trimmedTitle || !managementCode) {
          return;
        }

        void runStateWrite(
          (stateToPatch) =>
            bumpState(stateToPatch, {
              games: stateToPatch.games.map((game) =>
                game.id === gameId ? { ...game, title: trimmedTitle } : game
              ),
            }),
          () =>
            apiUpdateGame(lobbyId, managementCode, gameId, {
              title: trimmedTitle,
            })
        );
      },
      removeGame(gameId) {
        if (!managementCode) {
          return;
        }

        void runStateWrite(
          (stateToPatch) =>
            bumpState(stateToPatch, {
              lobby: {
                ...stateToPatch.lobby,
                currentGameId:
                  stateToPatch.lobby.currentGameId === gameId
                    ? null
                    : stateToPatch.lobby.currentGameId,
              },
              games: normalizePositions(
                stateToPatch.games.filter((game) => game.id !== gameId)
              ),
            }),
          () => apiDeleteGame(lobbyId, managementCode, gameId)
        );
      },
      toggleGame(gameId) {
        if (!managementCode) {
          return;
        }

        const game = stateRef.current?.games.find((item) => item.id === gameId);

        if (!game) {
          return;
        }

        void runStateWrite(
          (stateToPatch) =>
            bumpState(stateToPatch, {
              games: stateToPatch.games.map((item) =>
                item.id === gameId ? { ...item, enabled: !item.enabled } : item
              ),
            }),
          () =>
            apiUpdateGame(lobbyId, managementCode, gameId, {
              enabled: !game.enabled,
            })
        );
      },
      moveGame(gameId, direction) {
        const games = stateRef.current?.games ?? [];
        const fromIndex = games.findIndex((game) => game.id === gameId);
        const toIndex = fromIndex + direction;

        if (fromIndex < 0 || toIndex < 0 || toIndex >= games.length) {
          return;
        }

        const nextGames = [...games];
        const moved = nextGames[fromIndex];
        const target = nextGames[toIndex];

        if (!moved || !target) {
          return;
        }

        nextGames[fromIndex] = target;
        nextGames[toIndex] = moved;
        reorderByIds(nextGames.map((game) => game.id));
      },
      reorderGames(fromId, toId) {
        const games = stateRef.current?.games ?? [];
        const fromIndex = games.findIndex((game) => game.id === fromId);
        const toIndex = games.findIndex((game) => game.id === toId);

        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
          return;
        }

        const nextGames = [...games];
        const [moved] = nextGames.splice(fromIndex, 1);

        if (!moved) {
          return;
        }

        nextGames.splice(toIndex, 0, moved);
        reorderByIds(nextGames.map((game) => game.id));
      },
      clearCurrentGame() {
        const patch = { currentGameId: null };

        patchLobby(patch);
      },
      resetMatch() {
        const patch: UpdateLobbyRequest = {
          playerOneScore: 0,
          playerTwoScore: 0,
          currentGameId: null,
          status: "ready",
        };

        patchLobby(patch);
      },
    }),
    [lobbyId, managementCode, patchLobby, reorderByIds, runStateWrite]
  );

  const unlock = useCallback(
    async (passcode: string) => {
      const trimmedPasscode = passcode.trim();

      setUnlockError(null);

      if (!trimmedPasscode) {
        setUnlockError("Management passcode is required.");
        return;
      }

      const generation = lifecycleGenerationRef.current;

      try {
        await verifyLobbyPasscode(lobbyId, trimmedPasscode);
        if (!isCurrentGeneration(generation)) {
          return;
        }

        storeManagementPasscode(lobbyId, trimmedPasscode);
        setManagementCode(trimmedPasscode);
      } catch (unlockFailure) {
        if (isCurrentGeneration(generation)) {
          setUnlockError(
            unlockFailure instanceof Error
              ? unlockFailure.message
              : "That passcode didn't match. Try again."
          );
        }
      }
    },
    [isCurrentGeneration, lobbyId]
  );

  const lobby = useMemo(
    () => (state ? toMatchRoomLobby(state) : null),
    [state]
  );
  const surface = useMemo(() => (lobby ? toSurface(lobby) : null), [lobby]);

  return {
    state,
    lobby,
    surface,
    actions,
    isLoading,
    isUnlocked: Boolean(managementCode),
    isWriting,
    error,
    unlockError,
    unlock,
  };
}

function getPollInterval(isUnlocked: boolean): number {
  if (document.visibilityState === "hidden") {
    return HIDDEN_POLL_INTERVAL_MS;
  }

  return isUnlocked ? CONTROL_POLL_INTERVAL_MS : LOCKED_POLL_INTERVAL_MS;
}

function readStoredPasscode(lobbyId: string): string | null {
  try {
    return window.localStorage.getItem(
      getManagementPasscodeStorageKey(lobbyId)
    );
  } catch {
    return null;
  }
}

function toMatchRoomLobby(state: PublicLobbyState): MatchRoomLobby {
  const title =
    state.lobby.title ||
    deriveLobbyTitle(state.lobby.playerOneName, state.lobby.playerTwoName);

  return {
    lobbyId: state.lobby.id,
    title,
    status: mapLobbyStatus(state.lobby.status),
    targetScore: state.lobby.targetScore,
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
    games: state.games.map((game) => ({
      id: game.id,
      title: game.title,
      position: game.position,
      enabled: game.enabled,
    })),
    currentGameId: state.lobby.currentGameId,
    version: state.version,
    updatedAt: state.updatedAt,
  };
}

function toSurface(lobby: MatchRoomLobby): GauntletMatchSurface {
  const currentGame =
    lobby.games.find((game) => game.id === lobby.currentGameId) ?? null;

  return {
    title: lobby.title,
    status: lobby.status,
    targetWins: lobby.targetScore,
    players: lobby.players,
    currentGameId: lobby.currentGameId,
    currentGame: currentGame ? { title: currentGame.title } : null,
  };
}

function mapLobbyStatus(status: LobbyStatus): MatchRoomLobby["status"] {
  if (status === "playing") {
    return "live";
  }

  if (status === "complete") {
    return "done";
  }

  return "ready";
}

function bumpLobby(
  state: PublicLobbyState,
  patch: Partial<PublicLobbyState["lobby"]>
): PublicLobbyState {
  return bumpState(state, { lobby: { ...state.lobby, ...patch } });
}

function bumpState(
  state: PublicLobbyState,
  patch: Partial<Pick<PublicLobbyState, "games" | "lobby">>
): PublicLobbyState {
  const nextVersion = state.version + 1;
  const updatedAt = new Date().toISOString();

  return {
    ...state,
    ...patch,
    lobby: {
      ...(patch.lobby ?? state.lobby),
      version: nextVersion,
      updatedAt,
    },
    version: nextVersion,
    updatedAt,
  };
}

function normalizePositions<T extends { position: number }>(games: T[]): T[] {
  return games.map((game, position) => ({ ...game, position }));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
