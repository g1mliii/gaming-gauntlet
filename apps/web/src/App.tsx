import { useEffect } from "react";
import type { ReactNode } from "react";
import { KitButtonLink, PageShell } from "@gaming-gauntlet/ui";

import CreatePage from "./CreatePage";
import MatchRoom from "./match/MatchRoom";
import OverlayPage from "./overlay/OverlayPage";
import OverlaysSurface from "./overlay/OverlaysSurface";
import { PUBLIC_SITE_ORIGIN } from "./public-urls";
import { FORBIDDEN_URL_PARAM_NAMES, matchRoute } from "./routes";
import type { MatchedRoute } from "./routes";

type AppProps = {
  initialPath?: string;
};

const defaultDescription =
  "Create a Gaming Gauntlet lobby, share one match URL, and keep stream controls behind a private passcode.";

function getCurrentPath(initialPath?: string): string {
  if (initialPath) {
    return initialPath;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

type SeoConfig = {
  canonicalPath: string;
  description: string;
  robots: "index,follow" | "noindex,nofollow";
  title: string;
};

function getRouteSeo(route: MatchedRoute): SeoConfig {
  if (route.id === "create") {
    return {
      canonicalPath: "/",
      description: defaultDescription,
      robots: "index,follow",
      title: "Create lobby | Gaming Gauntlet",
    };
  }

  if (route.id === "game") {
    return {
      canonicalPath: `/g/${encodeURIComponent(route.params.lobbyId ?? "")}`,
      description:
        "Public Gaming Gauntlet match room with scoreboard state for a shared two-player challenge.",
      robots: "noindex,nofollow",
      title: "Match room | Gaming Gauntlet",
    };
  }

  if (route.id === "manage") {
    return {
      canonicalPath: `/g/${encodeURIComponent(route.params.lobbyId ?? "")}`,
      description:
        "Gaming Gauntlet match controls for passcode-verified stream management.",
      robots: "noindex,nofollow",
      title: "Match room | Gaming Gauntlet",
    };
  }

  if (route.id === "overlayHub") {
    return {
      canonicalPath: `/g/${encodeURIComponent(route.params.lobbyId ?? "")}/obs`,
      description: "Gaming Gauntlet OBS overlay setup surface.",
      robots: "noindex,nofollow",
      title: "Add to OBS | Gaming Gauntlet",
    };
  }

  if (route.id === "overlay") {
    const variant = route.params.variant ?? "";

    return {
      canonicalPath: `/overlay/${encodeURIComponent(route.params.lobbyId ?? "")}/${encodeURIComponent(variant)}`,
      description: "Gaming Gauntlet OBS overlay surface for a live match.",
      robots: "noindex,nofollow",
      title: "Overlay | Gaming Gauntlet",
    };
  }

  if (route.id === "notFound") {
    return {
      canonicalPath: "/",
      description: defaultDescription,
      robots: "noindex,nofollow",
      title: "Not found | Gaming Gauntlet",
    };
  }

  return {
    canonicalPath: "/",
    description: defaultDescription,
    robots: "index,follow",
    title: "Create lobby | Gaming Gauntlet",
  };
}

function setNamedMeta(
  attributeName: "name" | "property",
  key: string,
  content: string
) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attributeName}="${key}"]`
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attributeName, key);
    document.head.append(element);
  }

  element.content = content;
}

function setCanonicalLink(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );

  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }

  element.href = href;
}

function applySeo(route: MatchedRoute) {
  const seo = getRouteSeo(route);
  const canonicalUrl = new URL(
    seo.canonicalPath,
    PUBLIC_SITE_ORIGIN
  ).toString();

  document.title = seo.title;
  setCanonicalLink(canonicalUrl);
  setNamedMeta("name", "description", seo.description);
  setNamedMeta("name", "robots", seo.robots);
  setNamedMeta("property", "og:title", seo.title);
  setNamedMeta("property", "og:description", seo.description);
  setNamedMeta("property", "og:url", canonicalUrl);
  setNamedMeta("name", "twitter:title", seo.title);
  setNamedMeta("name", "twitter:description", seo.description);
}

function RouteChrome({
  children,
  routeId,
  showBrand = true,
}: {
  children: ReactNode;
  routeId: string;
  showBrand?: boolean;
}) {
  return (
    <main className="v1-app" data-route-id={routeId} data-testid={routeId}>
      {showBrand ? (
        <nav className="v1-nav" aria-label="Primary">
          <a className="v1-nav__brand" href="/">
            Gaming Gauntlet
          </a>
        </nav>
      ) : null}
      {children}
    </main>
  );
}

function OverlayHubPage({ lobbyId }: { lobbyId: string }) {
  return (
    <RouteChrome routeId="overlay-hub-v1">
      <OverlaysSurface lobbyId={lobbyId} />
    </RouteChrome>
  );
}

function NotFoundPage() {
  return (
    <RouteChrome routeId="not-found-v1">
      <PageShell
        eyebrow="Route"
        title="Not found"
        deck="This path is outside Gaming Gauntlet."
        emphasis="section"
      >
        <KitButtonLink href="/" variant="primary">
          Return home
        </KitButtonLink>
      </PageShell>
    </RouteChrome>
  );
}

export default function App({ initialPath }: AppProps) {
  const currentPath = getCurrentPath(initialPath);
  const route = matchRoute(currentPath);
  const isOverlay = route.id === "overlay";
  const lobbyId = route.params.lobbyId ?? "";

  useEffect(() => {
    if (initialPath) {
      return;
    }

    const forbiddenNames = new Set(
      FORBIDDEN_URL_PARAM_NAMES.map((name) => name.toLowerCase())
    );
    const url = new URL(window.location.href);
    let changed = false;

    for (const paramName of Array.from(url.searchParams.keys())) {
      if (forbiddenNames.has(paramName.toLowerCase())) {
        url.searchParams.delete(paramName);
        changed = true;
      }
    }

    if (changed) {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }
  }, [initialPath]);

  useEffect(() => {
    applySeo(route);
  }, [route.id, lobbyId]);

  useEffect(() => {
    document.documentElement.classList.toggle("gg-doc--overlay", isOverlay);
    document.body.classList.toggle("gg-body--overlay", isOverlay);

    return () => {
      document.documentElement.classList.remove("gg-doc--overlay");
      document.body.classList.remove("gg-body--overlay");
    };
  }, [isOverlay]);

  if (route.id === "create") {
    return (
      <RouteChrome routeId="create-v1">
        <CreatePage />
      </RouteChrome>
    );
  }

  if (route.id === "manage") {
    return (
      <RouteChrome routeId="manage-v1" showBrand={false}>
        <MatchRoom lobbyId={route.params.lobbyId ?? ""} />
      </RouteChrome>
    );
  }

  if (route.id === "game") {
    return (
      <RouteChrome routeId="game-v1" showBrand={false}>
        <MatchRoom lobbyId={route.params.lobbyId ?? ""} />
      </RouteChrome>
    );
  }

  if (route.id === "overlayHub") {
    return <OverlayHubPage lobbyId={route.params.lobbyId ?? ""} />;
  }

  if (route.id === "overlay") {
    return (
      <OverlayPage
        lobbyId={route.params.lobbyId ?? ""}
        search={route.search}
        variant={route.params.variant ?? ""}
      />
    );
  }

  return <NotFoundPage />;
}
