import {
  CreateLobbyResponseSchema,
  VerifyLobbyResponseSchema
} from "@gaming-gauntlet/core";
import type {
  CreateLobbyRequestInput,
  CreateLobbyResponse,
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
