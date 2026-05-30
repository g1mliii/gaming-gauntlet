// app.jsx — prototype shell: nav rail, screen routing, Tweaks panel.

const NAV = [
  { group: "Setup flow" },
  { id: "create", label: "Create", ico: "create" },
  { id: "match", label: "Match room", ico: "match" },
  { group: "On stream" },
  { id: "overlays", label: "Overlays", ico: "overlay" },
];

const ACCENTS = {
  "Amber": "oklch(0.81 0.14 82)",
  "Cyan": "oklch(0.78 0.13 210)",
  "Violet": "oklch(0.72 0.15 300)",
  "Lime": "oklch(0.83 0.16 130)",
  "Rose": "oklch(0.72 0.16 12)",
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "oklch(0.81 0.14 82)",
  "wheelStyle": "radial",
  "teamMode": "alpha-bravo"
}/*EDITMODE-END*/;

const TEAM_MODES = {
  "alpha-bravo": ["oklch(0.73 0.17 48)", "oklch(0.8 0.1 170)"],
  "red-blue": ["oklch(0.66 0.2 25)", "oklch(0.66 0.15 250)"],
  "magenta-teal": ["oklch(0.68 0.2 340)", "oklch(0.78 0.12 185)"],
};

function Rail({ route, nav, unlocked }) {
  return (
    <nav className="gg-rail" aria-label="Primary">
      <div className="gg-rail__brand">
        <div className="gg-rail__mark">G</div>
        <div>
          <div className="gg-rail__brand-name">Gaming<br />Gauntlet</div>
          <span className="gg-rail__brand-sub">V1 · Phase 6–9</span>
        </div>
      </div>
      {NAV.map((item, i) =>
        item.group ? (
          <div className="gg-rail__group" key={`g${i}`}>{item.group}</div>
        ) : (
          <a key={item.id} className={cx("gg-rail__link", route === item.id && "is-active")} onClick={() => nav(item.id)}>
            <Ico name={item.ico} />
            {item.label}
          </a>
        )
      )}
    </nav>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState("match");
  const [unlocked, setUnlocked] = React.useState(false);
  const [toastMsg, setToastMsg] = React.useState(null);
  const { lobby, surface, actions } = useLobby();

  const nav = React.useCallback((r) => { setRoute(r); window.scrollTo({ top: 0 }); }, []);
  const toast = React.useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => setToastMsg(null), 1800);
  }, []);

  const [ta, tb] = TEAM_MODES[t.teamMode] || TEAM_MODES["alpha-bravo"];
  const rootStyle = {
    "--gg-accent": t.accent,
    "--gg-team-alpha": ta,
    "--gg-team-bravo": tb,
  };

  const centered = route === "create";
  const wheelStyle = t.wheelStyle === "radial" ? "radial" : "reel";
  const setWheelStyle = (v) => setTweak("wheelStyle", v);

  return (
    <div className="gg-app" style={rootStyle}>
      <Rail route={route} nav={nav} unlocked={unlocked} />
      <main className={cx("gg-content", centered && "gg-content--center")}>
        {route === "create" && <CreateScreen nav={nav} toast={toast} />}
        {route === "match" && <MatchScreen lobby={lobby} surface={surface} actions={actions} nav={nav} unlocked={unlocked} onUnlock={() => setUnlocked(true)} onLock={() => setUnlocked(false)} wheelStyle={wheelStyle} setWheelStyle={setWheelStyle} toast={toast} />}
        {route === "overlays" && <OverlaysScreen lobby={lobby} surface={surface} nav={nav} toast={toast} />}
      </main>

      {toastMsg ? <div className="gg-toast" role="status">{toastMsg}</div> : null}

      <TweaksPanel>
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={t.accent} options={Object.values(ACCENTS)} onChange={(v) => setTweak("accent", v)} />
        <TweakRadio label="Team colors" value={t.teamMode} options={["alpha-bravo", "red-blue", "magenta-teal"]} onChange={(v) => setTweak("teamMode", v)} />
        <TweakSection label="Wheel" />
        <TweakRadio label="Style" value={wheelStyle} options={["radial", "reel"]} onChange={(v) => setTweak("wheelStyle", v)} />
        <TweakSection label="Demo state" />
        <TweakButton label={unlocked ? "Lock controls" : "Unlock controls"} onClick={() => setUnlocked((v) => !v)} />
        <TweakButton label="Reset match data" secondary onClick={() => { localStorage.removeItem("gg_proto_lobby_v1"); location.reload(); }} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
