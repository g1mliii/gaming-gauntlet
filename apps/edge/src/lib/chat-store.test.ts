import type { Env } from "../env";
import { createChatStore } from "./chat-store";

const { createRepositoryMock } = vi.hoisted(() => ({
  createRepositoryMock: vi.fn(),
}));

vi.mock("./repository", async () => {
  const actual = await vi.importActual("./repository");
  return {
    ...actual,
    createRepository: createRepositoryMock,
  };
});

describe("createChatStore queue reply cooldowns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T15:00:00.000Z"));
    createRepositoryMock.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquires a durable queue reply cooldown with an expiring upsert", async () => {
    const insertFirst = vi.fn().mockResolvedValue({ key: "help:1001" });
    const prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => {
        if (sql.includes("INSERT INTO queue_reply_cooldowns")) {
          expect(bindings).toEqual([
            "help:1001",
            "2026-03-27T15:01:00.000Z",
            "2026-03-27T15:00:00.000Z",
            "2026-03-27T15:00:00.000Z",
          ]);

          return {
            first: insertFirst,
            run: vi.fn(),
          };
        }

        return {
          first: vi.fn(),
          run: vi.fn(),
        };
      },
    }));
    const env = {
      DB: {
        prepare,
      },
    } as unknown as Env;
    const store = createChatStore(env);

    await expect(store.takeQueueReplyCooldown("help:1001", 60_000)).resolves.toBe(
      true
    );
    expect(insertFirst).toHaveBeenCalledTimes(1);
  });

  it("returns false when the durable cooldown is still active", async () => {
    const insertFirst = vi.fn().mockResolvedValue(null);
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: () => ({
            first: sql.includes("INSERT INTO queue_reply_cooldowns")
              ? insertFirst
              : vi.fn(),
            run: vi.fn(),
          }),
        })),
      },
    } as unknown as Env;
    const store = createChatStore(env);

    await expect(
      store.takeQueueReplyCooldown("unknown:1001", 15_000)
    ).resolves.toBe(false);
    expect(insertFirst).toHaveBeenCalledTimes(1);
  });

  it("prunes expired durable cooldowns with the current timestamp", async () => {
    const deleteRun = vi.fn().mockResolvedValue(undefined);
    const prepare = vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => {
        if (sql.includes("DELETE FROM queue_reply_cooldowns")) {
          expect(bindings).toEqual(["2026-03-27T15:00:00.000Z"]);
          return {
            first: vi.fn(),
            run: deleteRun,
          };
        }

        return {
          first: vi.fn(),
          run: vi.fn(),
        };
      },
    }));
    const env = {
      DB: {
        prepare,
      },
    } as unknown as Env;
    const store = createChatStore(env);

    await store.pruneExpiredQueueReplyCooldowns();

    expect(deleteRun).toHaveBeenCalledTimes(1);
  });

  it("looks up a persisted viewer vote without loading the full vote table", async () => {
    const voteFirst = vi.fn().mockResolvedValue({
      suggestion_id: "sgg_02",
      voter_twitch_id: "viewer-1",
    });
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: (...bindings: unknown[]) => {
            if (sql.includes("FROM votes")) {
              expect(bindings).toEqual(["match_1", "viewer-1"]);
              return {
                first: voteFirst,
                run: vi.fn(),
              };
            }

            return {
              first: vi.fn(),
              run: vi.fn(),
            };
          },
        })),
      },
    } as unknown as Env;
    const store = createChatStore(env);

    await expect(
      store.getViewerVoteSuggestionId("match_1", "viewer-1")
    ).resolves.toBe("sgg_02");
  });

  it("returns the persisted processed-message expiry for point dedupe checks", async () => {
    const processedFirst = vi.fn().mockResolvedValue({
      message_id: "msg-1",
      expires_at: "2026-03-27T15:10:00.000Z",
    });
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: (...bindings: unknown[]) => {
            if (sql.includes("FROM processed_command_messages")) {
              expect(bindings).toEqual([
                "match_1",
                "msg-1",
                "2026-03-27T15:00:00.000Z",
              ]);
              return {
                first: processedFirst,
                run: vi.fn(),
              };
            }

            return {
              first: vi.fn(),
              run: vi.fn(),
            };
          },
        })),
      },
    } as unknown as Env;
    const store = createChatStore(env);

    await expect(
      store.getProcessedCommandMessageExpiry(
        "match_1",
        "msg-1",
        "2026-03-27T15:00:00.000Z"
      )
    ).resolves.toBe(Date.parse("2026-03-27T15:10:00.000Z"));
  });
});
