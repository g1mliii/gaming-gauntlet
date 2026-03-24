export function json(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    {
      error: "method_not_allowed",
      allowed
    },
    {
      status: 405,
      headers: {
        Allow: allowed.join(", ")
      }
    }
  );
}
