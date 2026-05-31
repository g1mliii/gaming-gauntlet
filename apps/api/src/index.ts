import {
  AddGameRequestSchema,
  CreateLobbyRequestSchema,
  CreateLobbyResponseSchema,
  GameIdSchema,
  GameSchema,
  ReorderGamesRequestSchema,
  LobbyIdSchema,
  LobbySchema,
  PublicLobbyStateSchema,
  UpdateGameRequestSchema,
  UpdateLobbyRequestSchema,
  VerifyLobbyRequestSchema,
  VerifyLobbyResponseSchema,
  createGameId,
  createLobbyId,
  createManagementCode,
  deriveLobbyTitle,
  hashManagementCode,
  verifyManagementCode,
} from "@gaming-gauntlet/core";
import type {
  CreateLobbyResponse,
  Game,
  Lobby,
  PublicLobbyState,
  UpdateGameRequest,
  UpdateLobbyRequest,
} from "@gaming-gauntlet/core";

type DbValue = string | number | null;
type ApiD1Meta = {
  changed_db?: boolean;
  changes?: number;
  last_row_id?: number;
  rows_written?: number;
};
export type ApiD1Result<T = unknown> = {
  results?: T[];
  success?: boolean;
  meta?: ApiD1Meta;
};

export interface ApiStatement {
  bind(...values: DbValue[]): ApiStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<ApiD1Result<T>>;
  run<T = unknown>(): Promise<ApiD1Result<T>>;
}

export interface ApiDatabase {
  prepare(query: string): ApiStatement;
  batch<T = unknown>(statements: ApiStatement[]): Promise<ApiD1Result<T>[]>;
}

export interface ApiRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ApiEnv {
  CREATE_RATE_LIMITER?: ApiRateLimiter;
  DB: ApiDatabase;
  STATE_RATE_LIMITER?: ApiRateLimiter;
  VERIFY_RATE_LIMITER?: ApiRateLimiter;
  WRITE_RATE_LIMITER?: ApiRateLimiter;
}

type ApiRoute =
  | { id: "createLobby" }
  | { id: "getLobbyState"; lobbyId: string }
  | { id: "verifyLobby"; lobbyId: string }
  | { id: "updateLobby"; lobbyId: string }
  | { id: "spinLobby"; lobbyId: string }
  | { id: "addGame"; lobbyId: string }
  | { id: "updateGame"; lobbyId: string; gameId: string }
  | { id: "deleteGame"; lobbyId: string; gameId: string }
  | { id: "reorderGames"; lobbyId: string }
  | { id: "methodNotAllowed" }
  | { id: "notFound" };

type JsonErrorCode =
  | "bad_request"
  | "invalid_json"
  | "invalid_management_code"
  | "method_not_allowed"
  | "no_enabled_games"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "unauthorized"
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

type LobbyRow = {
  lobbyId: string;
  title: string;
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
};

type GameRow = {
  gameId: string;
  gameTitle: string;
  gamePosition: number;
  gameEnabled: number;
  gameCreatedAt: string;
  gameUpdatedAt: string;
};

type SecretRow = {
  managementCodeHash: string;
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_JSON_BODY_BYTES = 16 * 1024;

class BodyTooLargeError extends Error {}

// Retention: a lobby is purged once it has gone this many days without any
// update (updated_at bumps on every mutation, so this reaps inactivity, not
// age — an actively scored match is never touched). The daily cron caps how
// many it clears per run so a backlog can't exceed D1 limits or the scheduled
// CPU budget; the next run drains the remainder.
const LOBBY_RETENTION_DAYS = 30;
const LOBBY_CLEANUP_BATCH_LIMIT = 500;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runLobbyRetentionSweep(env, new Date());
  },
};

// Exported for tests and reuse. Returns the number of lobbies deleted this run.
export async function runLobbyRetentionSweep(
  env: ApiEnv,
  now: Date
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - LOBBY_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  return deleteExpiredLobbies(env.DB, cutoff, LOBBY_CLEANUP_BATCH_LIMIT);
}

async function deleteExpiredLobbies(
  db: ApiDatabase,
  cutoff: string,
  limit: number
): Promise<number> {
  // One deterministic selector reused by all three deletes so games, secrets,
  // and lobbies target the same bounded set within the transaction. Children
  // are deleted before the parent rather than relying on D1 honoring
  // ON DELETE CASCADE / PRAGMA foreign_keys across connections.
  const expiredSelector = `
    SELECT id FROM lobbies
    WHERE updated_at < ?
    ORDER BY updated_at ASC
    LIMIT ?`;

  const results = await db.batch([
    db
      .prepare(`DELETE FROM games WHERE lobby_id IN (${expiredSelector})`)
      .bind(cutoff, limit),
    db
      .prepare(`DELETE FROM lobby_secrets WHERE lobby_id IN (${expiredSelector})`)
      .bind(cutoff, limit),
    db
      .prepare(`DELETE FROM lobbies WHERE id IN (${expiredSelector})`)
      .bind(cutoff, limit),
  ]);

  // The final statement removes the lobby rows themselves; its changed-row
  // count is the number of matches purged.
  return getChangedRows(results[results.length - 1]) ?? 0;
}

export async function handleApiRequest(
  request: Request,
  env: ApiEnv
): Promise<Response> {
  try {
    const route = matchRoute(request);
    const rateLimitResponse = await enforceRateLimit(request, route, env);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    if (route.id === "createLobby") {
      return await createLobby(request, env.DB);
    }

    if (route.id === "getLobbyState") {
      return await getLobbyState(request, route.lobbyId, env.DB);
    }

    if (route.id === "verifyLobby") {
      return await verifyLobby(request, route.lobbyId, env.DB);
    }

    if (route.id === "updateLobby") {
      return await updateLobby(request, route.lobbyId, env.DB);
    }

    if (route.id === "spinLobby") {
      return await spinLobby(request, route.lobbyId, env.DB);
    }

    if (route.id === "addGame") {
      return await addGame(request, route.lobbyId, env.DB);
    }

    if (route.id === "updateGame") {
      return await updateGame(request, route.lobbyId, route.gameId, env.DB);
    }

    if (route.id === "deleteGame") {
      return await deleteGame(request, route.lobbyId, route.gameId, env.DB);
    }

    if (route.id === "reorderGames") {
      return await reorderGames(request, route.lobbyId, env.DB);
    }

    if (route.id === "methodNotAllowed") {
      return jsonError(
        405,
        "method_not_allowed",
        "Method is not allowed for this endpoint."
      );
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
    return request.method === "POST"
      ? { id: "createLobby" }
      : { id: "methodNotAllowed" };
  }

  if (parts.length === 3 && parts[0] === "api" && parts[1] === "lobbies") {
    return request.method === "PATCH"
      ? { id: "updateLobby", lobbyId: parts[2] ?? "" }
      : { id: "methodNotAllowed" };
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

    if (action === "spin") {
      return request.method === "POST"
        ? { id: "spinLobby", lobbyId }
        : { id: "methodNotAllowed" };
    }

    if (action === "games") {
      return request.method === "POST"
        ? { id: "addGame", lobbyId }
        : { id: "methodNotAllowed" };
    }
  }

  if (
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "lobbies" &&
    parts[3] === "games"
  ) {
    const lobbyId = parts[2] ?? "";
    const gameIdOrAction = parts[4] ?? "";

    if (gameIdOrAction === "reorder") {
      return request.method === "POST"
        ? { id: "reorderGames", lobbyId }
        : { id: "methodNotAllowed" };
    }

    if (request.method === "PATCH") {
      return { id: "updateGame", lobbyId, gameId: gameIdOrAction };
    }

    if (request.method === "DELETE") {
      return { id: "deleteGame", lobbyId, gameId: gameIdOrAction };
    }

    return { id: "methodNotAllowed" };
  }

  return { id: "notFound" };
}

async function enforceRateLimit(
  request: Request,
  route: ApiRoute,
  env: ApiEnv
): Promise<Response | null> {
  const key = rateLimitKey(request, route);

  if (!key) {
    return null;
  }

  const limiter = env[key.limiter];

  if (!limiter) {
    return null;
  }

  const result = await limiter.limit({ key: key.value });

  return result.success ? null : rateLimitedError();
}

function rateLimitKey(
  request: Request,
  route: ApiRoute
): {
  limiter: keyof Pick<
    ApiEnv,
    | "CREATE_RATE_LIMITER"
    | "STATE_RATE_LIMITER"
    | "VERIFY_RATE_LIMITER"
    | "WRITE_RATE_LIMITER"
  >;
  value: string;
} | null {
  const client = request.headers.get("cf-connecting-ip") ?? "unknown";

  if (route.id === "createLobby") {
    return { limiter: "CREATE_RATE_LIMITER", value: `create:${client}` };
  }

  if (route.id === "getLobbyState") {
    return {
      limiter: "STATE_RATE_LIMITER",
      value: `state:${route.lobbyId}:${client}`,
    };
  }

  if (route.id === "verifyLobby") {
    return {
      limiter: "VERIFY_RATE_LIMITER",
      value: `verify:${route.lobbyId}:${client}`,
    };
  }

  if (
    route.id === "updateLobby" ||
    route.id === "spinLobby" ||
    route.id === "addGame" ||
    route.id === "updateGame" ||
    route.id === "deleteGame" ||
    route.id === "reorderGames"
  ) {
    return {
      limiter: "WRITE_RATE_LIMITER",
      value: `write:${route.lobbyId}:${client}`,
    };
  }

  return null;
}

async function createLobby(
  request: Request,
  db: ApiDatabase
): Promise<Response> {
  const payload = await readJsonBody(request);
  const parsedPayload = CreateLobbyRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  const lobbyId = createLobbyId();
  const managementCode = createManagementCode();
  const managementCodeHash = await hashManagementCode(managementCode);
  const now = new Date().toISOString();
  const title =
    parsedPayload.data.title ??
    deriveLobbyTitle(
      parsedPayload.data.playerOneName,
      parsedPayload.data.playerTwoName
    );

  const lobby: Lobby = LobbySchema.parse({
    id: lobbyId,
    title,
    playerOneName: parsedPayload.data.playerOneName,
    playerTwoName: parsedPayload.data.playerTwoName,
    playerOneScore: 0,
    playerTwoScore: 0,
    targetScore: parsedPayload.data.targetScore ?? null,
    status: "setup",
    currentGameId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const games: Game[] = parsedPayload.data.games.map((title, position) =>
    GameSchema.parse({
      id: createGameId(),
      lobbyId,
      title,
      position,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
  );
  const gameSeedRows = games.map((game) => ({
    id: game.id,
    title: game.title,
  }));

  await db.batch([
    db
      .prepare(
        `INSERT INTO lobbies (
          id,
          title,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        lobby.id,
        lobby.title,
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
    ...((gameSeedRows.length > 0
      ? [
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
              )
              SELECT
                json_extract(seed.value, '$.id'),
                ?,
                json_extract(seed.value, '$.title'),
                CAST(seed.key AS INTEGER),
                1,
                ?,
                ?
              FROM json_each(?) seed`
            )
            .bind(lobby.id, now, now, JSON.stringify(gameSeedRows)),
        ]
      : []) as ApiStatement[]),
  ]);

  const responseBody: CreateLobbyResponse = CreateLobbyResponseSchema.parse({
    lobbyId,
    managementCode,
  });

  return jsonResponse(responseBody, { status: 201 });
}

async function getLobbyState(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  // Public clients (OBS overlays, spectators) poll this endpoint constantly.
  // The lobby version bumps on every mutation, so it doubles as an ETag: a
  // cheap version-only lookup lets unchanged polls short-circuit with a 304
  // before we pay for the heavier full-state load or serialize a JSON body.
  const version = await loadLobbyVersion(db, parsedLobbyId.data);

  if (version === null) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  if (etagMatches(request.headers.get("if-none-match"), lobbyStateEtag(version))) {
    return notModifiedResponse(lobbyStateEtag(version));
  }

  const state = await loadPublicLobbyState(db, parsedLobbyId.data);

  if (!state) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  // Derive the served ETag from the loaded state's version (not the pre-check
  // version) so a concurrent write between the two reads can never hand the
  // client an ETag that disagrees with the body it just received.
  return jsonResponse(state, {
    headers: { etag: lobbyStateEtag(state.version) },
  });
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
    return jsonError(
      401,
      "invalid_management_code",
      "Management code is invalid."
    );
  }

  return jsonResponse(VerifyLobbyResponseSchema.parse({ success: true }));
}

async function updateLobby(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;
  const payload = await readJsonBody(request);
  const parsedPayload = UpdateLobbyRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  if (
    parsedPayload.data.currentGameId !== undefined &&
    parsedPayload.data.currentGameId !== null &&
    !existingState.games.some(
      (game) => game.id === parsedPayload.data.currentGameId
    )
  ) {
    return jsonError(
      400,
      "bad_request",
      "Current game must belong to the lobby."
    );
  }

  if (!hasLobbyChanges(existingState.lobby, parsedPayload.data)) {
    return jsonResponse(existingState);
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: DbValue[] = [];

  addOptionalUpdate(updates, values, "title", parsedPayload.data.title);
  addOptionalUpdate(
    updates,
    values,
    "player_one_name",
    parsedPayload.data.playerOneName
  );
  addOptionalUpdate(
    updates,
    values,
    "player_two_name",
    parsedPayload.data.playerTwoName
  );
  addOptionalUpdate(
    updates,
    values,
    "player_one_score",
    parsedPayload.data.playerOneScore
  );
  addOptionalUpdate(
    updates,
    values,
    "player_two_score",
    parsedPayload.data.playerTwoScore
  );
  addOptionalUpdate(
    updates,
    values,
    "target_score",
    parsedPayload.data.targetScore
  );
  addOptionalUpdate(
    updates,
    values,
    "current_game_id",
    parsedPayload.data.currentGameId
  );
  addOptionalUpdate(updates, values, "status", parsedPayload.data.status);

  updates.push("version = version + 1", "updated_at = ?");
  values.push(now, parsedLobbyId.data);

  const updateResult = await db
    .prepare(`UPDATE lobbies SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  if (getChangedRows(updateResult) === 0) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  return jsonResponse(applyLobbyPatch(existingState, parsedPayload.data, now));
}

async function spinLobby(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;
  const enabledGames = existingState.games.filter((game) => game.enabled);

  if (enabledGames.length === 0) {
    return jsonError(
      400,
      "no_enabled_games",
      "Enable at least one game before spinning."
    );
  }

  // `enabledGames` is non-empty (checked above) and `randomIndex` returns an
  // in-range index, so this guard only narrows the type for the compiler.
  const winner = enabledGames[randomIndex(enabledGames.length)];

  if (!winner) {
    return jsonError(500, "internal_error", "Could not select a game.");
  }

  const now = new Date().toISOString();
  const updateResult = await db
    .prepare(
      `UPDATE lobbies
      SET current_game_id = ?,
        version = version + 1,
        updated_at = ?
      WHERE id = ?`
    )
    .bind(winner.id, now, parsedLobbyId.data)
    .run();

  if (getChangedRows(updateResult) === 0) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  return jsonResponse(
    applyLobbyPatch(existingState, { currentGameId: winner.id }, now)
  );
}

async function addGame(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;

  if (existingState.games.length >= 64) {
    return jsonError(
      400,
      "bad_request",
      "Lobby cannot have more than 64 games."
    );
  }

  const payload = await readJsonBody(request);
  const parsedPayload = AddGameRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  const now = new Date().toISOString();
  const position =
    existingState.games.reduce(
      (highestPosition, game) => Math.max(highestPosition, game.position),
      -1
    ) + 1;
  const game: Game = GameSchema.parse({
    id: createGameId(),
    lobbyId: parsedLobbyId.data,
    title: parsedPayload.data.title,
    position,
    enabled: parsedPayload.data.enabled,
    createdAt: now,
    updatedAt: now,
  });

  await db.batch([
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
      ),
    updateLobbyVersionStatement(db, parsedLobbyId.data, now),
  ]);

  const version = existingState.lobby.version + 1;

  return jsonResponse(
    PublicLobbyStateSchema.parse({
      ...existingState,
      lobby: { ...existingState.lobby, version, updatedAt: now },
      games: [...existingState.games, game],
      version,
      updatedAt: now,
    })
  );
}

async function updateGame(
  request: Request,
  lobbyId: string,
  gameId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);
  const parsedGameId = GameIdSchema.safeParse(gameId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  if (!parsedGameId.success) {
    return validationError(parsedGameId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;
  const existingGame = existingState.games.find(
    (game) => game.id === parsedGameId.data
  );

  if (!existingGame) {
    return jsonError(404, "not_found", "Game was not found.");
  }

  const payload = await readJsonBody(request);
  const parsedPayload = UpdateGameRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  if (!hasGameChanges(existingGame, parsedPayload.data)) {
    return jsonResponse(existingState);
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: DbValue[] = [];

  addOptionalUpdate(updates, values, "title", parsedPayload.data.title);

  if (parsedPayload.data.enabled !== undefined) {
    updates.push("enabled = ?");
    values.push(parsedPayload.data.enabled ? 1 : 0);
  }

  updates.push("updated_at = ?");
  values.push(now, parsedGameId.data, parsedLobbyId.data);

  const updateResults = await db.batch([
    db
      .prepare(
        `UPDATE games SET ${updates.join(", ")} WHERE id = ? AND lobby_id = ?`
      )
      .bind(...values),
    updateLobbyVersionStatement(db, parsedLobbyId.data, now),
  ]);

  if (getChangedRows(updateResults[0]) === 0) {
    return jsonError(404, "not_found", "Game was not found.");
  }

  const version = existingState.lobby.version + 1;
  const games = existingState.games.map((game) =>
    game.id === parsedGameId.data
      ? GameSchema.parse({ ...game, ...parsedPayload.data, updatedAt: now })
      : game
  );

  return jsonResponse(
    PublicLobbyStateSchema.parse({
      ...existingState,
      lobby: { ...existingState.lobby, version, updatedAt: now },
      games,
      version,
      updatedAt: now,
    })
  );
}

async function deleteGame(
  request: Request,
  lobbyId: string,
  gameId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);
  const parsedGameId = GameIdSchema.safeParse(gameId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  if (!parsedGameId.success) {
    return validationError(parsedGameId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;
  const existingGame = existingState.games.find(
    (game) => game.id === parsedGameId.data
  );

  if (!existingGame) {
    return jsonError(404, "not_found", "Game was not found.");
  }

  const now = new Date().toISOString();
  const temporaryPositionOffset = existingState.games.length + 1000;

  await db.batch([
    db
      .prepare("DELETE FROM games WHERE id = ? AND lobby_id = ?")
      .bind(parsedGameId.data, parsedLobbyId.data),
    db
      .prepare(
        `UPDATE games
        SET position = position + ?,
          updated_at = ?
        WHERE lobby_id = ?`
      )
      .bind(temporaryPositionOffset, now, parsedLobbyId.data),
    db
      .prepare(
        `WITH ranked_games AS (
          SELECT id,
            ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC) - 1 AS position
          FROM games
          WHERE lobby_id = ?
        )
        UPDATE games
        SET position = (
            SELECT ranked_games.position
            FROM ranked_games
            WHERE ranked_games.id = games.id
          ),
          updated_at = ?
        WHERE lobby_id = ?`
      )
      .bind(parsedLobbyId.data, now, parsedLobbyId.data),
    db
      .prepare(
        `UPDATE lobbies
        SET current_game_id = CASE WHEN current_game_id = ? THEN NULL ELSE current_game_id END,
          version = version + 1,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(parsedGameId.data, now, parsedLobbyId.data),
  ]);

  return publicLobbyStateResponse(db, parsedLobbyId.data);
}

async function reorderGames(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<Response> {
  const parsedLobbyId = LobbyIdSchema.safeParse(lobbyId);

  if (!parsedLobbyId.success) {
    return validationError(parsedLobbyId.error.issues);
  }

  const authorization = await authorizeLobbyWrite(
    request,
    parsedLobbyId.data,
    db
  );

  if (authorization.error) {
    return authorization.error;
  }

  const existingState = authorization.state;
  const payload = await readJsonBody(request);
  const parsedPayload = ReorderGamesRequestSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return validationError(parsedPayload.error.issues);
  }

  const requestedIds = parsedPayload.data.gameIds;
  const uniqueRequestedIds = new Set(requestedIds);
  const existingIds = new Set(existingState.games.map((game) => game.id));
  const hasExactGameSet =
    uniqueRequestedIds.size === requestedIds.length &&
    requestedIds.length === existingIds.size &&
    requestedIds.every((id) => existingIds.has(id));

  if (!hasExactGameSet) {
    return jsonError(
      400,
      "bad_request",
      "Reorder must include each lobby game exactly once."
    );
  }

  const now = new Date().toISOString();
  const temporaryPositionOffset = existingState.games.length + 1000;
  const requestedIdsJson = JSON.stringify(requestedIds);

  if (
    existingState.games.every((game, index) => game.id === requestedIds[index])
  ) {
    return jsonResponse(existingState);
  }

  await db.batch([
    db
      .prepare(
        `UPDATE games
        SET position = position + ?,
          updated_at = ?
        WHERE lobby_id = ?`
      )
      .bind(temporaryPositionOffset, now, parsedLobbyId.data),
    db
      .prepare(
        `WITH requested_games AS (
          SELECT value AS id,
            CAST(key AS INTEGER) AS position
          FROM json_each(?)
        )
        UPDATE games
        SET position = (
            SELECT requested_games.position
            FROM requested_games
            WHERE requested_games.id = games.id
          ),
          updated_at = ?
        WHERE lobby_id = ?
          AND id IN (
            SELECT requested_games.id
            FROM requested_games
          )`
      )
      .bind(requestedIdsJson, now, parsedLobbyId.data),
    updateLobbyVersionStatement(db, parsedLobbyId.data, now),
  ]);

  return publicLobbyStateResponse(db, parsedLobbyId.data);
}

async function loadLobbyVersion(
  db: ApiDatabase,
  lobbyId: string
): Promise<number | null> {
  const row = await db
    .prepare(`SELECT version FROM lobbies WHERE id = ? LIMIT 1`)
    .bind(lobbyId)
    .first<{ version: number }>();

  return row ? row.version : null;
}

async function loadPublicLobbyState(
  db: ApiDatabase,
  lobbyId: string
): Promise<PublicLobbyState | null> {
  const [lobbyRow, gamesResult] = await Promise.all([
    db
      .prepare(
        `SELECT
          id AS lobbyId,
          title,
          player_one_name AS playerOneName,
          player_two_name AS playerTwoName,
          player_one_score AS playerOneScore,
          player_two_score AS playerTwoScore,
          target_score AS targetScore,
          status,
          current_game_id AS currentGameId,
          version,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM lobbies
        WHERE id = ?
        LIMIT 1`
      )
      .bind(lobbyId)
      .first<LobbyRow>(),
    db
      .prepare(
        `SELECT
          id AS gameId,
          title AS gameTitle,
          position AS gamePosition,
          enabled AS gameEnabled,
          created_at AS gameCreatedAt,
          updated_at AS gameUpdatedAt
        FROM games
        WHERE lobby_id = ?
        ORDER BY position ASC, created_at ASC`
      )
      .bind(lobbyId)
      .all<GameRow>(),
  ]);

  if (!lobbyRow) {
    return null;
  }

  return mapLobbyState(lobbyRow, gamesResult.results ?? []);
}

function mapLobbyState(
  lobbyRow: LobbyRow,
  gameRows: GameRow[]
): PublicLobbyState {
  const lobby = LobbySchema.parse({
    id: lobbyRow.lobbyId,
    title: lobbyRow.title,
    playerOneName: lobbyRow.playerOneName,
    playerTwoName: lobbyRow.playerTwoName,
    playerOneScore: lobbyRow.playerOneScore,
    playerTwoScore: lobbyRow.playerTwoScore,
    targetScore: lobbyRow.targetScore,
    status: lobbyRow.status,
    currentGameId: lobbyRow.currentGameId,
    version: lobbyRow.version,
    createdAt: lobbyRow.createdAt,
    updatedAt: lobbyRow.updatedAt,
  });
  const games = gameRows.map((row) =>
    GameSchema.parse({
      id: row.gameId,
      lobbyId: lobbyRow.lobbyId,
      title: row.gameTitle,
      position: row.gamePosition,
      enabled: row.gameEnabled === 1,
      createdAt: row.gameCreatedAt,
      updatedAt: row.gameUpdatedAt,
    })
  );

  return PublicLobbyStateSchema.parse({
    lobby,
    games,
    version: lobby.version,
    updatedAt: lobby.updatedAt,
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

type LobbyWriteAuthorization =
  | { error: Response; state?: undefined }
  | { error?: undefined; state: PublicLobbyState };

async function authorizeLobbyWrite(
  request: Request,
  lobbyId: string,
  db: ApiDatabase
): Promise<LobbyWriteAuthorization> {
  if (hasQuerySecret(request)) {
    return {
      error: jsonError(
        400,
        "bad_request",
        "Management codes must be sent in Authorization."
      ),
    };
  }

  const managementCode = readBearerManagementCode(request);

  if (!managementCode) {
    return {
      error: jsonError(
        401,
        "unauthorized",
        "Authorization bearer token is required."
      ),
    };
  }

  const [secret, state] = await Promise.all([
    loadLobbySecret(db, lobbyId),
    loadPublicLobbyState(db, lobbyId),
  ]);

  if (!secret || !state) {
    return { error: jsonError(404, "not_found", "Lobby was not found.") };
  }

  const isVerified = await verifyManagementCode(
    managementCode,
    secret.managementCodeHash
  );

  if (!isVerified) {
    return {
      error: jsonError(
        401,
        "invalid_management_code",
        "Management code is invalid."
      ),
    };
  }

  return { state };
}

function applyLobbyPatch(
  state: PublicLobbyState,
  patch: UpdateLobbyRequest,
  updatedAt: string
): PublicLobbyState {
  const version = state.lobby.version + 1;
  const lobby = LobbySchema.parse({
    ...state.lobby,
    ...patch,
    version,
    updatedAt,
  });

  return PublicLobbyStateSchema.parse({ ...state, lobby, version, updatedAt });
}

async function publicLobbyStateResponse(
  db: ApiDatabase,
  lobbyId: string
): Promise<Response> {
  const state = await loadPublicLobbyState(db, lobbyId);

  if (!state) {
    return jsonError(404, "not_found", "Lobby was not found.");
  }

  return jsonResponse(state);
}

function updateLobbyVersionStatement(
  db: ApiDatabase,
  lobbyId: string,
  updatedAt: string
): ApiStatement {
  return db
    .prepare(
      `UPDATE lobbies
      SET version = version + 1,
        updated_at = ?
      WHERE id = ?`
    )
    .bind(updatedAt, lobbyId);
}

function hasLobbyChanges(lobby: Lobby, patch: UpdateLobbyRequest): boolean {
  return (
    changed(patch.title, lobby.title) ||
    changed(patch.playerOneName, lobby.playerOneName) ||
    changed(patch.playerTwoName, lobby.playerTwoName) ||
    changed(patch.playerOneScore, lobby.playerOneScore) ||
    changed(patch.playerTwoScore, lobby.playerTwoScore) ||
    changed(patch.targetScore, lobby.targetScore) ||
    changed(patch.currentGameId, lobby.currentGameId) ||
    changed(patch.status, lobby.status)
  );
}

function hasGameChanges(game: Game, patch: UpdateGameRequest): boolean {
  return (
    changed(patch.title, game.title) || changed(patch.enabled, game.enabled)
  );
}

function changed<T>(nextValue: T | undefined, currentValue: T): boolean {
  return nextValue !== undefined && nextValue !== currentValue;
}

function randomIndex(length: number): number {
  if (length <= 1) {
    return 0;
  }

  // Rejection sampling keeps the selection uniform: discard the high tail of
  // the uint32 range that wouldn't divide evenly by `length` so no game gets a
  // slightly higher chance of winning.
  const limit = Math.floor(0xffffffff / length) * length;
  const buffer = new Uint32Array(1);

  let value: number;

  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? 0;
  } while (value >= limit);

  return value % length;
}

function getChangedRows(result: ApiD1Result | undefined): number | null {
  if (!result?.meta || typeof result.meta.changes !== "number") {
    return null;
  }

  return result.meta.changes;
}

function addOptionalUpdate(
  updates: string[],
  values: DbValue[],
  column: string,
  value: DbValue | undefined
): void {
  if (value === undefined) {
    return;
  }

  updates.push(`${column} = ?`);
  values.push(value);
}

function hasQuerySecret(request: Request): boolean {
  const url = new URL(request.url);
  const blockedQueryParams = new Set([
    "authorization",
    "code",
    "managementcode",
    "management_code",
    "secret",
    "token",
  ]);

  return Array.from(url.searchParams.keys()).some((param) =>
    blockedQueryParams.has(param.toLowerCase())
  );
}

function readBearerManagementCode(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  return match?.[1]?.trim() ?? null;
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

    throw jsonHandledError(
      jsonError(400, "invalid_json", "Request body must be valid JSON.")
    );
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
    issues: issues.map(
      (issue): ValidationIssue => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })
    ),
  });
}

function lobbyStateEtag(version: number): string {
  return `"v${version}"`;
}

// RFC 9110 If-None-Match: a comma-separated list, the "*" wildcard, and weak
// validators (W/ prefix) that an intermediary may have added are all valid.
function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }

  const normalized = etag.replace(/^W\//, "");

  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === normalized;
  });
}

function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      etag,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_CONTENT_TYPE);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
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
        ...extra,
      },
    },
    { status }
  );
}

function rateLimitedError(): Response {
  const response = jsonError(
    429,
    "rate_limited",
    "Too many requests. Try again shortly."
  );

  response.headers.set("retry-after", "60");
  return response;
}

function jsonHandledError(response: Response): Error {
  return Object.assign(new Error("Handled JSON response"), { response });
}

function isHandledJsonError(
  error: unknown
): error is Error & { response: Response } {
  return (
    error instanceof Error &&
    "response" in error &&
    error.response instanceof Response
  );
}
