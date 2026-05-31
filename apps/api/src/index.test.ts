import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { handleApiRequest, runLobbyRetentionSweep } from ".";
import type {
  ApiD1Result,
  ApiDatabase,
  ApiEnv,
  ApiRateLimiter,
  ApiStatement,
} from ".";

type SqliteValue = string | number | null;

const __dirname = dirname(fileURLToPath(import.meta.url));

class SqliteD1Statement implements ApiStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: SqliteValue[] = []
  ) {}

  bind(...values: SqliteValue[]): ApiStatement {
    return new SqliteD1Statement(this.database, this.query, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...this.values) as
      | T
      | undefined;

    return row ?? null;
  }

  async all<T = unknown>(): Promise<ApiD1Result<T>> {
    const rows = this.database.prepare(this.query).all(...this.values) as T[];

    return d1Result(rows);
  }

  async run<T = unknown>(): Promise<ApiD1Result<T>> {
    const result = this.database.prepare(this.query).run(...this.values) as {
      changes?: bigint | number;
      lastInsertRowid?: bigint | number;
    };
    const changes = toNumber(result.changes);

    return d1Result<T>([], {
      changes,
      changed_db: changes > 0,
      last_row_id: toNumber(result.lastInsertRowid),
      rows_written: changes,
    });
  }
}

class SqliteD1Database implements ApiDatabase {
  readonly batchSizes: number[] = [];

  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string): ApiStatement {
    return new SqliteD1Statement(this.database, query);
  }

  async batch<T = unknown>(
    statements: ApiStatement[]
  ): Promise<ApiD1Result<T>[]> {
    const results: ApiD1Result<T>[] = [];

    this.batchSizes.push(statements.length);
    this.database.exec("BEGIN IMMEDIATE");

    try {
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }

      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function d1Result<T = unknown>(
  results: T[],
  meta: Partial<NonNullable<ApiD1Result["meta"]>> = {}
): ApiD1Result<T> {
  return {
    results,
    success: true,
    meta: {
      changes: meta.changes ?? 0,
      rows_written: meta.rows_written ?? 0,
    },
  };
}

function toNumber(value: bigint | number | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return value ?? 0;
}

describe("Phase 3 core lobby API", () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let env: ApiEnv;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    for (const migrationName of [
      "0001_v1_lobby_foundation.sql",
      "0002_add_lobby_title.sql",
    ]) {
      sqlite.exec(
        readFileSync(
          resolve(__dirname, `../../../migrations/${migrationName}`),
          "utf8"
        )
      );
    }
    database = new SqliteD1Database(sqlite);
    env = { DB: database };
  });

  afterEach(() => {
    sqlite.close();
  });

  test("POST /api/lobbies creates a lobby and returns the one allowed raw code response", async () => {
    const response = await apiJson("/api/lobbies", {
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
      targetScore: 5,
    });
    const body = (await response.json()) as {
      lobbyId: string;
      managementCode: string;
    };

    expect(response.status).toBe(201);
    expect(body.lobbyId).toMatch(/^lob_[a-z2-9]{12}$/);
    expect(body.managementCode).toMatch(
      /^GG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
    );

    const lobbyRow = sqlite
      .prepare(
        "SELECT title, player_one_name, player_two_name, target_score FROM lobbies WHERE id = ?"
      )
      .get(body.lobbyId) as {
      title: string;
      player_one_name: string;
      player_two_name: string;
      target_score: number;
    };
    const secretRow = sqlite
      .prepare(
        "SELECT management_code_hash FROM lobby_secrets WHERE lobby_id = ?"
      )
      .get(body.lobbyId) as { management_code_hash: string };

    expect(lobbyRow).toEqual({
      title: "Alice vs Bob",
      player_one_name: "Alice",
      player_two_name: "Bob",
      target_score: 5,
    });
    expect(secretRow.management_code_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(secretRow)).not.toContain(body.managementCode);
  });

  test("GET /api/lobbies/:lobbyId/state returns public state with starting games", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const response = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const body = (await response.json()) as {
      lobby: {
        id: string;
        title: string;
        playerOneName: string;
        playerTwoName: string;
        version: number;
        updatedAt: string;
      };
      games: Array<{ title: string; enabled: boolean; position: number }>;
      version: number;
      updatedAt: string;
    };
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.lobby.id).toBe(created.lobbyId);
    expect(body.lobby.title).toBe("Alice vs Bob");
    expect(body.lobby.playerOneName).toBe("Alice");
    expect(body.lobby.playerTwoName).toBe("Bob");
    expect(body.version).toBe(1);
    expect(body.updatedAt).toBe(body.lobby.updatedAt);
    expect(
      body.games.map((game) => ({
        title: game.title,
        enabled: game.enabled,
        position: game.position,
      }))
    ).toEqual([
      { title: "Rocket League", enabled: true, position: 0 },
      { title: "Tetris", enabled: true, position: 1 },
    ]);
    expect(serialized).not.toContain(created.managementCode);
    expect(serialized).not.toMatch(
      /managementCode|managementCodeHash|secret|token|authorization/i
    );
  });

  test("GET /api/lobbies/:lobbyId/state handles lobbies with no starting games", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });
    const response = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const body = (await response.json()) as {
      games: unknown[];
      lobby: { targetScore: number | null };
    };

    expect(response.status).toBe(200);
    expect(body.games).toEqual([]);
    expect(body.lobby.targetScore).toBeNull();
  });

  test("GET /api/lobbies/:lobbyId/state returns a version ETag and 304s unchanged polls", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });

    const first = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const etag = first.headers.get("etag");

    expect(first.status).toBe(200);
    expect(etag).toBe('"v1"');

    const conditional = await apiGet(`/api/lobbies/${created.lobbyId}/state`, {
      "if-none-match": etag!,
    });

    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe('"v1"');
    expect(await conditional.text()).toBe("");
  });

  test("GET /api/lobbies/:lobbyId/state serves a fresh body and ETag after a write", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });

    const patched = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      { playerOneScore: 1 },
      { method: "PATCH", headers: authHeader(created.managementCode) }
    );

    expect(patched.status).toBe(200);

    // A poller still holding the pre-write ETag must not get a stale 304.
    const response = await apiGet(`/api/lobbies/${created.lobbyId}/state`, {
      "if-none-match": '"v1"',
    });
    const body = (await response.json()) as {
      version: number;
      lobby: { playerOneScore: number };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"v2"');
    expect(body.version).toBe(2);
    expect(body.lobby.playerOneScore).toBe(1);
  });

  test("POST /api/lobbies/:lobbyId/verify accepts the correct code and rejects wrong codes", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });

    const accepted = await apiJson(`/api/lobbies/${created.lobbyId}/verify`, {
      managementCode: created.managementCode,
    });
    const acceptedBody = (await accepted.json()) as { success: boolean };

    expect(accepted.status).toBe(200);
    expect(acceptedBody).toEqual({ success: true });

    const rejected = await apiJson(`/api/lobbies/${created.lobbyId}/verify`, {
      managementCode: "GG-AAAA-BBBB-CCCC",
    });
    const rejectedBody = (await rejected.json()) as {
      error: { code: string; message: string };
    };

    expect(rejected.status).toBe(401);
    expect(rejectedBody.error.code).toBe("invalid_management_code");
    expect(JSON.stringify(rejectedBody)).not.toContain(created.managementCode);
  });

  test("unknown lobby ids return 404", async () => {
    const response = await apiGet("/api/lobbies/lob_abc234def567/state");
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  test("invalid create lobby payloads return validation errors", async () => {
    const response = await apiJson("/api/lobbies", {
      playerOneName: "",
      playerTwoName: "Bob",
      managementCode: "GG-AAAA-BBBB-CCCC",
    });
    const body = (await response.json()) as {
      error: { code: string; issues: Array<{ path: string }> };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  test("oversized JSON bodies are rejected before validation", async () => {
    const response = await handleApiRequest(
      new Request("https://api.test/api/lobbies", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          playerOneName: "Alice",
          playerTwoName: "Bob",
          games: ["x".repeat(20_000)],
        }),
      }),
      env
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("payload_too_large");
  });

  test("configured rate limiters reject create, verify, state, and write routes", async () => {
    const createLimiter = mockRateLimiter(false);
    const verifyLimiter = mockRateLimiter(false);
    const stateLimiter = mockRateLimiter(false);
    const writeLimiter = mockRateLimiter(false);
    const limitedEnv: ApiEnv = {
      ...env,
      CREATE_RATE_LIMITER: createLimiter,
      STATE_RATE_LIMITER: stateLimiter,
      VERIFY_RATE_LIMITER: verifyLimiter,
      WRITE_RATE_LIMITER: writeLimiter,
    };
    const clientHeaders = { "cf-connecting-ip": "203.0.113.10" };

    const createResponse = await handleApiRequest(
      new Request("https://api.test/api/lobbies", {
        method: "POST",
        headers: clientHeaders,
        body: "{}",
      }),
      limitedEnv
    );
    const stateResponse = await handleApiRequest(
      new Request(`https://api.test/api/lobbies/${lobbyIdFixture()}/state`, {
        headers: clientHeaders,
      }),
      limitedEnv
    );
    const verifyResponse = await handleApiRequest(
      new Request(`https://api.test/api/lobbies/${lobbyIdFixture()}/verify`, {
        method: "POST",
        headers: clientHeaders,
        body: "{}",
      }),
      limitedEnv
    );
    const writeResponse = await handleApiRequest(
      new Request(`https://api.test/api/lobbies/${lobbyIdFixture()}`, {
        method: "PATCH",
        headers: clientHeaders,
        body: "{}",
      }),
      limitedEnv
    );

    for (const response of [
      createResponse,
      stateResponse,
      verifyResponse,
      writeResponse,
    ]) {
      const body = (await response.json()) as { error: { code: string } };

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(body.error.code).toBe("rate_limited");
    }

    expect(createLimiter.limit).toHaveBeenCalledWith({
      key: "create:203.0.113.10",
    });
    expect(stateLimiter.limit).toHaveBeenCalledWith({
      key: `state:${lobbyIdFixture()}:203.0.113.10`,
    });
    expect(verifyLimiter.limit).toHaveBeenCalledWith({
      key: `verify:${lobbyIdFixture()}:203.0.113.10`,
    });
    expect(writeLimiter.limit).toHaveBeenCalledWith({
      key: `write:${lobbyIdFixture()}:203.0.113.10`,
    });
  });

  test("write endpoints require the correct Authorization bearer code", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });

    const missingAuth = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      { playerOneScore: 1 },
      { method: "PATCH" }
    );
    const missingAuthBody = (await missingAuth.json()) as {
      error: { code: string };
    };

    expect(missingAuth.status).toBe(401);
    expect(missingAuthBody.error.code).toBe("unauthorized");

    const wrongAuth = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      { playerOneScore: 1 },
      {
        method: "PATCH",
        headers: { authorization: "Bearer GG-AAAA-BBBB-CCCC" },
      }
    );
    const wrongAuthBody = (await wrongAuth.json()) as {
      error: { code: string };
    };

    expect(wrongAuth.status).toBe(401);
    expect(wrongAuthBody.error.code).toBe("invalid_management_code");

    const accepted = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      { playerOneScore: 1 },
      {
        method: "PATCH",
        headers: authHeader(created.managementCode),
      }
    );
    const acceptedBody = (await accepted.json()) as {
      lobby: { playerOneScore: number; version: number };
      version: number;
    };

    expect(accepted.status).toBe(200);
    expect(acceptedBody.lobby.playerOneScore).toBe(1);
    expect(acceptedBody.lobby.version).toBe(2);
    expect(acceptedBody.version).toBe(2);
    expect(JSON.stringify(acceptedBody)).not.toMatch(
      /managementCode|managementCodeHash|secret|token|authorization/i
    );
  });

  test("query param management codes are rejected and do not authorize writes", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
    });
    const response = await apiJson(
      `/api/lobbies/${created.lobbyId}?code=${encodeURIComponent(created.managementCode)}`,
      { playerOneScore: 9 },
      { method: "PATCH" }
    );
    const body = (await response.json()) as { error: { code: string } };
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      lobby: { playerOneScore: number; version: number };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    expect(state.lobby.playerOneScore).toBe(0);
    expect(state.lobby.version).toBe(1);

    const mixedCaseResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}?ManagementCode=${encodeURIComponent(
        created.managementCode
      )}`,
      { playerOneScore: 9 },
      {
        method: "PATCH",
        headers: authHeader(created.managementCode),
      }
    );
    const mixedCaseBody = (await mixedCaseResponse.json()) as {
      error: { code: string };
    };
    const unchangedStateResponse = await apiGet(
      `/api/lobbies/${created.lobbyId}/state`
    );
    const unchangedState = (await unchangedStateResponse.json()) as {
      lobby: { playerOneScore: number; version: number };
    };

    expect(mixedCaseResponse.status).toBe(400);
    expect(mixedCaseBody.error.code).toBe("bad_request");
    expect(unchangedState.lobby.playerOneScore).toBe(0);
    expect(unchangedState.lobby.version).toBe(1);
  });

  test("PATCH /api/lobbies/:lobbyId updates lobby fields and increments version", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League"],
    });
    const initialStateResponse = await apiGet(
      `/api/lobbies/${created.lobbyId}/state`
    );
    const initialState = (await initialStateResponse.json()) as {
      games: Array<{ id: string }>;
    };

    const response = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      {
        playerOneName: "Alicia",
        playerTwoName: "Bobby",
        title: "Championship Set",
        playerOneScore: 3,
        playerTwoScore: 2,
        targetScore: 7,
        currentGameId: initialState.games[0]?.id,
        status: "playing",
      },
      {
        method: "PATCH",
        headers: authHeader(created.managementCode),
      }
    );
    const body = (await response.json()) as {
      lobby: {
        playerOneName: string;
        playerTwoName: string;
        title: string;
        playerOneScore: number;
        playerTwoScore: number;
        targetScore: number;
        currentGameId: string | null;
        status: string;
        version: number;
        updatedAt: string;
      };
      updatedAt: string;
      version: number;
    };

    expect(response.status).toBe(200);
    expect(body.lobby).toMatchObject({
      playerOneName: "Alicia",
      playerTwoName: "Bobby",
      title: "Championship Set",
      playerOneScore: 3,
      playerTwoScore: 2,
      targetScore: 7,
      currentGameId: initialState.games[0]?.id,
      status: "playing",
      version: 2,
    });
    expect(body.version).toBe(2);
    expect(body.updatedAt).toBe(body.lobby.updatedAt);
    expect(JSON.stringify(body)).not.toMatch(
      /managementCode|managementCodeHash|secret|token|authorization/i
    );
  });

  test("game add, edit, reorder, and delete writes increment version safely", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const headers = authHeader(created.managementCode);
    const addedResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games`,
      { title: "Chess" },
      { headers }
    );
    const addedBody = (await addedResponse.json()) as {
      games: Array<{
        id: string;
        title: string;
        enabled: boolean;
        position: number;
      }>;
      version: number;
    };
    const addedGame = addedBody.games.find((game) => game.title === "Chess");

    expect(addedResponse.status).toBe(200);
    expect(addedBody.version).toBe(2);
    expect(addedGame).toBeDefined();
    if (!addedGame) {
      throw new Error("Expected Chess game to exist after add.");
    }
    expect(addedGame).toMatchObject({
      title: "Chess",
      enabled: true,
      position: 2,
    });

    const editedResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games/${addedGame.id}`,
      { title: "Speed Chess", enabled: false },
      {
        method: "PATCH",
        headers,
      }
    );
    const editedBody = (await editedResponse.json()) as {
      games: Array<{
        id: string;
        title: string;
        enabled: boolean;
        position: number;
      }>;
      version: number;
    };

    expect(editedResponse.status).toBe(200);
    expect(editedBody.version).toBe(3);
    expect(
      editedBody.games.find((game) => game.id === addedGame.id)
    ).toMatchObject({
      title: "Speed Chess",
      enabled: false,
    });

    const reorderedIds = [...editedBody.games].reverse().map((game) => game.id);
    const reorderedResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games/reorder`,
      { gameIds: reorderedIds },
      { headers }
    );
    const reorderedBody = (await reorderedResponse.json()) as {
      games: Array<{ id: string; position: number }>;
      version: number;
    };

    expect(reorderedResponse.status).toBe(200);
    expect(reorderedBody.version).toBe(4);
    expect(reorderedBody.games.map((game) => game.id)).toEqual(reorderedIds);
    expect(reorderedBody.games.map((game) => game.position)).toEqual([0, 1, 2]);

    const deletedResponse = await apiDelete(
      `/api/lobbies/${created.lobbyId}/games/${addedGame.id}`,
      headers
    );
    const deletedBody = (await deletedResponse.json()) as {
      games: Array<{ id: string; position: number }>;
      version: number;
    };

    expect(deletedResponse.status).toBe(200);
    expect(deletedBody.version).toBe(5);
    expect(deletedBody.games.some((game) => game.id === addedGame.id)).toBe(
      false
    );
    expect(deletedBody.games.map((game) => game.position)).toEqual([0, 1]);
    expect(
      JSON.stringify([addedBody, editedBody, reorderedBody, deletedBody])
    ).not.toMatch(
      /managementCode|managementCodeHash|secret|token|authorization/i
    );
  });

  test("no-op lobby, game, and reorder writes return current state without bumping version", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const headers = authHeader(created.managementCode);
    const initialResponse = await apiGet(
      `/api/lobbies/${created.lobbyId}/state`
    );
    const initialState = (await initialResponse.json()) as {
      games: Array<{ enabled: boolean; id: string; title: string }>;
      lobby: { playerOneName: string; title: string };
      version: number;
    };
    const firstGame = initialState.games[0];

    if (!firstGame) {
      throw new Error("Expected a seeded game.");
    }

    const lobbyNoopResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}`,
      {
        playerOneName: initialState.lobby.playerOneName,
        title: initialState.lobby.title,
      },
      {
        method: "PATCH",
        headers,
      }
    );
    const gameNoopResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games/${firstGame.id}`,
      {
        enabled: firstGame.enabled,
        title: firstGame.title,
      },
      {
        method: "PATCH",
        headers,
      }
    );
    const reorderNoopResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games/reorder`,
      { gameIds: initialState.games.map((game) => game.id) },
      { headers }
    );

    expect(
      (await lobbyNoopResponse.json()) as { version: number }
    ).toMatchObject({
      version: initialState.version,
    });
    expect(
      (await gameNoopResponse.json()) as { version: number }
    ).toMatchObject({
      version: initialState.version,
    });
    expect(
      (await reorderNoopResponse.json()) as { version: number }
    ).toMatchObject({
      version: initialState.version,
    });
  });

  test("max-size game create, reorder, and delete keep D1 batches bounded", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: Array.from({ length: 64 }, (_, index) => `Game ${index + 1}`),
    });
    const headers = authHeader(created.managementCode);
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      games: Array<{ id: string }>;
    };
    const reversedIds = [...state.games].reverse().map((game) => game.id);
    const reorderResponse = await apiJson(
      `/api/lobbies/${created.lobbyId}/games/reorder`,
      { gameIds: reversedIds },
      { headers }
    );
    const deleteResponse = await apiDelete(
      `/api/lobbies/${created.lobbyId}/games/${reversedIds[0]}`,
      headers
    );

    expect(state.games).toHaveLength(64);
    expect(reorderResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(Math.max(...database.batchSizes)).toBeLessThanOrEqual(4);
  });

  test("POST /api/lobbies/:lobbyId/spin requires the correct Authorization bearer code", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });

    const missingAuth = await apiJson(
      `/api/lobbies/${created.lobbyId}/spin`,
      {}
    );
    const missingAuthBody = (await missingAuth.json()) as {
      error: { code: string };
    };

    expect(missingAuth.status).toBe(401);
    expect(missingAuthBody.error.code).toBe("unauthorized");

    const wrongAuth = await apiJson(
      `/api/lobbies/${created.lobbyId}/spin`,
      {},
      { headers: { authorization: "Bearer GG-AAAA-BBBB-CCCC" } }
    );
    const wrongAuthBody = (await wrongAuth.json()) as {
      error: { code: string };
    };

    expect(wrongAuth.status).toBe(401);
    expect(wrongAuthBody.error.code).toBe("invalid_management_code");
  });

  test("POST /api/lobbies/:lobbyId/spin rejects query-param management codes", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const response = await apiJson(
      `/api/lobbies/${created.lobbyId}/spin?code=${encodeURIComponent(
        created.managementCode
      )}`,
      {}
    );
    const body = (await response.json()) as { error: { code: string } };
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      lobby: { currentGameId: string | null; version: number };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    expect(state.lobby.currentGameId).toBeNull();
    expect(state.lobby.version).toBe(1);
  });

  test("POST /api/lobbies/:lobbyId/spin returns 400 when no games are enabled", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const headers = authHeader(created.managementCode);
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      games: Array<{ id: string }>;
    };

    for (const game of state.games) {
      await apiJson(
        `/api/lobbies/${created.lobbyId}/games/${game.id}`,
        { enabled: false },
        { method: "PATCH", headers }
      );
    }

    const response = await apiJson(
      `/api/lobbies/${created.lobbyId}/spin`,
      {},
      { headers }
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("no_enabled_games");
  });

  test("POST /api/lobbies/:lobbyId/spin only ever selects an enabled game", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris", "Chess", "Pong"],
    });
    const headers = authHeader(created.managementCode);
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      games: Array<{ id: string; title: string }>;
    };
    const allowed = state.games.find((game) => game.title === "Chess");

    if (!allowed) {
      throw new Error("expected the Chess game to exist");
    }

    for (const game of state.games) {
      if (game.id !== allowed.id) {
        await apiJson(
          `/api/lobbies/${created.lobbyId}/games/${game.id}`,
          { enabled: false },
          { method: "PATCH", headers }
        );
      }
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await apiJson(
        `/api/lobbies/${created.lobbyId}/spin`,
        {},
        { headers }
      );
      const body = (await response.json()) as {
        lobby: { currentGameId: string | null };
      };

      expect(response.status).toBe(200);
      expect(body.lobby.currentGameId).toBe(allowed.id);
    }
  });

  test("POST /api/lobbies/:lobbyId/spin sets currentGameId, bumps version, and leaks no secrets", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
    });
    const headers = authHeader(created.managementCode);
    const stateResponse = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const state = (await stateResponse.json()) as {
      games: Array<{ id: string }>;
    };
    const enabledIds = state.games.map((game) => game.id);

    const response = await apiJson(
      `/api/lobbies/${created.lobbyId}/spin`,
      {},
      { headers }
    );
    const body = (await response.json()) as {
      lobby: { currentGameId: string | null; version: number };
      version: number;
    };
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.lobby.currentGameId).not.toBeNull();
    expect(enabledIds).toContain(body.lobby.currentGameId);
    expect(body.lobby.version).toBe(2);
    expect(body.version).toBe(2);
    expect(serialized).not.toContain(created.managementCode);
    expect(serialized).not.toMatch(
      /managementCode|managementCodeHash|secret|token|authorization/i
    );
  });

  async function createLobby(payload: {
    playerOneName: string;
    playerTwoName: string;
    games?: string[];
    targetScore?: number;
  }): Promise<{ lobbyId: string; managementCode: string }> {
    const response = await apiJson("/api/lobbies", payload);

    expect(response.status).toBe(201);
    return (await response.json()) as {
      lobbyId: string;
      managementCode: string;
    };
  }

  function apiGet(path: string, headers?: HeadersInit): Promise<Response> {
    return handleApiRequest(
      new Request(`https://api.test${path}`, { headers }),
      env
    );
  }

  function authHeader(managementCode: string): HeadersInit {
    return { authorization: `Bearer ${managementCode}` };
  }

  function apiJson(
    path: string,
    body: unknown,
    options: { method?: string; headers?: HeadersInit } = {}
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");

    return handleApiRequest(
      new Request(`https://api.test${path}`, {
        method: options.method ?? "POST",
        headers,
        body: JSON.stringify(body),
      }),
      env
    );
  }

  function apiDelete(path: string, headers?: HeadersInit): Promise<Response> {
    return handleApiRequest(
      new Request(`https://api.test${path}`, {
        method: "DELETE",
        headers,
      }),
      env
    );
  }

  function mockRateLimiter(success: boolean): ApiRateLimiter {
    return {
      limit: vi.fn().mockResolvedValue({ success }),
    };
  }

  function lobbyIdFixture(): string {
    return "lob_abc234def567";
  }
});

describe("lobby retention sweep", () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let env: ApiEnv;

  // Retention is 30 days of inactivity; cutoff for this clock is 2026-05-01.
  const now = new Date("2026-05-31T00:00:00.000Z");
  const recent = "2026-05-30T00:00:00.000Z"; // 1 day ago — keep
  const insideWindow = "2026-05-20T00:00:00.000Z"; // 11 days ago — keep
  const stale = "2026-03-01T00:00:00.000Z"; // ~91 days ago — purge

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    for (const migrationName of [
      "0001_v1_lobby_foundation.sql",
      "0002_add_lobby_title.sql",
    ]) {
      sqlite.exec(
        readFileSync(
          resolve(__dirname, `../../../migrations/${migrationName}`),
          "utf8"
        )
      );
    }
    database = new SqliteD1Database(sqlite);
    env = { DB: database };
  });

  afterEach(() => {
    sqlite.close();
  });

  test("purges lobbies inactive past the window and their games + secrets", async () => {
    seedLobby("lob_keepaaaaaaaa", insideWindow);
    seedLobby("lob_dropbbbbbbbb", stale);

    const deleted = await runLobbyRetentionSweep(env, now);

    expect(deleted).toBe(1);
    expect(idExists("lobbies", "lob_keepaaaaaaaa")).toBe(true);
    expect(idExists("lobbies", "lob_dropbbbbbbbb")).toBe(false);
    // Children of the purged lobby are gone; the surviving lobby keeps its game.
    expect(childCount("games", "lob_dropbbbbbbbb")).toBe(0);
    expect(childCount("lobby_secrets", "lob_dropbbbbbbbb")).toBe(0);
    expect(childCount("games", "lob_keepaaaaaaaa")).toBe(1);
    expect(childCount("lobby_secrets", "lob_keepaaaaaaaa")).toBe(1);
  });

  test("never touches a match scored within the window", async () => {
    seedLobby("lob_recentaaaaa", recent);
    seedLobby("lob_edgeaaaaaaaa", insideWindow);

    const deleted = await runLobbyRetentionSweep(env, now);

    expect(deleted).toBe(0);
    expect(rowCount("lobbies")).toBe(2);
  });

  function seedLobby(id: string, updatedAt: string): void {
    sqlite
      .prepare(
        `INSERT INTO lobbies (id, title, player_one_name, player_two_name, created_at, updated_at)
         VALUES (?, '', 'A', 'B', ?, ?)`
      )
      .run(id, updatedAt, updatedAt);
    sqlite
      .prepare(
        `INSERT INTO games (id, lobby_id, title, position, created_at, updated_at)
         VALUES (?, ?, 'Rocket League', 0, ?, ?)`
      )
      .run(`game_${id}`, id, updatedAt, updatedAt);
    sqlite
      .prepare(
        `INSERT INTO lobby_secrets (lobby_id, management_code_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, `sha256:${"a".repeat(64)}`, updatedAt, updatedAt);
  }

  function rowCount(table: string): number {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };

    return row.n;
  }

  function idExists(table: string, id: string): boolean {
    return Boolean(
      sqlite.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)
    );
  }

  function childCount(table: string, lobbyId: string): number {
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE lobby_id = ?`)
      .get(lobbyId) as { n: number };

    return row.n;
  }
});
