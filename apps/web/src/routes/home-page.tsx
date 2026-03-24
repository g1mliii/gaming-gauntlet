import { PageShell } from "@gaming-gauntlet/ui";
import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="hero-grid">
      <PageShell
        eyebrow="Streamer vs streamer"
        title="Run the gauntlet. Let chat build the match."
        deck="Gaming Gauntlet merges two Twitch chats into one live board, pushes the best game ideas to the top, and gives broadcasters a command center for queueing games, settling winners, and keeping both overlay surfaces synchronized."
        actions={<span className="gg-chip">OBS + Twitch Extension</span>}
      >
        <div className="stats-grid">
          <article className="stat-card">
            <strong>Dual chat ingestion</strong>
            <p>Both communities feed one shared ranked board with source-channel tracking.</p>
          </article>
          <article className="stat-card">
            <strong>Broadcast-safe overlays</strong>
            <p>One view model powers the web overlay and the Twitch video extension.</p>
          </article>
          <article className="stat-card">
            <strong>Manual control wins</strong>
            <p>Streamers and mods can always approve, reorder, randomize, and score the set.</p>
          </article>
        </div>
      </PageShell>

      <PageShell
        eyebrow="Bootstrap"
        title="Repo status"
        deck="This scaffold includes the monorepo layout, shared domain contracts, the Worker shell, D1 migration, route stubs, and testable sample data."
      >
        <div className="route-grid">
          <article className="route-card">
            <strong>Dashboard</strong>
            <p>Broadcaster-facing view for live matches, linked channels, and setup tasks.</p>
            <Link className="route-card__link" to="/dashboard">
              Open dashboard
            </Link>
          </article>
          <article className="route-card">
            <strong>Control room</strong>
            <p>Queue, score, and moderation controls for the current head-to-head match.</p>
            <Link className="route-card__link" to="/control/match_demo_01">
              Open control room
            </Link>
          </article>
          <article className="route-card">
            <strong>Overlay</strong>
            <p>Transparent scoreboard variant sized for OBS browser sources and Twitch surfaces.</p>
            <Link className="route-card__link" to="/overlay/match_demo_01">
              Open overlay
            </Link>
          </article>
        </div>
      </PageShell>
    </div>
  );
}
