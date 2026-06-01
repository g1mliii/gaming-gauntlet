// screens-obs.jsx — the single "Overlays" screen. Merges the preview gallery and
// the copy-OBS-URL panel: each overlay shows a live transparent preview, its size,
// and a Copy URL button, with setup + troubleshooting beneath. Public, read-only;
// generated URLs never carry the management passcode.

function OverlayPreview({ ov, m, maxW = 340, maxH = 170 }) {
  const ref = React.useRef(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/offsetHeight report the element's UNTRANSFORMED layout size, so
    // measuring is independent of the scale we apply — no feedback loop. The graphic
    // is sized to its natural content, so this captures the full real layout, then
    // we shrink the whole thing uniformly to fit the card (never blow it up past 1).
    const fit = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w && h) setScale(Math.min(maxW / w, maxH / h, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxW, maxH]);
  return (
    <div style={{ position: "relative", width: maxW, height: maxH, overflow: "hidden" }}>
      <div
        ref={ref}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
          willChange: "transform",
        }}
      >
        <OverlayGraphic slug={ov.slug} m={m} />
      </div>
    </div>
  );
}

function OverlaysScreen({ lobby, surface, nav, toast }) {
  const base = `https://gaming-gauntlet.com/overlay/${lobby.lobbyId}`;
  return (
    <div className="gg-content__inner">
      <UrlBar path={`/overlay/${lobby.lobbyId}/…`} />

      <KitPanel eyebrow="On stream · OBS overlays" title="Add to OBS">
        <div className="gg-obs-guide">
          <div className="gg-obs-guide__col">
            <span className="gg-obs-guide__head">Setup</span>
            <ol className="gg-steps">
              <li>Copy an overlay URL below.</li>
              <li>In OBS: <b>Sources</b> → <b>+</b> → <b>Browser</b>.</li>
              <li>Paste the URL, set the listed width &amp; height.</li>
              <li>Click <b>OK</b> and drag it into place.</li>
            </ol>
          </div>
          <div className="gg-obs-guide__col">
            <span className="gg-obs-guide__head">Troubleshooting</span>
            <ul className="gg-steps" style={{ listStyle: "disc" }}>
              <li>Blank? Re-copy the full link and confirm the match still exists.</li>
              <li>Not updating? Right-click the source → <b>Refresh</b>.</li>
              <li>Not transparent? Remove any color source behind it.</li>
            </ul>
          </div>
        </div>
      </KitPanel>

      <div className="gg-grid-2">
        {OVERLAYS.map((ov) => (
          <div className="gg-overlay-card" key={ov.id}>
            <div className="gg-overlay-card__bar">
              <span className="gg-overlay-card__name">{ov.name}</span>
              <span className="gg-overlay-card__dim">{ov.w} × {ov.h}</span>
            </div>
            <div className="gg-overlay-card__stage gg-checker">
              <OverlayPreview ov={ov} m={surface} maxW={360} maxH={ov.id === "rail" ? 250 : ov.id === "square" ? 230 : ov.id === "full" ? 200 : 150} />
            </div>
            <div className="gg-overlay-card__foot">
              <span className="gg-overlay-card__desc" style={{ border: 0, padding: 0 }}>{ov.desc}</span>
              <div className="gg-obs-item__actions">
                <KitButton size="sm" onClick={() => { navigator.clipboard?.writeText(`${base}/${ov.slug}`); toast(`${ov.name} URL copied`); }}>
                  <Ico name="copy" className="gg-rail__ico" /> Copy URL
                </KitButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { OverlaysScreen, OverlayPreview });
