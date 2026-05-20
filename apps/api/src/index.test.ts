import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { handleApiRequest } from ".";
import type { ApiDatabase, ApiEnv, ApiStatement } from ".";

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
    const row = this.database.prepare(this.query).get(...this.values) as T | undefined;

    return row ?? null;
  }

  async all<T = unknown>(): Promise<{ results?: T[] }> {
    const rows = this.database.prepare(this.query).all(...this.values) as T[];

    return { results: rows };
  }

  async run(): Promise<unknown> {
    this.database.prepare(this.query).run(...this.values);

    return { success: true };
  }
}

class SqliteD1Database implements ApiDatabase {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string): ApiStatement {
    return new SqliteD1Statement(this.database, query);
  }

  async batch(statements: ApiStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];

    this.database.exec("BEGIN IMMEDIATE");

    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }

      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("Phase 3 core lobby API", () => {
  let sqlite: DatabaseSync;
  let env: ApiEnv;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync(resolve(__dirname, "../../../migrations/0001_v1_lobby_foundation.sql"), "utf8")
    );
    env = { DB: new SqliteD1Database(sqlite) };
  });

  afterEach(() => {
    sqlite.close();
  });

  test("POST /api/lobbies creates a lobby and returns the one allowed raw code response", async () => {
    const response = await apiJson("/api/lobbies", {
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"],
      targetScore: 5
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
      .prepare("SELECT player_one_name, player_two_name, target_score FROM lobbies WHERE id = ?")
      .get(body.lobbyId) as {
      player_one_name: string;
      player_two_name: string;
      target_score: number;
    };
    const secretRow = sqlite
      .prepare("SELECT management_code_hash FROM lobby_secrets WHERE lobby_id = ?")
      .get(body.lobbyId) as { management_code_hash: string };

    expect(lobbyRow).toEqual({
      player_one_name: "Alice",
      player_two_name: "Bob",
      target_score: 5
    });
    expect(secretRow.management_code_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(secretRow)).not.toContain(body.managementCode);
  });

  test("GET /api/lobbies/:lobbyId/state returns public state with starting games", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Rocket League", "Tetris"]
    });
    const response = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const body = (await response.json()) as {
      lobby: {
        id: string;
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
    expect(body.lobby.playerOneName).toBe("Alice");
    expect(body.lobby.playerTwoName).toBe("Bob");
    expect(body.version).toBe(1);
    expect(body.updatedAt).toBe(body.lobby.updatedAt);
    expect(
      body.games.map((game) => ({
        title: game.title,
        enabled: game.enabled,
        position: game.position
      }))
    ).toEqual([
      { title: "Rocket League", enabled: true, position: 0 },
      { title: "Tetris", enabled: true, position: 1 }
    ]);
    expect(serialized).not.toContain(created.managementCode);
    expect(serialized).not.toMatch(/managementCode|managementCodeHash|secret|token|authorization/i);
  });

  test("GET /api/lobbies/:lobbyId/state handles lobbies with no starting games", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob"
    });
    const response = await apiGet(`/api/lobbies/${created.lobbyId}/state`);
    const body = (await response.json()) as { games: unknown[] };

    expect(response.status).toBe(200);
    expect(body.games).toEqual([]);
  });

  test("POST /api/lobbies/:lobbyId/verify accepts the correct code and rejects wrong codes", async () => {
    const created = await createLobby({
      playerOneName: "Alice",
      playerTwoName: "Bob"
    });

    const accepted = await apiJson(`/api/lobbies/${created.lobbyId}/verify`, {
      managementCode: created.managementCode
    });
    const acceptedBody = (await accepted.json()) as { success: boolean };

    expect(accepted.status).toBe(200);
    expect(acceptedBody).toEqual({ success: true });

    const rejected = await apiJson(`/api/lobbies/${created.lobbyId}/verify`, {
      managementCode: "GG-AAAA-BBBB-CCCC"
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
      managementCode: "GG-AAAA-BBBB-CCCC"
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
          "content-type": "application/json"
        },
        body: JSON.stringify({
          playerOneName: "Alice",
          playerTwoName: "Bob",
          games: ["x".repeat(20_000)]
        })
      }),
      env
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("payload_too_large");
  });

  async function createLobby(payload: {
    playerOneName: string;
    playerTwoName: string;
    games?: string[];
    targetScore?: number;
  }): Promise<{ lobbyId: string; managementCode: string }> {
    const response = await apiJson("/api/lobbies", payload);

    expect(response.status).toBe(201);
    return (await response.json()) as { lobbyId: string; managementCode: string };
  }

  function apiGet(path: string): Promise<Response> {
    return handleApiRequest(new Request(`https://api.test${path}`), env);
  }

  function apiJson(path: string, body: unknown): Promise<Response> {
    return handleApiRequest(
      new Request(`https://api.test${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      }),
      env
    );
  }
});
