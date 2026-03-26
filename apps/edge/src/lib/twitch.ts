import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Env } from "../env";
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_EVENTSUB_SUBSCRIPTIONS_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";
const TWITCH_CHAT_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";
const TWITCH_JWKS = createRemoteJWKSet(new URL("https://id.twitch.tv/oauth2/keys"));
const EVENTSUB_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;

const DEFAULT_TWITCH_AUTH_SCOPES = ["openid", "channel:bot"] as const;

let cachedAppToken:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | null = null;

type TwitchTokenResponse = {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string[] | string;
  token_type: string;
};

export type TwitchIdentity = {
  id: string;
  login: string;
  display_name: string;
};

export type ValidatedAccessToken = {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
};

export class TwitchAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export function buildTwitchAuthorizeUrl(
  env: Env,
  state: string,
  nonce: string,
  scopes: readonly string[] = DEFAULT_TWITCH_AUTH_SCOPES
): string {
  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.TWITCH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

export async function exchangeAuthorizationCode(env: Env, code: string): Promise<TwitchTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.TWITCH_REDIRECT_URI
  });

  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Twitch token exchange failed: ${response.status}`);
  }

  return (await response.json()) as TwitchTokenResponse;
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<TwitchTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed: ${response.status}`);
  }

  return (await response.json()) as TwitchTokenResponse;
}

export async function validateAccessToken(accessToken: string): Promise<ValidatedAccessToken> {
  const response = await fetch(TWITCH_VALIDATE_URL, {
    headers: {
      Authorization: `OAuth ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Twitch token validation failed: ${response.status}`);
  }

  return (await response.json()) as ValidatedAccessToken;
}

export async function validateIdToken(
  env: Env,
  idToken: string,
  expectedNonce: string
): Promise<{ sub: string; nonce?: string }> {
  const result = await jwtVerify(idToken, TWITCH_JWKS, {
    issuer: "https://id.twitch.tv/oauth2",
    audience: env.TWITCH_CLIENT_ID
  });

  const nonce = typeof result.payload.nonce === "string" ? result.payload.nonce : undefined;

  if (nonce !== expectedNonce) {
    throw new TwitchAuthError(401, "invalid_nonce");
  }

  return {
    sub: String(result.payload.sub),
    nonce
  };
}

export async function fetchTwitchUser(env: Env, accessToken: string): Promise<TwitchIdentity> {
  const response = await fetch(`${env.TWITCH_API_BASE}/users`, {
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Twitch user fetch failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      login: string;
      display_name: string;
    }>;
  };

  const user = payload.data?.[0];

  if (!user) {
    throw new Error("Twitch user payload missing profile");
  }

  return user;
}

export function normalizeScopeValue(scope: string[] | string | undefined): string[] {
  if (Array.isArray(scope)) {
    return scope;
  }

  if (typeof scope === "string" && scope.length > 0) {
    return scope.split(" ");
  }

  return [];
}

export async function getAppAccessToken(env: Env): Promise<string> {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) {
    return cachedAppToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials"
  });

  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Twitch app token exchange failed: ${response.status}`);
  }

  const payload = (await response.json()) as TwitchTokenResponse;

  cachedAppToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000
  };

  return payload.access_token;
}

export async function createEventSubChatMessageSubscription(
  env: Env,
  appAccessToken: string,
  input: {
    broadcasterUserId: string;
    userId: string;
  }
): Promise<{ id: string; status: string }> {
  const callback = new URL("/api/twitch/eventsub", env.TWITCH_REDIRECT_URI).toString();
  const response = await fetch(TWITCH_EVENTSUB_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${appAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: {
        broadcaster_user_id: input.broadcasterUserId,
        user_id: input.userId
      },
      transport: {
        method: "webhook",
        callback,
        secret: env.TWITCH_EVENTSUB_SECRET
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Twitch EventSub subscription failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      status: string;
    }>;
  };
  const subscription = payload.data?.[0];

  if (!subscription) {
    throw new Error("Twitch EventSub subscription payload missing data");
  }

  return subscription;
}

export async function deleteEventSubSubscription(
  env: Env,
  appAccessToken: string,
  subscriptionId: string
): Promise<void> {
  const url = new URL(TWITCH_EVENTSUB_SUBSCRIPTIONS_URL);
  url.searchParams.set("id", subscriptionId);

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${appAccessToken}`
    }
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Twitch EventSub delete failed: ${response.status}`);
  }
}

export async function sendChatMessage(
  env: Env,
  appAccessToken: string,
  input: {
    broadcasterId: string;
    senderId: string;
    message: string;
    replyParentMessageId?: string | null;
    forSourceOnly?: boolean;
  }
): Promise<void> {
  const response = await fetch(TWITCH_CHAT_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${appAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      broadcaster_id: input.broadcasterId,
      sender_id: input.senderId,
      message: input.message,
      reply_parent_message_id: input.replyParentMessageId ?? undefined,
      for_source_only: input.forSourceOnly ?? true
    })
  });

  if (!response.ok) {
    throw new Error(`Twitch chat send failed: ${response.status}`);
  }
}

export async function verifyEventSubRequest(env: Env, headers: Headers, bodyText: string): Promise<void> {
  if (!env.TWITCH_EVENTSUB_SECRET) {
    throw new TwitchAuthError(503, "eventsub_secret_not_configured");
  }

  const messageId = headers.get("Twitch-Eventsub-Message-Id");
  const timestamp = headers.get("Twitch-Eventsub-Message-Timestamp");
  const signature = headers.get("Twitch-Eventsub-Message-Signature");

  if (!messageId || !timestamp || !signature) {
    throw new TwitchAuthError(401, "invalid_eventsub_signature");
  }

  const timestampMs = Date.parse(timestamp);

  if (Number.isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > EVENTSUB_MESSAGE_MAX_AGE_MS) {
    throw new TwitchAuthError(401, "stale_eventsub_message");
  }

  const expectedSignature = `sha256=${await hmacSha256Hex(`${messageId}${timestamp}${bodyText}`, env.TWITCH_EVENTSUB_SECRET)}`;

  if (!timingSafeEqual(expectedSignature, signature)) {
    throw new TwitchAuthError(401, "invalid_eventsub_signature");
  }
}
