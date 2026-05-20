import { z } from "zod";

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_ID_PREFIX = "lob_";
const GAME_ID_PREFIX = "game_";
const MANAGEMENT_HASH_PREFIX = "sha256:";
const TOKEN_BYTE_LIMIT = Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;
const textEncoder = new TextEncoder();

export const LOBBY_STATUSES = ["setup", "ready", "playing", "complete"] as const;

export const LobbyIdSchema = z
  .string()
  .regex(/^lob_[a-z2-9]{12}$/, "Expected a generated lobby id.");

export const GameIdSchema = z
  .string()
  .regex(/^game_[a-z2-9]{12}$/, "Expected a generated game id.");

export const PlayerNameSchema = z.string().trim().min(1).max(40);
export const GameTitleSchema = z.string().trim().min(1).max(80);
export const ScoreSchema = z.number().int().min(0).max(999);
export const VersionSchema = z.number().int().min(1);
export const TimestampSchema = z.string().datetime({ offset: true });
export const LobbyStatusSchema = z.enum(LOBBY_STATUSES);

export const ManagementCodeSchema = z
  .string()
  .trim()
  .regex(/^GG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i)
  .transform((code) => code.toUpperCase());

export const ManagementCodeHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected a SHA-256 management code hash.");

export const LobbySchema = z
  .object({
    id: LobbyIdSchema,
    playerOneName: PlayerNameSchema,
    playerTwoName: PlayerNameSchema,
    playerOneScore: ScoreSchema,
    playerTwoScore: ScoreSchema,
    targetScore: z.number().int().min(1).max(99).nullable(),
    status: LobbyStatusSchema,
    currentGameId: GameIdSchema.nullable(),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const GameSchema = z
  .object({
    id: GameIdSchema,
    lobbyId: LobbyIdSchema,
    title: GameTitleSchema,
    position: z.number().int().min(0),
    enabled: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const LobbyStateSchema = z
  .object({
    lobby: LobbySchema,
    games: z.array(GameSchema),
    managementCodeHash: ManagementCodeHashSchema,
    version: VersionSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const PublicLobbyStateSchema = LobbyStateSchema.omit({
  managementCodeHash: true
}).strict();

export const CreateLobbyRequestSchema = z
  .object({
    playerOneName: PlayerNameSchema,
    playerTwoName: PlayerNameSchema,
    games: z.array(GameTitleSchema).max(64).default([]),
    targetScore: z.number().int().min(1).max(99).optional()
  })
  .strict();

export const CreateLobbyResponseSchema = z
  .object({
    lobbyId: LobbyIdSchema,
    managementCode: ManagementCodeSchema
  })
  .strict();

export type LobbyStatus = z.infer<typeof LobbyStatusSchema>;
export type Lobby = z.infer<typeof LobbySchema>;
export type Game = z.infer<typeof GameSchema>;
export type LobbyState = z.infer<typeof LobbyStateSchema>;
export type PublicLobbyState = z.infer<typeof PublicLobbyStateSchema>;
export type CreateLobbyRequest = z.infer<typeof CreateLobbyRequestSchema>;
export type CreateLobbyResponse = z.infer<typeof CreateLobbyResponseSchema>;
export type ManagementCode = z.infer<typeof ManagementCodeSchema>;
export type ManagementCodeHash = z.infer<typeof ManagementCodeHashSchema>;

export function parseCreateLobbyRequest(payload: unknown): CreateLobbyRequest {
  return CreateLobbyRequestSchema.parse(payload);
}

export function safeParseCreateLobbyRequest(payload: unknown) {
  return CreateLobbyRequestSchema.safeParse(payload);
}

export function createLobbyId(): string {
  return `${LOBBY_ID_PREFIX}${randomToken(12).toLowerCase()}`;
}

export function createGameId(): string {
  return `${GAME_ID_PREFIX}${randomToken(12).toLowerCase()}`;
}

export function createManagementCode(): ManagementCode {
  const code = `GG-${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`;

  return ManagementCodeSchema.parse(code);
}

export async function hashManagementCode(code: string): Promise<ManagementCodeHash> {
  const normalizedCode = ManagementCodeSchema.parse(code);
  const bytes = textEncoder.encode(normalizedCode);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = `${MANAGEMENT_HASH_PREFIX}${bytesToHex(new Uint8Array(digest))}`;

  return ManagementCodeHashSchema.parse(hash);
}

export async function verifyManagementCode(
  code: string,
  expectedHash: string
): Promise<boolean> {
  const parsedHash = ManagementCodeHashSchema.safeParse(expectedHash);

  if (!parsedHash.success) {
    return false;
  }

  try {
    const actualHash = await hashManagementCode(code);

    return constantTimeEqual(actualHash, parsedHash.data);
  } catch {
    return false;
  }
}

function randomToken(length: number): string {
  let token = "";

  while (token.length < length) {
    const remainingLength = length - token.length;
    const bytes = new Uint8Array(remainingLength * 2);
    globalThis.crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= TOKEN_BYTE_LIMIT) {
        continue;
      }

      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];

      if (token.length === length) {
        break;
      }
    }
  }

  return token;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}
