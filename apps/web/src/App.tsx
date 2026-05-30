import { useEffect } from "react";
import type { ReactNode } from "react";
import { KitChip, KitPanel, PageShell, ScoreBug } from "@gaming-gauntlet/ui";
import type { GauntletMatchSurface } from "@gaming-gauntlet/ui";

import CreatePage from "./CreatePage";
import { matchRoute } from "./routes";
import type { MatchedRoute } from "./routes";

type AppProps = {
  initialPath?: string;
};

const siteOrigin = "https://gaming-gauntlet.com";
const defaultDescription =
  "Create a Gaming Gauntlet lobby, share one match URL, and keep stream controls behind a private passcode.";

const previewMatch: GauntletMatchSurface = {
  title: "Demo Lobby",
  status: "ready",
  targetWins: 3,
  players: [
    { displayName: "Player One", wins: 0 },
    { displayName: "Player Two", wins: 0 },
  ],
  currentGame: { title: "Waiting for first spin" },
};

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
      canonicalPath: `/manage/${encodeURIComponent(route.params.lobbyId ?? "")}`,
      description:
        "Private Gaming Gauntlet match controls for passcode-verified stream management.",
      robots: "noindex,nofollow",
      title: "Manage match | Gaming Gauntlet",
    };
  }

  if (route.id === "overlayTop") {
    return {
      canonicalPath: `/overlay/${encodeURIComponent(route.params.lobbyId ?? "")}/top`,
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
  const canonicalUrl = new URL(seo.canonicalPath, siteOrigin).toString();

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

function AppLink({
  children,
  href,
  variant = "default",
}: {
  children: ReactNode;
  href: string;
  variant?: "primary" | "ghost" | "default";
}) {
  const variantClass = variant === "default" ? "" : ` gg-button--${variant}`;

  return (
    <a className={`gg-button${variantClass}`} href={href}>
      {children}
    </a>
  );
}

function RouteChrome({
  children,
  routeId,
}: {
  children: ReactNode;
  routeId: string;
}) {
  return (
    <main className="v1-app" data-route-id={routeId} data-testid={routeId}>
      <nav className="v1-nav" aria-label="Primary">
        <a className="v1-nav__brand" href="/">
          Gaming Gauntlet
        </a>
      </nav>
      {children}
    </main>
  );
}

function ManagePage({ lobbyId }: { lobbyId: string }) {
  return (
    <RouteChrome routeId="manage-v1">
      <PageShell
        eyebrow="Streamer room"
        title="Manage match"
        deck={`Internal controls for ${lobbyId}. The passcode is never part of the URL.`}
        emphasis="section"
      >
        <div className="v1-grid">
          <KitPanel
            title="Match controls"
            summary="Write controls are deferred."
          >
            <ScoreBug match={previewMatch} />
          </KitPanel>
          <KitPanel
            title="Room status"
            summary="Management unlock arrives after verify API."
          >
            <div className="v1-status-row">
              <KitChip tone="soft">Clean URLs</KitChip>
              <KitChip tone="soft">No auth dependency</KitChip>
            </div>
          </KitPanel>
        </div>
      </PageShell>
    </RouteChrome>
  );
}

function PublicGamePage({ lobbyId }: { lobbyId: string }) {
  return (
    <RouteChrome routeId="game-v1">
      <PageShell
        eyebrow="Match room"
        title="Match room"
        deck={`Public view for ${lobbyId}. Use the manage action only if you have the passcode.`}
        actions={
          <AppLink href={`/manage/${lobbyId}`} variant="ghost">
            Manage this match
          </AppLink>
        }
        emphasis="section"
      >
        <ScoreBug match={previewMatch} />
      </PageShell>
    </RouteChrome>
  );
}

function OverlayTopPage({ lobbyId }: { lobbyId: string }) {
  return (
    <main
      className="v1-overlay"
      data-route-id="overlay-top-v1"
      data-testid="overlay-top-v1"
    >
      <PageShell
        eyebrow="Overlay"
        title={lobbyId}
        deck=""
        emphasis="compact"
        tone="overlay"
      >
        <ScoreBug match={previewMatch} transparent />
      </PageShell>
    </main>
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
        <AppLink href="/" variant="primary">
          Return home
        </AppLink>
      </PageShell>
    </RouteChrome>
  );
}

export default function App({ initialPath }: AppProps) {
  const route = matchRoute(getCurrentPath(initialPath));
  const isOverlay = route.id === "overlayTop";
  const lobbyId = route.params.lobbyId ?? "";

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
    return <ManagePage lobbyId={route.params.lobbyId ?? ""} />;
  }

  if (route.id === "game") {
    return <PublicGamePage lobbyId={route.params.lobbyId ?? ""} />;
  }

  if (route.id === "overlayTop") {
    return <OverlayTopPage lobbyId={route.params.lobbyId ?? ""} />;
  }

  return <NotFoundPage />;
}
