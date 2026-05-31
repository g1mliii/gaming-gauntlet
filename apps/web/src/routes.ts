export const FORBIDDEN_URL_PARAM_NAMES = [
  "authorization",
  "managementCode",
  "management_code",
  "code",
  "token",
  "secret",
] as const;

type RouteId =
  | "create"
  | "manage"
  | "game"
  | "overlayHub"
  | "overlay"
  | "notFound";

type RouteDefinition = {
  id: Exclude<RouteId, "notFound">;
  pattern: string;
  paramNames: readonly string[];
};

export type MatchedRoute = {
  id: RouteId;
  params: Record<string, string>;
  search: string;
};

export const V1_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  { id: "create", pattern: "/", paramNames: [] },
  { id: "create", pattern: "/create", paramNames: [] },
  { id: "manage", pattern: "/manage/:lobbyId", paramNames: ["lobbyId"] },
  { id: "game", pattern: "/g/:lobbyId", paramNames: ["lobbyId"] },
  { id: "overlayHub", pattern: "/g/:lobbyId/obs", paramNames: ["lobbyId"] },
  {
    id: "overlay",
    pattern: "/overlay/:lobbyId/:variant",
    paramNames: ["lobbyId", "variant"],
  },
];

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function matchRoute(path: string): MatchedRoute {
  // Parse the location once here; callers receive both the matched params and
  // the raw query string off the same parse.
  const url = new URL(path, "https://gaming-gauntlet.local");
  const pathParts = splitPath(url.pathname);

  for (const route of V1_ROUTE_DEFINITIONS) {
    const patternParts = splitPath(route.pattern);

    if (pathParts.length !== patternParts.length) {
      continue;
    }

    const params: Record<string, string> = {};
    const matches = patternParts.every((part, index) => {
      const pathPart = pathParts[index];

      if (part.startsWith(":")) {
        params[part.slice(1)] = decodePathPart(pathPart ?? "");
        return Boolean(pathPart);
      }

      return part === pathPart;
    });

    if (matches) {
      return { id: route.id, params, search: url.search };
    }
  }

  return { id: "notFound", params: {}, search: url.search };
}
