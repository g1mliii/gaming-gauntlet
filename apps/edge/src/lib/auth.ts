import type { AuthIntent } from "@gaming-gauntlet/contracts";

import type { Env } from "../env";
import { createSignedValue, randomToken, readSignedValue } from "./crypto";
import { parseCookies, serializeCookie } from "./response";

type AuthState = {
  intent: AuthIntent;
  inviteCode?: string;
  nonce: string;
  expiresAt: string;
};

export const SESSION_COOKIE_NAME = "gg_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_STATE_TTL_MS = 1000 * 60 * 10;

export async function createAuthState(
  env: Env,
  input: Pick<AuthState, "intent" | "inviteCode" | "nonce">
): Promise<string> {
  return createSignedValue(
    JSON.stringify({
      ...input,
      expiresAt: new Date(Date.now() + AUTH_STATE_TTL_MS).toISOString()
    } satisfies AuthState),
    env.SESSION_SECRET
  );
}

export async function readAuthState(env: Env, value: string | null): Promise<AuthState | null> {
  if (!value) {
    return null;
  }

  const payload = await readSignedValue(value, env.SESSION_SECRET);

  if (!payload) {
    return null;
  }

  const parsed = JSON.parse(payload) as AuthState;

  if (Date.parse(parsed.expiresAt) <= Date.now()) {
    return null;
  }

  return parsed;
}

export function createNonce(): string {
  return randomToken(24);
}

export async function createSessionCookieValue(sessionId: string, env: Env): Promise<string> {
  return createSignedValue(sessionId, env.SESSION_SECRET);
}

export async function readSessionIdFromRequest(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const value = cookies[SESSION_COOKIE_NAME];

  if (!value) {
    return null;
  }

  return readSignedValue(value, env.SESSION_SECRET);
}

export function buildSessionCookie(sessionValue: string, request: Request): string {
  return serializeCookie(SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: "Lax",
    secure: new URL(request.url).protocol === "https:"
  });
}

export function buildExpiredSessionCookie(request: Request): string {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: "Lax",
    secure: new URL(request.url).protocol === "https:"
  });
}
