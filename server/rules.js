/* Rules for the CV content, shared by the /admin page (live feedback) and the server (enforced on save).
   Pure JS, no Node or browser APIs, so both sides import the same file. */

/** The four U-turn set pieces the engine knows how to build. */
export const SCENES = {
  neon: "Neon Quarter",
  marina: "The Marina",
  grid: "The Grid",
  luna: "Luna Park",
};

/* Bends alternate right (city inside) and left (sea inside), so the city scenes go on odd bends and the
   water scenes on even ones: neon, marina, grid, luna, then round again for longer roads. */
const CYCLE = ["neon", "marina", "grid", "luna"];

/** The scene for the section at this position: none for the opening straight (0), then the cycle. */
export const sceneFor = (index) => (index === 0 ? null : CYCLE[(index - 1) % CYCLE.length]);

/** Which side of the road a bend's set piece sits on. */
export const sideFor = (index) => (index === 0 ? null : index % 2 ? "city side" : "sea side");

/** Past this many sections the drive still works, but loading takes noticeably longer. */
export const MANY_SECTIONS = 12;

/** What fits on a billboard (see drawPanel in src/engine.js); past these, text is cut off on the road. */
export const LIMITS = { body: 280, groups: 3, groupItems: 6, list: 6, title: 26, chips: 6 };

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks a whole content document.
 * Returns { errors, warnings }: each an array of { where, msg }, where `where` is
 * "site", "category:<id>", "section:<id>" or "entry:<id>". Errors block saving; warnings don't.
 */
export function check(c) {
  const errors = [], warnings = [];
  const err = (where, msg) => errors.push({ where, msg });
  const warn = (where, msg) => warnings.push({ where, msg });

  if (!c.site?.name?.trim()) err("site", "Your name is required.");
  if (!c.site?.pageTitle?.trim()) err("site", "The browser tab title is required.");

  const catIds = new Set(), catNames = new Set();
  (c.categories || []).forEach((k) => {
    const w = "category:" + k.id;
    catIds.add(k.id);
    const n = (k.name || "").trim();
    if (!n) err(w, "Category name is required.");
    else if (catNames.has(n.toLowerCase())) err(w, `Another category is already called “${n}”.`);
    catNames.add(n.toLowerCase());
    if (!HEX.test(k.color || "")) err(w, "Color must be a hex value like #ffb15e.");
  });

  const secs = c.sections || [];
  if (!secs.length) err("site", "Add at least one section.");
  if (secs.length > MANY_SECTIONS) warn("site", `${secs.length} sections make a long road: each bend adds a set piece, so the site takes longer to load.`);
  const secIds = new Set();
  secs.forEach((s) => {
    const w = "section:" + s.id;
    secIds.add(s.id);
    if (!(s.title || "").trim()) err(w, "Section title is required.");
    if (!(c.entries || []).some((e) => e.sectionId === s.id)) err(w, "A section needs at least one entry.");
  });

  (c.entries || []).forEach((e) => {
    const w = "entry:" + e.id;
    if (!(e.title || "").trim()) err(w, "Title is required.");
    if (!catIds.has(e.categoryId)) err(w, "Pick a category.");
    if (!secIds.has(e.sectionId)) err(w, "Pick a section.");
    if ((e.title || "").length > LIMITS.title) warn(w, "Long titles are shrunk to fit the billboard.");
    if ((e.body || "").length > LIMITS.body && !e.groups?.length && !e.list?.length)
      warn(w, `The billboard shows about ${LIMITS.body} characters of text; the rest is only on the card.`);
    if ((e.groups || []).length > LIMITS.groups) warn(w, `Only the first ${LIMITS.groups} skill groups fit on the billboard.`);
    (e.groups || []).forEach((g, i) => {
      if (!(g.heading || "").trim()) err(w, `Skill group ${i + 1} needs a heading.`);
      if ((g.items || []).length > LIMITS.groupItems) warn(w, `“${g.heading}” has more than ${LIMITS.groupItems} items; the billboard cuts the rest.`);
    });
    if ((e.list || []).length > LIMITS.list) warn(w, `Only the first ${LIMITS.list} list items fit on the billboard.`);
    if (e.contact) {
      if (e.contact.email && !EMAIL.test(e.contact.email)) err(w, "That email address doesn't look right.");
      if (!e.contact.email && !e.contact.phone) err(w, "Add an email or a phone number, or remove the contact block.");
    }
    if ([...(e.tags || []), ...(e.links || [])].length > LIMITS.chips) warn(w, "Chips that don't fit across the billboard are left off it.");
  });

  return { errors, warnings };
}

/**
 * Turns the stored content into what the site uses: DATA (one item per billboard, in road order),
 * KIND (category → accent color), SECTIONS (with item indices) and SITE.
 */
export function toSite(c) {
  const cat = new Map(c.categories.map((k) => [k.id, k]));
  const DATA = [], SECTIONS = [];
  c.sections.forEach((s) => {
    const items = [];
    c.entries.filter((e) => e.sectionId === s.id).forEach((e) => {
      const it = { kind: cat.get(e.categoryId)?.name || "Other", title: e.title, subtitle: e.subtitle || "" };
      if (e.period) it.period = e.period;
      if (e.body) it.body = e.body;
      if (e.tags?.length) it.tags = e.tags;
      if (e.links?.length) it.links = e.links;
      if (e.groups?.length) it.groups = e.groups.map((g) => [g.heading, g.items || []]);
      if (e.list?.length) it.list = e.list;
      if (e.contact && (e.contact.email || e.contact.phone)) it.contact = { email: e.contact.email || "", phone: e.contact.phone || "" };
      items.push(DATA.length);
      DATA.push(it);
    });
    const sec = { title: s.title, items }, scene = sceneFor(SECTIONS.length);
    if (scene) { sec.scene = scene; sec.sceneName = SCENES[scene]; }
    SECTIONS.push(sec);
  });
  const KIND = Object.fromEntries(c.categories.map((k) => [k.name, k.color]));
  return { DATA, KIND, SECTIONS, SITE: c.site };
}
