import type { ExtensionBroadcasterConfig } from "@gaming-gauntlet/contracts";

type InstallTwitchHelperMockOptions = {
  broadcasterConfig?: ExtensionBroadcasterConfig | null;
  channelId?: string;
  role?: "broadcaster" | "moderator" | "viewer";
};

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createMockToken(
  role: InstallTwitchHelperMockOptions["role"] = "broadcaster",
  channelId = "1001"
): string {
  return [
    base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64UrlEncode(
      JSON.stringify({
        channel_id: channelId,
        exp: Math.floor(Date.now() / 1000) + 300,
        opaque_user_id: `U${channelId}`,
        role,
        user_id: channelId,
      })
    ),
    "signature",
  ].join(".");
}

export function installTwitchHelperMock(
  options: InstallTwitchHelperMockOptions = {}
) {
  const authCallbacks: Array<
    (auth: {
      channelId: string;
      clientId: string;
      helixToken: string;
      token: string;
      userId: string;
    }) => void
  > = [];
  const configCallbacks: Array<() => void> = [];
  const contextCallbacks: Array<(context: object, changed: string[]) => void> =
    [];
  const highlightCallbacks: Array<(isHighlighted: boolean) => void> = [];
  const positionCallbacks: Array<(position: { x: number; y: number }) => void> =
    [];
  const visibilityCallbacks: Array<(isVisible: boolean, context?: object) => void> =
    [];
  let broadcasterConfigRecord =
    options.broadcasterConfig === undefined
      ? {
          version: "1",
          content: JSON.stringify({
            version: 1,
            matchSlug: "gauntlet-finals",
          } satisfies ExtensionBroadcasterConfig),
        }
      : options.broadcasterConfig === null
        ? undefined
        : {
            version: "1",
            content: JSON.stringify(options.broadcasterConfig),
          };

  const configurationSetSpy = vi.fn(
    (_segment: "broadcaster", version: string, content: string) => {
      broadcasterConfigRecord = {
        version,
        content,
      };
      configCallbacks.forEach((callback) => callback());
    }
  );

  const helper = {
    configuration: {
      get broadcaster() {
        return broadcasterConfigRecord;
      },
      onChanged(callback: () => void) {
        configCallbacks.push(callback);
      },
      set: configurationSetSpy,
    },
    onAuthorized(
      callback: (auth: {
        channelId: string;
        clientId: string;
        helixToken: string;
        token: string;
        userId: string;
      }) => void
    ) {
      authCallbacks.push(callback);
    },
    onContext(callback: (context: object, changed: string[]) => void) {
      contextCallbacks.push(callback);
    },
    onHighlightChanged(callback: (isHighlighted: boolean) => void) {
      highlightCallbacks.push(callback);
    },
    onPositionChanged(callback: (position: { x: number; y: number }) => void) {
      positionCallbacks.push(callback);
    },
    onVisibilityChanged(
      callback: (isVisible: boolean, context?: object) => void
    ) {
      visibilityCallbacks.push(callback);
    },
    viewer: {
      id: options.channelId ?? "1001",
      opaqueId: `U${options.channelId ?? "1001"}`,
      role: options.role ?? "broadcaster",
      sessionToken: createMockToken(options.role, options.channelId),
    },
  };

  vi.stubGlobal("Twitch", { ext: helper });

  return {
    authorize() {
      const channelId = options.channelId ?? "1001";
      const token = createMockToken(options.role, channelId);

      authCallbacks.forEach((callback) =>
        callback({
          channelId,
          clientId: "client-id",
          helixToken: "helix-token",
          token,
          userId: `U${channelId}`,
        })
      );
    },
    emitContext(context: object, changed: string[] = []) {
      contextCallbacks.forEach((callback) => callback(context, changed));
    },
    emitHighlight(isHighlighted: boolean) {
      highlightCallbacks.forEach((callback) => callback(isHighlighted));
    },
    emitPosition(position: { x: number; y: number }) {
      positionCallbacks.forEach((callback) => callback(position));
    },
    emitVisibility(isVisible: boolean, context?: object) {
      visibilityCallbacks.forEach((callback) => callback(isVisible, context));
    },
    configurationSetSpy,
    setBroadcasterConfig(config: ExtensionBroadcasterConfig | null) {
      broadcasterConfigRecord = config
        ? {
            version: "1",
            content: JSON.stringify(config),
          }
        : undefined;
      configCallbacks.forEach((callback) => callback());
    },
  };
}
