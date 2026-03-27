export class EdgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(code);
  }
}

const EDGE_BASE_URL = import.meta.env.VITE_EDGE_BASE_URL ?? "http://localhost:8787";

export function buildEdgeUrl(path: string, params?: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, EDGE_BASE_URL);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function buildEdgeWebSocketUrl(path: string): string {
  const url = new URL(path, EDGE_BASE_URL);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function edgeFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildEdgeUrl(path);
  const headers = new Headers(init?.headers);

  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: string; details?: unknown })
        : { error: "request_failed" };
    throw new EdgeError(response.status, errorPayload.error, errorPayload.details);
  }

  return payload as T;
}

export async function edgeSendJson<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return edgeFetchJson<T>(path, {
    method: init?.method ?? "POST",
    ...init,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function edgeNoContent(path: string, init?: RequestInit): Promise<void> {
  const url = buildEdgeUrl(path);

  const response = await fetch(url, {
    credentials: "include",
    ...init
  });

  if (!response.ok) {
    let code = "request_failed";
    let details: unknown;

    try {
      const payload = (await response.json()) as { error?: string; details?: unknown };
      code = payload.error ?? code;
      details = payload.details;
    } catch {
      // ignore non-json errors
    }

    throw new EdgeError(response.status, code, details);
  }
}
