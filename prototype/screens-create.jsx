// screens-create.jsx — Phase 5: Create page + management-passcode UX, polished.
// One shareable Match URL, passcode hidden by default, reveal/copy on explicit click.

const MASK = "GG-••••-••••-••••";

function CopyField({ label, value, onCopy }) {
  return (
    <div className="gg-stack" style={{ gap: "0.42rem" }}>
      {label ? <span style={{ fontFamily: "var(--gg-font-display)", fontWeight: 600, fontSize: "0.82rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gg-text-dim)" }}>{label}</span> : null}
      <div className="gg-share">
        <input readOnly value={value} onFocus={(e) => e.target.select()} />
        <KitButton type="button" onClick={onCopy}><Ico name="copy" className="gg-rail__ico" /> Copy</KitButton>
      </div>
    </div>
  );
}

function CreateScreen({ nav, toast }) {
  const [p1, setP1] = React.useState("");
  const [p2, setP2] = React.useState("");
  const [games, setGames] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [joinPass, setJoinPass] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [revealed, setRevealed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [joinErr, setJoinErr] = React.useState(null);

  const matchUrl = result ? `gaming-gauntlet.com/g/${result.lobbyId}` : "";

  function create(e) {
    e.preventDefault();
    setErr(null);
    if (!p1.trim() || !p2.trim()) { setErr("Both player names are required."); return; }
    setBusy(true);
    setTimeout(() => {
      const lobbyId = "lob_" + Math.random().toString(36).slice(2, 10);
      const code = "GG-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase() + "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();
      setResult({ type: "created", lobbyId, managementCode: code });
      setRevealed(false);
      setBusy(false);
    }, 650);
  }

  function join(e) {
    e.preventDefault();
    setJoinErr(null);
    if (!ref.trim()) { setJoinErr("Enter a valid match URL or lobby id."); return; }
    if (!joinPass.trim()) { setJoinErr("Management passcode is required."); return; }
    const lobbyId = ref.trim().split("/").filter(Boolean).pop();
    setResult({ type: "verified", lobbyId });
    toast("Passcode verified");
  }

  return (
    <div className="gg-content__inner">
      <PageShell
        eyebrow="Lobby setup"
        title="Create a match"
        deck="Spin up a two-player gauntlet, then share one match URL. The management passcode is yours alone — it never lands in a link."
        emphasis="section"
      />

      <div className="gg-create-grid">
        <KitPanel eyebrow="New match" title="Create">
          <form className="gg-form" onSubmit={create}>
            <div className="gg-form-pair">
              <KitTextField label="Player 1" maxLength={40} value={p1} onChange={(e) => setP1(e.target.value)} placeholder="NOVA" autoComplete="off" />
              <KitTextField label="Player 2" maxLength={40} value={p2} onChange={(e) => setP2(e.target.value)} placeholder="RIPTIDE" autoComplete="off" />
            </div>
            <KitTextareaField label="Starting games — one per line (optional)" rows={5} value={games} onChange={(e) => setGames(e.target.value)} placeholder={"Rocket League\nTetris\nStreet Fighter 6"} />
            <KitTextField label="Target score (optional)" type="number" min={1} max={99} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="5" hint="Leave blank for open mode — first to nothing, play forever." />
            <div className="gg-row">
              <KitButton type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create match"}</KitButton>
            </div>
            {err ? <KitNotice tone="warning" role="status">{err}</KitNotice> : null}
          </form>
        </KitPanel>

        <KitPanel eyebrow="Existing match" title="Join to manage">
          <form className="gg-form" onSubmit={join}>
            <KitTextField label="Match URL or ID" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="gaming-gauntlet.com/g/lob_8fk2n4qz" autoComplete="off" />
            <KitTextField label="Management passcode" value={joinPass} onChange={(e) => setJoinPass(e.target.value)} placeholder={MASK} autoComplete="off" />
            <div className="gg-row">
              <KitButton type="submit" variant="primary">Verify passcode</KitButton>
            </div>
            {joinErr ? <KitNotice tone="warning" role="status">{joinErr}</KitNotice> : null}
            <p className="gg-field__hint">Already created a match on this device? Your passcode is remembered automatically — just open the match room.</p>
          </form>
        </KitPanel>
      </div>

      {result ? (
        <KitPanel
          eyebrow={result.type === "created" ? "Created" : "Verified"}
          title="Match ready"
          actions={
            <>
              <KitButton variant="primary" onClick={() => nav("match")}>Open match room</KitButton>
              <KitButton variant="ghost" onClick={() => nav("manage")}>Manage this match</KitButton>
            </>
          }
        >
          <p className="gg-panel__summary" style={{ marginTop: 0 }}>Share the match URL with your opponent, chat, and OBS. Keep the passcode private — anyone with it can control the scoreboard.</p>
          <CopyField label="Match URL — the only link you share" value={matchUrl} onCopy={() => toast("Match URL copied")} />

          {result.type === "created" ? (
            <div className="gg-passcode">
              <div className="gg-spread">
                <div>
                  <p className="gg-passcode__label">Management passcode</p>
                  <p className={cx("gg-passcode__value", !revealed && "is-masked")}>{revealed ? result.managementCode : MASK}</p>
                </div>
                <div className="gg-row">
                  <KitButton type="button" variant="ghost" size="sm" aria-expanded={revealed} onClick={() => setRevealed((v) => !v)}>
                    <Ico name="eye" className="gg-rail__ico" /> {revealed ? "Hide" : "Reveal"}
                  </KitButton>
                  <KitButton type="button" size="sm" disabled={!revealed} onClick={() => { navigator.clipboard?.writeText(result.managementCode); toast("Passcode copied"); }}>
                    <Ico name="copy" className="gg-rail__ico" /> Copy
                  </KitButton>
                </div>
              </div>
              <KitNotice tone="warning" style={{ margin: 0 }}>Saved to this device. Store it somewhere safe — we only keep a hash, so we can’t recover it for you.</KitNotice>
            </div>
          ) : (
            <KitNotice tone="success" style={{ margin: 0 }}>Passcode verified and saved to this device. You’re cleared to manage the match.</KitNotice>
          )}
        </KitPanel>
      ) : null}
    </div>
  );
}

Object.assign(window, { CreateScreen });
