import {
  AddGameRequestSchema,
  CreateLobbyResponseSchema,
  PublicLobbyStateSchema,
  ReorderGamesRequestSchema,
  UpdateGameRequestSchema,
  UpdateLobbyRequestSchema,
  VerifyLobbyResponseSchema
} from "@gaming-gauntlet/core";
import type {
  CreateLobbyRequestInput,
  CreateLobbyResponse,
  PublicLobbyState,
  ReorderGamesRequest,
  UpdateGameRequest,
  UpdateLobbyRequest,
  VerifyLobbyResponse
} from "@gaming-gauntlet/core";

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class LobbyApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function createLobby(
  payload: CreateLobbyRequestInput
): Promise<CreateLobbyResponse> {
  const response = await fetch("/api/lobbies", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw apiError(response, body);
  }

  const parsed = CreateLobbyResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new LobbyApiError("Create response was not valid.", response.status);
  }

  return parsed.data;
}

export async function verifyLobbyPasscode(
  lobbyId: string,
  managementCode: string
): Promise<VerifyLobbyResponse> {
  const response = await fetch(`/api/lobbies/${encodeURIComponent(lobbyId)}/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ managementCode })
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw apiError(response, body);
  }

  const parsed = VerifyLobbyResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new LobbyApiError("Verify response was not valid.", response.status);
  }

  return parsed.data;
}

// A poll either returns fresh state (with the ETag to echo back next time) or,
// when the caller's ETag still matches, a "not-modified" marker so the caller
// can skip re-rendering. Callers thread `etag` from the previous "modified"
// result back in to enable server-side 304 short-circuiting.
export type PublicLobbyStateResult =
  | { status: "modified"; state: PublicLobbyState; etag: string | null }
  | { status: "not-modified"; etag: string | null };

export async function fetchPublicLobbyState(
  lobbyId: string,
  options: { signal?: AbortSignal; etag?: string | null } = {}
): Promise<PublicLobbyStateResult> {
  const headers = new Headers();

  if (options.etag) {
    headers.set("if-none-match", options.etag);
  }

  const response = await fetch(
    `/api/lobbies/${encodeURIComponent(lobbyId)}/state`,
    { signal: options.signal, headers }
  );

  if (response.status === 304) {
    return { status: "not-modified", etag: options.etag ?? null };
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw apiError(response, body);
  }

  const parsed = PublicLobbyStateSchema.safeParse(body);

  if (!parsed.success) {
    throw new LobbyApiError("Lobby state response was not valid.", response.status);
  }

  return {
    status: "modified",
    state: parsed.data,
    etag: response.headers.get("etag"),
  };
}

export async function updateLobby(
  lobbyId: string,
  managementCode: string,
  patch: UpdateLobbyRequest
): Promise<PublicLobbyState> {
  const parsedPatch = UpdateLobbyRequestSchema.parse(patch);

  return writeLobbyState(`/api/lobbies/${encodeURIComponent(lobbyId)}`, {
    method: "PATCH",
    managementCode,
    body: parsedPatch
  });
}

export async function spinLobby(
  lobbyId: string,
  managementCode: string
): Promise<PublicLobbyState> {
  return writeLobbyState(`/api/lobbies/${encodeURIComponent(lobbyId)}/spin`, {
    method: "POST",
    managementCode
  });
}

export async function addGame(
  lobbyId: string,
  managementCode: string,
  payload: { title: string; enabled?: boolean }
): Promise<PublicLobbyState> {
  const parsedPayload = AddGameRequestSchema.parse(payload);

  return writeLobbyState(
    `/api/lobbies/${encodeURIComponent(lobbyId)}/games`,
    {
      method: "POST",
      managementCode,
      body: parsedPayload
    }
  );
}

export async function updateGame(
  lobbyId: string,
  managementCode: string,
  gameId: string,
  patch: UpdateGameRequest
): Promise<PublicLobbyState> {
  const parsedPatch = UpdateGameRequestSchema.parse(patch);

  return writeLobbyState(
    `/api/lobbies/${encodeURIComponent(lobbyId)}/games/${encodeURIComponent(gameId)}`,
    {
      method: "PATCH",
      managementCode,
      body: parsedPatch
    }
  );
}

export async function deleteGame(
  lobbyId: string,
  managementCode: string,
  gameId: string
): Promise<PublicLobbyState> {
  return writeLobbyState(
    `/api/lobbies/${encodeURIComponent(lobbyId)}/games/${encodeURIComponent(gameId)}`,
    {
      method: "DELETE",
      managementCode
    }
  );
}

export async function reorderGames(
  lobbyId: string,
  managementCode: string,
  gameIds: ReorderGamesRequest["gameIds"]
): Promise<PublicLobbyState> {
  const parsedPayload = ReorderGamesRequestSchema.parse({ gameIds });

  return writeLobbyState(
    `/api/lobbies/${encodeURIComponent(lobbyId)}/games/reorder`,
    {
      method: "POST",
      managementCode,
      body: parsedPayload
    }
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiError(response: Response, body: unknown): LobbyApiError {
  const errorBody = body as ApiErrorBody | null;
  const message = errorBody?.error?.message ?? "Request failed.";

  return new LobbyApiError(message, response.status);
}

async function writeLobbyState(
  url: string,
  options: {
    method: "DELETE" | "PATCH" | "POST";
    managementCode: string;
    body?: unknown;
  }
): Promise<PublicLobbyState> {
  const headers = new Headers({
    authorization: `Bearer ${options.managementCode}`
  });
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body
  });
  const responseBody = await readJson(response);

  if (!response.ok) {
    throw apiError(response, responseBody);
  }

  const parsed = PublicLobbyStateSchema.safeParse(responseBody);

  if (!parsed.success) {
    throw new LobbyApiError("Write response was not valid.", response.status);
  }

  return parsed.data;
}
