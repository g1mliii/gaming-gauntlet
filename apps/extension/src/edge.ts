export class ExtensionEdgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(code);
  }
}

const EDGE_BASE_URL =
  import.meta.env.VITE_EDGE_BASE_URL ?? "http://localhost:8787";

export function buildEdgeUrl(path: string): string {
  return new URL(path, EDGE_BASE_URL).toString();
}

export async function extensionFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(buildEdgeUrl(path), {
    credentials: "omit",
    ...init,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: string; details?: unknown })
        : { error: "request_failed" };
    throw new ExtensionEdgeError(
      response.status,
      errorPayload.error,
      errorPayload.details
    );
  }

  return payload as T;
}
