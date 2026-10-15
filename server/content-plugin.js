/* Connects the CV database to the site.
   - `virtual:content` is a module built from the database: the site imports it, so a production build
     bakes the content in (no requests at runtime) and the dev server reloads the site when it changes.
   - In dev only: GET/PUT /api/content for the /admin page (signed-in admins only, see auth.js) and the
     login routes. Nothing of this exists in the built site. */
import { read, write } from "./db.js";
import { check, toSite } from "./rules.js";
import { authRoutes, sessionOf } from "./auth.js";

const ID = "virtual:content", RID = "\0" + ID;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export default function contentPlugin() {
  let server = null;
  return {
    name: "night-drive-content",
    resolveId: (id) => (id === ID ? RID : null),
    load(id) {
      if (id !== RID) return null;
      return "export default " + JSON.stringify(toSite(read())) + ";";
    },
    // the tab title and description come from the database too (only the site's page, not /admin)
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.path && ctx.path.startsWith("/admin")) return html;
        const { site } = read();
        return html
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(site.pageTitle)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(site.description)}$2`);
      },
    },
    configureServer(s) {
      server = s;
      s.middlewares.use(authRoutes());
      s.middlewares.use("/api/content", (req, res) => {
        const send = (code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
        if (!sessionOf(req)) return send(401, { error: "Sign in first." });
        if (req.method === "GET") return send(200, read());
        if (req.method !== "PUT") return send(405, { error: "Use GET or PUT." });
        let raw = "";
        req.on("data", (ch) => { raw += ch; });
        req.on("end", () => {
          let c;
          try { c = JSON.parse(raw); } catch { return send(400, { error: "The request wasn't valid JSON." }); }
          const { errors, warnings } = check(c);
          if (errors.length) return send(422, { errors, warnings });
          try { write(c); } catch (e) { return send(500, { error: "Couldn't save to the database: " + e.message }); }
          // apply: rebuild the content module and reload any open tab of the site
          const mod = server.moduleGraph.getModuleById(RID);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "custom", event: "content:changed" });
          send(200, { ok: true, warnings, content: read() });
        });
      });
    },
  };
}
