import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import {
  CreateLobbyRequestSchema,
  GameSchema,
  LobbySchema,
  LobbyStateSchema,
  PublicLobbyStateSchema,
  createGameId,
  createLobbyId,
  createManagementCode,
  hashManagementCode,
  parseCreateLobbyRequest,
  safeParseCreateLobbyRequest,
  verifyManagementCode
} from ".";

const now = "2026-05-20T12:00:00.000Z";
const lobbyId = "lob_abc234def567";
const gameId = "game_abc234def567";
const managementCodeHash =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const lobby = {
  id: lobbyId,
  playerOneName: "Player One",
  playerTwoName: "Player Two",
  playerOneScore: 0,
  playerTwoScore: 0,
  targetScore: 3,
  status: "setup",
  currentGameId: null,
  version: 1,
  createdAt: now,
  updatedAt: now
};

const game = {
  id: gameId,
  lobbyId,
  title: "Rocket League",
  position: 0,
  enabled: true,
  createdAt: now,
  updatedAt: now
};

describe("Phase 2 shared schemas", () => {
  test("Lobby requires the V1 polling and scoreboard fields", () => {
    expect(LobbySchema.parse(lobby)).toEqual(lobby);
    expect(LobbySchema.safeParse({ ...lobby, id: undefined }).success).toBe(false);
    expect(LobbySchema.safeParse({ ...lobby, playerOneName: "" }).success).toBe(false);
    expect(LobbySchema.safeParse({ ...lobby, playerOneScore: -1 }).success).toBe(false);
    expect(LobbySchema.safeParse({ ...lobby, status: "oauth-required" }).success).toBe(
      false
    );
    expect(LobbySchema.safeParse({ ...lobby, version: 0 }).success).toBe(false);
    expect(LobbySchema.safeParse({ ...lobby, updatedAt: "not-a-date" }).success).toBe(
      false
    );
  });

  test("Game requires id, lobbyId, title, position, and enabled", () => {
    expect(GameSchema.parse(game)).toEqual(game);
    expect(GameSchema.safeParse({ ...game, id: undefined }).success).toBe(false);
    expect(GameSchema.safeParse({ ...game, lobbyId: undefined }).success).toBe(false);
    expect(GameSchema.safeParse({ ...game, title: "" }).success).toBe(false);
    expect(GameSchema.safeParse({ ...game, position: -1 }).success).toBe(false);
    expect(GameSchema.safeParse({ ...game, enabled: undefined }).success).toBe(false);
  });

  test("private lobby state stores a hash and rejects raw management codes", () => {
    const privateState = {
      lobby,
      games: [game],
      managementCodeHash,
      version: lobby.version,
      updatedAt: lobby.updatedAt
    };
    const publicState = {
      lobby,
      games: [game],
      version: lobby.version,
      updatedAt: lobby.updatedAt
    };

    expect(LobbyStateSchema.parse(privateState)).toEqual(privateState);
    expect(PublicLobbyStateSchema.parse(publicState)).toEqual(publicState);
    expect(PublicLobbyStateSchema.safeParse(privateState).success).toBe(false);
    expect(
      LobbyStateSchema.safeParse({
        ...privateState,
        managementCode: "GG-AAAA-BBBB-CCCC"
      }).success
    ).toBe(false);
    expect(JSON.stringify(publicState)).not.toContain("managementCodeHash");
  });

  test("create lobby request validation accepts only valid request bodies", () => {
    expect(
      parseCreateLobbyRequest({
        playerOneName: "Alice",
        playerTwoName: "Bob",
        games: ["Chess", "Tetris"],
        targetScore: 5
      })
    ).toEqual({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: ["Chess", "Tetris"],
      targetScore: 5
    });
    expect(
      parseCreateLobbyRequest({
        playerOneName: "Alice",
        playerTwoName: "Bob"
      })
    ).toEqual({
      playerOneName: "Alice",
      playerTwoName: "Bob",
      games: []
    });
    expect(
      CreateLobbyRequestSchema.safeParse({
        playerOneName: "",
        playerTwoName: "Bob"
      }).success
    ).toBe(false);
    expect(
      CreateLobbyRequestSchema.safeParse({
        playerOneName: "Alice",
        playerTwoName: "Bob",
        managementCode: "GG-AAAA-BBBB-CCCC"
      }).success
    ).toBe(false);
    expect(
      CreateLobbyRequestSchema.safeParse({
        playerOneName: "Alice",
        playerTwoName: "Bob",
        targetScore: 0
      }).success
    ).toBe(false);
    expect(
      safeParseCreateLobbyRequest({
        playerOneName: "",
        playerTwoName: "Bob"
      }).success
    ).toBe(false);
  });

  test("generated ids and management codes match the shared schemas", () => {
    expect(LobbySchema.shape.id.safeParse(createLobbyId()).success).toBe(true);
    expect(GameSchema.shape.id.safeParse(createGameId()).success).toBe(true);
    expect(createManagementCode()).toMatch(/^GG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  test("hash verification accepts the correct code and rejects incorrect codes", async () => {
    const code = createManagementCode();
    const hash = await hashManagementCode(code);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(verifyManagementCode(code, hash)).resolves.toBe(true);
    await expect(verifyManagementCode("GG-AAAA-BBBB-CCCC", hash)).resolves.toBe(false);
    await expect(verifyManagementCode(code, "not-a-hash")).resolves.toBe(false);
  });
});

describe("Phase 2 D1 migration", () => {
  test("applies cleanly and creates the required tables without raw code storage", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../../migrations/0001_v1_lobby_foundation.sql"),
      "utf8"
    );
    const database = new DatabaseSync(":memory:");

    try {
      database.exec(migration);

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row.name));
      const lobbySecretColumns = database
        .prepare("PRAGMA table_info(lobby_secrets)")
        .all()
        .map((row) => String(row.name));

      expect(tables).toContain("lobbies");
      expect(tables).toContain("games");
      expect(tables).toContain("lobby_secrets");
      expect(lobbySecretColumns).toContain("management_code_hash");
      expect(lobbySecretColumns).not.toContain("management_code");
      expect(lobbySecretColumns).not.toContain("managementCode");
    } finally {
      database.close();
    }
  });
});
