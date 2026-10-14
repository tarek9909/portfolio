import { DATA } from "./data.js";

/* The drive is split into sections. The opening stops sit on the first straight. Every other
   section is a hairpin U-turn with its own set piece: an overhead gantry on the highway announces
   it, the section's billboards line the bend, and a stretch of highway leads on to the next one.
   Turns alternate right/left, so the road snakes in parallel legs and never crosses itself:
   right turns have the city on their inside, left turns the sea. */
export const SECTIONS = [
  { title: "Start", items: [0, 1] },
  { title: "Career", scene: "neon", sceneName: "Neon Quarter", items: [2, 3, 4] },
  { title: "Projects", scene: "marina", sceneName: "The Marina", items: [5, 6, 7, 8, 9] },
  { title: "Toolkit", scene: "grid", sceneName: "The Grid", items: [10, 11] },
  { title: "Contact", scene: "luna", sceneName: "Luna Park", items: [12] },
];

const INTRO_GAP = 70;     // between the opening stops
const HIGHWAY = 170;      // straight between one section and the next
const GANTRY_LEAD = 62;   // how far before a turn its section sign stands
const STOP_SPACING = 44;  // minimum road length per billboard inside a turn
const MIN_RADIUS = 55;

/** Road distance of each stop, indexed like DATA. */
export const STOPS = new Array(DATA.length).fill(0);
/** ["S", length] straights and ["T", degrees, radius] corners (negative = left). */
export const COURSE = [];
/** One entry per U-turn section: where it starts, how long it is, which way it bends. */
export const TURNS = [];
/** Overhead section signs on the highway. */
export const GANTRIES = [];
/** Section index for each stop. */
export const SECTION_OF = new Array(DATA.length).fill(0);

{
  let s = 0, side = 1, turnNo = 0;
  SECTIONS.forEach((sec, k) => {
    sec.items.forEach((it) => { SECTION_OF[it] = k; });
    if (!sec.scene) {
      sec.items.forEach((it, j) => { STOPS[it] = j * INTRO_GAP; });
      s = (sec.items.length - 1) * INTRO_GAP;
      COURSE.push(["S", s]);   // the opening straight is part of the road too
      return;
    }
    COURSE.push(["S", HIGHWAY]); s += HIGHWAY;
    const n = sec.items.length, R = Math.max(MIN_RADIUS, (n * STOP_SPACING) / Math.PI), len = Math.PI * R;
    COURSE.push(["T", side * 180, R]);
    turnNo++;
    TURNS.push({ section: k, no: turnNo, s0: s, len, R, side, deg: side * 180 });
    GANTRIES.push({ section: k, no: turnNo, s: s - GANTRY_LEAD, side });
    sec.items.forEach((it, j) => { STOPS[it] = s + (len * (j + 0.5)) / n; });
    s += len; side = -side;
  });
  COURSE.push(["S", 600]);
}

/** Road distance of the final stop. */
export const END_S = STOPS[STOPS.length - 1];

/** Which side of the road each stop's billboard stands on (+1 right, -1 left): inside its U-turn,
    so every turnaround holds its own section's billboards. The opening stops stand on the right. */
export const STOP_SIDE = STOPS.map((_, i) => {
  const t = TURNS.find((tt) => tt.section === SECTION_OF[i]);
  return t ? t.side : 1;
});

/** Where the main road is built (road distance). */
export const ROAD_S0 = -200, ROAD_S1 = END_S + 700;

/* Cross roads. Neighbouring legs of the snake run parallel, joined at one end by a U-turn.
   Between the legs of a right U-turn lies city, so they're linked by streets; between the legs
   of a left U-turn lies sea, so they're linked by a bridge. Each link is placed at a distance d
   back from its U-turn, so it meets both legs straight across from each other, and it is kept
   clear of billboards, gantries and the set piece inside the bend. */
const SCENE_CLEAR = { neon: 45, grid: 55, marina: 140, luna: 45 };   // no links closer than this to the turn centre
const LINK_HALF = 7;

/** [{ sA, sB, side, kind, turn }]: sA on the leg before the turn, sB on the leg after; side +1 = right, -1 = left. */
export const CROSSINGS = [];
{
  const avoid = [];   // [s, clearance, side]: billboards and section boards stand inside their turn, gantries span both sides
  STOPS.forEach((s, i) => avoid.push([s + 14, 11, STOP_SIDE[i]]));
  GANTRIES.forEach((g) => avoid.push([g.s, 9, 0]));
  TURNS.forEach((t) => avoid.push([t.s0 - 20, 15, t.side]));
  const clear = (s, side) => avoid.every(([a, c, sd]) => (sd && sd !== side) || Math.abs(s - a) > c + LINK_HALF);
  TURNS.forEach((t, k) => {
    const prevEnd = k > 0 ? TURNS[k - 1].s0 + TURNS[k - 1].len : ROAD_S0 + 50;
    const nextStart = k < TURNS.length - 1 ? TURNS[k + 1].s0 : ROAD_S1 - 50;
    const after = t.s0 + t.len, scene = SECTIONS[t.section].scene;
    const kind = t.side > 0 ? "street" : "bridge", want = kind === "street" ? 2 : 1;
    const picked = [];
    for (let d = SCENE_CLEAR[scene] || 45; d <= 170 && picked.length < want; d += 5) {
      const sA = t.s0 - d, sB = after + d;
      if (sA < prevEnd + 12 || sB > nextStart - 12) continue;
      if (!clear(sA, t.side) || !clear(sB, t.side)) continue;
      if (picked.some((p) => Math.abs(p - d) < 40)) continue;
      picked.push(d);
      CROSSINGS.push({ sA, sB, side: t.side, kind, turn: k, d });
    }
  });
}

/** Index of the stop nearest to road distance v. */
export function nearestStop(v) {
  let best = 0;
  for (let i = 1; i < STOPS.length; i++) if (Math.abs(STOPS[i] - v) < Math.abs(STOPS[best] - v)) best = i;
  return best;
}

/** Index of the last stop at or before v (with a small tolerance). */
export function stopAtOrBefore(v, tol = 1) {
  let i = 0;
  while (i < STOPS.length - 1 && STOPS[i + 1] <= v + tol) i++;
  return i;
}

/** Index of the first stop at or after v (with a small tolerance). */
export function stopAtOrAfter(v, tol = 1) {
  let i = STOPS.length - 1;
  while (i > 0 && STOPS[i - 1] >= v - tol) i--;
  return i;
}
