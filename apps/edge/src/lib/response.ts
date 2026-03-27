import type { Env } from "../env";

type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
};

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

function setVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");

  if (!current) {
    headers.set("Vary", value);
    return;
  }

  if (
    !current
      .split(",")
      .map((entry) => entry.trim())
      .includes(value)
  ) {
    headers.set("Vary", `${current}, ${value}`);
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
      cookies[name] = decodeURIComponent(value.join("="));
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
  const allowedOrigins = options?.allowedOrigins ?? [env.APP_ORIGIN];

  if (!origin || !allowedOrigins.includes(origin)) {
    return response;
  }

  const headers = appendSecurityHeaders(new Headers(response.headers));
  headers.set("Access-Control-Allow-Origin", origin);

  if (options?.allowCredentials !== false) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  setVary(headers, "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflight(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");

  if (!origin || origin !== env.APP_ORIGIN) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: createHeaders({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      Vary: "Origin",
    }),
  });
}
