import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

const HomePage = lazy(() =>
  import("./routes/home-page").then((module) => ({ default: module.HomePage }))
);
const DashboardPage = lazy(() =>
  import("./routes/dashboard-page").then((module) => ({
    default: module.DashboardPage,
  }))
);
const LinkInvitePage = lazy(() =>
  import("./routes/link-invite-page").then((module) => ({
    default: module.LinkInvitePage,
  }))
);
const MatchPage = lazy(() =>
  import("./routes/match-page").then((module) => ({
    default: module.MatchPage,
  }))
);
const ControlRoomPage = lazy(() =>
  import("./routes/control-room-page").then((module) => ({
    default: module.ControlRoomPage,
  }))
);
const OverlayPage = lazy(() =>
  import("./routes/overlay-page").then((module) => ({
    default: module.OverlayPage,
  }))
);

function AppLayout() {
  const location = useLocation();
  const isOverlayRoute = location.pathname.startsWith("/overlay/");

  return (
    <div className={`web-app ${isOverlayRoute ? "web-app--overlay" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {isOverlayRoute ? null : (
        <header className="site-header">
          <Link className="site-header__brand" to="/">
            Gaming Gauntlet
          </Link>
          <nav className="site-header__nav" aria-label="Primary">
            <Link to="/dashboard">Dashboard</Link>
          </nav>
        </header>
      )}
      <main
        className={`site-main ${isOverlayRoute ? "site-main--overlay" : ""}`}
        id="main-content"
      >
        <Suspense
          fallback={
            <div className="route-loading" role="status" aria-live="polite">
              Loading Route…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/link/:inviteCode" element={<LinkInvitePage />} />
            <Route path="/matches/:slug" element={<MatchPage />} />
            <Route path="/control/:matchId" element={<ControlRoomPage />} />
            <Route path="/overlay/:slug" element={<OverlayPage />} />
          </Routes>
        </Suspense>
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
