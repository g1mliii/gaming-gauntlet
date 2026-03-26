import type {
  AuditLogEntry,
  AuditLogResponse,
  AuthSession,
  ChannelLinkInvite,
  ChannelLinkSummary,
  MatchSnapshot,
  MatchSummary,
} from "@gaming-gauntlet/contracts";
import {
  PageShell,
  QueueList,
  ScoreBug,
  SuggestionBoard,
} from "@gaming-gauntlet/ui";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";

import {
  buildEdgeUrl,
  EdgeError,
  edgeFetchJson,
  edgeNoContent,
  edgeSendJson,
} from "../lib/edge";
import { slugifyMatchTitle } from "../lib/slug";

type DashboardPayload = {
  items: ChannelLinkSummary[];
};

type MatchPayload = {
  items: MatchSummary[];
};

const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]+$/;
const MATCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SNAPSHOT_POLL_INTERVAL_MS = 60_000;
const EMPTY_SESSION: AuthSession = {
  authenticated: false,
  user: null,
  ownedChannel: null,
};

function validateTwitchLogin(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (trimmed.length < 3) {
    return "Enter a Twitch login with at least 3 characters.";
  }

  if (!TWITCH_LOGIN_PATTERN.test(trimmed)) {
    return "Use lowercase letters, numbers, or underscores for Twitch logins.";
  }

  return null;
}

function validateMatchTitle(value: string): string | null {
  return value.trim().length < 3
    ? "Enter a match title with at least 3 characters."
    : null;
}

function validateMatchSlug(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length < 3) {
    return "Enter a slug with at least 3 characters.";
  }

  return MATCH_SLUG_PATTERN.test(trimmed)
    ? null
    : "Use lowercase letters, numbers, and single hyphens only.";
}

function validateTargetWins(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? null
    : "Target wins must be a whole number greater than 0.";
}

function describeAuditEntry(entry: AuditLogEntry): string {
  const actor =
    entry.actor?.displayName ?? entry.actor?.login ?? "A broadcaster";
  const pair = entry.channelPairLabel ?? "the broadcaster pair";
  const assignedLogin =
    typeof entry.payload.login === "string"
      ? `@${entry.payload.login}`
      : "a moderator";

  switch (entry.action) {
    case "channel_link.created":
      return `${actor} created an invite for ${pair}.`;
    case "channel_link.accepted":
      return `${actor} activated ${pair}.`;
    case "member.assigned":
      return `${actor} assigned ${assignedLogin} to ${pair}.`;
    case "member.revoked":
      return `${actor} removed a moderator from ${pair}.`;
    case "match.created":
      return `${actor} created ${entry.matchTitle ?? "a new match"} for ${pair}.`;
    case "match.status.updated":
      return `${actor} updated ${entry.matchTitle ?? "the match"} to ${String(entry.payload.toStatus ?? "a new status")}.`;
    default:
      return `${actor} updated ${pair}.`;
  }
}

function formatAuditTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return "The local match API is offline. Start the edge worker on port 8787 to load the dashboard.";
  }

  if (!(error instanceof EdgeError)) {
    return "Something broke while syncing the dashboard. Try the action again.";
  }

  switch (error.code) {
    case "invalid_origin":
      return "The request came from an unexpected origin. Refresh the app and try again.";
    case "match_slug_taken":
      return "That match slug is already taken. Change the title or edit the slug.";
    case "moderator_not_signed_in":
      return "That moderator has not signed in with Twitch yet.";
    case "membership_exists":
      return "That Twitch account is already attached to this link.";
    case "channel_link_pending":
      return "A pending broadcaster invite already exists for that login.";
    case "channel_link_not_active":
      return "The broadcaster pair is not active yet. Accept the invite before creating matches.";
    case "cannot_invite_self":
      return "Invite the opposing broadcaster, not the channel you already own.";
    case "live_match_exists":
      return "Only one live match can own chat ingestion for a broadcaster pair at a time.";
    case "shared_bot_not_configured":
      return "The shared chat bot is not configured yet on the edge worker.";
    default:
      return error.code.replaceAll("_", " ");
  }
}

export function DashboardPage() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const [session, setSession] = useState<AuthSession>(EMPTY_SESSION);
  const [links, setLinks] = useState<ChannelLinkSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(search.get("authError"));
  const [inviteResult, setInviteResult] = useState<ChannelLinkInvite | null>(
    null
  );
  const [linkLogin, setLinkLogin] = useState("");
  const [moderatorDrafts, setModeratorDrafts] = useState<
    Record<string, string>
  >({});
  const [linkActionState, setLinkActionState] = useState<
    "idle" | "creating" | "editing-members"
  >("idle");
  const [matchActionState, setMatchActionState] = useState<
    "idle" | "creating" | "updating-status"
  >("idle");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [matchTitle, setMatchTitle] = useState("");
  const [matchSlug, setMatchSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [targetWins, setTargetWins] = useState("");
  const [selectedLinkId, setSelectedLinkId] = useState("");
  const [linkLoginError, setLinkLoginError] = useState<string | null>(null);
  const [moderatorErrors, setModeratorErrors] = useState<
    Record<string, string | null>
  >({});
  const [matchErrors, setMatchErrors] = useState({
    selectedLinkId: null as string | null,
    matchTitle: null as string | null,
    matchSlug: null as string | null,
    targetWins: null as string | null,
  });
  const linkLoginRef = useRef<HTMLInputElement | null>(null);
  const moderatorRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const selectedLinkRef = useRef<HTMLSelectElement | null>(null);
  const matchTitleRef = useRef<HTMLInputElement | null>(null);
  const matchSlugRef = useRef<HTMLInputElement | null>(null);
  const targetWinsRef = useRef<HTMLInputElement | null>(null);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [linkRailExpanded, setLinkRailExpanded] = useState(true);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchRailExpanded, setMatchRailExpanded] = useState(true);
  const [operatorSnapshot, setOperatorSnapshot] =
    useState<MatchSnapshot | null>(null);
  const [operatorSnapshotLoading, setOperatorSnapshotLoading] = useState(false);
  const [operatorSnapshotError, setOperatorSnapshotError] = useState<
    string | null
  >(null);
  const operatorEtagRef = useRef<string | null>(null);
  const operatorPollAbortRef = useRef<AbortController | null>(null);
  const operatorPollTimerRef = useRef<number | null>(null);
  const operatorFetchInFlightRef = useRef(false);
  const operatorLastLoadedAtRef = useRef(0);

  const activeLinks = links.filter((link) => link.status === "active");
  const isLinkBusy = linkActionState !== "idle";
  const isMatchBusy = matchActionState !== "idle";
  const selectedHeaderMatch =
    matches.find((match) => match.id === selectedMatchId) ?? null;
  const selectedOperatorMatch =
    matches.find((match) => match.id === expandedMatchId) ?? null;

  const loadDashboard = useEffectEvent(async () => {
    setIsLoading(true);
    setPageError(null);

    try {
      const nextSession = await edgeFetchJson<AuthSession>("/api/auth/session");

      if (!nextSession.authenticated) {
        setSession(nextSession);
        setLinks([]);
        setMatches([]);
        setActivity([]);
        setIsLoading(false);
        return;
      }

      const [linkPayload, matchPayload] = await Promise.all([
        edgeFetchJson<DashboardPayload>("/api/channel-links"),
        edgeFetchJson<MatchPayload>("/api/matches"),
      ]);

      setSession(nextSession);
      setLinks(linkPayload.items);
      setMatches(matchPayload.items);
      setIsLoading(false);
    } catch (error) {
      setPageError(toFriendlyError(error));
      setIsLoading(false);
    }
  });

  const refreshLinks = useEffectEvent(async () => {
    const payload = await edgeFetchJson<DashboardPayload>("/api/channel-links");
    startTransition(() => {
      setLinks(payload.items);
    });
  });

  const refreshMatches = useEffectEvent(async () => {
    const payload = await edgeFetchJson<MatchPayload>("/api/matches");
    startTransition(() => {
      setMatches(payload.items);
    });
  });

  const refreshActivity = useEffectEvent(async () => {
    setActivityLoading(true);

    try {
      const payload = await edgeFetchJson<AuditLogResponse>("/api/audit-log");
      startTransition(() => {
        setActivity(payload.items);
        setActivityLoaded(true);
      });
    } finally {
      setActivityLoading(false);
    }
  });

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (slugTouched) {
      return;
    }

    setMatchSlug(slugifyMatchTitle(matchTitle));
  }, [matchTitle, slugTouched]);

  useEffect(() => {
    if (
      selectedLinkId &&
      activeLinks.some((link) => link.id === selectedLinkId)
    ) {
      return;
    }

    setSelectedLinkId(activeLinks[0]?.id ?? "");
  }, [activeLinks, selectedLinkId]);

  useEffect(() => {
    if (
      selectedMatchId &&
      matches.some((match) => match.id === selectedMatchId)
    ) {
      return;
    }

    setSelectedMatchId(matches[0]?.id ?? null);
  }, [matches, selectedMatchId]);

  const loadOperatorSnapshot = useEffectEvent(
    async (matchId: string, signal?: AbortSignal) => {
      operatorFetchInFlightRef.current = true;

      const headers: HeadersInit = {};

      if (operatorEtagRef.current) {
        headers["If-None-Match"] = operatorEtagRef.current;
      }

      const response = await fetch(
        buildEdgeUrl(`/api/matches/${matchId}/snapshot`),
        {
          credentials: "include",
          headers,
          signal,
        }
      );

      if (response.status === 304) {
        operatorLastLoadedAtRef.current = Date.now();
        operatorFetchInFlightRef.current = false;
        return;
      }

      const text = await response.text();
      const payload = text
        ? (JSON.parse(text) as
            | MatchSnapshot
            | { error: string; details?: unknown })
        : null;

      if (!response.ok) {
        const errorPayload =
          payload && typeof payload === "object" && "error" in payload
            ? payload
            : { error: "request_failed" };
        throw new EdgeError(
          response.status,
          errorPayload.error,
          errorPayload.details
        );
      }

      operatorEtagRef.current = response.headers.get("ETag");
      operatorLastLoadedAtRef.current = Date.now();
      startTransition(() => {
        setOperatorSnapshot(payload as MatchSnapshot);
      });
      operatorFetchInFlightRef.current = false;
    }
  );

  useEffect(() => {
    if (!expandedMatchId) {
      operatorPollAbortRef.current?.abort();
      if (operatorPollTimerRef.current !== null) {
        window.clearInterval(operatorPollTimerRef.current);
        operatorPollTimerRef.current = null;
      }
      setOperatorSnapshot(null);
      setOperatorSnapshotError(null);
      setOperatorSnapshotLoading(false);
      operatorEtagRef.current = null;
      operatorFetchInFlightRef.current = false;
      operatorLastLoadedAtRef.current = 0;
      return;
    }

    const abortController = new AbortController();
    operatorPollAbortRef.current = abortController;
    operatorEtagRef.current = null;
    operatorFetchInFlightRef.current = false;
    operatorLastLoadedAtRef.current = 0;
    setOperatorSnapshot(null);
    setOperatorSnapshotLoading(true);
    setOperatorSnapshotError(null);

    void (async () => {
      try {
        await loadOperatorSnapshot(expandedMatchId, abortController.signal);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setOperatorSnapshotError(toFriendlyError(error));
        }
      } finally {
        operatorFetchInFlightRef.current = false;
        if (!abortController.signal.aborted) {
          setOperatorSnapshotLoading(false);
        }
      }
    })();

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (operatorFetchInFlightRef.current) {
        return;
      }

      if (Date.now() - operatorLastLoadedAtRef.current < 10_000) {
        return;
      }

      const nextAbortController = new AbortController();
      operatorPollAbortRef.current = nextAbortController;

      void loadOperatorSnapshot(
        expandedMatchId,
        nextAbortController.signal
      ).catch((error) => {
        operatorFetchInFlightRef.current = false;
        if (!nextAbortController.signal.aborted) {
          setOperatorSnapshotError(toFriendlyError(error));
        }
      });
    };

    operatorPollTimerRef.current = window.setInterval(
      tick,
      SNAPSHOT_POLL_INTERVAL_MS
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      abortController.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (operatorPollTimerRef.current !== null) {
        window.clearInterval(operatorPollTimerRef.current);
        operatorPollTimerRef.current = null;
      }
    };
  }, [expandedMatchId, loadOperatorSnapshot]);

  async function runAction(action: () => Promise<void>) {
    setActionError(null);

    try {
      await action();
    } catch (error) {
      setActionError(toFriendlyError(error));
    }
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    await runAction(async () => {
      await edgeNoContent("/api/auth/logout", { method: "POST" });
      startTransition(() => {
        setSession(EMPTY_SESSION);
        setLinks([]);
        setMatches([]);
        setActivity([]);
        setInviteResult(null);
      });
    });
    setIsLoggingOut(false);
  }

  function handleReconnectChat() {
    window.location.assign(
      buildEdgeUrl("/api/auth/twitch/login", { intent: "chat" })
    );
  }

  async function handleCreateLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateTwitchLogin(linkLogin);

    if (nextError) {
      setLinkLoginError(nextError);
      linkLoginRef.current?.focus();
      return;
    }

    setLinkActionState("creating");
    await runAction(async () => {
      const payload = await edgeSendJson<{ invite: ChannelLinkInvite }>(
        "/api/channel-links",
        {
          invitedChannelLogin: linkLogin.trim().toLowerCase(),
        }
      );

      setInviteResult(payload.invite);
      setLinkLogin("");
      setLinkLoginError(null);
      await Promise.all([
        refreshLinks(),
        activityLoaded ? refreshActivity() : Promise.resolve(),
      ]);
    });
    setLinkActionState("idle");
  }

  async function handleAddModerator(
    event: React.FormEvent<HTMLFormElement>,
    channelLinkId: string
  ) {
    event.preventDefault();

    const login = moderatorDrafts[channelLinkId]?.trim().toLowerCase() ?? "";
    const nextError = validateTwitchLogin(login);

    if (nextError) {
      setModeratorErrors((current) => ({
        ...current,
        [channelLinkId]: nextError,
      }));
      moderatorRefs.current[channelLinkId]?.focus();
      return;
    }

    setLinkActionState("editing-members");
    await runAction(async () => {
      await edgeSendJson(`/api/channel-links/${channelLinkId}/members`, {
        login,
        role: "mod",
      });
      setModeratorDrafts((current) => ({ ...current, [channelLinkId]: "" }));
      setModeratorErrors((current) => ({ ...current, [channelLinkId]: null }));
      await Promise.all([
        refreshLinks(),
        activityLoaded ? refreshActivity() : Promise.resolve(),
      ]);
    });
    setLinkActionState("idle");
  }

  async function handleRemoveModerator(
    channelLinkId: string,
    membershipId: string
  ) {
    setLinkActionState("editing-members");
    await runAction(async () => {
      await edgeNoContent(
        `/api/channel-links/${channelLinkId}/members/${membershipId}`,
        {
          method: "DELETE",
        }
      );
      await Promise.all([
        refreshLinks(),
        activityLoaded ? refreshActivity() : Promise.resolve(),
      ]);
    });
    setLinkActionState("idle");
  }

  async function handleCreateMatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = {
      selectedLinkId:
        selectedLinkId.trim().length > 0
          ? null
          : activeLinks.length > 0
            ? "Select an active broadcaster pair."
            : "Activate a broadcaster pair before creating a match.",
      matchTitle: validateMatchTitle(matchTitle),
      matchSlug: validateMatchSlug(matchSlug),
      targetWins: validateTargetWins(targetWins),
    };

    setMatchErrors(nextErrors);

    if (
      nextErrors.selectedLinkId ||
      nextErrors.matchTitle ||
      nextErrors.matchSlug ||
      nextErrors.targetWins
    ) {
      if (nextErrors.selectedLinkId) {
        selectedLinkRef.current?.focus();
      } else if (nextErrors.matchTitle) {
        matchTitleRef.current?.focus();
      } else if (nextErrors.matchSlug) {
        matchSlugRef.current?.focus();
      } else if (nextErrors.targetWins) {
        targetWinsRef.current?.focus();
      }
      return;
    }

    setMatchActionState("creating");
    await runAction(async () => {
      await edgeSendJson<{ match: MatchSummary }>("/api/matches", {
        channelLinkId: selectedLinkId,
        title: matchTitle,
        slug: matchSlug,
        targetWins: targetWins ? Number(targetWins) : null,
      });

      startTransition(() => {
        setNotice("match-created");
      });
      setMatchTitle("");
      setMatchSlug("");
      setTargetWins("");
      setSlugTouched(false);
      setMatchErrors({
        selectedLinkId: null,
        matchTitle: null,
        matchSlug: null,
        targetWins: null,
      });
      await Promise.all([
        refreshMatches(),
        activityLoaded ? refreshActivity() : Promise.resolve(),
      ]);
    });
    setMatchActionState("idle");
  }

  async function handleSetMatchStatus(
    matchId: string,
    status: MatchSummary["status"]
  ) {
    setMatchActionState("updating-status");
    await runAction(async () => {
      await edgeSendJson<{ match: MatchSummary }>(
        `/api/matches/${matchId}/status`,
        { status },
        { method: "PATCH" }
      );
      await Promise.all([
        refreshMatches(),
        refreshLinks(),
        activityLoaded ? refreshActivity() : Promise.resolve(),
      ]);

      if (expandedMatchId === matchId) {
        operatorEtagRef.current = null;
        await loadOperatorSnapshot(matchId);
      }
    });
    setMatchActionState("idle");
  }

  async function handleToggleOperatorPanel(matchId: string) {
    setSelectedMatchId(matchId);

    if (expandedMatchId === matchId) {
      setExpandedMatchId(null);
      return;
    }

    setExpandedMatchId(matchId);
  }

  async function handleToggleActivityExpanded() {
    const nextExpanded = !activityExpanded;
    setActivityExpanded(nextExpanded);

    if (nextExpanded && !activityLoaded && !activityLoading) {
      await runAction(async () => {
        await refreshActivity();
      });
    }
  }

  function handleToggleMatchRailExpanded() {
    setMatchRailExpanded((current) => !current);
  }

  function getOperatorPrimaryAction(match: MatchSummary): {
    label: string;
    status: MatchSummary["status"];
  } {
    if (match.status === "live") {
      return {
        label: "Pause",
        status: "paused",
      };
    }

    if (match.status === "paused") {
      return {
        label: "Resume match",
        status: "live",
      };
    }

    if (match.status === "draft") {
      return {
        label: "Start match",
        status: "live",
      };
    }

    return {
      label: "Route chat live",
      status: "live",
    };
  }

  function handleToggleLinkRailExpanded() {
    setLinkRailExpanded((current) => !current);
  }

  if (isLoading) {
    return (
      <PageShell
        eyebrow="Dashboard"
        title="Syncing the command deck"
        deck="Pulling your Twitch session, linked channels, and current match rail."
        actions={<span className="gg-chip">Phase 2</span>}
      >
        <div className="dashboard-skeleton">
          <div className="dashboard-skeleton__bar" />
          <div className="dashboard-skeleton__grid">
            <div className="dashboard-skeleton__panel" />
            <div className="dashboard-skeleton__panel" />
            <div className="dashboard-skeleton__panel" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (!session.authenticated || !session.user || !session.ownedChannel) {
    return (
      <PageShell
        eyebrow="Dashboard"
        title="Sign in and wire the rivalry"
        deck="Twitch login is the control-room gate. Broadcasters authenticate here, mint the invite, and keep every match tied to verified channel identity."
        actions={<span className="gg-chip">Twitch OIDC</span>}
      >
        <section className="dashboard-auth-gate">
          <div className="dashboard-auth-gate__copy">
            <p className="dashboard-auth-gate__label">Broadcaster auth only</p>
            <h2 className="dashboard-auth-gate__title">
              Lock the command deck to real Twitch channels.
            </h2>
            <p className="dashboard-auth-gate__body">
              The website never handles raw Twitch tokens. The Worker owns
              sign-in, session cookies, channel linking, and every protected
              match mutation.
            </p>
          </div>
          <button
            className="dashboard-button dashboard-button--primary"
            type="button"
            onClick={() => {
              window.location.assign(
                buildEdgeUrl("/api/auth/twitch/login", { intent: "dashboard" })
              );
            }}
          >
            Sign in with Twitch
          </button>
        </section>
        {notice ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>
        ) : null}
        {pageError ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {pageError}
          </p>
        ) : null}
      </PageShell>
    );
  }

  return (
    <div className="dashboard-stage">
      <PageShell eyebrow="" title="" deck="" emphasis="compact">
        <section className="dashboard-toolbar">
          <div className="dashboard-toolbar__left">
            <span className="gg-chip">Twitch verified</span>
          </div>
          <div className="dashboard-toolbar__right">
            {selectedHeaderMatch ? (
              <>
                <Link
                  className="dashboard-link"
                  to={`/matches/${selectedHeaderMatch.slug}`}
                >
                  Open public page
                </Link>
                <Link
                  className="dashboard-link"
                  to={`/overlay/${selectedHeaderMatch.id}`}
                >
                  Open overlay
                </Link>
              </>
            ) : null}
            <button
              className="dashboard-button dashboard-button--ghost"
              type="button"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </div>
        </section>

        <section className="dashboard-hero">
          <article className="dashboard-banner dashboard-banner--identity">
            <p className="dashboard-banner__label">Signed in broadcaster</p>
            <strong>{session.user.displayName}</strong>
            <span>@{session.user.login}</span>
          </article>
          <article className="dashboard-banner">
            <p className="dashboard-banner__label">Linked channel sets</p>
            <strong>{links.length}</strong>
            <span>{activeLinks.length} active for match creation</span>
          </article>
          <article className="dashboard-banner">
            <p className="dashboard-banner__label">Drafted matches</p>
            <strong>{matches.length}</strong>
            <span>Every match stays scoped to one active broadcaster pair</span>
          </article>
        </section>

        {notice === "match-created" ? (
          <p
            className="dashboard-message dashboard-message--success"
            role="status"
            aria-live="polite"
          >
            Match created and added to the draft rail.
          </p>
        ) : null}
        {search.get("auth") === "connected" ? (
          <p
            className="dashboard-message dashboard-message--success"
            role="status"
            aria-live="polite"
          >
            Twitch authentication is active. Start by linking the opposing
            broadcaster.
          </p>
        ) : null}
        {search.get("chatAuth") === "connected" ? (
          <p
            className="dashboard-message dashboard-message--success"
            role="status"
            aria-live="polite"
          >
            Chat authorization updated. The worker will reconcile subscriptions
            for active pairs.
          </p>
        ) : null}
        {pageError ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {pageError}
          </p>
        ) : null}
        {actionError ? (
          <p
            className="dashboard-message dashboard-message--warning"
            role="status"
            aria-live="polite"
          >
            {actionError}
          </p>
        ) : null}
        {inviteResult ? (
          <p
            className="dashboard-message dashboard-message--success"
            role="status"
            aria-live="polite"
          >
            Invite live for @{inviteResult.invitedChannelLogin}. Share{" "}
            <a href={inviteResult.shareUrl}>{inviteResult.shareUrl}</a>
          </p>
        ) : null}

        {selectedOperatorMatch ? (
          <section className="dashboard-panel dashboard-panel--operator">
            {(() => {
              const primaryAction = getOperatorPrimaryAction(
                selectedOperatorMatch
              );

              return (
                <>
                  <div className="dashboard-panel__header">
                    <div>
                      <p className="dashboard-panel__eyebrow">Operator board</p>
                      <h2 className="dashboard-panel__title">
                        Live match operator view
                      </h2>
                    </div>
                    <span className="gg-chip gg-chip--soft">
                      1m visible-tab refresh
                    </span>
                  </div>
                  {operatorSnapshotError ? (
                    <p
                      className="dashboard-message dashboard-message--warning"
                      role="status"
                      aria-live="polite"
                    >
                      {operatorSnapshotError}
                    </p>
                  ) : null}
                  {operatorSnapshot ? (
                    <div className="dashboard-match-operator">
                      <div className="dashboard-match-operator__header">
                        <div>
                          <p className="dashboard-panel__eyebrow">
                            {selectedOperatorMatch.status}
                          </p>
                          <h3 className="dashboard-panel__title">
                            {selectedOperatorMatch.title}
                          </h3>
                        </div>
                        <span className="gg-chip gg-chip--soft">
                          Chat {selectedOperatorMatch.chatState ?? "idle"}
                        </span>
                      </div>
                      <div className="dashboard-match-operator__actions">
                        <span className="gg-chip gg-chip--soft">
                          {selectedOperatorMatch.targetWins
                            ? `FT${selectedOperatorMatch.targetWins}`
                            : "Open mode"}
                        </span>
                        <button
                          className="dashboard-button dashboard-button--ghost"
                          type="button"
                          disabled={isMatchBusy}
                          onClick={() =>
                            void handleSetMatchStatus(
                              selectedOperatorMatch.id,
                              primaryAction.status
                            )
                          }
                        >
                          {primaryAction.label}
                        </button>
                        <button
                          className="dashboard-button dashboard-button--ghost"
                          type="button"
                          disabled={isMatchBusy}
                          onClick={() =>
                            void handleSetMatchStatus(
                              selectedOperatorMatch.id,
                              "complete"
                            )
                          }
                        >
                          Complete
                        </button>
                        <button
                          className="dashboard-button dashboard-button--ghost"
                          type="button"
                          onClick={() =>
                            void handleToggleOperatorPanel(
                              selectedOperatorMatch.id
                            )
                          }
                        >
                          Close operator board
                        </button>
                      </div>
                      <div className="dashboard-match-operator__grid">
                        <ScoreBug match={operatorSnapshot} />
                        <div className="match-support-grid">
                          <SuggestionBoard
                            suggestions={operatorSnapshot.suggestions}
                            title="Compact chat board"
                          />
                          <QueueList
                            items={operatorSnapshot.queue}
                            title="Upcoming flow"
                            transparent
                          />
                        </div>
                      </div>
                    </div>
                  ) : operatorSnapshotLoading ? (
                    <EmptyPanel
                      title="Syncing operator board"
                      body="Loading the live snapshot for the selected match."
                    />
                  ) : null}
                </>
              );
            })()}
          </section>
        ) : null}

        <div className="dashboard-lanes">
          <section className="dashboard-panel dashboard-panel--accent">
            <div className="dashboard-panel__header">
              <div>
                <p className="dashboard-panel__eyebrow">Channel linking</p>
                <h2 className="dashboard-panel__title">
                  Bring the rival broadcaster in
                </h2>
              </div>
              <div className="dashboard-membership__actions">
                <span className="gg-chip gg-chip--soft">24h invite window</span>
                <button
                  className="dashboard-button dashboard-button--ghost"
                  type="button"
                  onClick={handleToggleLinkRailExpanded}
                >
                  {linkRailExpanded ? "Collapse links" : "Expand links"}
                </button>
              </div>
            </div>
            {linkRailExpanded ? (
              <>
                <form
                  className="dashboard-form"
                  onSubmit={(event) => void handleCreateLink(event)}
                >
                  <label className="dashboard-field">
                    <span>Invite by Twitch login</span>
                    <input
                      ref={linkLoginRef}
                      name="invitedChannelLogin"
                      value={linkLogin}
                      onChange={(event) => {
                        setLinkLogin(event.currentTarget.value);
                        setLinkLoginError(null);
                      }}
                      placeholder="novarune"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={linkLoginError ? "true" : "false"}
                      aria-describedby={
                        linkLoginError
                          ? "invited-channel-login-error"
                          : undefined
                      }
                    />
                  </label>
                  {linkLoginError ? (
                    <p
                      id="invited-channel-login-error"
                      className="dashboard-field__error"
                      role="status"
                      aria-live="polite"
                    >
                      {linkLoginError}
                    </p>
                  ) : null}
                  <button
                    className="dashboard-button dashboard-button--primary"
                    type="submit"
                    disabled={isLinkBusy}
                  >
                    Create broadcaster invite
                  </button>
                </form>
                {links.length > 0 ? (
                  <div className="dashboard-link-stack">
                    {links.map((link) => (
                      <article key={link.id} className="dashboard-link-card">
                        {(() => {
                          const chatIntegration = link.chatIntegration ?? {
                            ownerAuthorized: false,
                            linkedAuthorized: false,
                            status: "idle",
                          };

                          return (
                            <>
                              <div className="dashboard-link-card__header">
                                <div>
                                  <p className="dashboard-link-card__eyebrow">
                                    Channel pair
                                  </p>
                                  <h3 className="dashboard-link-card__title">
                                    @{link.ownerChannel.login} <span>vs</span>{" "}
                                    {link.linkedChannel
                                      ? `@${link.linkedChannel.login}`
                                      : `@${link.invitedChannelLogin}`}
                                  </h3>
                                </div>
                                <span
                                  className={`gg-chip ${link.status === "active" ? "" : "gg-chip--soft"}`}
                                >
                                  {link.status}
                                </span>
                              </div>

                              {link.pendingInvite ? (
                                <p className="dashboard-link-card__meta">
                                  Invite locked to @
                                  {link.pendingInvite.invitedChannelLogin}.
                                  Share{" "}
                                  <a href={link.pendingInvite.shareUrl}>
                                    {link.pendingInvite.shareUrl}
                                  </a>
                                </p>
                              ) : null}
                              <div className="dashboard-membership">
                                <div>
                                  <strong>Chat integration</strong>
                                  <span>
                                    {chatIntegration.status} • owner{" "}
                                    {chatIntegration.ownerAuthorized
                                      ? "ready"
                                      : "missing"}{" "}
                                    • rival{" "}
                                    {chatIntegration.linkedAuthorized
                                      ? "ready"
                                      : "missing"}
                                  </span>
                                </div>
                                <div className="dashboard-membership__actions">
                                  <span className="gg-chip gg-chip--soft">
                                    {chatIntegration.status}
                                  </span>
                                  {chatIntegration.status ===
                                  "needs_consent" ? (
                                    <button
                                      className="dashboard-button dashboard-button--ghost"
                                      type="button"
                                      onClick={handleReconnectChat}
                                    >
                                      Reconnect chat
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                        <div className="dashboard-memberships">
                          {link.memberships.map((membership) => (
                            <div
                              key={membership.id}
                              className="dashboard-membership"
                            >
                              <div>
                                <strong>{membership.user.displayName}</strong>
                                <span>@{membership.user.login}</span>
                              </div>
                              <div className="dashboard-membership__actions">
                                <span className="gg-chip gg-chip--soft">
                                  {membership.role}
                                </span>
                                {membership.role === "mod" ? (
                                  <button
                                    className="dashboard-button dashboard-button--ghost"
                                    type="button"
                                    disabled={isLinkBusy}
                                    onClick={() =>
                                      void handleRemoveModerator(
                                        link.id,
                                        membership.id
                                      )
                                    }
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>

                        <form
                          className="dashboard-inline-form"
                          onSubmit={(event) =>
                            void handleAddModerator(event, link.id)
                          }
                        >
                          <label className="dashboard-field">
                            <span>Add verified moderator</span>
                            <input
                              ref={(element) => {
                                moderatorRefs.current[link.id] = element;
                              }}
                              name={`moderatorLogin-${link.id}`}
                              value={moderatorDrafts[link.id] ?? ""}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setModeratorDrafts((current) => ({
                                  ...current,
                                  [link.id]: value,
                                }));
                                setModeratorErrors((current) => ({
                                  ...current,
                                  [link.id]: null,
                                }));
                              }}
                              placeholder="trustedmod"
                              autoComplete="off"
                              spellCheck={false}
                              aria-invalid={
                                moderatorErrors[link.id] ? "true" : "false"
                              }
                              aria-describedby={
                                moderatorErrors[link.id]
                                  ? `moderator-error-${link.id}`
                                  : undefined
                              }
                            />
                          </label>
                          {moderatorErrors[link.id] ? (
                            <p
                              id={`moderator-error-${link.id}`}
                              className="dashboard-field__error"
                              role="status"
                              aria-live="polite"
                            >
                              {moderatorErrors[link.id]}
                            </p>
                          ) : null}
                          <button
                            className="dashboard-button dashboard-button--ghost"
                            type="submit"
                            disabled={isLinkBusy}
                          >
                            Assign mod
                          </button>
                        </form>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyPanel
                    title="No linked rivalry yet"
                    body="Create the first broadcaster invite to unlock moderator assignment and match creation."
                  />
                )}
              </>
            ) : (
              <EmptyPanel
                title="Channel linking collapsed"
                body="Expand this rail when you need to invite a broadcaster, reconnect chat, or manage moderators."
              />
            )}
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <p className="dashboard-panel__eyebrow">Match drafting</p>
                <h2 className="dashboard-panel__title">Seed the next set</h2>
              </div>
              <div className="dashboard-membership__actions">
                <span className="gg-chip gg-chip--soft">
                  {activeLinks.length} active pairs
                </span>
                <button
                  className="dashboard-button dashboard-button--ghost"
                  type="button"
                  onClick={handleToggleMatchRailExpanded}
                >
                  {matchRailExpanded ? "Collapse matches" : "Expand matches"}
                </button>
              </div>
            </div>
            <form
              className="dashboard-form"
              onSubmit={(event) => void handleCreateMatch(event)}
            >
              <label className="dashboard-field">
                <span>Broadcaster pair</span>
                <select
                  ref={selectedLinkRef}
                  name="channelLinkId"
                  value={selectedLinkId}
                  onChange={(event) => {
                    setSelectedLinkId(event.currentTarget.value);
                    setMatchErrors((current) => ({
                      ...current,
                      selectedLinkId: null,
                    }));
                  }}
                  disabled={activeLinks.length === 0}
                  aria-invalid={matchErrors.selectedLinkId ? "true" : "false"}
                  aria-describedby={
                    matchErrors.selectedLinkId ? "match-link-error" : undefined
                  }
                >
                  <option value="">Select an active pair</option>
                  {activeLinks.map((link) => (
                    <option key={link.id} value={link.id}>
                      @{link.ownerChannel.login} vs @{link.linkedChannel?.login}
                    </option>
                  ))}
                </select>
              </label>
              {matchErrors.selectedLinkId ? (
                <p
                  id="match-link-error"
                  className="dashboard-field__error"
                  role="status"
                  aria-live="polite"
                >
                  {matchErrors.selectedLinkId}
                </p>
              ) : null}
              <label className="dashboard-field">
                <span>Match title</span>
                <input
                  ref={matchTitleRef}
                  name="matchTitle"
                  value={matchTitle}
                  onChange={(event) => {
                    setMatchTitle(event.currentTarget.value);
                    setMatchErrors((current) => ({
                      ...current,
                      matchTitle: null,
                    }));
                  }}
                  placeholder="Gauntlet Finals"
                  autoComplete="off"
                  aria-invalid={matchErrors.matchTitle ? "true" : "false"}
                  aria-describedby={
                    matchErrors.matchTitle ? "match-title-error" : undefined
                  }
                />
              </label>
              {matchErrors.matchTitle ? (
                <p
                  id="match-title-error"
                  className="dashboard-field__error"
                  role="status"
                  aria-live="polite"
                >
                  {matchErrors.matchTitle}
                </p>
              ) : null}
              <div className="dashboard-form__split">
                <label className="dashboard-field">
                  <span>Slug</span>
                  <input
                    ref={matchSlugRef}
                    name="matchSlug"
                    value={matchSlug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setMatchSlug(event.currentTarget.value);
                      setMatchErrors((current) => ({
                        ...current,
                        matchSlug: null,
                      }));
                    }}
                    placeholder="gauntlet-finals"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={matchErrors.matchSlug ? "true" : "false"}
                    aria-describedby={
                      matchErrors.matchSlug ? "match-slug-error" : undefined
                    }
                  />
                  {matchErrors.matchSlug ? (
                    <p
                      id="match-slug-error"
                      className="dashboard-field__error"
                      role="status"
                      aria-live="polite"
                    >
                      {matchErrors.matchSlug}
                    </p>
                  ) : null}
                </label>
                <label className="dashboard-field">
                  <span>Target wins</span>
                  <input
                    ref={targetWinsRef}
                    name="targetWins"
                    type="number"
                    min="1"
                    value={targetWins}
                    onChange={(event) => {
                      setTargetWins(event.currentTarget.value);
                      setMatchErrors((current) => ({
                        ...current,
                        targetWins: null,
                      }));
                    }}
                    placeholder="3"
                    inputMode="numeric"
                    aria-invalid={matchErrors.targetWins ? "true" : "false"}
                    aria-describedby={
                      matchErrors.targetWins ? "target-wins-error" : undefined
                    }
                  />
                  {matchErrors.targetWins ? (
                    <p
                      id="target-wins-error"
                      className="dashboard-field__error"
                      role="status"
                      aria-live="polite"
                    >
                      {matchErrors.targetWins}
                    </p>
                  ) : null}
                </label>
              </div>
              <button
                className="dashboard-button dashboard-button--primary"
                type="submit"
                disabled={isMatchBusy}
              >
                Create match draft
              </button>
            </form>

            {matches.length > 0 && matchRailExpanded ? (
              <div className="dashboard-match-list">
                {matches.map((match) => (
                  <article key={match.id} className="dashboard-match-card">
                    {(() => {
                      const chatState = match.chatState ?? "idle";
                      const boardRevision = match.boardRevision ?? 0;
                      const subscriptionHealth =
                        match.subscriptionHealth ?? "idle";

                      return (
                        <>
                          <div>
                            <p className="dashboard-match-card__eyebrow">
                              {match.status}
                            </p>
                            <h3 className="dashboard-match-card__title">
                              {match.title}
                            </h3>
                            <p className="dashboard-match-card__meta">
                              {match.players
                                .map((player) => player.displayName)
                                .join(" vs ")}
                            </p>
                            <p className="dashboard-match-card__meta">
                              Chat {chatState} • board rev {boardRevision} •
                              subs {subscriptionHealth}
                            </p>
                          </div>
                          <span className="gg-chip gg-chip--soft">
                            {match.targetWins
                              ? `FT${match.targetWins}`
                              : "Open mode"}
                          </span>
                          <div className="dashboard-match-card__actions">
                            <button
                              className="dashboard-button dashboard-button--ghost"
                              type="button"
                              onClick={() =>
                                void handleToggleOperatorPanel(match.id)
                              }
                            >
                              {expandedMatchId === match.id
                                ? "Selected in operator board"
                                : "Open operator board"}
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </article>
                ))}
              </div>
            ) : matches.length > 0 ? (
              <EmptyPanel
                title="Matches collapsed"
                body="Expand the drafted match rail when you need to review or operate older sets."
              />
            ) : (
              <EmptyPanel
                title="No matches drafted"
                body="As soon as a broadcaster invite is accepted, you can seed the title, slug, and target wins for the next set."
              />
            )}
          </section>
        </div>

        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <p className="dashboard-panel__eyebrow">Events</p>
              <h2 className="dashboard-panel__title">Operational event rail</h2>
            </div>
            <div className="dashboard-membership__actions">
              <span className="gg-chip gg-chip--soft">
                {activityLoaded
                  ? `${activity.length} events`
                  : activityLoading
                    ? "Loading…"
                    : "Deferred"}
              </span>
              <button
                className="dashboard-button dashboard-button--ghost"
                type="button"
                onClick={() => void handleToggleActivityExpanded()}
              >
                {activityExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>
          {!activityExpanded ? (
            <EmptyPanel
              title="Events collapsed"
              body="Open this panel only when you need the audit trail."
            />
          ) : !activityLoaded ? (
            <EmptyPanel
              title="Events deferred"
              body="This rail loads only when expanded so normal dashboard use stays cheap."
            />
          ) : activity.length > 0 ? (
            <ol
              className="dashboard-activity-list"
              aria-label="Recent activity"
            >
              {activity.map((entry) => (
                <li key={entry.id} className="dashboard-activity-item">
                  <p className="dashboard-activity-item__summary">
                    {describeAuditEntry(entry)}
                  </p>
                  <p className="dashboard-activity-item__meta">
                    <span>{formatAuditTimestamp(entry.createdAt)}</span>
                    {entry.channelPairLabel ? (
                      <span>{entry.channelPairLabel}</span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyPanel
              title="No events yet"
              body="Link a broadcaster, assign a moderator, or create a match to start the event rail."
            />
          )}
        </section>
      </PageShell>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="dashboard-empty">
      <p className="dashboard-empty__title">{title}</p>
      <p className="dashboard-empty__body">{body}</p>
    </div>
  );
}
