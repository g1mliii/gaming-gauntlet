import type { AuthSession, InviteStatus } from "@gaming-gauntlet/contracts";
import { PageShell } from "@gaming-gauntlet/ui";
import { useEffect, useEffectEvent, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { buildEdgeUrl, EdgeError, edgeFetchJson } from "../lib/edge";

const EMPTY_SESSION: AuthSession = {
  authenticated: false,
  user: null,
  ownedChannel: null,
  sharedBotConnected: false
};

function describeInviteError(code: string | null): string | null {
  switch (code) {
    case "invite_login_mismatch":
      return "That Twitch account does not match the invited broadcaster login.";
    case "invite_expired":
      return "That invite expired. Ask the owner to mint a new link.";
    case "invite_already_claimed":
      return "That invite was already claimed.";
    case "duplicate_channel_pair":
      return "That broadcaster pair is already linked.";
    case "oauth_callback_failed":
      return "Twitch sign-in did not complete. Try again.";
    default:
      return code ? code.replaceAll("_", " ") : null;
  }
}

export function LinkInvitePage() {
  const { inviteCode = "" } = useParams();
  const [search] = useSearchParams();
  const inviteErrorCode = search.get("inviteError");
  const [session, setSession] = useState<AuthSession>(EMPTY_SESSION);
  const [invite, setInvite] = useState<InviteStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(describeInviteError(inviteErrorCode));

  const loadInvite = useEffectEvent(async () => {
    setIsLoading(true);
    setInvite(null);

    try {
      const [nextSession, nextInvite] = await Promise.all([
        edgeFetchJson<AuthSession>("/api/auth/session"),
        edgeFetchJson<InviteStatus>(`/api/channel-links/invites/${inviteCode}`)
      ]);

      setSession(nextSession);
      setInvite(nextInvite);
      setIsLoading(false);
    } catch (error) {
      setPageError(error instanceof EdgeError ? error.code.replaceAll("_", " ") : "Failed to load invite");
      setIsLoading(false);
    }
  });

  useEffect(() => {
    setPageError(describeInviteError(inviteErrorCode));
  }, [inviteCode, inviteErrorCode]);

  useEffect(() => {
    void loadInvite();
  }, [inviteCode]);

  if (isLoading || !invite) {
    return (
      <PageShell
        eyebrow="Invite"
        title="Checking the rivalry pass"
        deck="Verifying the link code, the target Twitch login, and the current sign-in state."
        actions={<span className="gg-chip">Invite gate</span>}
      >
        <div className="dashboard-skeleton">
          <div className="dashboard-skeleton__bar" />
        </div>
      </PageShell>
    );
  }

  const inviteError = describeInviteError(inviteErrorCode);
  const signedInLogin = session.ownedChannel?.login ?? null;
  const isMatchingBroadcaster =
    session.authenticated && signedInLogin && invite.invitedChannelLogin
      ? signedInLogin === invite.invitedChannelLogin
      : false;

  return (
    <PageShell
      eyebrow="Broadcaster Invite"
      title={
        invite.status === "accepted"
          ? "The rivalry link is live"
          : invite.status === "expired"
            ? "This invite timed out"
            : invite.status === "not_found"
              ? "That invite code is gone"
              : "Claim the broadcaster slot"
      }
      deck="Invite acceptance is finished through Twitch sign-in so the app can prove the second channel really controls the invited login."
      actions={<span className="gg-chip">{invite.status}</span>}
    >
      <section className="invite-stage">
        <div className="invite-stage__hero">
          <p className="invite-stage__eyebrow">Owner channel</p>
          <h2 className="invite-stage__title">
            @{invite.ownerChannel?.login ?? "unknown"} <span>vs</span> @{invite.invitedChannelLogin ?? "unknown"}
          </h2>
          <p className="invite-stage__body">
            {invite.status === "accepted"
              ? `The pair is active${invite.claimedChannel ? ` and @${invite.claimedChannel.login} has already claimed the slot.` : "."}`
              : "Finish Twitch sign-in with the invited broadcaster account to activate the pair."}
          </p>
        </div>

        {search.get("invite") === "accepted" ? (
          <p className="dashboard-message dashboard-message--success" role="status" aria-live="polite">
            Invite accepted. The broadcaster pair is active in the dashboard.
          </p>
        ) : null}
        {inviteError || pageError ? (
          <p className="dashboard-message dashboard-message--warning" role="status" aria-live="polite">
            {inviteError ?? pageError}
          </p>
        ) : null}

        {invite.status === "not_found" ? (
          <InviteActionCard
            title="No live invite found"
            body="The code is invalid or has already been rotated out of the system."
            action={<Link className="dashboard-link" to="/dashboard">Return to dashboard</Link>}
          />
        ) : null}

        {invite.status === "expired" ? (
          <InviteActionCard
            title="Invite expired"
            body="The 24-hour claim window elapsed before the invited broadcaster authenticated."
            action={<Link className="dashboard-link" to="/dashboard">Ask for a new invite</Link>}
          />
        ) : null}

        {invite.status === "accepted" ? (
          <InviteActionCard
            title="Pair is active"
            body="The channel link is already claimed, so you can move straight into drafting or control-room setup."
            action={<Link className="dashboard-link" to="/dashboard">Open dashboard</Link>}
          />
        ) : null}

        {invite.status === "pending" && !session.authenticated ? (
          <InviteActionCard
            title="Authenticate with the invited Twitch account"
            body="Use the Twitch login for the invited broadcaster. The Worker claims the invite during the OAuth callback, not in the browser."
            action={
              <button
                className="dashboard-button dashboard-button--primary"
                type="button"
                onClick={() => {
                  window.location.assign(
                    buildEdgeUrl("/api/auth/twitch/login", {
                      intent: "invite",
                      inviteCode
                    })
                  );
                }}
              >
                Continue with Twitch
              </button>
            }
          />
        ) : null}

        {invite.status === "pending" && session.authenticated && !isMatchingBroadcaster ? (
          <InviteActionCard
            title="Wrong Twitch account"
            body={`You are signed in as @${signedInLogin ?? "unknown"}, but this invite is reserved for @${invite.invitedChannelLogin}.`}
            action={
              <button
                className="dashboard-button dashboard-button--primary"
                type="button"
                onClick={() => {
                  window.location.assign(
                    buildEdgeUrl("/api/auth/twitch/login", {
                      intent: "invite",
                      inviteCode
                    })
                  );
                }}
              >
                Switch Twitch account
              </button>
            }
          />
        ) : null}

        {invite.status === "pending" && session.authenticated && isMatchingBroadcaster ? (
          <InviteActionCard
            title="Confirm the broadcaster claim"
            body={`You are already signed in as @${signedInLogin}. Run the Twitch callback one more time to claim the invite with the verified broadcaster account.`}
            action={
              <button
                className="dashboard-button dashboard-button--primary"
                type="button"
                onClick={() => {
                  window.location.assign(
                    buildEdgeUrl("/api/auth/twitch/login", {
                      intent: "invite",
                      inviteCode
                    })
                  );
                }}
              >
                Confirm with Twitch
              </button>
            }
          />
        ) : null}
      </section>
    </PageShell>
  );
}

function InviteActionCard({
  title,
  body,
  action
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <article className="invite-card">
      <div>
        <p className="invite-card__eyebrow">Invite status</p>
        <h3 className="invite-card__title">{title}</h3>
        <p className="invite-card__body">{body}</p>
      </div>
      <div>{action}</div>
    </article>
  );
}
