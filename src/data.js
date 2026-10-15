/* The CV content lives in the database (content/portfolio.db) and is edited at /admin while `npm run dev` runs.
   It reaches the site through `virtual:content` (server/content-plugin.js), baked in at build time. */
import content from "virtual:content";

export const DATA = content.DATA;
export const KIND = content.KIND;
export const SECTIONS = content.SECTIONS;
export const SITE = content.SITE;
export const N = DATA.length;
export const pad = n => String(n).padStart(2,"0");

// the scene is built once from this content, so applying changes from /admin reloads the page
if (import.meta.hot) import.meta.hot.on("content:changed", () => location.reload());
