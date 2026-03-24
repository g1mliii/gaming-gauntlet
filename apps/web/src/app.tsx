import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

import { ControlRoomPage } from "./routes/control-room-page";
import { DashboardPage } from "./routes/dashboard-page";
import { HomePage } from "./routes/home-page";
import { MatchPage } from "./routes/match-page";
import { OverlayPage } from "./routes/overlay-page";

function AppLayout() {
  return (
    <div className="web-app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link className="site-header__brand" to="/">
          Gaming Gauntlet
        </Link>
        <nav className="site-header__nav" aria-label="Primary">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/matches/speedrun-showdown">Live Match</Link>
          <Link to="/control/match_demo_01">Control Room</Link>
          <Link to="/overlay/match_demo_01">Overlay</Link>
        </nav>
      </header>
      <main className="site-main" id="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/matches/:slug" element={<MatchPage />} />
          <Route path="/control/:matchId" element={<ControlRoomPage />} />
          <Route path="/overlay/:matchId" element={<OverlayPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
