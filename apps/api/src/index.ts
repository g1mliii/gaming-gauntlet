import {
  CreateLobbyRequestSchema,
  CreateLobbyResponseSchema,
  GameSchema,
  LobbyIdSchema,
  LobbySchema,
  PublicLobbyStateSchema,
  VerifyLobbyRequestSchema,
  VerifyLobbyResponseSchema,
  createGameId,
  createLobbyId,
  createManagementCode,
  hashManagementCode,
  verifyManagementCode
} from "@gaming-gauntlet/core";
import type {
  CreateLobbyResponse,
  Game,
  Lobby,
  PublicLobbyState
} from "@gaming-gauntlet/core";

type DbValue = string | number | null;

export interface ApiStatement {
  bind(...values: DbValue[]): ApiStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface ApiDatabase {
  prepare(query: string): ApiStatement;
  batch(statements: ApiStatement[]): Promise<unknown[]>;
}

export interface ApiEnv {
  DB: ApiDatabase;
}

type ApiRoute =
  | { id: "createLobby" }
  | { id: "getLobbyState"; lobbyId: string }
  | { id: "verifyLobby"; lobbyId: string }
  | { id: "methodNotAllowed" }
  | { id: "notFound" };

type JsonErrorCode =
  | "bad_request"
  | "invalid_json"
  | "invalid_management_code"
  | "method_not_allowed"
  | "not_found"
  | "payload_too_large"
  | "validation_error"
  | "internal_error";

type ValidationIssue = {
  path: string;
  message: string;
};

type SchemaIssue = {
  path: Array<string | number | symbol>;
  message: string;
};

type LobbyStateRow = {
  lobbyId: string;
  playerOneName: string;
  playerTwoName: string;
  playerOneScore: number;
  playerTwoScore: number;
  targetScore: number | null;
  status: string;
  currentGameId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  gameId: string | null;
  gameTitle: string | null;
  gamePosition: number | null;
  gameEnabled: number | null;
  gameCreatedAt: string | null;
  gameUpdatedAt: string | null;
};

type SecretRow = {
  managementCodeHash: string;
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_JSON_BODY_BYTES = 16 * 1024;

class BodyTooLargeError extends Error {}

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    return handleApiRequest(request, env);
  }
};

export async function handleApiRequest(
  request: Request,
  env: ApiEnv
): Promise<Response> {
  try {
    const route = matchRoute(request);

    if (route.id === "createLobby") {
      return await createLobby(request, env.DB);
    }

    if (route.id === "getLobbyState") {
      return await getLobbyState(route.lobbyId, env.DB);
    }

    if (route.id === "verifyLobby") {
      return await verifyLobby(request, route.lobbyId, env.DB);
    }

    if (route.id === "methodNotAllowed") {
      return jsonError(405, "method_not_allowed", "Method is not allowed for this endpoint.");
    }

    return jsonError(404, "not_found", "API route was not found.");
  } catch (error) {
    if (isHandledJsonError(error)) {
      return error.response;
    }

    return jsonError(500, "internal_error", "Unexpected API error.");
  }
}

function matchRoute(request: Request): ApiRoute {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 2 && parts[0] === "api" && parts[1] === "lobbies") {
    return request.method === "POST" ? { id: "createLobby" } : { id: "methodNotAllowed" };
  }

  if (parts.length === 4 && parts[0] === "api" && parts[1] === "lobbies") {
    const lobbyId = parts[2] ?? "";
    const action = parts[3];

    if (action === "state") {
      return request.method === "GET"
        ? { id: "getLobbyState", lobbyId }
        : { id: "methodNotAllowed" };
    }

    if (action === "verify") {
      return request.method === "POST"
        ? { id: "verifyLobby", lobbyId }
        : { id: "methodNotAllowed" };
    }
  }

  return { id: "notFound" };
}

async function createLobby(request: Request, db: ApiDatabase): Promise<Response> {
  const payload = await readJsonBody(request);
  const parsedPayload = CreateLobbyRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  const lobbyId = createLobbyId();
  const managementCode = createManagementCode();
  const managementCodeHash = await hashManagementCode(managementCode);
  const now = new Date().toISOString();

  const lobby: Lobby = LobbySchema.parse({
    id: lobbyId,
    playerOneName: parsedPayload.data.playerOneName,
    playerTwoName: parsedPayload.data.playerTwoName,
    playerOneScore: 0,
    playerTwoScore: 0,
    targetScore: parsedPayload.data.targetScore ?? null,
    status: "setup",
    currentGameId: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  });
  const games: Game[] = parsedPayload.data.games.map((title, position) =>
    GameSchema.parse({
      id: createGameId(),
      lobbyId,
      title,
      position,
      enabled: true,
      createdAt: now,
      updatedAt: now
    })
  );

  await db.batch([
    db
      .prepare(
        `INSERT INTO lobbies (
          id,
          player_one_name,
          player_two_name,
          player_one_score,
          player_two_score,
          target_score,
          status,
          current_game_id,
          version,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        lobby.id,
        lobby.playerOneName,
        lobby.playerTwoName,
        lobby.playerOneScore,
        lobby.playerTwoScore,
        lobby.targetScore,
        lobby.status,
        lobby.currentGameId,
        lobby.version,
        lobby.createdAt,
        lobby.updatedAt
      ),
    db
      .prepare(
        `INSERT INTO lobby_secrets (
          lobby_id,
          management_code_hash,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)`
      )
      .bind(lobby.id, managementCodeHash, now, now),
    ...games.map((game) =>
      db
        .prepare(
          `INSERT INTO games (
            id,
            lobby_id,
            title,
            position,
            enabled,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          game.id,
          game.lobbyId,
          game.title,
          game.position,
          game.enabled ? 1 : 0,
          game.createdAt,
          game.updatedAt
        )
    )
  ]);

  const responseBody: CreateLobbyResponse = CreateLobbyResponseSchema.parse({
    lobbyId,
    managementCode
  });

  return jsonResponse(responseBody, { status: 201 });
}

async function getLobbyState(lobbyId: string, db: ApiDatabase): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const state = await loadPublicLobbyState(db, parsedLobbyId.data);

  if (!state) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  return jsonResponse(state);
}

async function verifyLobby(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const payload = await readJsonBody(request);
  const parsedPayload = VerifyLobbyRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  const secret = await loadLobbySecret(db, parsedLobbyId.data);

  if (!secret) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  const isVerified = await verifyManagementCode(
    parsedPayload.data.managementCode,
    secret.managementCodeHash
  );

  if (!isVerified) {
    return jsonError(401, "invalid_management_code", "Management code is invalid.");
  }

  return jsonResponse(VerifyLobbyResponseSchema.parse({ success: true }));
}

async function loadPublicLobbyState(
  db: ApiDatabase,
  lobbyId: string
): Promise<PublicLobbyState | null> {
  const result = await db
    .prepare(
      `SELECT
        l.id AS lobbyId,
        l.player_one_name AS playerOneName,
        l.player_two_name AS playerTwoName,
        l.player_one_score AS playerOneScore,
        l.player_two_score AS playerTwoScore,
        l.target_score AS targetScore,
        l.status,
        l.current_game_id AS currentGameId,
        l.version,
        l.created_at AS createdAt,
        l.updated_at AS updatedAt,
        g.id AS gameId,
        g.title AS gameTitle,
        g.position AS gamePosition,
        g.enabled AS gameEnabled,
        g.created_at AS gameCreatedAt,
        g.updated_at AS gameUpdatedAt
      FROM lobbies l
      LEFT JOIN games g ON g.lobby_id = l.id
      WHERE l.id = ?
      ORDER BY g.position ASC, g.created_at ASC`
    )
    .bind(lobbyId)
    .all<LobbyStateRow>();
  const rows = result.results ?? [];
  const firstRow = rows[0];

  if (!firstRow) {
    return null;
  }

  const lobby = LobbySchema.parse({
    id: firstRow.lobbyId,
    playerOneName: firstRow.playerOneName,
    playerTwoName: firstRow.playerTwoName,
    playerOneScore: firstRow.playerOneScore,
    playerTwoScore: firstRow.playerTwoScore,
    targetScore: firstRow.targetScore,
    status: firstRow.status,
    currentGameId: firstRow.currentGameId,
    version: firstRow.version,
    createdAt: firstRow.createdAt,
    updatedAt: firstRow.updatedAt
  });
  const games = rows
    .filter((row) => row.gameId !== null)
    .map((row) =>
      GameSchema.parse({
        id: row.gameId,
        lobbyId,
        title: row.gameTitle,
        position: row.gamePosition,
        enabled: row.gameEnabled === 1,
        createdAt: row.gameCreatedAt,
        updatedAt: row.gameUpdatedAt
      })
    );

  return PublicLobbyStateSchema.parse({
    lobby,
    games,
    version: lobby.version,
    updatedAt: lobby.updatedAt
  });
}

async function loadLobbySecret(
  db: ApiDatabase,
  lobbyId: string
): Promise<SecretRow | null> {
  return await db
    .prepare(
      `SELECT management_code_hash AS managementCodeHash
      FROM lobby_secrets
      WHERE lobby_id = ?
      LIMIT 1`
    )
    .bind(lobbyId)
    .first<SecretRow>();
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await readLimitedText(request);

    if (!text.trim()) {
      return {};
    }

    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw jsonHandledError(
        jsonError(413, "payload_too_large", "JSON body is too large.")
      );
    }

    if (isHandledJsonError(error)) {
      throw error;
    }

    throw jsonHandledError(jsonError(400, "invalid_json", "Request body must be valid JSON."));
  }
}

async function readLimitedText(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new BodyTooLargeError();
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  let shouldCancel = false;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      bytesRead += result.value.byteLength;

      if (bytesRead > MAX_JSON_BODY_BYTES) {
        shouldCancel = true;
        throw new BodyTooLargeError();
      }

      text += decoder.decode(result.value, { stream: true });
    }

    return text + decoder.decode();
  } finally {
    if (shouldCancel) {
      await reader.cancel();
    }

    reader.releaseLock();
  }
}

function validationError(issues: SchemaIssue[]): Response {
  return jsonError(400, "validation_error", "Request validation failed.", {
    issues: issues.map((issue): ValidationIssue => ({
      path: issue.path.map(String).join("."),
      message: issue.message
    }))
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_CONTENT_TYPE);

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  });
}

function jsonError(
  status: number,
  code: JsonErrorCode,
  message: string,
  extra?: Record<string, unknown>
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...extra
      }
    },
    { status }
  );
}

function jsonHandledError(response: Response): Error {
  return Object.assign(new Error("Handled JSON response"), { response });
}

function isHandledJsonError(error: unknown): error is Error & { response: Response } {
  return error instanceof Error && "response" in error && error.response instanceof Response;
}
