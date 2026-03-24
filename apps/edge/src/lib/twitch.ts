import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Env } from "../env";
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_JWKS = createRemoteJWKSet(new URL("https://id.twitch.tv/oauth2/keys"));
const EVENTSUB_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;

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

export function buildTwitchAuthorizeUrl(env: Env, state: string, nonce: string): string {
  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.TWITCH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid");
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
