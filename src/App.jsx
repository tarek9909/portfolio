import { Fragment, useEffect, useRef, useState } from "react";
import { CHOICES, detectQuality, setChoice } from "./quality.js";
import { DATA, KIND, N, SITE, pad } from "./data.js";
import { SECTIONS, SECTION_OF, STOPS, END_S } from "./course.js";

function copyText(text, el) {
  const done = () => {
    if (el) {
      const o = el.textContent;
      el.textContent = "Copied";
      setTimeout(() => { el.textContent = o; }, 1400);
    }
  };
  const sel = () => {
    const n = el && el.parentElement && el.parentElement.querySelector("span");
    if (!n) return;
    const r = document.createRange();
    r.selectNodeContents(n);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  try { navigator.clipboard.writeText(text).then(done, sel); } catch (e) { sel(); }
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*/<>";

/* Decodes the text from random glyphs, left to right, like a split-flap board */
function Scramble({ text, duration = 700 }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setOut(text); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const fixed = Math.floor(p * text.length);
      let s = text.slice(0, fixed);
      for (let k = fixed; k < text.length; k++) s += text[k] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);
  return <span aria-label={text}>{out}</span>;
}

/* Splits a heading into letters that rise in one by one */
function Letters({ text }) {
  return (
    <span aria-label={text}>
      {text.split("").map((ch, k) => (
        <span key={k} className="ch" style={{ "--i": k }} aria-hidden="true">{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}

function Gear({ dir, speed }) {
  const g = speed < 2 ? "P" : dir < 0 ? "R" : dir > 0 ? "D" : "N";
  return (
    <div className="gear" aria-label={"Gear " + g}>
      {["P", "R", "N", "D"].map((x) => <span key={x} className={x === g ? "on" + (x === "R" ? " rev" : "") : ""}>{x}</span>)}
    </div>
  );
}

/* Minimap: the whole road network, north up, with the car's position and heading */
function Minimap({ map, x, z, h, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !map) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), S = 168;
    if (c.width !== S * dpr) { c.width = S * dpr; c.height = S * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const [x0, z0, x1, z1] = map.bounds, pad = 10;
    const k = Math.min((S - 2 * pad) / (x1 - x0), (S - 2 * pad) / (z1 - z0));
    const ox = (S - (x1 - x0) * k) / 2, oz = (S - (z1 - z0) * k) / 2;
    const P = (px, pz) => [ox + (px - x0) * k, oz + (pz - z0) * k];
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = "rgba(190,205,240,.45)"; g.lineWidth = 2.4;
    g.beginPath(); map.road.forEach(([px, pz], i) => { const [a, b] = P(px, pz); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
    map.links.forEach(([ax, az, bx, bz, kind]) => {
      g.strokeStyle = kind === "bridge" ? "rgba(143,214,192,.6)" : "rgba(190,205,240,.35)"; g.lineWidth = 2;
      const [a, b] = P(ax, az), [c2, d] = P(bx, bz); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
    });
    map.stops.forEach(([px, pz], i) => {
      const [a, b] = P(px, pz); g.fillStyle = i === active ? "#ffb15e" : "rgba(255,177,94,.45)";
      g.beginPath(); g.arc(a, b, i === active ? 3 : 1.8, 0, Math.PI * 2); g.fill();
    });
    const [cx, cz] = P(x, z);
    g.save(); g.translate(cx, cz); g.rotate(h);
    g.fillStyle = "#fff"; g.shadowColor = "#a9c6ff"; g.shadowBlur = 8;
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(0, 2); g.lineTo(-4, 4); g.closePath(); g.fill();
    g.restore();
  }, [map, x, z, h, active]);
  return <canvas className="minimap" ref={ref} style={{ width: 168, height: 168 }} aria-label="Map of the drive" />;
}

/* Touch controls: hold to accelerate, brake/reverse and steer (shown on touch screens only) */
function Pedals({ press }) {
  const bind = (k) => ({
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(k, true); },
    onPointerUp: () => press(k, false),
    onPointerCancel: () => press(k, false),
    onContextMenu: (e) => e.preventDefault(),
  });
  return (
    <div className="pedals" aria-label="Driving controls">
      <div className="steer">
        <button {...bind("left")} aria-label="Steer left">◀</button>
        <button {...bind("right")} aria-label="Steer right">▶</button>
      </div>
      <div className="feet">
        <button className="brake" {...bind("down")} aria-label="Brake and reverse">BRAKE</button>
        <button className="gas" {...bind("up")} aria-label="Accelerate">GAS</button>
      </div>
    </div>
  );
}

function Details({ it }) {
  const acc = KIND[it.kind];
  const chips = it.tags || it.links;
  return (
    <Fragment>
      {it.body && !it.contact && <p className="body">{it.body}</p>}
      {it.groups && (
        <div className="groups">
          {it.groups.map(([h, l]) => (
            <div key={h}>
              <h4 style={{ color: acc }}>{h}</h4>
              <div className="tags" style={{ marginTop: 0 }}>
                {l.map((s, k) => <span className="tag" key={s} style={{ "--i": k }}>{s}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {it.list && (
        <ul className="list">
          {it.list.map((s, k) => <li key={s} style={{ "--i": k }}><span>{pad(k + 1)}</span>{s}</li>)}
        </ul>
      )}
      {it.contact && (
        <div className="contact">
          <div className="crow">
            <span>{it.contact.email}</span>
            <button className="copy" onClick={(e) => copyText(it.contact.email, e.currentTarget)}>Copy</button>
          </div>
          <div className="crow">
            <span>{it.contact.phone}</span>
            <button className="copy" onClick={(e) => copyText(it.contact.phone.replace(/\s/g, ""), e.currentTarget)}>Copy</button>
          </div>
          <p className="body" style={{ marginTop: 6 }}>{it.body}</p>
        </div>
      )}
      {chips && (
        <div className="tags">
          {chips.map((s, k) => <span className="tag" key={s} style={{ "--i": k }}>{s}</span>)}
        </div>
      )}
    </Fragment>
  );
}

function Card({ it, i, off, nav }) {
  const acc = KIND[it.kind];
  return (
    <aside className={"card" + (off ? " off" : "")} data-scroll aria-live="polite" style={{ "--acc": acc }}>
      <div className="chead">
        <span>No. {pad(i + 1)} / {pad(N)} · {SECTIONS[SECTION_OF[i]].title}</span>
        <span style={{ color: acc }}>{it.kind}</span>
      </div>
      <h3><Scramble text={it.title} /></h3>
      <p className="sub" style={{ color: acc }}>{it.subtitle}</p>
      {it.period && <p className="period">{it.period}</p>}
      <Details it={it} />
      <div className="cnav">
        <button onClick={() => nav(-1)} disabled={i === 0} aria-label="Previous stop">← Prev</button>
        <button onClick={() => nav(1)} disabled={i === N - 1} aria-label="Next stop">Next →</button>
      </div>
    </aside>
  );
}

/** One billboard, opened by clicking it on the road. */
function Board({ i, close, go, pick }) {
  const it = DATA[i], acc = KIND[it.kind];
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && i < N - 1) pick(i + 1);
      else if (e.key === "ArrowLeft" && i > 0) pick(i - 1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [i]);
  return (
    <div className="board" data-scroll role="dialog" aria-modal="true" aria-label={it.title} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <article className="item boardin" key={i} style={{ "--acc": acc }}>
        <div className="chead">
          <span>No. {pad(i + 1)} / {pad(N)} · {SECTIONS[SECTION_OF[i]].title}</span>
          <span style={{ color: acc }}>{it.kind}</span>
        </div>
        <h3>{it.title}</h3>
        <p className="sub" style={{ color: acc }}>{it.subtitle}</p>
        {it.period && <p className="period">{it.period}</p>}
        <Details it={it} />
        <div className="cnav">
          <button onClick={() => pick(i - 1)} disabled={i === 0} aria-label="Previous billboard">← Prev</button>
          <button className="go" onClick={() => go(i)}>Drive here →</button>
          <button onClick={() => pick(i + 1)} disabled={i === N - 1} aria-label="Next billboard">Next →</button>
        </div>
        <button className="tbtn bclose" onClick={close} aria-label="Close">Close</button>
      </article>
    </div>
  );
}

function Gauge({ v }) {
  const r = 19, c = 2 * Math.PI * r, arc = c * 0.75, f = Math.min(1, v / 240);
  return (
    <div className="gauge" aria-label={Math.round(v) + " kilometres per hour"}>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(190,205,240,.18)" strokeWidth="2" strokeDasharray={arc + " " + c} transform="rotate(135 24 24)" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#ffb15e" strokeWidth="2" strokeDasharray={arc * f + " " + c} transform="rotate(135 24 24)" style={{ transition: "stroke-dasharray .2s" }} />
      </svg>
      <div>
        <div className="gnum">{String(Math.round(v)).padStart(3, "0")}</div>
        <div className="gunit">km/h</div>
      </div>
    </div>
  );
}

function Catalogue({ close, go, noGL, try3D }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  return (
    <div className="cat" data-scroll role="dialog" aria-modal="true" aria-label="Full catalogue">
      <div className="catin">
        <div className="cathead">
          <div>
            <div className="eyebrow">Catalogue · {N} entries</div>
            <h2>Everything on the road</h2>
          </div>
          {noGL
            ? <button className="tbtn" onClick={try3D}>Try 3D anyway</button>
            : <button className="tbtn" onClick={close}>Close</button>}
        </div>
        {noGL && <p className="nogl">The 3D drive is off because this browser has no graphics acceleration. Everything is listed below.</p>}
        <div className="grid">
          {DATA.map((it, i) => (
            <article className="item" key={i} style={{ "--i": i, "--acc": KIND[it.kind] }}>
              <div className="chead">
                <span>No. {pad(i + 1)}</span>
                <span style={{ color: KIND[it.kind] }}>{it.kind}</span>
              </div>
              <h3>{it.title}</h3>
              <p className="sub" style={{ color: KIND[it.kind] }}>{it.subtitle}</p>
              {it.period && <p className="period">{it.period}</p>}
              <Details it={it} />
              {!noGL && <button className="go" onClick={() => go(i)}>Drive here →</button>}
            </article>
          ))}
        </div>
        <p className="credit">
          Car: <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noopener noreferrer">Ferrari 458 Italia</a> model by vicent091036, CC BY 4.0.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [st, setSt] = useState({ dist: 0, active: 0, speed: 0, dir: 0, zone: null, zoneScene: null, zoneNo: 0, manual: false, bump: false, carX: 0, carZ: 0, carH: 0 });
  const [load, setLoad] = useState(0.05);
  const [ready, setReady] = useState(false);
  const [cat, setCat] = useState(false);
  const [board, setBoard] = useState(null);   // billboard opened by clicking it
  const [noGL, setNoGL] = useState(false);
  const host = useRef(null);
  const railList = useRef(null);
  const eng = useRef(null);
  const [q] = useState(detectQuality);
  const [tier, setTier] = useState(q.tier);   // the engine may step down after its boot benchmark
  // cycling Auto → High → Low rebuilds the scene, so the simplest honest way is a reload
  const cycleQuality = () => { setChoice(CHOICES[(CHOICES.indexOf(q.choice) + 1) % CHOICES.length]); location.reload(); };

  useEffect(() => {
    let e = null, gone = false;
    const fail = (err) => { console.error(err); setNoGL(true); setReady(true); setCat(true); };
    if (q.tier === "none") { fail(new Error("no hardware WebGL")); return; }
    // the engine (and three.js) is its own chunk, so the loader paints before it downloads and parses
    import("./engine.js").then(({ createEngine }) => {
      if (gone) return;
      e = createEngine(host.current, setSt, setLoad, (t) => { setTier(t); setReady(true); }, { tier: q.tier, forced: q.choice !== "auto", onPick: setBoard });
      eng.current = e;
    }).catch(fail);
    return () => { gone = true; if (e) e.dispose(); };
  }, []);

  useEffect(() => { if (eng.current) eng.current.setInput(!cat && board === null); }, [cat, board]);

  // keep the current stop visible in the catalogue rail when the list is longer than its box
  useEffect(() => {
    const ol = railList.current;
    if (!ol) return;
    ol.classList.toggle("scrolls", ol.scrollHeight > ol.clientHeight + 1);
    const li = ol.children[st.active];
    if (li) {
      const top = li.offsetTop - ol.offsetTop, bottom = top + li.offsetHeight;
      if (top < ol.scrollTop || bottom > ol.scrollTop + ol.clientHeight) ol.scrollTo({ top: top - ol.clientHeight / 2, behavior: "smooth" });
    }
  }, [st.active]);

  const go = (i) => { setCat(false); setBoard(null); if (eng.current) eng.current.goTo(i); };
  const nav = (d) => { if (eng.current) eng.current.step(d); };
  const intro = st.dist < 22;
  const it = DATA[st.active];

  return (
    <div className={"app" + (intro ? " intro" : "") + (ready ? " ready" : "") + (st.speed > 150 ? " fast" : "")}>
      <div className="stage" ref={host}></div>
      <div className="bar top"></div>
      <div className="bar bottom"></div>
      {st.zone && (
        <div className="zone" key={st.zone} aria-live="polite">
          <span className="zone-kicker">Section {pad(st.zoneNo)} · {st.zoneScene}</span>
          <span className="zone-name"><Letters text={st.zone} /></span>
          <i className="zone-rule"></i>
        </div>
      )}
      {!intro && !st.zone && (
        <div className="toast" key={"toast-" + st.active} aria-hidden="true" style={{ "--acc": KIND[it.kind] }}>
          <span>Now passing</span><b>{it.kind}</b><i>{pad(st.active + 1)}</i>
        </div>
      )}
      <header className="top">
        <div className="brand">
          <div className="mark">{SITE.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
          <div><b>{SITE.name}</b>{SITE.role && <span> · {SITE.role}</span>}</div>
        </div>
        <nav className="tbtns">
          <button className="tbtn" onClick={() => setCat(true)}>Catalogue</button>
          <button className="tbtn" onClick={() => go(N - 1)}>Contact</button>
          <button className="tbtn" onClick={cycleQuality} title={"Graphics quality" + (q.gpu ? " · " + q.gpu : "")}>
            <span className="qlbl">Quality: </span>{q.choice === "auto" ? "Auto" : q.choice === "high" ? "High" : "Low"}{q.choice === "auto" && tier !== "none" ? " (" + tier + ")" : ""}
          </button>
        </nav>
      </header>
      <section className={"hero" + (intro ? "" : " off")}>
        <div className="eyebrow">No. 01 · {SITE.eyebrow}</div>
        <h1><Letters text={SITE.name} /></h1>
        <p>{SITE.intro}</p>
        <div className="cue"><i></i>Scroll to drive</div>
      </section>
      <nav className={"rail" + (intro ? " dim" : "")} aria-label="Catalogue stops">
        <h2>Catalogue</h2>
        <ol ref={railList} data-scroll>
          {DATA.map((d, i) => (
            <li key={i} style={{ "--i": i }}>
              <button className={i === st.active ? "on" : ""} onClick={() => go(i)} aria-current={i === st.active ? "step" : undefined}>
                <span className="mono">{pad(i + 1)}</span><span>{d.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <Card key={"card-" + st.active} it={it} i={st.active} off={intro} nav={nav} />
      <footer className="hud">
        <div className="dash">
          <Gauge v={st.speed} />
          <Gear dir={st.dir} speed={st.speed} />
          <span className={"mode" + (st.manual ? " on" : "")}>{st.manual ? "Driving" : "Autopilot"}</span>
        </div>
        <div className="track">
          <div className="base"></div>
          <div className="fill" style={{ width: Math.min(100, (st.dist / END_S) * 100) + "%" }}></div>
          {SECTIONS.map((sec, k) => sec.scene && (
            <span
              key={sec.title}
              className={"seclabel" + (SECTION_OF[st.active] === k ? " on" : "")}
              style={{ left: (STOPS[sec.items[0]] / END_S) * 100 + "%" }}
            >{sec.title}</span>
          ))}
          {DATA.map((d, i) => (
            <button
              key={i}
              className={"tick" + (i === st.active ? " on" : "") + (STOPS[i] < st.dist - 1 ? " past" : "")}
              style={{ left: (STOPS[i] / END_S) * 100 + "%" }}
              onClick={() => go(i)}
              aria-label={"Drive to " + d.title}
            />
          ))}
        </div>
        <div className="hint">
          <span className="txt">↑↓ drive · ←→ steer</span>
          <span className="odo"><span className="roll" key={st.active}>{pad(st.active + 1)}</span> / {pad(N)}</span>
        </div>
      </footer>
      <Pedals press={(k, d) => eng.current && eng.current.press(k, d)} />
      {ready && eng.current && <Minimap map={eng.current.map} x={st.carX} z={st.carZ} h={st.carH} active={st.active} />}
      {st.bump && <div className="bump" aria-hidden="true"></div>}
      {board !== null && <Board i={board} close={() => setBoard(null)} go={go} pick={(i) => setBoard(Math.max(0, Math.min(N - 1, i)))} />}
      {cat && <Catalogue close={() => { if (!noGL) setCat(false); }} go={go} noGL={noGL} try3D={() => { setChoice("low"); location.reload(); }} />}
      <div className={"loader" + (ready ? " done" : "")} aria-hidden={ready}>
        <div className="lin">
          <div className="eyebrow">Starting the engine</div>
          <div className="lnum">{Math.round(load * 100)}%</div>
          <div className="lbar"><i style={{ width: load * 100 + "%" }}></i></div>
          <div className="lroad" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  );
}
