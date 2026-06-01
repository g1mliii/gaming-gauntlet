// screens-match.jsx — the single match-room page (/g/:lobbyId).
// Public by default: scores, the wheel, current pick, game pool.
// With the passcode it unlocks INLINE: spin + score steppers + game/settings editing.
// Live score and match settings are merged into one Scoreboard panel, so the
// spinner and game pool sit side by side. No separate "command center" route.

// ---------- compact horizontal scoreboard + settings (unlocked) ----------
function ScoreBar({ surface, actions }) {
  const teamBlock = (i, mod) => (
    <div className={cx("gg-scorebar__team", `gg-scorebar__team--${mod}`)}>
      <input
        className="gg-scorebar__name"
        value={surface.players[i].displayName}
        maxLength={40}
        onChange={(e) => actions.renamePlayer(i, e.target.value)}
        aria-label={`Player ${i + 1} name`}
      />
      <div className="gg-scorebar__ctrl">
        <button className="gg-scorebar__step" onClick={() => actions.setScore(i, -1)} aria-label="minus">–</button>
        <span className="gg-scorebar__score">{surface.players[i].wins}</span>
        <button className="gg-scorebar__step" onClick={() => actions.setScore(i, 1)} aria-label="plus">+</button>
      </div>
    </div>
  );
  return (
    <div className="gg-scorebar">
      {teamBlock(0, "alpha")}
      <div className="gg-scorebar__vs">
        <b>VS</b>
        <span>{surface.targetWins ? `First to ${surface.targetWins}` : "Open mode"}</span>
      </div>
      {teamBlock(1, "bravo")}
    </div>
  );
}

function ScoreboardPanel({ lobby, surface, actions }) {
  return (
    <KitPanel
      eyebrow="Live"
      title="Scoreboard"
    >
      <ScoreBar surface={surface} actions={actions} />
      <div className="gg-scorebar__meta">
        <label className="gg-field">
          <span>Set target score</span>
          <input
            type="number" min={0} max={99}
            value={lobby.targetScore || ""}
            onChange={(e) => actions.setTarget(e.target.value ? Number(e.target.value) : null)}
            placeholder="Open"
          />
        </label>
        <div className="gg-scorebar__meta-actions">
          <KitButton size="sm" variant="ghost" onClick={actions.resetScores}>Reset scores</KitButton>
          <KitButton size="sm" variant="ghost" onClick={actions.clearCurrentGame} disabled={!lobby.currentGameId}>Clear pick</KitButton>
          <KitButton size="sm" variant="danger" onClick={actions.resetMatch}>Reset match</KitButton>
        </div>
      </div>
    </KitPanel>
  );
}

// ---------- editable game pool (drag to reorder, drag to trash to delete) ----------
function GameRow({ game, index, total, isCurrent, actions, drag }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(game.title);
  function commit() { const v = draft.trim(); if (v) actions.renameGame(game.id, v); setEditing(false); }
  return (
    <div
      className={cx("gg-game", !game.enabled && "is-disabled", isCurrent && "is-current", drag.dragId === game.id && "is-dragging", drag.dragId === game.id && drag.outside && "is-removing", drag.overId === game.id && drag.dragId !== game.id && "is-over")}
      data-game-id={game.id}
      onPointerDown={(e) => drag.onStart(e, game.id, editing)}
    >
      <div className="gg-game__grip" title="Drag the row to reorder" aria-hidden="true" style={{ cursor: "grab", touchAction: "none" }}>
        <span></span><span></span><span></span>
      </div>
      <div className="gg-game__order">
        <button onClick={() => actions.moveGame(game.id, -1)} disabled={index === 0} aria-label="move up">▲</button>
        <button onClick={() => actions.moveGame(game.id, 1)} disabled={index === total - 1} aria-label="move down">▼</button>
      </div>
      <div className={cx("gg-toggle", game.enabled && "is-on")} role="switch" aria-checked={game.enabled} tabIndex={0} onClick={() => actions.toggleGame(game.id)} title={game.enabled ? "Enabled — in the pool" : "Disabled — skipped on spin"} />
      <div className="gg-game__title">
        {editing
          ? <input value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
          : <span onDoubleClick={() => { setDraft(game.title); setEditing(true); }}>{game.title}</span>}
      </div>
      <div className="gg-game__actions">
        {isCurrent ? <span className="gg-live-dot" role="img" aria-label="Live now" title="Live now"></span> : null}
        <KitButton size="sm" variant="ghost" onClick={() => { setDraft(game.title); setEditing(true); }}>Edit</KitButton>
        <KitButton size="sm" variant="danger" onClick={() => actions.removeGame(game.id)} aria-label="delete">✕</KitButton>
      </div>
    </div>
  );
}

function GamePoolEditor({ lobby, actions }) {
  const [adding, setAdding] = React.useState("");
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [outside, setOutside] = React.useState(false);
  const listRef = React.useRef(null);
  function add(e) { e.preventDefault(); const v = adding.trim(); if (v) { actions.addGame(v); setAdding(""); } }

  // Pointer-based drag-to-reorder — works in every browser/iframe and on touch,
  // unlike the flaky native HTML5 drag-and-drop. A small movement threshold lets
  // plain clicks / double-clicks on a row pass through untouched. The drop target
  // is tracked in plain closure vars (not React state) so the final action never
  // depends on a re-render having flushed first. Release OUTSIDE the list to delete.
  const beginDrag = (e, id, editing) => {
    if (editing) return;
    if (e.button != null && e.button !== 0) return;
    const tgt = e.target;
    const onGrip = tgt.closest && tgt.closest(".gg-game__grip");
    if (!onGrip && tgt.closest && tgt.closest('button, input, [role="switch"]')) return;

    const startX = e.clientX, startY = e.clientY;
    let active = false;
    let curOver = id;       // game id currently hovered
    let curOutside = false; // pointer is outside the list → release to delete

    const activate = () => {
      active = true;
      setDragId(id); setOverId(id); setOutside(false);
      document.body.style.userSelect = "none";
    };

    const move = (ev) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        activate();
      }
      const x = ev.clientX, y = ev.clientY;
      const list = listRef.current;
      const lr = list ? list.getBoundingClientRect() : null;
      // small margin so the very edge still counts as "inside"
      const inside = lr ? (x >= lr.left - 6 && x <= lr.right + 6 && y >= lr.top - 6 && y <= lr.bottom + 6) : true;
      if (!inside !== curOutside) { curOutside = !inside; setOutside(curOutside); }
      if (!inside) return; // outside: no reorder target, just primed for delete

      const rows = list ? Array.from(list.querySelectorAll("[data-game-id]")) : [];
      let target = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) { target = row.getAttribute("data-game-id"); break; }
      }
      if (target == null && rows.length) {
        const firstR = rows[0].getBoundingClientRect();
        target = y < firstR.top
          ? rows[0].getAttribute("data-game-id")
          : rows[rows.length - 1].getAttribute("data-game-id");
      }
      if (target && target !== curOver) { curOver = target; setOverId(target); }
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      if (active) {
        if (curOutside) actions.removeGame(id);
        else if (curOver && curOver !== id) actions.reorderGames(id, curOver);
      }
      setDragId(null); setOverId(null); setOutside(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const drag = { dragId, overId, outside, onStart: beginDrag };

  const enabledCount = lobby.games.filter((g) => g.enabled).length;
  return (
    <KitPanel eyebrow="Game pool" title="Games" actions={<KitChip tone="soft">{enabledCount}/{lobby.games.length} active</KitChip>}>
      <form className="gg-share" onSubmit={add}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a game…" maxLength={48} />
        <KitButton type="submit" variant="primary">Add</KitButton>
      </form>

      {lobby.games.length === 0 ? (
        <KitNotice style={{ margin: 0 }}>No games yet. Add a few above to fill the wheel.</KitNotice>
      ) : (
        <div className={cx("gg-games", dragId && "is-dragging-list", dragId && outside && "is-deleting")} ref={listRef}>
          {lobby.games.map((g, i) => (
            <GameRow key={g.id} game={g} index={i} total={lobby.games.length} isCurrent={g.id === lobby.currentGameId} actions={actions} drag={drag} />
          ))}
        </div>
      )}
      <p className={cx("gg-field__hint", dragId && outside && "gg-field__hint--danger")}>
        {dragId
          ? (outside ? "Release here to remove this game." : "Drag onto another row to reorder — or drag outside the list to remove.")
          : "Drag a row to reorder, or drag it outside the list to remove. Double-click a name to rename; toggle the switch to keep it out of the spin."}
      </p>
    </KitPanel>
  );
}

function GamePoolView({ lobby }) {
  const enabled = lobby.games.filter((g) => g.enabled);
  return (
    <KitPanel eyebrow="Game pool" title="In the running" actions={<KitChip tone="soft">{enabled.length} games</KitChip>}>
      <div className="gg-row">
        {enabled.length === 0
          ? <KitNotice style={{ margin: 0 }}>No games in the pool yet.</KitNotice>
          : enabled.map((g) => <KitChip key={g.id} tone={g.id === lobby.currentGameId ? "live" : "soft"}>{g.title}</KitChip>)}
      </div>
    </KitPanel>
  );
}

// ---------- compact control-room header (editable title, no subtitle) ----------
function MatchHeader({ lobby, actions, onLock, nav }) {
  return (
    <header className="gg-match-head">
      <div className="gg-match-head__title">
        <input
          className="gg-title-input"
          value={lobby.title}
          maxLength={60}
          onChange={(e) => actions.setTitle(e.target.value)}
          aria-label="Match title"
        />
      </div>
      <div className="gg-shell__actions">
        <KitButton variant="ghost" onClick={() => nav("overlays")}><Ico name="obs" className="gg-rail__ico" /> Add to OBS</KitButton>
      </div>
    </header>
  );
}

// ---------- the match-room control surface (locked behind passcode) ----------
function MatchScreen({ lobby, surface, actions, nav, unlocked, onUnlock, onLock, wheelStyle, setWheelStyle, toast }) {
  const [pass, setPass] = React.useState("");
  const [bad, setBad] = React.useState(false);
  const [spinSignal, setSpinSignal] = React.useState(0);
  const [spinning, setSpinning] = React.useState(false);
  const enabled = lobby.games.filter((g) => g.enabled);

  function verify(e) {
    e.preventDefault();
    if (pass.trim().toUpperCase() === lobby.managementCode.toUpperCase() || pass.trim().length >= 6) {
      setBad(false); onUnlock(); setPass(""); toast("Controls unlocked");
    } else { setBad(true); }
  }
  function spin() {
    if (enabled.length === 0 || spinning) return;
    setSpinning(true); setSpinSignal((s) => s + 1);
  }
  function onResult(game) { setSpinning(false); actions.setCurrentGame(game.id); toast(`Spun: ${game.title}`); }

  // LOCKED — basically empty, just the passcode gate
  if (!unlocked) {
    return (
      <div className="gg-content__inner">
        <UrlBar path={`/g/${lobby.lobbyId}`} note="Streamer & mod control room — passcode required" />
        <div className="gg-lockscreen">
          <KitPanel className="gg-lockcard" eyebrow="Control room" title="Locked">
            <Ico name="lock" className="gg-lock-ico" />
            <p className="gg-panel__summary" style={{ margin: 0, textAlign: "center" }}>
              This room is for streamers and mods. Enter the management passcode to take control. Viewers watch the match through your OBS overlays — not here.
            </p>
            <form onSubmit={verify}>
              <KitTextField label="Management passcode" value={pass} onChange={(e) => { setPass(e.target.value); setBad(false); }} placeholder="GG-••••-••••-••••" error={bad ? "That passcode didn’t match. Try again." : null} autoFocus />
              <KitButton type="submit" variant="primary" block>Unlock controls</KitButton>
            </form>
            <p className="gg-field__hint" style={{ textAlign: "center" }}>Demo: any 6+ character code unlocks. The real passcode is <b>{lobby.managementCode}</b>.</p>
          </KitPanel>
        </div>
      </div>
    );
  }

  // UNLOCKED — the control room
  return (
    <div className="gg-content__inner">
      <MatchHeader lobby={lobby} actions={actions} onLock={onLock} nav={nav} />

      <ScoreboardPanel lobby={lobby} surface={surface} actions={actions} />

      <div className="gg-board-grid">
        <KitPanel eyebrow="The gauntlet" title="Spin to pick" actions={
          <div className="gg-row" style={{ gap: "0.5rem" }}>
            <div className="gg-seg" role="tablist" aria-label="Wheel style">
              <button className={cx(wheelStyle === "radial" && "is-active")} onClick={() => setWheelStyle("radial")}>Radial</button>
              <button className={cx(wheelStyle !== "radial" && "is-active")} onClick={() => setWheelStyle("reel")}>Reel</button>
            </div>
            <KitChip tone={spinning ? "live" : "soft"}>{spinning ? "Spinning" : `${enabled.length} games`}</KitChip>
          </div>
        }>
          <div className="gg-wheel-stage">
            <Wheel games={lobby.games} style={wheelStyle} spinSignal={spinSignal} onResult={onResult} />
            <div className="gg-row" style={{ justifyContent: "center" }}>
              <KitButton variant="primary" onClick={spin} disabled={spinning || enabled.length === 0}>{spinning ? "Spinning…" : "Spin the gauntlet"}</KitButton>
            </div>
          </div>
          <div className="gg-pick">
            <p className="gg-pick__label">{spinning ? "Spinning…" : lobby.currentGameId ? "Now playing" : "No pick yet"}</p>
            <p className={cx("gg-pick__title", !lobby.currentGameId && "is-empty")}>{spinning ? "—" : currentGameTitle(surface)}</p>
          </div>
        </KitPanel>

        <GamePoolEditor lobby={lobby} actions={actions} />
      </div>
    </div>
  );
}

function UrlBar({ path, note }) {
  return (
    <div className="gg-urlbar">
      <span className="gg-urlbar__dot" />
      <span className="gg-urlbar__url">gaming-gauntlet.com<b>{path}</b></span>
      {note ? <span className="gg-urlbar__url" style={{ marginLeft: "auto", opacity: 0.7 }}>{note}</span> : null}
    </div>
  );
}

Object.assign(window, { MatchScreen, ScoreBar, ScoreboardPanel, GamePoolEditor, GamePoolView, MatchHeader, UrlBar });
