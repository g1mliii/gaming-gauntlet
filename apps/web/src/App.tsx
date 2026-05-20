import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  KitCard,
  KitChip,
  KitNotice,
  KitPanel,
  PageShell,
  ScoreBug
} from "@gaming-gauntlet/ui";
import type { GauntletMatchSurface } from "@gaming-gauntlet/ui";

import { matchRoute } from "./routes";

type AppProps = {
  initialPath?: string;
};

const previewLobbyId = "demo-lobby";

const previewMatch: GauntletMatchSurface = {
  title: "Demo Lobby",
  status: "ready",
  targetWins: 3,
  players: [
    { displayName: "Player One", wins: 0 },
    { displayName: "Player Two", wins: 0 }
  ],
  currentGame: { title: "Waiting for first spin" }
};

function getCurrentPath(initialPath?: string): string {
  if (initialPath) {
    return initialPath;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function AppLink({
  children,
  href,
  variant = "default"
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
  routeId
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
        <div className="v1-nav__links">
          <a href="/create">Create</a>
          <a href={`/g/${previewLobbyId}`}>Public</a>
          <a href={`/overlay/${previewLobbyId}/top`}>Overlay</a>
        </div>
      </nav>
      {children}
    </main>
  );
}

function LandingPage() {
  return (
    <RouteChrome routeId="landing-v1">
      <PageShell
        eyebrow="V1 baseline"
        title="Gaming Gauntlet"
        deck="Spin-ready match rooms for two-player game challenges, with public and overlay surfaces separated from management controls."
        actions={
          <>
            <AppLink href="/create" variant="primary">
              Create lobby
            </AppLink>
            <AppLink href={`/overlay/${previewLobbyId}/top`} variant="ghost">
              View overlay
            </AppLink>
          </>
        }
      >
        <div className="v1-grid">
          <KitPanel
            eyebrow="Routes"
            title="App shell"
            summary="The V1 paths are present and public while lobby logic is still pending."
          >
            <div className="v1-route-list" aria-label="V1 routes">
              <AppLink href="/create">/create</AppLink>
              <AppLink href={`/manage/${previewLobbyId}`}>/manage/:lobbyId</AppLink>
              <AppLink href={`/g/${previewLobbyId}`}>/g/:lobbyId</AppLink>
              <AppLink href={`/overlay/${previewLobbyId}/top`}>
                /overlay/:lobbyId/top
              </AppLink>
            </div>
          </KitPanel>
          <KitPanel
            eyebrow="Preview"
            title="Public state"
            summary="Only public match information appears on the baseline surfaces."
          >
            <ScoreBug match={previewMatch} />
          </KitPanel>
        </div>
      </PageShell>
    </RouteChrome>
  );
}

function CreatePage() {
  return (
    <RouteChrome routeId="create-v1">
      <PageShell
        eyebrow="Lobby setup"
        title="Create lobby"
        deck="A minimal creation surface is ready for the lobby API phase."
        emphasis="section"
      >
        <KitPanel title="Lobby draft" summary="Player fields and game setup land next.">
          <div className="v1-placeholder-form" aria-label="Lobby draft">
            <KitCard title="Players" meta="Two-player match">
              <p>Player names will connect to the create API after the D1 schema exists.</p>
            </KitCard>
            <KitCard title="Games" meta="Spin pool">
              <p>The starting game list stays local until lobby creation is implemented.</p>
            </KitCard>
          </div>
          <KitNotice tone="warning">Creation is intentionally inactive in Phase 1.</KitNotice>
        </KitPanel>
      </PageShell>
    </RouteChrome>
  );
}

function ManagePage({ lobbyId }: { lobbyId: string }) {
  return (
    <RouteChrome routeId="manage-v1">
      <PageShell
        eyebrow="Streamer room"
        title="Manage lobby"
        deck={`Lobby ${lobbyId} has a management route using only the lobby id.`}
        emphasis="section"
      >
        <div className="v1-grid">
          <KitPanel title="Match controls" summary="Write controls are deferred.">
            <ScoreBug match={previewMatch} />
          </KitPanel>
          <KitPanel title="Room status" summary="Management unlock arrives after verify API.">
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
        eyebrow="Public lobby"
        title="Match room"
        deck={`Public view for ${lobbyId}.`}
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
        deck="This path is outside the V1 baseline."
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

  useEffect(() => {
    document.documentElement.classList.toggle("gg-doc--overlay", isOverlay);
    document.body.classList.toggle("gg-body--overlay", isOverlay);

    return () => {
      document.documentElement.classList.remove("gg-doc--overlay");
      document.body.classList.remove("gg-body--overlay");
    };
  }, [isOverlay]);

  if (route.id === "landing") {
    return <LandingPage />;
  }

  if (route.id === "create") {
    return <CreatePage />;
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
