/* The CV database: content/portfolio.db (SQLite, via Node's built-in node:sqlite).
   Created and filled from server/seed.json the first time it is opened.
   The whole document is read and written at once; saves are one transaction. */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneFor } from "./rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DB_PATH = path.join(ROOT, "content", "portfolio.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS site (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, sort INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, scene TEXT, sort INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    category_id INTEGER NOT NULL REFERENCES categories(id),
    sort INTEGER NOT NULL,
    title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', period TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',     -- JSON: ["React", ...]
    links TEXT NOT NULL DEFAULT '[]',    -- JSON: ["GitHub", ...]
    groups_json TEXT NOT NULL DEFAULT '[]', -- JSON: [{heading, items: [...]}]
    list TEXT NOT NULL DEFAULT '[]',     -- JSON: ["CCNA ...", ...]
    contact TEXT                         -- JSON: {email, phone} or NULL
  );`;

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;" + SCHEMA);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM entries").get();
  if (!n) seed();
  return db;
}

/** First run: load the CV that used to live in src/data.js. */
function seed() {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "seed.json"), "utf8"));
  const cats = s.categories.map((k, i) => ({ id: i + 1, ...k }));
  const secs = s.sections.map((x, i) => ({ id: i + 1, ...x }));
  const byName = new Map(cats.map((k) => [k.name, k.id]));
  write({
    site: s.site,
    categories: cats,
    sections: secs,
    entries: s.entries.map((e, i) => ({ id: i + 1, ...e, sectionId: secs[e.section].id, categoryId: byName.get(e.category) })),
  });
}

/** The whole content document: { site, categories[], sections[], entries[] }, each list in its saved order. */
export function read() {
  const d = open();
  const site = Object.fromEntries(d.prepare("SELECT key, value FROM site").all().map((r) => [r.key, r.value]));
  const categories = d.prepare("SELECT id, name, color FROM categories ORDER BY sort").all().map((r) => ({ ...r }));
  const sections = d.prepare("SELECT id, title, scene FROM sections ORDER BY sort").all().map((r) => ({ ...r }));
  const entries = d.prepare(`SELECT e.* FROM entries e JOIN sections s ON s.id = e.section_id ORDER BY s.sort, e.sort`).all()
    .map((r) => ({
      id: r.id, sectionId: r.section_id, categoryId: r.category_id,
      title: r.title, subtitle: r.subtitle, period: r.period, body: r.body,
      tags: JSON.parse(r.tags), links: JSON.parse(r.links), groups: JSON.parse(r.groups_json), list: JSON.parse(r.list),
      contact: r.contact ? JSON.parse(r.contact) : null,
    }));
  return { site, categories, sections, entries };
}

/** Replaces everything with `c` in one transaction (ids are kept, so nothing else needs remapping). */
export function write(c) {
  const d = db || open();
  d.exec("BEGIN");
  try {
    d.exec("DELETE FROM entries; DELETE FROM sections; DELETE FROM categories; DELETE FROM site;");
    const site = d.prepare("INSERT INTO site (key, value) VALUES (?, ?)");
    Object.entries(c.site || {}).forEach(([k, v]) => site.run(k, String(v ?? "")));
    const cat = d.prepare("INSERT INTO categories (id, name, color, sort) VALUES (?, ?, ?, ?)");
    c.categories.forEach((k, i) => cat.run(k.id, k.name.trim(), k.color, i));
    const sec = d.prepare("INSERT INTO sections (id, title, scene, sort) VALUES (?, ?, ?, ?)");
    c.sections.forEach((s, i) => sec.run(s.id, s.title.trim(), sceneFor(i), i));   // scene follows position
    const ent = d.prepare(`INSERT INTO entries (id, section_id, category_id, sort, title, subtitle, period, body, tags, links, groups_json, list, contact)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const clean = (a) => JSON.stringify((a || []).map((x) => String(x).trim()).filter(Boolean));
    c.entries.forEach((e, i) => ent.run(
      e.id, e.sectionId, e.categoryId, i,
      e.title.trim(), (e.subtitle || "").trim(), (e.period || "").trim(), (e.body || "").trim(),
      clean(e.tags), clean(e.links),
      JSON.stringify((e.groups || []).map((g) => ({ heading: g.heading.trim(), items: JSON.parse(clean(g.items)) }))),
      clean(e.list),
      e.contact ? JSON.stringify({ email: (e.contact.email || "").trim(), phone: (e.contact.phone || "").trim() }) : null,
    ));
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}
