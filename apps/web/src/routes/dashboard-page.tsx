import type {
  AuthSession,
  ChannelLinkInvite,
  ChannelLinkSummary,
  MatchSummary
} from "@gaming-gauntlet/contracts";
import { PageShell } from "@gaming-gauntlet/ui";
import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { buildEdgeUrl, EdgeError, edgeFetchJson, edgeNoContent, edgeSendJson } from "../lib/edge";
import { slugifyMatchTitle } from "../lib/slug";

type DashboardPayload = {
  items: ChannelLinkSummary[];
};

type MatchPayload = {
  items: MatchSummary[];
};

const EMPTY_SESSION: AuthSession = {
  authenticated: false,
  user: null,
  ownedChannel: null
};

function toFriendlyError(error: unknown): string {
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
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(search.get("authError"));
  const [inviteResult, setInviteResult] = useState<ChannelLinkInvite | null>(null);
  const [linkLogin, setLinkLogin] = useState("");
  const [moderatorDrafts, setModeratorDrafts] = useState<Record<string, string>>({});
  const [linkActionState, setLinkActionState] = useState<"idle" | "creating" | "editing-members">("idle");
  const [matchActionState, setMatchActionState] = useState<"idle" | "creating">("idle");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [matchTitle, setMatchTitle] = useState("");
  const [matchSlug, setMatchSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [targetWins, setTargetWins] = useState("");
  const [selectedLinkId, setSelectedLinkId] = useState("");

  const activeLinks = links.filter((link) => link.status === "active");
  const isLinkBusy = linkActionState !== "idle";
  const isMatchBusy = matchActionState !== "idle";

  const loadDashboard = useEffectEvent(async () => {
    setIsLoading(true);
    setPageError(null);

    try {
      const nextSession = await edgeFetchJson<AuthSession>("/api/auth/session");

      if (!nextSession.authenticated) {
        setSession(nextSession);
        setLinks([]);
        setMatches([]);
        setIsLoading(false);
        return;
      }

      const [linkPayload, matchPayload] = await Promise.all([
        edgeFetchJson<DashboardPayload>("/api/channel-links"),
        edgeFetchJson<MatchPayload>("/api/matches")
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
    if (selectedLinkId && activeLinks.some((link) => link.id === selectedLinkId)) {
      return;
    }

    setSelectedLinkId(activeLinks[0]?.id ?? "");
  }, [activeLinks, selectedLinkId]);

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
        setInviteResult(null);
      });
    });
    setIsLoggingOut(false);
  }

  async function handleCreateLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLinkActionState("creating");
    await runAction(async () => {
      const payload = await edgeSendJson<{ invite: ChannelLinkInvite }>(
        "/api/channel-links",
        {
          invitedChannelLogin: linkLogin.trim().toLowerCase()
        }
      );

      setInviteResult(payload.invite);
      setLinkLogin("");
      await refreshLinks();
    });
    setLinkActionState("idle");
  }

  async function handleAddModerator(event: React.FormEvent<HTMLFormElement>, channelLinkId: string) {
    event.preventDefault();

    const login = moderatorDrafts[channelLinkId]?.trim().toLowerCase() ?? "";

    setLinkActionState("editing-members");
    await runAction(async () => {
      await edgeSendJson(`/api/channel-links/${channelLinkId}/members`, {
        login,
        role: "mod"
      });
      setModeratorDrafts((current) => ({ ...current, [channelLinkId]: "" }));
      await refreshLinks();
    });
    setLinkActionState("idle");
  }

  async function handleRemoveModerator(channelLinkId: string, membershipId: string) {
    setLinkActionState("editing-members");
    await runAction(async () => {
      await edgeNoContent(`/api/channel-links/${channelLinkId}/members/${membershipId}`, {
        method: "DELETE"
      });
      await refreshLinks();
    });
    setLinkActionState("idle");
  }

  async function handleCreateMatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMatchActionState("creating");
    await runAction(async () => {
      await edgeSendJson<{ match: MatchSummary }>("/api/matches", {
        channelLinkId: selectedLinkId,
        title: matchTitle,
        slug: matchSlug,
        targetWins: targetWins ? Number(targetWins) : null
      });

      startTransition(() => {
        setNotice("match-created");
      });
      setMatchTitle("");
      setMatchSlug("");
      setTargetWins("");
      setSlugTouched(false);
      await refreshMatches();
    });
    setMatchActionState("idle");
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
            <h2 className="dashboard-auth-gate__title">Lock the command deck to real Twitch channels.</h2>
            <p className="dashboard-auth-gate__body">
              The website never handles raw Twitch tokens. The Worker owns sign-in, session cookies,
              channel linking, and every protected match mutation.
            </p>
          </div>
          <button
            className="dashboard-button dashboard-button--primary"
            type="button"
            onClick={() => {
              window.location.assign(buildEdgeUrl("/api/auth/twitch/login", { intent: "dashboard" }));
            }}
          >
            Sign in with Twitch
          </button>
        </section>
        {notice ? <p className="dashboard-message dashboard-message--warning">{notice}</p> : null}
        {pageError ? <p className="dashboard-message dashboard-message--warning">{pageError}</p> : null}
      </PageShell>
    );
  }

  return (
    <div className="dashboard-stage">
      <PageShell
        eyebrow="Broadcaster Dashboard"
        title={`Queue the gauntlet for @${session.ownedChannel.login}`}
        deck="Invite the second broadcaster, assign verified moderators, and draft the match before the live control room takes over."
        actions={
          <div className="dashboard-header-actions">
            <span className="gg-chip">Twitch verified</span>
            <button
              className="dashboard-button dashboard-button--ghost"
              type="button"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </div>
        }
      >
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
          <p className="dashboard-message dashboard-message--success">Match created and added to the draft rail.</p>
        ) : null}
        {search.get("auth") === "connected" ? (
          <p className="dashboard-message dashboard-message--success">
            Twitch authentication is active. Start by linking the opposing broadcaster.
          </p>
        ) : null}
        {pageError ? <p className="dashboard-message dashboard-message--warning">{pageError}</p> : null}
        {actionError ? <p className="dashboard-message dashboard-message--warning">{actionError}</p> : null}
        {inviteResult ? (
          <p className="dashboard-message dashboard-message--success">
            Invite live for @{inviteResult.invitedChannelLogin}. Share{" "}
            <a href={inviteResult.shareUrl}>{inviteResult.shareUrl}</a>
          </p>
        ) : null}

        <div className="dashboard-lanes">
          <section className="dashboard-panel dashboard-panel--accent">
            <div className="dashboard-panel__header">
              <div>
                <p className="dashboard-panel__eyebrow">Channel linking</p>
                <h2 className="dashboard-panel__title">Bring the rival broadcaster in</h2>
              </div>
              <span className="gg-chip gg-chip--soft">24h invite window</span>
            </div>
            <form className="dashboard-form" onSubmit={(event) => void handleCreateLink(event)}>
              <label className="dashboard-field">
                <span>Invite by Twitch login</span>
                <input
                  name="invitedChannelLogin"
                  value={linkLogin}
                  onChange={(event) => setLinkLogin(event.currentTarget.value)}
                  placeholder="novarune"
                  autoComplete="off"
                />
              </label>
              <button
                className="dashboard-button dashboard-button--primary"
                type="submit"
                disabled={isLinkBusy || linkLogin.trim().length < 3}
              >
                Create broadcaster invite
              </button>
            </form>
            {links.length > 0 ? (
              <div className="dashboard-link-stack">
                {links.map((link) => (
                  <article key={link.id} className="dashboard-link-card">
                    <div className="dashboard-link-card__header">
                      <div>
                        <p className="dashboard-link-card__eyebrow">Channel pair</p>
                        <h3 className="dashboard-link-card__title">
                          @{link.ownerChannel.login} <span>vs</span>{" "}
                          {link.linkedChannel ? `@${link.linkedChannel.login}` : `@${link.invitedChannelLogin}`}
                        </h3>
                      </div>
                      <span className={`gg-chip ${link.status === "active" ? "" : "gg-chip--soft"}`}>
                        {link.status}
                      </span>
                    </div>

                    {link.pendingInvite ? (
                      <p className="dashboard-link-card__meta">
                        Invite locked to @{link.pendingInvite.invitedChannelLogin}. Share{" "}
                        <a href={link.pendingInvite.shareUrl}>{link.pendingInvite.shareUrl}</a>
                      </p>
                    ) : null}

                    <div className="dashboard-memberships">
                      {link.memberships.map((membership) => (
                        <div key={membership.id} className="dashboard-membership">
                          <div>
                            <strong>{membership.user.displayName}</strong>
                            <span>@{membership.user.login}</span>
                          </div>
                          <div className="dashboard-membership__actions">
                            <span className="gg-chip gg-chip--soft">{membership.role}</span>
                            {membership.role === "mod" ? (
                              <button
                                className="dashboard-button dashboard-button--ghost"
                                type="button"
                                disabled={isLinkBusy}
                                onClick={() => void handleRemoveModerator(link.id, membership.id)}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    <form className="dashboard-inline-form" onSubmit={(event) => void handleAddModerator(event, link.id)}>
                      <label className="dashboard-field">
                        <span>Add verified moderator</span>
                        <input
                          value={moderatorDrafts[link.id] ?? ""}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setModeratorDrafts((current) => ({
                              ...current,
                              [link.id]: value
                            }));
                          }}
                          placeholder="trustedmod"
                          autoComplete="off"
                        />
                      </label>
                      <button
                        className="dashboard-button dashboard-button--ghost"
                        type="submit"
                        disabled={isLinkBusy || (moderatorDrafts[link.id] ?? "").trim().length < 3}
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
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <p className="dashboard-panel__eyebrow">Match drafting</p>
                <h2 className="dashboard-panel__title">Seed the next set</h2>
              </div>
              <span className="gg-chip gg-chip--soft">{activeLinks.length} active pairs</span>
            </div>
            <form className="dashboard-form" onSubmit={(event) => void handleCreateMatch(event)}>
              <label className="dashboard-field">
                <span>Broadcaster pair</span>
                <select
                  value={selectedLinkId}
                  onChange={(event) => setSelectedLinkId(event.currentTarget.value)}
                  disabled={activeLinks.length === 0}
                >
                  <option value="">Select an active pair</option>
                  {activeLinks.map((link) => (
                    <option key={link.id} value={link.id}>
                      @{link.ownerChannel.login} vs @{link.linkedChannel?.login}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Match title</span>
                <input
                  value={matchTitle}
                  onChange={(event) => setMatchTitle(event.currentTarget.value)}
                  placeholder="Gauntlet Finals"
                />
              </label>
              <div className="dashboard-form__split">
                <label className="dashboard-field">
                  <span>Slug</span>
                  <input
                    value={matchSlug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setMatchSlug(event.currentTarget.value);
                    }}
                    placeholder="gauntlet-finals"
                  />
                </label>
                <label className="dashboard-field">
                  <span>Target wins</span>
                  <input
                    type="number"
                    min="1"
                    value={targetWins}
                    onChange={(event) => setTargetWins(event.currentTarget.value)}
                    placeholder="3"
                  />
                </label>
              </div>
              <button
                className="dashboard-button dashboard-button--primary"
                type="submit"
                disabled={isMatchBusy || !selectedLinkId || matchTitle.trim().length < 3 || matchSlug.trim().length < 3}
              >
                Create match draft
              </button>
            </form>

            {matches.length > 0 ? (
              <div className="dashboard-match-list">
                {matches.map((match) => (
                  <article key={match.id} className="dashboard-match-card">
                    <div>
                      <p className="dashboard-match-card__eyebrow">{match.status}</p>
                      <h3 className="dashboard-match-card__title">{match.title}</h3>
                      <p className="dashboard-match-card__meta">
                        {match.players.map((player) => player.displayName).join(" vs ")}
                      </p>
                    </div>
                    <div className="dashboard-match-card__actions">
                      <span className="gg-chip gg-chip--soft">{match.targetWins ? `FT${match.targetWins}` : "Open mode"}</span>
                      <Link className="dashboard-link" to={`/control/${match.id}`}>
                        Open control room
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title="No matches drafted"
                body="As soon as a broadcaster invite is accepted, you can seed the title, slug, and target wins for the next set."
              />
            )}
          </section>
        </div>
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
