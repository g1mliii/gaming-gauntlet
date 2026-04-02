import {
  extensionBroadcasterConfigSchema,
  type ExtensionBroadcasterConfig,
  twitchExtensionAnchorSchema,
  twitchExtensionModeSchema,
  twitchExtensionRoleSchema,
  type TwitchExtensionAnchor,
  type TwitchExtensionAuthContext,
  type TwitchExtensionMode,
} from "@gaming-gauntlet/contracts";
import { useEffect, useMemo, useState } from "react";

const HELPER_ATTACH_INITIAL_RETRY_MS = 500;
const HELPER_ATTACH_MAX_RETRY_MS = 15_000;

type TwitchHelperAuth = {
  channelId: string;
  clientId: string;
  helixToken?: string;
  token: string;
  userId?: string;
};

type TwitchHelperContext = {
  arePlayerControlsVisible?: boolean;
  isFullScreen?: boolean;
  isMuted?: boolean;
  isPaused?: boolean;
  isTheatreMode?: boolean;
  mode?: TwitchExtensionMode;
  theme?: "light" | "dark";
  volume?: number;
};

type TwitchHelperPosition = {
  x: number;
  y: number;
};

type TwitchExtensionQuery = {
  anchor: TwitchExtensionAnchor | null;
  mode: TwitchExtensionMode | null;
  platform: string | null;
  popout: boolean;
  releaseState: string | null;
  slugFallback: string | null;
};

type TwitchHelperConfigurationRecord = {
  content: string;
  version: string;
};

type TwitchHelperConfiguration = {
  broadcaster?: TwitchHelperConfigurationRecord;
  developer?: TwitchHelperConfigurationRecord;
  global?: TwitchHelperConfigurationRecord;
  onChanged: (callback: () => void) => void;
  set: (segment: "broadcaster", version: string, content: string) => void;
};

type TwitchExtensionHelper = {
  configuration: TwitchHelperConfiguration;
  onAuthorized: (callback: (auth: TwitchHelperAuth) => void) => void;
  onContext: (
    callback: (context: TwitchHelperContext, changed: string[]) => void
  ) => void;
  onError?: (callback: (error: unknown) => void) => void;
  onHighlightChanged: (callback: (isHighlighted: boolean) => void) => void;
  onPositionChanged: (
    callback: (position: TwitchHelperPosition) => void
  ) => void;
  onVisibilityChanged: (
    callback: (isVisible: boolean, context?: TwitchHelperContext) => void
  ) => void;
  viewer?: {
    helixToken?: string;
    id?: string | null;
    opaqueId?: string | null;
    role?: string;
    sessionToken?: string;
  };
};

declare global {
  interface Window {
    __GG_TWITCH_RUNTIME__?: TwitchRuntimeStore;
    Twitch?: {
      ext: TwitchExtensionHelper;
    };
  }
}

type UseTwitchExtensionStateResult = {
  auth: TwitchExtensionAuthContext | null;
  broadcasterConfig: ExtensionBroadcasterConfig | null;
  context: TwitchHelperContext | null;
  isHighlighted: boolean;
  isVisible: boolean;
  pageError: string | null;
  position: TwitchHelperPosition | null;
  query: TwitchExtensionQuery;
  saveBroadcasterConfig: (config: ExtensionBroadcasterConfig) => void;
  usingTwitchHelper: boolean;
};

type TwitchRuntimeSnapshot = Omit<
  UseTwitchExtensionStateResult,
  "query" | "saveBroadcasterConfig"
> & {
  query: TwitchExtensionQuery;
};

type TwitchRuntimeStore = {
  attach: () => void;
  getSnapshot: () => TwitchRuntimeSnapshot;
  saveBroadcasterConfig: (config: ExtensionBroadcasterConfig) => void;
  subscribe: (callback: () => void) => () => void;
};

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");

  if (parts.length < 2) {
    return null;
  }

  const encodedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    encodedPayload.length % 4 === 0
      ? ""
      : "=".repeat(4 - (encodedPayload.length % 4));

  try {
    return JSON.parse(atob(`${encodedPayload}${padding}`)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function parseBroadcasterConfig(
  record: TwitchHelperConfigurationRecord | undefined
): ExtensionBroadcasterConfig | null {
  if (!record?.content) {
    return null;
  }

  try {
    return extensionBroadcasterConfigSchema.parse(JSON.parse(record.content));
  } catch {
    return null;
  }
}

export function readExtensionQuery(
  search = window.location.search
): TwitchExtensionQuery {
  const params = new URLSearchParams(search);
  const anchor = twitchExtensionAnchorSchema.safeParse(params.get("anchor"));
  const mode = twitchExtensionModeSchema.safeParse(params.get("mode"));

  return {
    anchor: anchor.success ? anchor.data : null,
    mode: mode.success ? mode.data : null,
    platform: params.get("platform"),
    popout: params.get("popout") === "true",
    releaseState: params.get("state"),
    slugFallback:
      params.get("slug")?.trim() ?? params.get("matchId")?.trim() ?? null,
  };
}

function normalizeAuth(auth: TwitchHelperAuth): TwitchExtensionAuthContext {
  const payload = parseJwtPayload(auth.token);
  const role = twitchExtensionRoleSchema.safeParse(payload?.role);
  const payloadUserId =
    typeof payload?.user_id === "string" ? payload.user_id : null;
  const payloadOpaqueUserId =
    typeof payload?.opaque_user_id === "string"
      ? payload.opaque_user_id
      : null;

  return {
    channelId: auth.channelId,
    clientId: auth.clientId,
    token: auth.token,
    helixToken: auth.helixToken ?? null,
    opaqueUserId: auth.userId ?? payloadOpaqueUserId,
    role: role.success ? role.data : "viewer",
    userId: payloadUserId,
  };
}

function getExtensionHelper(): TwitchExtensionHelper | null {
  return window.Twitch?.ext ?? null;
}

function createInitialSnapshot(): TwitchRuntimeSnapshot {
  return {
    auth: null,
    broadcasterConfig: parseBroadcasterConfig(
      getExtensionHelper()?.configuration.broadcaster
    ),
    context: null,
    isHighlighted: false,
    isVisible: true,
    pageError: null,
    position: null,
    query: readExtensionQuery(),
    usingTwitchHelper: Boolean(getExtensionHelper()),
  };
}

function createTwitchRuntimeStore(): TwitchRuntimeStore {
  let attachRequested = false;
  let helperAttached = false;
  let helperAttachAttempt = 0;
  let helperAttachTimer: number | null = null;
  let snapshot = createInitialSnapshot();
  const subscribers = new Set<() => void>();

  const clearHelperAttachTimer = () => {
    if (helperAttachTimer !== null) {
      window.clearInterval(helperAttachTimer);
      helperAttachTimer = null;
    }
  };

  const emit = () => {
    for (const subscriber of subscribers) {
      subscriber();
    }
  };

  const patchSnapshot = (nextValues: Partial<TwitchRuntimeSnapshot>) => {
    let changed = false;

    for (const [key, value] of Object.entries(nextValues) as Array<
      [keyof TwitchRuntimeSnapshot, TwitchRuntimeSnapshot[keyof TwitchRuntimeSnapshot]]
    >) {
      if (!Object.is(snapshot[key], value)) {
        changed = true;
        break;
      }
    }

    if (!changed) {
      return;
    }

    snapshot = {
      ...snapshot,
      ...nextValues,
    };
    emit();
  };

  const updateBroadcasterConfig = () => {
    patchSnapshot({
      broadcasterConfig: parseBroadcasterConfig(
        getExtensionHelper()?.configuration.broadcaster
      ),
      usingTwitchHelper: Boolean(getExtensionHelper()),
    });
  };

  const bindHelper = (helper: TwitchExtensionHelper) => {
    helperAttached = true;
    clearHelperAttachTimer();
    helperAttachAttempt = 0;

    patchSnapshot({
      pageError: null,
      usingTwitchHelper: true,
    });

    helper.onAuthorized((nextAuth) => {
      patchSnapshot({
        auth: normalizeAuth(nextAuth),
        pageError: null,
      });
      updateBroadcasterConfig();
    });
    helper.onContext((nextContext) => {
      patchSnapshot({
        context: nextContext,
      });
    });
    helper.onVisibilityChanged((nextIsVisible, nextContext) => {
      patchSnapshot({
        context: nextContext ?? snapshot.context,
        isVisible: nextIsVisible,
      });
    });
    helper.onHighlightChanged((nextIsHighlighted) => {
      patchSnapshot({
        isHighlighted: nextIsHighlighted,
      });
    });
    helper.onPositionChanged((nextPosition) => {
      patchSnapshot({
        position: nextPosition,
      });
    });
    helper.onError?.((error) => {
      patchSnapshot({
        pageError: error instanceof Error ? error.message : String(error),
      });
    });
    helper.configuration.onChanged(() => {
      updateBroadcasterConfig();
    });

    updateBroadcasterConfig();
  };

  const scheduleHelperAttachRetry = () => {
    if (helperAttachTimer !== null || helperAttached) {
      return;
    }

    const delay = Math.min(
      HELPER_ATTACH_INITIAL_RETRY_MS * 2 ** helperAttachAttempt,
      HELPER_ATTACH_MAX_RETRY_MS
    );

    helperAttachAttempt += 1;
    helperAttachTimer = window.setTimeout(() => {
      helperAttachTimer = null;

      if (helperAttached) {
        return;
      }

      const helper = getExtensionHelper();

      if (!helper) {
        scheduleHelperAttachRetry();
        return;
      }

      bindHelper(helper);
    }, delay);
  };

  return {
    attach() {
      if (attachRequested) {
        return;
      }

      attachRequested = true;

      const helper = getExtensionHelper();

      if (!helper) {
        patchSnapshot({
          usingTwitchHelper: false,
        });
        scheduleHelperAttachRetry();

        return;
      }

      bindHelper(helper);
    },
    getSnapshot() {
      return snapshot;
    },
    saveBroadcasterConfig(config) {
      const helper = getExtensionHelper();

      if (!helper) {
        throw new Error("twitch_helper_unavailable");
      }

      helper.configuration.set("broadcaster", "1", JSON.stringify(config));
      patchSnapshot({
        broadcasterConfig: config,
      });
    },
    subscribe(callback) {
      subscribers.add(callback);

      return () => {
        subscribers.delete(callback);
      };
    },
  };
}

function getTwitchRuntimeStore(): TwitchRuntimeStore {
  window.__GG_TWITCH_RUNTIME__ ??= createTwitchRuntimeStore();
  return window.__GG_TWITCH_RUNTIME__;
}

export function useTwitchExtensionState(): UseTwitchExtensionStateResult {
  const store = useMemo(() => getTwitchRuntimeStore(), []);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<TwitchRuntimeSnapshot>(
    () => store.getSnapshot()
  );

  useEffect(() => {
    store.attach();
    setRuntimeSnapshot(store.getSnapshot());

    return store.subscribe(() => {
      setRuntimeSnapshot(store.getSnapshot());
    });
  }, [store]);

  return {
    ...runtimeSnapshot,
    saveBroadcasterConfig: store.saveBroadcasterConfig,
  };
}
