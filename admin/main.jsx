/* /admin: edit the CV in the database (dev server only). "Apply to site" saves and reloads any open tab of the site. */
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { SCENES, LIMITS, check, sceneFor, sideFor } from "../server/rules.js";
import "./admin.css";

const pad = (n) => String(n).padStart(2, "0");
const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TABS = [["entries", "Entries"], ["categories", "Categories"], ["sections", "Sections"], ["site", "Site"]];

/* ---------- small inputs ---------- */

function Field({ label, hint, children, wide }) {
  return (
    <label className={"field" + (wide ? " wide" : "")}>
      <span className="flabel">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}

/** Tags as chips: Enter or comma adds, Backspace on an empty box removes the last. */
function Chips({ value, onChange, placeholder, id }) {
  const [draft, setDraft] = useState("");
  const add = (raw) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  return (
    <div className="chips" onClick={(e) => e.currentTarget.querySelector("input").focus()}>
      {value.map((t, i) => (
        <span className="chip" key={t}>
          {t}
          <button type="button" aria-label={"Remove " + t} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <input
        id={id} value={draft} placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(draft); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}

function Issues({ list, kind }) {
  if (!list.length) return null;
  return <ul className={"issues " + kind}>{list.map((x, i) => <li key={i}>{x.msg}</li>)}</ul>;
}

function MoveButtons({ up, down, label }) {
  return (
    <span className="move">
      <button type="button" onClick={up} disabled={!up} aria-label={"Move " + label + " up"}>↑</button>
      <button type="button" onClick={down} disabled={!down} aria-label={"Move " + label + " down"}>↓</button>
    </span>
  );
}

/* ---------- entries ---------- */

/** The card as it appears on the site, so changes can be judged before applying. */
function Preview({ e, cat, no, total, section }) {
  const acc = cat?.color || "#a9c6ff";
  const chips = [...(e.tags || []), ...(e.links || [])];
  return (
    <aside className="preview" style={{ "--acc": acc }} aria-label="Card preview">
      <div className="pv-head"><span>No. {pad(no)} / {pad(total)} · {section?.title}</span><span style={{ color: acc }}>{cat?.name}</span></div>
      <h3>{e.title || "Untitled"}</h3>
      {e.subtitle && <p className="pv-sub" style={{ color: acc }}>{e.subtitle}</p>}
      {e.period && <p className="pv-period">{e.period}</p>}
      {e.body && !e.contact && <p className="pv-body">{e.body}</p>}
      {e.groups?.length > 0 && (
        <div className="pv-groups">
          {e.groups.map((g, i) => <div key={i}><h4 style={{ color: acc }}>{g.heading}</h4><p>{(g.items || []).join(" · ")}</p></div>)}
        </div>
      )}
      {e.list?.length > 0 && <ol className="pv-list">{e.list.map((s, i) => <li key={i}><span>{pad(i + 1)}</span>{s}</li>)}</ol>}
      {e.contact && (
        <div className="pv-contact"><b>{e.contact.email}</b><span>{e.contact.phone}</span>{e.body && <p className="pv-body">{e.body}</p>}</div>
      )}
      {chips.length > 0 && <div className="pv-chips">{chips.map((t) => <span key={t}>{t}</span>)}</div>}
    </aside>
  );
}

function EntryEditor({ e, c, setC, update, remove, issues }) {
  const set = (patch) => update({ ...e, ...patch });
  const [newCat, setNewCat] = useState(null);   // {name, color} while adding a category from here
  const catTaken = !!newCat && c.categories.some((k) => k.name.trim().toLowerCase() === newCat.name.trim().toLowerCase());
  const addCat = () => {
    if (!newCat.name.trim() || catTaken) return;
    const id = nextId(c.categories);
    setC({ ...c, categories: [...c.categories, { id, name: newCat.name.trim(), color: newCat.color }], entries: c.entries.map((x) => (x.id === e.id ? { ...e, categoryId: id } : x)) });
    setNewCat(null);
  };
  const cat = c.categories.find((k) => k.id === e.categoryId);
  const section = c.sections.find((s) => s.id === e.sectionId);
  const no = c.entries.indexOf(e) + 1;
  const err = issues.errors.filter((x) => x.where === "entry:" + e.id);
  const warn = issues.warnings.filter((x) => x.where === "entry:" + e.id);
  const groups = e.groups || [];
  const setGroup = (i, patch) => set({ groups: groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const bodyLen = (e.body || "").length;

  return (
    <div className="editor">
      <div className="ed-form">
        <div className="ed-top">
          <h2>{e.title || "Untitled entry"}</h2>
          <button type="button" className="danger" onClick={remove}>Delete entry</button>
        </div>
        <Issues list={err} kind="err" />
        <Issues list={warn} kind="warn" />
        <div className="grid2">
          <Field label="Category">
            <select id="e-cat" value={newCat ? "new" : e.categoryId ?? ""}
              onChange={(x) => (x.target.value === "new" ? setNewCat({ name: "", color: "#a9c6ff" }) : (setNewCat(null), set({ categoryId: Number(x.target.value) })))}>
              {c.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              <option value="new">+ New category…</option>
            </select>
          </Field>
          <Field label="Section" hint="where it stands on the road">
            <select id="e-sec" value={e.sectionId ?? ""} onChange={(x) => set({ sectionId: Number(x.target.value) })}>
              {c.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>
          {newCat && (
            <div className="newcat wide">
              <input type="color" id="nc-color" aria-label="New category color" value={newCat.color} onChange={(x) => setNewCat({ ...newCat, color: x.target.value })} />
              <input id="nc-name" autoFocus placeholder="Category name, e.g. Volunteering" value={newCat.name}
                onChange={(x) => setNewCat({ ...newCat, name: x.target.value })} onKeyDown={(x) => { if (x.key === "Enter") { x.preventDefault(); addCat(); } }} />
              <button type="button" className="ghost" onClick={addCat} disabled={!newCat.name.trim() || catTaken}>Add</button>
              <button type="button" className="ghost" onClick={() => setNewCat(null)}>Cancel</button>
              {catTaken && <p className="muted small">There's already a category with that name.</p>}
            </div>
          )}
          <Field label="Title" wide><input id="e-title" value={e.title} onChange={(x) => set({ title: x.target.value })} /></Field>
          <Field label="Subtitle"><input id="e-sub" value={e.subtitle} onChange={(x) => set({ subtitle: x.target.value })} /></Field>
          <Field label="Period or place" hint="e.g. 02/2026 – Present"><input id="e-period" value={e.period} onChange={(x) => set({ period: x.target.value })} /></Field>
          <Field label="Description" wide hint={<span className={bodyLen > LIMITS.body ? "over" : ""}>{bodyLen} / {LIMITS.body}</span>}>
            <textarea id="e-body" rows={4} value={e.body} onChange={(x) => set({ body: x.target.value })} />
          </Field>
          <Field label="Tags" wide hint="Enter or comma to add"><Chips id="e-tags" value={e.tags || []} onChange={(tags) => set({ tags })} placeholder="React, Node.js…" /></Field>
        </div>

        <details open={groups.length > 0} className="block">
          <summary>Skill groups <em>{groups.length ? groups.length + " of up to " + LIMITS.groups : "columns of skills, like the Skills entry"}</em></summary>
          {groups.map((g, i) => (
            <div className="group" key={i}>
              <input id={`e-g${i}-h`} aria-label="Group heading" placeholder="Heading, e.g. Front end" value={g.heading} onChange={(x) => setGroup(i, { heading: x.target.value })} />
              <Chips id={`e-g${i}-items`} value={g.items || []} onChange={(items) => setGroup(i, { items })} placeholder="Skills…" />
              <button type="button" className="ghost" onClick={() => set({ groups: groups.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => set({ groups: [...groups, { heading: "", items: [] }] })}>+ Add group</button>
        </details>

        <details open={(e.list || []).length > 0} className="block">
          <summary>Numbered list <em>{(e.list || []).length ? (e.list || []).length + " items" : "one item per line, like Certificates"}</em></summary>
          <textarea id="e-list" rows={5} value={(e.list || []).join("\n")} onChange={(x) => set({ list: x.target.value.split("\n") })}
            onBlur={(x) => set({ list: x.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
        </details>

        <details open={!!e.contact} className="block">
          <summary>Contact details <em>{e.contact ? "shown with copy buttons" : "email and phone, like the Contact entry"}</em></summary>
          {e.contact ? (
            <div className="grid2">
              <Field label="Email"><input id="e-email" type="email" value={e.contact.email} onChange={(x) => set({ contact: { ...e.contact, email: x.target.value } })} /></Field>
              <Field label="Phone"><input id="e-phone" value={e.contact.phone} onChange={(x) => set({ contact: { ...e.contact, phone: x.target.value } })} /></Field>
              <Field label="Link labels" wide hint="shown as chips"><Chips id="e-links" value={e.links || []} onChange={(links) => set({ links })} placeholder="LinkedIn, GitHub…" /></Field>
              <button type="button" className="ghost" onClick={() => set({ contact: null, links: [] })}>Remove contact details</button>
            </div>
          ) : <button type="button" className="ghost" onClick={() => set({ contact: { email: "", phone: "" } })}>+ Add contact details</button>}
        </details>
      </div>
      <Preview e={e} cat={cat} no={no} total={c.entries.length} section={section} />
    </div>
  );
}

function Entries({ c, setC, issues, sel, setSel }) {
  const e = c.entries.find((x) => x.id === sel) || c.entries[0];
  const update = (ne) => {
    let list = c.entries.map((x) => (x.id === ne.id ? ne : x));
    // a new section: move it to the end of that section, so the road order stays section by section
    if (e && ne.sectionId !== e.sectionId) list = [...list.filter((x) => x.id !== ne.id), ne];
    setC({ ...c, entries: list });
  };
  const add = (sectionId) => {
    const id = nextId(c.entries);
    const ne = { id, sectionId, categoryId: c.categories[0]?.id, title: "New entry", subtitle: "", period: "", body: "", tags: [], links: [], groups: [], list: [], contact: null };
    setC({ ...c, entries: [...c.entries, ne] });
    setSel(id);
  };
  const move = (id, d) => {
    const list = [...c.entries], i = list.findIndex((x) => x.id === id), sec = list[i].sectionId;
    let j = i + d;
    while (j >= 0 && j < list.length && list[j].sectionId !== sec) j += d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setC({ ...c, entries: list });
  };
  const remove = (id) => {
    const i = c.entries.findIndex((x) => x.id === id), list = c.entries.filter((x) => x.id !== id);
    setC({ ...c, entries: list });
    setSel(list[Math.min(i, list.length - 1)]?.id ?? null);
  };
  const catOf = (id) => c.categories.find((k) => k.id === id);
  const bad = new Set(issues.errors.map((x) => x.where)), warned = new Set(issues.warnings.map((x) => x.where));
  let n = 0;

  return (
    <div className="split">
      <nav className="list" aria-label="Entries">
        {c.sections.map((s, si) => {
          const items = c.entries.filter((x) => x.sectionId === s.id);
          return (
            <section key={s.id}>
              <h3>{s.title}<span>{si ? SCENES[sceneFor(si)] : "Opening straight"}</span></h3>
              <ul>
                {items.map((x, k) => {
                  n++;
                  return (
                    <li key={x.id} className={x.id === e?.id ? "on" : ""}>
                      <button type="button" className="pick" onClick={() => setSel(x.id)}>
                        <span className="no">{pad(n)}</span>
                        <i className="dot" style={{ background: catOf(x.categoryId)?.color }} />
                        <span className="t">{x.title || "Untitled"}<small>{catOf(x.categoryId)?.name}</small></span>
                        {bad.has("entry:" + x.id) ? <b className="flag err" title="Has errors">!</b> : warned.has("entry:" + x.id) ? <b className="flag warn" title="Has warnings">!</b> : null}
                      </button>
                      <MoveButtons label={x.title} up={k > 0 ? () => move(x.id, -1) : null} down={k < items.length - 1 ? () => move(x.id, 1) : null} />
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="ghost add" onClick={() => add(s.id)}>+ New entry in {s.title}</button>
            </section>
          );
        })}
      </nav>
      {e ? <EntryEditor key={e.id} e={e} c={c} setC={setC} update={update} remove={() => remove(e.id)} issues={issues} />
         : <p className="empty">No entries yet. Add one to a section on the left.</p>}
    </div>
  );
}

/* ---------- categories ---------- */

function Categories({ c, setC, issues }) {
  const set = (id, patch) => setC({ ...c, categories: c.categories.map((k) => (k.id === id ? { ...k, ...patch } : k)) });
  const move = (i, d) => { const l = [...c.categories]; [l[i], l[i + d]] = [l[i + d], l[i]]; setC({ ...c, categories: l }); };
  const used = (id) => c.entries.filter((e) => e.categoryId === id).length;
  return (
    <div className="panel">
      <p className="lead">A category is the label at the top of a billboard and card (Experience, Project…). Its color is that entry's accent on the road, the card and the minimap.</p>
      <table className="rows">
        <thead><tr><th>Color</th><th>Name</th><th>Entries</th><th><span className="sr">Actions</span></th></tr></thead>
        <tbody>
          {c.categories.map((k, i) => {
            const err = issues.errors.filter((x) => x.where === "category:" + k.id), u = used(k.id);
            return (
              <tr key={k.id}>
                <td className="color">
                  <input type="color" id={`c${k.id}-color`} aria-label={"Color for " + k.name} value={/^#[0-9a-f]{6}$/i.test(k.color) ? k.color : "#000000"} onChange={(x) => set(k.id, { color: x.target.value })} />
                  <input className="hex" id={`c${k.id}-hex`} aria-label="Hex color" value={k.color} onChange={(x) => set(k.id, { color: x.target.value })} />
                </td>
                <td><input id={`c${k.id}-name`} aria-label="Category name" value={k.name} onChange={(x) => set(k.id, { name: x.target.value })} /><Issues list={err} kind="err" /></td>
                <td className="num">{u}</td>
                <td className="acts">
                  <MoveButtons label={k.name} up={i > 0 ? () => move(i, -1) : null} down={i < c.categories.length - 1 ? () => move(i, 1) : null} />
                  <button type="button" className="danger" disabled={u > 0} title={u ? "Move its entries to another category first" : ""}
                    onClick={() => setC({ ...c, categories: c.categories.filter((x) => x.id !== k.id) })}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={() => setC({ ...c, categories: [...c.categories, { id: nextId(c.categories), name: "New category", color: "#a9c6ff" }] })}>+ Add category</button>
    </div>
  );
}

/* ---------- sections ---------- */

function Sections({ c, setC, issues }) {
  const set = (id, patch) => setC({ ...c, sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (i, d) => { const l = [...c.sections]; [l[i], l[i + d]] = [l[i + d], l[i]]; setC({ ...c, sections: l }); };
  const used = (id) => c.entries.filter((e) => e.sectionId === id).length;
  const warn = issues.warnings.filter((x) => x.where === "site");
  return (
    <div className="panel">
      <p className="lead">Sections are the stretches of the drive, in road order. The first is the opening straight; every later one is a hairpin bend announced by an overhead sign. Add as many as you need: the road grows to fit, and a bend widens with the number of entries in it. Each bend gets a set piece from its place on the road, city scenes on the right-hand bends and water scenes on the left.</p>
      <Issues list={warn} kind="warn" />
      <table className="rows">
        <thead><tr><th>#</th><th>Title</th><th>Scene</th><th>Entries</th><th><span className="sr">Actions</span></th></tr></thead>
        <tbody>
          {c.sections.map((s, i) => {
            const err = issues.errors.filter((x) => x.where === "section:" + s.id), u = used(s.id), sc = sceneFor(i);
            return (
              <tr key={s.id}>
                <td className="num">{pad(i + 1)}</td>
                <td><input id={`s${s.id}-title`} aria-label="Section title" value={s.title} onChange={(x) => set(s.id, { title: x.target.value })} /><Issues list={err} kind="err" /></td>
                <td className="scene">{sc ? <>{SCENES[sc]}<small>{sideFor(i)}</small></> : <>Opening straight<small>before the first bend</small></>}</td>
                <td className="num">{u}</td>
                <td className="acts">
                  <MoveButtons label={s.title} up={i > 0 ? () => move(i, -1) : null} down={i < c.sections.length - 1 ? () => move(i, 1) : null} />
                  <button type="button" className="danger" disabled={u > 0 || c.sections.length === 1} title={u ? "Move or delete its entries first" : ""}
                    onClick={() => setC({ ...c, sections: c.sections.filter((x) => x.id !== s.id) })}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={() => setC({ ...c, sections: [...c.sections, { id: nextId(c.sections), title: "New section", scene: null }] })}>+ Add section</button>
    </div>
  );
}

/* ---------- site ---------- */

function Site({ c, setC, issues }) {
  const set = (k) => (x) => setC({ ...c, site: { ...c.site, [k]: x.target.value } });
  const err = issues.errors.filter((x) => x.where === "site");
  return (
    <div className="panel">
      <p className="lead">The opening screen and the header shown above the drive.</p>
      <Issues list={err} kind="err" />
      <div className="grid2">
        <Field label="Your name"><input id="site-name" value={c.site.name || ""} onChange={set("name")} /></Field>
        <Field label="Role" hint="beside your name in the header"><input id="site-role" value={c.site.role || ""} onChange={set("role")} /></Field>
        <Field label="Opening line" hint="above your name"><input id="site-eyebrow" value={c.site.eyebrow || ""} onChange={set("eyebrow")} /></Field>
        <Field label="Introduction" wide><textarea id="site-intro" rows={3} value={c.site.intro || ""} onChange={set("intro")} /></Field>
        <Field label="Browser tab title"><input id="site-title" value={c.site.pageTitle || ""} onChange={set("pageTitle")} /></Field>
        <Field label="Search description" wide hint="shown by search engines and link previews"><textarea id="site-desc" rows={2} value={c.site.description || ""} onChange={set("description")} /></Field>
      </div>
    </div>
  );
}

/* ---------- app ---------- */

function Admin() {
  const [saved, setSaved] = useState(null);   // what the database holds
  const [c, setC] = useState(null);           // what's on screen
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("nd.admin.tab") || "entries"; } catch { return "entries"; } });
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState({ kind: "", msg: "" });
  const [busy, setBusy] = useState(false);
  const applyRef = useRef(null);

  useEffect(() => {
    fetch("/api/content").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d) => { setSaved(d); setC(d); setSel(d.entries[0]?.id ?? null); })
      .catch((e) => setStatus({ kind: "err", msg: "Couldn't load the content: " + e.message + ". Is `npm run dev` running?" }));
  }, []);
  useEffect(() => { try { localStorage.setItem("nd.admin.tab", tab); } catch {} }, [tab]);

  const issues = useMemo(() => (c ? check(c) : { errors: [], warnings: [] }), [c]);
  const dirty = c && saved && !same(c, saved);

  const apply = async () => {
    if (!dirty || busy) return;
    if (issues.errors.length) { setStatus({ kind: "err", msg: `Fix ${issues.errors.length} ${issues.errors.length > 1 ? "problems" : "problem"} before applying.` }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/content", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || (d.errors || []).map((x) => x.msg).join(" "));
      setSaved(d.content); setC(d.content);
      setStatus({ kind: "ok", msg: "Applied. Open tabs of the site have reloaded with the changes." });
    } catch (e) {
      setStatus({ kind: "err", msg: "Not saved: " + e.message });
    } finally { setBusy(false); }
  };
  applyRef.current = apply;

  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); applyRef.current(); } };
    const leave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("keydown", k); addEventListener("beforeunload", leave);
    return () => { removeEventListener("keydown", k); removeEventListener("beforeunload", leave); };
  }, [dirty]);
  useEffect(() => { if (dirty && status.kind === "ok") setStatus({ kind: "", msg: "" }); }, [dirty]);

  const count = (where) => issues.errors.filter((x) => x.where.startsWith(where)).length;
  const tabErr = { entries: count("entry:"), categories: count("category:"), sections: count("section:"), site: count("site") };

  return (
    <div className="admin">
      <header className="bar">
        <div className="brand"><span className="mark">ND</span><div><b>Night Drive</b><span>Content admin</span></div></div>
        <div className="state" role="status">
          {!c ? "Loading…" : dirty ? <span className="pill dirty">Unsaved changes</span> : <span className="pill clean">Up to date with the site</span>}
          {c && issues.errors.length > 0 && <span className="pill err">{issues.errors.length} to fix</span>}
        </div>
        <div className="acts">
          <a className="ghost" href="/" target="_blank" rel="noopener">Open site ↗</a>
          <button type="button" className="ghost" disabled={!dirty || busy} onClick={() => { setC(saved); setStatus({ kind: "", msg: "" }); }}>Discard changes</button>
          <button type="button" className="primary" disabled={!dirty || busy} onClick={apply} title="Ctrl+S">{busy ? "Applying…" : "Apply to site"}</button>
        </div>
      </header>
      {status.msg && <p className={"status " + status.kind}>{status.msg}</p>}
      {c && (
        <>
          <nav className="tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {label}
                <span className="count">{k === "entries" ? c.entries.length : k === "categories" ? c.categories.length : k === "sections" ? c.sections.length : ""}</span>
                {tabErr[k] > 0 && <b className="flag err">{tabErr[k]}</b>}
              </button>
            ))}
          </nav>
          <main>
            {tab === "entries" && <Entries c={c} setC={setC} issues={issues} sel={sel} setSel={setSel} />}
            {tab === "categories" && <Categories c={c} setC={setC} issues={issues} />}
            {tab === "sections" && <Sections c={c} setC={setC} issues={issues} />}
            {tab === "site" && <Site c={c} setC={setC} issues={issues} />}
          </main>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("admin")).render(<Admin />);
