export const FORBIDDEN_URL_PARAM_NAMES = [
  "managementCode",
  "code",
  "token",
  "secret"
] as const;

type RouteId = "landing" | "create" | "manage" | "game" | "overlayTop" | "notFound";

type RouteDefinition = {
  id: Exclude<RouteId, "notFound">;
  pattern: string;
  paramNames: readonly string[];
};

export type MatchedRoute = {
  id: RouteId;
  params: Record<string, string>;
};

export const V1_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  { id: "landing", pattern: "/", paramNames: [] },
  { id: "create", pattern: "/create", paramNames: [] },
  { id: "manage", pattern: "/manage/:lobbyId", paramNames: ["lobbyId"] },
  { id: "game", pattern: "/g/:lobbyId", paramNames: ["lobbyId"] },
  { id: "overlayTop", pattern: "/overlay/:lobbyId/top", paramNames: ["lobbyId"] }
];

function getPathname(path: string): string {
  return new URL(path, "https://gaming-gauntlet.local").pathname;
}

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
  const pathParts = splitPath(getPathname(path));

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
      return { id: route.id, params };
    }
  }

  return { id: "notFound", params: {} };
}
