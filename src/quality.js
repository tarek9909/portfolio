/* Quality tiers, decided once at startup:
   - "high": the full scene (bloom, real lamp lights, clearcoat paint, dense rain)
   - "low":  integrated / mobile GPUs and modest machines; the same drive with the expensive extras off
   - "none": no hardware WebGL at all (software rendering, blocked GPU); the site falls back to the catalogue
   A visitor's own choice (the Quality button, or ?q=high|low in the URL) always wins. */

const KEY = "nightDrive.quality";
export const CHOICES = ["auto", "high", "low"];

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
// integrated and mobile GPUs: fine for the drive, not for HDR bloom plus per-pixel lights
const MODEST = /intel|uhd|iris|hd graphics|mali|adreno|powervr|videocore|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|radeon r\d|apple a\d/i;

export function getChoice() {
  try {
    const q = new URLSearchParams(location.search).get("q");
    if (CHOICES.includes(q)) return q;
    const s = localStorage.getItem(KEY);
    if (CHOICES.includes(s)) return s;
  } catch (e) {}
  return "auto";
}

export function setChoice(c) {
  try { if (c === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch (e) {}
}

/** Ask for a context that refuses software rendering, and read the GPU's name if the browser shares it. */
function probe() {
  const c = document.createElement("canvas");
  const opts = { failIfMajorPerformanceCaveat: true, antialias: false, depth: false, stencil: false };
  const gl = c.getContext("webgl2", opts) || c.getContext("webgl", opts);
  if (!gl) return null;
  let name = "";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch (e) {}
  const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
  return { name, webgl2: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext };
}

/** Returns { tier: "high"|"low"|"none", choice, gpu }. */
export function detectQuality() {
  const choice = getChoice();
  const p = probe();
  const gpu = p ? p.name : "";
  if (choice !== "auto") return { tier: choice, choice, gpu };   // forced: try it even on weak hardware
  if (!p || SOFTWARE.test(gpu)) return { tier: "none", choice, gpu };
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const modest = MODEST.test(gpu) || !p.webgl2 || cores <= 4 || mem <= 4 || small;
  return { tier: modest ? "low" : "high", choice, gpu };
}
