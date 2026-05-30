// kit.jsx — Gaming Gauntlet UI kit primitives, ported from packages/ui to plain JSX.
// Mirrors KitButton / KitChip / KitPanel / KitCard / KitNotice / KitTextField /
// KitTextareaField / PageShell / ScoreBug so screens read like the real codebase.

const cx = (...names) => names.filter(Boolean).join(" ");

function KitButton({ className, variant = "default", size, block, ...props }) {
  return (
    <button
      className={cx(
        "gg-button",
        variant !== "default" && `gg-button--${variant}`,
        size && `gg-button--${size}`,
        block && "gg-button--block",
        className
      )}
      {...props}
    />
  );
}

function KitChip({ className, tone = "default", ...props }) {
  return <span className={cx("gg-chip", tone !== "default" && `gg-chip--${tone}`, className)} {...props} />;
}

function KitPanel({ eyebrow, title, summary, actions, transparent, flush, className, children, ...props }) {
  const hasHeader = eyebrow || title || summary || actions;
  return (
    <section
      className={cx("gg-panel", transparent && "gg-panel--transparent", flush && "gg-panel--flush", className)}
      {...props}
    >
      {hasHeader ? (
        <div className="gg-panel__header">
          <div>
            {eyebrow ? <p className="gg-panel__eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="gg-panel__title">{title}</h2> : null}
            {summary ? <p className="gg-panel__summary">{summary}</p> : null}
          </div>
          {actions ? <div className="gg-action-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function KitCard({ eyebrow, title, actions, className, children, ...props }) {
  const hasHeader = eyebrow || title || actions;
  return (
    <article className={cx("gg-card", className)} {...props}>
      {hasHeader ? (
        <div className="gg-card__header">
          <div>
            {eyebrow ? <p className="gg-card__eyebrow">{eyebrow}</p> : null}
            {title ? <h3 className="gg-card__title">{title}</h3> : null}
          </div>
          {actions ? <div className="gg-action-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

function KitNotice({ className, tone = "default", ...props }) {
  return <p className={cx("gg-notice", tone !== "default" && `gg-notice--${tone}`, className)} {...props} />;
}

function KitTextField({ className, error, hint, label, ...props }) {
  return (
    <label className={cx("gg-field", className)}>
      {label ? <span>{label}</span> : null}
      <input aria-invalid={error ? "true" : undefined} {...props} />
      {hint && !error ? <p className="gg-field__hint">{hint}</p> : null}
      {error ? <p className="gg-field__error">{error}</p> : null}
    </label>
  );
}

function KitTextareaField({ className, error, label, ...props }) {
  return (
    <label className={cx("gg-field", className)}>
      {label ? <span>{label}</span> : null}
      <textarea aria-invalid={error ? "true" : undefined} {...props} />
      {error ? <p className="gg-field__error">{error}</p> : null}
    </label>
  );
}

function PageShell({ eyebrow, title, deck, actions, emphasis = "hero", tone = "default", children }) {
  const TitleTag = emphasis === "hero" ? "h1" : "h2";
  return (
    <section className={cx("gg-shell", `gg-shell--${tone}`, `gg-shell--${emphasis}`)}>
      <header className="gg-shell__header">
        <div>
          {eyebrow ? <p className="gg-shell__eyebrow">{eyebrow}</p> : null}
          {title ? <TitleTag className="gg-shell__title">{title}</TitleTag> : null}
          {deck ? <p className="gg-shell__deck">{deck}</p> : null}
        </div>
        {actions ? <div className="gg-shell__actions">{actions}</div> : null}
      </header>
      {children ? <div className="gg-shell__body">{children}</div> : null}
    </section>
  );
}

function currentGameTitle(match) {
  if (match.currentGame && match.currentGame.title) return match.currentGame.title;
  const g = (match.games || []).find((x) => x.id === match.currentGameId);
  return g ? g.title : "Waiting for next pick";
}

function ScoreBug({ match, transparent = false }) {
  const [left, right] = match.players;
  if (!left || !right) {
    return (
      <section className={cx("gg-scorebug", transparent && "gg-scorebug--transparent")}>
        <div className="gg-scorebug__footer"><span>Waiting for both streamers to join.</span></div>
      </section>
    );
  }
  return (
    <section className={cx("gg-scorebug", transparent && "gg-scorebug--transparent")}>
      <div className="gg-scorebug__meta">
        <span className="gg-scorebug__title">{match.title}</span>
        {match.status === "live" ? <KitChip tone="live">Live</KitChip> : <KitChip tone="soft">{match.status || "Ready"}</KitChip>}
      </div>
      <div className="gg-scorebug__line">
        <article className="gg-scorebug__player gg-scorebug__player--left">
          <p className="gg-scorebug__label">{left.displayName}</p>
          <p className="gg-scorebug__score">{left.wins}</p>
        </article>
        <div className="gg-scorebug__versus">vs</div>
        <article className="gg-scorebug__player gg-scorebug__player--right">
          <p className="gg-scorebug__label">{right.displayName}</p>
          <p className="gg-scorebug__score">{right.wins}</p>
        </article>
      </div>
      <div className="gg-scorebug__footer">
        <span className="gg-scorebug__meta-label">Current game</span>
        <strong className="gg-scorebug__current-game">{currentGameTitle(match)}</strong>
        <span className="gg-scorebug__meta-label gg-scorebug__meta-label--right">
          {match.targetWins ? `First to ${match.targetWins}` : "Open mode"}
        </span>
      </div>
    </section>
  );
}

// tiny inline icons (stroke) for the nav rail + buttons
function Ico({ name, className = "gg-rail__ico" }) {
  const paths = {
    create: <path d="M12 5v14M5 12h14" />,
    match: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 10h18M9 5v14" /></>,
    manage: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
    wheel: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></>,
    overlay: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M3 16l4 4h10l4-4" /></>,
    obs: <><rect x="3" y="4" width="18" height="14" rx="1" /><path d="M8 21h8M12 18v3M7 9l3 3-3 3M13 15h4" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" /></>,
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

Object.assign(window, {
  cx, KitButton, KitChip, KitPanel, KitCard, KitNotice,
  KitTextField, KitTextareaField, PageShell, ScoreBug, Ico, currentGameTitle,
});
