import type { Env } from "../env";

type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
};

export const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function getTrustedLocalDevOrigins(env: Env): string[] {
  return isLoopbackOrigin(env.APP_ORIGIN) ||
    isLoopbackOrigin(env.EXTENSION_ORIGIN)
    ? LOCAL_DEV_ORIGINS
    : [];
}

export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: Iterable<string>
): boolean {
  if (!origin) {
    return false;
  }

  return new Set(allowedOrigins).has(origin);
}

function appendSecurityHeaders(headers: Headers): Headers {
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return headers;
}

function createHeaders(init?: HeadersInit): Headers {
  return appendSecurityHeaders(new Headers(init));
}

function appendHeaderToken(
  headers: Headers,
  name: string,
  value: string
): void {
  const current = headers.get(name);

  if (!current) {
    headers.set(name, value);
    return;
  }

  if (
    !current
      .split(",")
      .map((entry) => entry.trim())
      .includes(value)
  ) {
    headers.set(name, `${current}, ${value}`);
  }
}

export function json(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: createHeaders({
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    }),
  });
}

export function plainText(payload: string, init?: ResponseInit): Response {
  return new Response(payload, {
    ...init,
    headers: createHeaders({
      "content-type": "text/plain; charset=utf-8",
      ...init?.headers,
    }),
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    {
      error: "method_not_allowed",
      allowed,
    },
    {
      status: 405,
      headers: {
        Allow: allowed.join(", "),
      },
    }
  );
}

export function redirect(location: string, init?: ResponseInit): Response {
  return new Response(null, {
    status: 302,
    ...init,
    headers: createHeaders({
      Location: location,
      ...init?.headers,
    }),
  });
}

export function noContent(init?: ResponseInit): Response {
  return new Response(null, {
    status: 204,
    ...init,
    headers: createHeaders(init?.headers),
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, entry) => {
      const [name, ...value] = entry.split("=");

      if (!name) {
        return cookies;
      }

      const rawValue = value.join("=");

      try {
        cookies[name] = decodeURIComponent(rawValue);
      } catch {
        cookies[name] = rawValue;
      }

      return cookies;
    }, {});
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function withSetCookie(response: Response, cookie: string): Response {
  const headers = appendSecurityHeaders(new Headers(response.headers));
  headers.append("Set-Cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withCors(
  request: Request,
  env: Env,
  response: Response,
  options?: {
    allowCredentials?: boolean;
    allowedOrigins?: string[];
  }
): Response {
  const origin = request.headers.get("Origin");
  const allowedOrigins = [
    ...(options?.allowedOrigins ?? [env.APP_ORIGIN]),
    ...getTrustedLocalDevOrigins(env),
  ];

  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return response;
  }

  if (!origin) {
    return response;
  }

  const resolvedOrigin = origin;

  const headers = appendSecurityHeaders(new Headers(response.headers));
  headers.set("Access-Control-Allow-Origin", resolvedOrigin);

  if (options?.allowCredentials !== false) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  appendHeaderToken(headers, "Access-Control-Expose-Headers", "ETag");
  appendHeaderToken(headers, "Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflight(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  const allowedOrigins = [
    env.APP_ORIGIN,
    env.EXTENSION_ORIGIN,
    ...getTrustedLocalDevOrigins(env),
  ];

  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return new Response(null, { status: 403 });
  }

  if (!origin) {
    return new Response(null, { status: 403 });
  }

  const resolvedOrigin = origin;

  return new Response(null, {
    status: 204,
    headers: createHeaders({
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      Vary: "Origin",
    }),
  });
}
