import type { Env } from "../env";

import { corsPreflight, parseCookies, withCors } from "./response";

describe("parseCookies", () => {
  it("ignores malformed percent-encoded values instead of throwing", () => {
    expect(() =>
      parseCookies("broken=%E0%A4%A; gg_session=signed-value")
    ).not.toThrow();

    expect(parseCookies("broken=%E0%A4%A; gg_session=signed-value")).toEqual({
      broken: "%E0%A4%A",
      gg_session: "signed-value",
    });
  });
});

describe("withCors", () => {
  const productionEnv = {
    APP_ORIGIN: "https://app.example.com",
    EXTENSION_ORIGIN: "https://extension.example.com",
  } as Env;
  const localEnv = {
    APP_ORIGIN: "http://localhost:5173",
    EXTENSION_ORIGIN: "http://localhost:5174",
  } as Env;

  it("exposes ETag to the configured app origin", () => {
    const response = withCors(
      new Request("https://edge.example.com/api/public/matches/demo/surface", {
        headers: {
          Origin: "https://app.example.com",
        },
      }),
      productionEnv,
      new Response("ok", {
        headers: {
          ETag: 'W/"surface:1"',
        },
      })
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com"
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true"
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "ETag"
    );
  });

  it("rejects localhost origins when the deployed app origin is not local", () => {
    const response = withCors(
      new Request("https://edge.example.com/api/public/matches/demo/surface", {
        headers: {
          Origin: "http://localhost:5173",
        },
      }),
      productionEnv,
      new Response("ok")
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows localhost app requests during local web testing", () => {
    const response = withCors(
      new Request("http://localhost:8787/api/public/matches/demo/surface", {
        headers: {
          Origin: "http://localhost:5173",
        },
      }),
      localEnv,
      new Response("ok")
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });
});

describe("corsPreflight", () => {
  const productionEnv = {
    APP_ORIGIN: "https://app.example.com",
    EXTENSION_ORIGIN: "https://extension.example.com",
  } as Env;
  const localEnv = {
    APP_ORIGIN: "http://localhost:5173",
    EXTENSION_ORIGIN: "http://localhost:5174",
  } as Env;

  it("rejects localhost extension preflight requests in production", () => {
    const response = corsPreflight(
      new Request("https://edge.example.com/api/public/matches/demo/surface", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5174",
        },
      }),
      productionEnv
    );

    expect(response.status).toBe(403);
  });

  it("allows localhost extension preflight requests during local development", () => {
    const response = corsPreflight(
      new Request("http://localhost:8787/api/public/matches/demo/surface", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5174",
        },
      }),
      localEnv
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5174"
    );
  });
});
