import {
  applyMatchControlAction,
  createCanonicalGameKey,
  createWebsocketEnvelope,
  getMatchAutoCompleteAt,
  getMatchAutoCompleteReason,
  matchControlActionSchema,
  type ChatCommand,
  type MatchControlAction,
  type MatchSnapshot,
  type MatchSummary,
} from "@gaming-gauntlet/contracts";

import type { Env } from "../env";
import {
  createChatStore,
  type PersistedSuggestionState,
} from "../lib/chat-store";
import { createRepository } from "../lib/repository";
import { json } from "../lib/response";

const IDLE_EVICTION_MS = 5 * 60 * 1000;
const MESSAGE_DEDUPE_TTL_MS = 15 * 60 * 1000;
const MANAGED_MATCH_ID_KEY = "matchId";
const MATCH_SOCKET_TAG_PREFIX = "match:";

type CommandInput = {
  command: ChatCommand;
  messageId: string;
  sentAt: string;
  sourceChannelId: string;
  sourceTwitchChannelId: string;
  viewerId: string;
  replyParentId: string | null;
};

type CommandBatchInput = {
  commands: CommandInput[];
};

type ReplyPayload = {
  broadcasterId: string;
  message: string;
  replyParentMessageId: string | null;
};

type ExpiringEntry = {
  key: string;
  expiresAt: number;
};

type RuntimeState = {
  snapshot: MatchSnapshot;
  suggestionsById: Map<string, PersistedSuggestionState>;
  suggestionIdsByCanonical: Map<string, string>;
  suggestionIdsByBoardId: Map<string, string>;
  viewerVotes: Map<string, string>;
  dirtySuggestionIds: Set<string>;
  dirtyQueueIds: Set<string>;
  dirtyVotes: Map<string, { suggestionId: string; sourceChannelId: string }>;
  pendingProcessedMessages: Map<string, string>;
  recentMessageIds: Map<string, number>;
  recentMessageExpirations: ExpiringEntry[];
  recentMessageExpirationHead: number;
  replyCooldowns: Map<string, number>;
  replyCooldownExpirations: ExpiringEntry[];
  replyCooldownExpirationHead: number;
  nextBoardNumber: number;
  dirty: boolean;
  queueDirty: boolean;
  removedQueueIds: Set<string>;
  playersDirty: boolean;
  lastActivityAt: number;
  cachedTopBoardSummary: string | null;
  snapshotSuggestionsDirty: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function compareBoardOrder(
  left: PersistedSuggestionState,
  right: PersistedSuggestionState
): number {
  if (right.voteCount !== left.voteCount) {
    return right.voteCount - left.voteCount;
  }

  return Number(left.boardId) - Number(right.boardId);
}

function formatBoardId(boardNumber: number): string {
  return String(boardNumber).padStart(2, "0");
}

function normalizeBoardVoteArgument(argument: string | null): string | null {
  if (!argument) {
    return null;
  }

  const normalized = argument.replace(/^#/, "").trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return normalized.padStart(2, "0");
}

function cleanupExpiringEntries(
  map: Map<string, number>,
  expirations: ExpiringEntry[],
  head: number,
  now: number
): number {
  let nextHead = head;

  while (
    nextHead < expirations.length &&
    expirations[nextHead]?.expiresAt <= now
  ) {
    const entry = expirations[nextHead];

    if (entry && map.get(entry.key) === entry.expiresAt) {
      map.delete(entry.key);
    }

    nextHead += 1;
  }

  if (nextHead >= 1024 && nextHead * 2 >= expirations.length) {
    expirations.splice(0, nextHead);
    return 0;
  }

  return nextHead;
}

function rememberExpiringKey(
  map: Map<string, number>,
  expirations: ExpiringEntry[],
  key: string,
  expiresAt: number
): void {
  map.set(key, expiresAt);
  expirations.push({ key, expiresAt });
}

function buildSnapshotEtag(snapshot: {
  matchId: string;
  updatedAt: string;
  boardRevision: number;
}): string {
  return `W/"${snapshot.matchId}:${snapshot.updatedAt}:${snapshot.boardRevision}"`;
}

export class MatchCoordinator {
  private readonly chatStore: ReturnType<typeof createChatStore>;
  private readonly repo: ReturnType<typeof createRepository>;
  private runtime: RuntimeState | null = null;
  private loadingState: Promise<RuntimeState> | null = null;
  private activeMatchId: string | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.chatStore = createChatStore(env);
    this.repo = createRepository(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const matchId =
      url.searchParams.get("matchId") ?? this.activeMatchId ?? "match_demo_01";

    if (url.pathname === "/snapshot") {
      const runtime = await this.ensureRuntime(matchId);
      const etag = buildSnapshotEtag(runtime.snapshot);

      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        });
      }

      this.ensureSnapshotSuggestions(runtime);
      return json(runtime.snapshot, {
        headers: {
          ETag: etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    if (url.pathname === "/command") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, { status: 405 });
      }

      const payload = (await request.json()) as CommandInput;
      const reply = await this.processCommand(matchId, payload);
      return json({ ok: true, reply });
    }

    if (url.pathname === "/commands") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, { status: 405 });
      }

      const payload = (await request.json()) as CommandBatchInput;
      const replies = await this.processCommands(
        matchId,
        payload.commands ?? []
      );
      return json({ ok: true, replies });
    }

    if (url.pathname === "/sync-meta") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, { status: 405 });
      }

      const payload = (await request.json()) as { match: MatchSummary };
      const snapshot = await this.syncSnapshotMeta(matchId, payload.match);
      return json(snapshot);
    }

    if (url.pathname === "/control") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, { status: 405 });
      }

      const payload = await request.json();
      const result = matchControlActionSchema.safeParse(payload);

      if (!result.success) {
        return json(
          {
            error: "invalid_match_control_action",
            details: result.error.flatten(),
          },
          { status: 400 }
        );
      }

      const snapshot = await this.applyControlAction(matchId, result.data);
      return json({ snapshot });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      server.serializeAttachment({ matchId });
      this.state.acceptWebSocket(server, [buildMatchSocketTag(matchId)]);
      await this.sendSnapshot(server, matchId);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return json({ ok: true, service: "match-coordinator", matchId });
  }

  async alarm(): Promise<void> {
    const matchId = await this.getManagedMatchId();

    if (!matchId) {
      return;
    }

    const runtime = await this.ensureRuntime(matchId);
    await this.flush(matchId);

    const autoCompleteReason = getMatchAutoCompleteReason(
      runtime.snapshot,
      Date.now()
    );

    if (autoCompleteReason) {
      const summary = await this.repo.autoCompleteInactiveMatch(
        matchId,
        autoCompleteReason
      );

      if (summary) {
        await this.syncSnapshotMeta(matchId, summary);
        await this.env.EVENT_INGEST_QUEUE.send({
          type: "subscription_reconcile",
          channelLinkId: summary.channelLinkId,
          reason: "match_status",
        });
      }
    }

    if (!this.runtime || this.activeMatchId !== matchId) {
      return;
    }

    const nextRuntime = this.runtime;
    const now = Date.now();
    const autoCompleteAt = getMatchAutoCompleteAt(nextRuntime.snapshot);

    if (now - nextRuntime.lastActivityAt >= IDLE_EVICTION_MS) {
      if (autoCompleteAt !== null && autoCompleteAt > now) {
        await this.state.storage.setAlarm(autoCompleteAt);
      }

      this.runtime = null;
      this.loadingState = null;
      this.activeMatchId = null;
      return;
    }

    await this.scheduleNextAlarm(nextRuntime);
  }

  async webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const text =
      typeof message === "string" ? message : new TextDecoder().decode(message);
    const payload = safeParseJson(text);

    if (payload?.type === "request.snapshot") {
      const matchId = readSocketMatchId(this.state, webSocket);

      if (!matchId) {
        webSocket.close(1008, "match_scope_required");
        return;
      }

      await this.sendSnapshot(webSocket, matchId);
      return;
    }

    if (payload?.type === "ping") {
      webSocket.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(webSocket: WebSocket): void {
    webSocket.close(1000, "closed");
  }

  private async getSnapshot(matchId: string): Promise<MatchSnapshot> {
    const runtime = await this.ensureRuntime(matchId);
    this.ensureSnapshotSuggestions(runtime);
    return runtime.snapshot;
  }

  private async syncSnapshotMeta(
    matchId: string,
    match: MatchSummary
  ): Promise<MatchSnapshot> {
    const runtime = await this.ensureRuntime(matchId);
    runtime.snapshot = {
      ...runtime.snapshot,
      slug: match.slug,
      title: match.title,
      status: match.status,
      chatState: match.chatState,
      chatEnabledUntil: match.chatEnabledUntil,
      boardRevision: match.boardRevision,
      subscriptionHealth: match.subscriptionHealth,
      targetWins: match.targetWins,
      players: match.players,
      updatedAt: match.updatedAt,
    };
    runtime.lastActivityAt = Date.now();
    this.ensureSnapshotSuggestions(runtime);
    await this.scheduleNextAlarm(runtime);
    await this.broadcastSnapshot(matchId);
    return runtime.snapshot;
  }

  private async applyControlAction(
    matchId: string,
    action: MatchControlAction
  ): Promise<MatchSnapshot> {
    const runtime = await this.ensureRuntime(matchId);
    const nextSnapshot = applyMatchControlAction(runtime.snapshot, action);

    if (nextSnapshot === runtime.snapshot) {
      return runtime.snapshot;
    }

    this.syncRuntimeFromSnapshot(
      runtime,
      {
        ...nextSnapshot,
        boardRevision: runtime.snapshot.boardRevision + 1,
        updatedAt: nowIso(),
      },
      {
        queueDirty: action.type !== "reject_suggestion",
        playersDirty: action.type === "record_round_winner",
      }
    );

    await this.finalizeCommands(matchId, runtime);
    return runtime.snapshot;
  }

  private async ensureRuntime(matchId: string): Promise<RuntimeState> {
    if (this.runtime && this.activeMatchId === matchId) {
      return this.runtime;
    }

    if (this.loadingState && this.activeMatchId === matchId) {
      return this.loadingState;
    }

    this.activeMatchId = matchId;
    this.loadingState = this.state.blockConcurrencyWhile(async () => {
      const loaded = await this.chatStore.loadCommandState(matchId);
      const suggestionsById = new Map<string, PersistedSuggestionState>(
        loaded.suggestions.map((suggestion) => [suggestion.id, suggestion])
      );
      const suggestionIdsByCanonical = new Map<string, string>(
        loaded.suggestions.map((suggestion) => [
          suggestion.canonicalKey,
          suggestion.id,
        ])
      );
      const suggestionIdsByBoardId = new Map<string, string>(
        loaded.suggestions.map((suggestion) => [
          suggestion.boardId,
          suggestion.id,
        ])
      );
      const nextBoardNumber =
        loaded.suggestions.reduce(
          (maxBoardNumber, suggestion) =>
            Math.max(maxBoardNumber, Number(suggestion.boardId)),
          0
        ) + 1;

      this.runtime = {
        snapshot: {
          ...loaded.snapshot,
          suggestions: loaded.suggestions.map(stripSuggestionMetadata),
        },
        suggestionsById,
        suggestionIdsByCanonical,
        suggestionIdsByBoardId,
        viewerVotes: loaded.viewerVotes,
        dirtySuggestionIds: new Set(),
        dirtyQueueIds: new Set(),
        dirtyVotes: new Map(),
        pendingProcessedMessages: new Map(),
        recentMessageIds: loaded.recentMessageIds,
        recentMessageExpirations: [...loaded.recentMessageIds.entries()].map(
          ([key, expiresAt]) => ({ key, expiresAt })
        ),
        recentMessageExpirationHead: 0,
        replyCooldowns: new Map(),
        replyCooldownExpirations: [],
        replyCooldownExpirationHead: 0,
        nextBoardNumber,
        dirty: false,
        queueDirty: false,
        removedQueueIds: new Set(),
        playersDirty: false,
        lastActivityAt: Date.now(),
        cachedTopBoardSummary: null,
        snapshotSuggestionsDirty: false,
      };

      await this.state.storage.put(MANAGED_MATCH_ID_KEY, matchId);
      await this.scheduleNextAlarm(this.runtime);

      return this.runtime;
    });

    try {
      return await this.loadingState;
    } finally {
      this.loadingState = null;
    }
  }

  private async processCommand(
    matchId: string,
    input: CommandInput
  ): Promise<ReplyPayload | null> {
    const runtime = await this.ensureRuntime(matchId);
    const reply = this.applyCommand(runtime, input, Date.now());
    await this.finalizeCommands(matchId, runtime);
    return reply;
  }

  private async processCommands(
    matchId: string,
    inputs: CommandInput[]
  ): Promise<Array<ReplyPayload | null>> {
    if (inputs.length === 0) {
      return [];
    }

    const runtime = await this.ensureRuntime(matchId);
    const replies = inputs.map((input) =>
      this.applyCommand(runtime, input, Date.now())
    );

    await this.finalizeCommands(matchId, runtime);
    return replies;
  }

  private applyCommand(
    runtime: RuntimeState,
    input: CommandInput,
    now: number
  ): ReplyPayload | null {
    runtime.recentMessageExpirationHead = cleanupExpiringEntries(
      runtime.recentMessageIds,
      runtime.recentMessageExpirations,
      runtime.recentMessageExpirationHead,
      now
    );
    runtime.replyCooldownExpirationHead = cleanupExpiringEntries(
      runtime.replyCooldowns,
      runtime.replyCooldownExpirations,
      runtime.replyCooldownExpirationHead,
      now
    );

    runtime.lastActivityAt = now;

    const recentExpiry = runtime.recentMessageIds.get(input.messageId);

    if (recentExpiry && recentExpiry > now) {
      return null;
    }

    rememberExpiringKey(
      runtime.recentMessageIds,
      runtime.recentMessageExpirations,
      input.messageId,
      now + MESSAGE_DEDUPE_TTL_MS
    );
    runtime.pendingProcessedMessages.set(
      input.messageId,
      input.sourceTwitchChannelId
    );

    switch (input.command.kind) {
      case "suggest":
        this.applySuggestion(runtime, input);
        return null;
      case "vote":
        return this.applyVote(runtime, input);
      case "board":
        return this.buildBoardReply(runtime, input);
      default:
        return null;
    }
  }

  private async finalizeCommands(
    matchId: string,
    runtime: RuntimeState
  ): Promise<void> {
    if (this.hasPendingFlushWork(runtime)) {
      await this.flush(matchId);
    }

    await this.scheduleNextAlarm(runtime);
  }

  private async getManagedMatchId(): Promise<string | null> {
    if (this.activeMatchId) {
      return this.activeMatchId;
    }

    const storedMatchId =
      await this.state.storage.get<string>(MANAGED_MATCH_ID_KEY);

    if (typeof storedMatchId !== "string" || storedMatchId.length === 0) {
      return null;
    }

    this.activeMatchId = storedMatchId;
    return storedMatchId;
  }

  private async scheduleNextAlarm(runtime: RuntimeState): Promise<void> {
    const idleEvictionAt = runtime.lastActivityAt + IDLE_EVICTION_MS;
    const autoCompleteAt = getMatchAutoCompleteAt(runtime.snapshot);
    const nextAlarmAt =
      autoCompleteAt === null
        ? idleEvictionAt
        : Math.min(idleEvictionAt, autoCompleteAt);

    await this.state.storage.setAlarm(nextAlarmAt);
  }

  private applySuggestion(runtime: RuntimeState, input: CommandInput): void {
    const argument = input.command.argument?.trim();

    if (!argument) {
      return;
    }

    const canonicalKey = createCanonicalGameKey(argument);
    const existingSuggestionId =
      runtime.suggestionIdsByCanonical.get(canonicalKey);
    const timestamp = nowIso();

    if (existingSuggestionId) {
      const suggestion = runtime.suggestionsById.get(existingSuggestionId);

      if (!suggestion) {
        return;
      }

      if (!suggestion.aliases.includes(argument)) {
        suggestion.aliases = [...suggestion.aliases, argument];
        suggestion.updatedAt = timestamp;
        runtime.dirtySuggestionIds.add(suggestion.id);
        runtime.dirty = true;
        runtime.snapshot.boardRevision += 1;
        runtime.snapshot.updatedAt = timestamp;
        runtime.cachedTopBoardSummary = null;
        runtime.snapshotSuggestionsDirty = true;
      }

      return;
    }

    const suggestion: PersistedSuggestionState = {
      id: `sgg_${crypto.randomUUID()}`,
      boardId: formatBoardId(runtime.nextBoardNumber),
      title: argument,
      canonicalKey,
      aliases: [argument],
      sourceChannelId: input.sourceChannelId,
      suggestedBy: input.viewerId,
      voteCount: 0,
      status: "board",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    runtime.nextBoardNumber += 1;
    runtime.suggestionsById.set(suggestion.id, suggestion);
    runtime.suggestionIdsByCanonical.set(canonicalKey, suggestion.id);
    runtime.suggestionIdsByBoardId.set(suggestion.boardId, suggestion.id);
    runtime.dirtySuggestionIds.add(suggestion.id);
    runtime.dirty = true;
    runtime.snapshot.boardRevision += 1;
    runtime.snapshot.updatedAt = timestamp;
    runtime.cachedTopBoardSummary = null;
    runtime.snapshotSuggestionsDirty = true;
  }

  private applyVote(
    runtime: RuntimeState,
    input: CommandInput
  ): ReplyPayload | null {
    const boardId = normalizeBoardVoteArgument(input.command.argument);

    if (!boardId) {
      return this.buildThrottledErrorReply(
        runtime,
        input,
        "invalid-vote",
        "Use !gg vote <board id>."
      );
    }

    const suggestionId = runtime.suggestionIdsByBoardId.get(boardId);

    if (!suggestionId) {
      return this.buildThrottledErrorReply(
        runtime,
        input,
        `missing-board-${boardId}`,
        `No board entry #${boardId}.`
      );
    }

    const nextSuggestion = runtime.suggestionsById.get(suggestionId);

    if (!nextSuggestion) {
      return null;
    }

    const previousSuggestionId = runtime.viewerVotes.get(input.viewerId);

    if (previousSuggestionId === suggestionId) {
      return null;
    }

    const timestamp = nowIso();

    if (previousSuggestionId) {
      const previousSuggestion =
        runtime.suggestionsById.get(previousSuggestionId);

      if (previousSuggestion && previousSuggestion.voteCount > 0) {
        previousSuggestion.voteCount -= 1;
        previousSuggestion.updatedAt = timestamp;
        runtime.dirtySuggestionIds.add(previousSuggestion.id);
      }
    }

    nextSuggestion.voteCount += 1;
    nextSuggestion.updatedAt = timestamp;
    runtime.viewerVotes.set(input.viewerId, nextSuggestion.id);
    runtime.dirtyVotes.set(input.viewerId, {
      suggestionId: nextSuggestion.id,
      sourceChannelId: input.sourceChannelId,
    });
    runtime.dirtySuggestionIds.add(nextSuggestion.id);
    runtime.dirty = true;
    runtime.snapshot.boardRevision += 1;
    runtime.snapshot.updatedAt = timestamp;
    runtime.cachedTopBoardSummary = null;
    runtime.snapshotSuggestionsDirty = true;

    return null;
  }

  private buildBoardReply(
    runtime: RuntimeState,
    input: CommandInput
  ): ReplyPayload | null {
    const cooldownKey = `board:${input.sourceTwitchChannelId}`;
    const now = Date.now();

    if ((runtime.replyCooldowns.get(cooldownKey) ?? 0) > now) {
      return null;
    }

    rememberExpiringKey(
      runtime.replyCooldowns,
      runtime.replyCooldownExpirations,
      cooldownKey,
      now + 15_000
    );

    return {
      broadcasterId: input.sourceTwitchChannelId,
      message: this.getTopBoardSummary(runtime),
      replyParentMessageId: input.replyParentId,
    };
  }

  private buildThrottledErrorReply(
    runtime: RuntimeState,
    input: CommandInput,
    errorKey: string,
    message: string
  ): ReplyPayload | null {
    const cooldownKey = `error:${errorKey}:${input.sourceTwitchChannelId}`;
    const now = Date.now();

    if ((runtime.replyCooldowns.get(cooldownKey) ?? 0) > now) {
      return null;
    }

    rememberExpiringKey(
      runtime.replyCooldowns,
      runtime.replyCooldownExpirations,
      cooldownKey,
      now + 15_000
    );

    return {
      broadcasterId: input.sourceTwitchChannelId,
      message,
      replyParentMessageId: input.replyParentId,
    };
  }

  private getTopBoardSummary(runtime: RuntimeState): string {
    if (runtime.cachedTopBoardSummary) {
      return runtime.cachedTopBoardSummary;
    }

    const ranked = [...runtime.suggestionsById.values()]
      .toSorted(compareBoardOrder)
      .slice(0, 5);

    if (ranked.length === 0) {
      runtime.cachedTopBoardSummary = "GG board: no picks yet.";
      return runtime.cachedTopBoardSummary;
    }

    runtime.cachedTopBoardSummary = `GG board: ${ranked
      .map(
        (suggestion) =>
          `#${suggestion.boardId} ${suggestion.title} (${suggestion.voteCount})`
      )
      .join(", ")}`;

    return runtime.cachedTopBoardSummary;
  }

  private ensureSnapshotSuggestions(runtime: RuntimeState): void {
    if (!runtime.snapshotSuggestionsDirty) {
      return;
    }

    runtime.snapshot.suggestions = [...runtime.suggestionsById.values()]
      .toSorted(compareBoardOrder)
      .map(stripSuggestionMetadata);
    runtime.snapshotSuggestionsDirty = false;
  }

  private hasPendingFlushWork(runtime: RuntimeState): boolean {
    return runtime.dirty || runtime.pendingProcessedMessages.size > 0;
  }

  private syncRuntimeFromSnapshot(
    runtime: RuntimeState,
    nextSnapshot: MatchSnapshot,
    options: {
      queueDirty: boolean;
      playersDirty: boolean;
    }
  ): void {
    const nextSuggestionsById = new Map<string, PersistedSuggestionState>();
    const nextSuggestionIdsByCanonical = new Map<string, string>();
    const nextSuggestionIdsByBoardId = new Map<string, string>();

    for (const suggestion of nextSnapshot.suggestions) {
      const existing = runtime.suggestionsById.get(suggestion.id);
      const changed = hasSuggestionChanged(existing, suggestion);
      const persistedSuggestion: PersistedSuggestionState = {
        ...suggestion,
        createdAt: existing?.createdAt ?? nextSnapshot.updatedAt,
        updatedAt: changed
          ? nextSnapshot.updatedAt
          : (existing?.updatedAt ?? nextSnapshot.updatedAt),
      };

      nextSuggestionsById.set(persistedSuggestion.id, persistedSuggestion);
      nextSuggestionIdsByCanonical.set(
        persistedSuggestion.canonicalKey,
        persistedSuggestion.id
      );
      nextSuggestionIdsByBoardId.set(
        persistedSuggestion.boardId,
        persistedSuggestion.id
      );

      if (changed) {
        runtime.dirtySuggestionIds.add(persistedSuggestion.id);
      }
    }

    if (options.queueDirty) {
      const currentQueueById = new Map(
        runtime.snapshot.queue.map((entry) => [entry.id, entry])
      );
      const nextQueueIds = new Set<string>();

      for (const entry of nextSnapshot.queue) {
        nextQueueIds.add(entry.id);
        const existing = currentQueueById.get(entry.id);

        if (!existing || hasQueueEntryChanged(existing, entry)) {
          runtime.dirtyQueueIds.add(entry.id);
        }

        runtime.removedQueueIds.delete(entry.id);
      }

      for (const entry of runtime.snapshot.queue) {
        if (!nextQueueIds.has(entry.id)) {
          runtime.dirtyQueueIds.delete(entry.id);
          runtime.removedQueueIds.add(entry.id);
        }
      }
    }

    runtime.snapshot = nextSnapshot;
    runtime.suggestionsById = nextSuggestionsById;
    runtime.suggestionIdsByCanonical = nextSuggestionIdsByCanonical;
    runtime.suggestionIdsByBoardId = nextSuggestionIdsByBoardId;
    runtime.nextBoardNumber =
      nextSnapshot.suggestions.reduce(
        (maxBoardNumber, suggestion) =>
          Math.max(maxBoardNumber, Number(suggestion.boardId)),
        0
      ) + 1;
    runtime.dirty = true;
    runtime.queueDirty = runtime.queueDirty || options.queueDirty;
    runtime.playersDirty = runtime.playersDirty || options.playersDirty;
    runtime.lastActivityAt = Date.now();
    runtime.cachedTopBoardSummary = null;
    runtime.snapshotSuggestionsDirty = false;
  }

  private async flush(matchId: string): Promise<void> {
    if (
      !this.runtime ||
      !this.activeMatchId ||
      this.activeMatchId !== matchId ||
      !this.hasPendingFlushWork(this.runtime)
    ) {
      return;
    }

    const runtime = this.runtime;
    const shouldBroadcastSnapshot = runtime.dirty;
    const dirtySuggestions = [...runtime.dirtySuggestionIds]
      .map((suggestionId) => runtime.suggestionsById.get(suggestionId))
      .filter((suggestion): suggestion is PersistedSuggestionState =>
        Boolean(suggestion)
      );
    const dirtyVotes = [...runtime.dirtyVotes.entries()].map(
      ([viewerId, value]) => ({
        viewerId,
        suggestionId: value.suggestionId,
        sourceChannelId: value.sourceChannelId,
      })
    );
    const processedMessages = [
      ...runtime.pendingProcessedMessages.entries(),
    ].map(([messageId, sourceTwitchChannelId]) => ({
      messageId,
      sourceTwitchChannelId,
    }));
    const dirtyQueueEntries = [...runtime.dirtyQueueIds]
      .map((queueId) =>
        runtime.snapshot.queue.find((entry) => entry.id === queueId)
      )
      .filter((entry): entry is MatchSnapshot["queue"][number] =>
        Boolean(entry)
      );

    await this.chatStore.flushCommandState({
      matchId,
      boardRevision: runtime.snapshot.boardRevision,
      updatedAt: runtime.snapshot.updatedAt,
      dirtySuggestions,
      dirtyVotes,
      processedMessages,
      players: runtime.playersDirty ? runtime.snapshot.players : undefined,
      dirtyQueueEntries:
        dirtyQueueEntries.length > 0 ? dirtyQueueEntries : undefined,
      removedQueueIds:
        runtime.removedQueueIds.size > 0
          ? [...runtime.removedQueueIds]
          : undefined,
    });

    runtime.dirtySuggestionIds.clear();
    runtime.dirtyQueueIds.clear();
    runtime.dirtyVotes.clear();
    runtime.pendingProcessedMessages.clear();
    runtime.dirty = false;
    runtime.queueDirty = false;
    runtime.removedQueueIds.clear();
    runtime.playersDirty = false;
    this.ensureSnapshotSuggestions(runtime);

    if (shouldBroadcastSnapshot) {
      await this.broadcastSnapshot(matchId);
    }
  }

  private async sendSnapshot(
    webSocket: WebSocket,
    matchId: string
  ): Promise<void> {
    const snapshot = await this.getSnapshot(matchId);
    const envelope = createWebsocketEnvelope(
      "match.snapshot",
      matchId,
      snapshot
    );
    webSocket.send(JSON.stringify(envelope));
  }

  private async broadcastSnapshot(matchId: string): Promise<void> {
    const runtime = this.runtime;

    if (!runtime || this.activeMatchId !== matchId) {
      return;
    }

    const sockets = this.state.getWebSockets();

    if (sockets.length === 0) {
      return;
    }

    const envelope = JSON.stringify(
      createWebsocketEnvelope("match.snapshot", matchId, runtime.snapshot)
    );

    for (const socket of sockets) {
      socket.send(envelope);
    }
  }
}

function stripSuggestionMetadata(
  suggestion: PersistedSuggestionState
): MatchSnapshot["suggestions"][number] {
  return {
    id: suggestion.id,
    boardId: suggestion.boardId,
    title: suggestion.title,
    canonicalKey: suggestion.canonicalKey,
    aliases: suggestion.aliases,
    sourceChannelId: suggestion.sourceChannelId,
    suggestedBy: suggestion.suggestedBy,
    voteCount: suggestion.voteCount,
    status: suggestion.status,
  };
}

function hasSuggestionChanged(
  existing: PersistedSuggestionState | undefined,
  nextSuggestion: MatchSnapshot["suggestions"][number]
): boolean {
  if (!existing) {
    return true;
  }

  return (
    existing.boardId !== nextSuggestion.boardId ||
    existing.title !== nextSuggestion.title ||
    existing.canonicalKey !== nextSuggestion.canonicalKey ||
    existing.sourceChannelId !== nextSuggestion.sourceChannelId ||
    existing.suggestedBy !== nextSuggestion.suggestedBy ||
    existing.voteCount !== nextSuggestion.voteCount ||
    existing.status !== nextSuggestion.status ||
    existing.aliases.length !== nextSuggestion.aliases.length ||
    existing.aliases.some(
      (alias, index) => alias !== nextSuggestion.aliases[index]
    )
  );
}

function hasQueueEntryChanged(
  existing: MatchSnapshot["queue"][number],
  nextEntry: MatchSnapshot["queue"][number]
): boolean {
  return (
    existing.order !== nextEntry.order ||
    existing.title !== nextEntry.title ||
    existing.sourceSuggestionId !== nextEntry.sourceSuggestionId ||
    existing.status !== nextEntry.status ||
    existing.winnerPlayerId !== nextEntry.winnerPlayerId
  );
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildMatchSocketTag(matchId: string): string {
  return `${MATCH_SOCKET_TAG_PREFIX}${matchId}`;
}

function readSocketMatchId(
  state: DurableObjectState,
  webSocket: WebSocket
): string | null {
  const attachment = webSocket.deserializeAttachment() as
    | { matchId?: unknown }
    | null;

  if (typeof attachment?.matchId === "string" && attachment.matchId.length > 0) {
    return attachment.matchId;
  }

  const taggedMatchId = state
    .getTags(webSocket)
    .find((tag) => tag.startsWith(MATCH_SOCKET_TAG_PREFIX));

  if (!taggedMatchId) {
    return null;
  }

  const matchId = taggedMatchId.slice(MATCH_SOCKET_TAG_PREFIX.length);
  return matchId.length > 0 ? matchId : null;
}
