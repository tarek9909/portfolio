/* Login for the /admin page (dev server only).
   Accounts live in content/users.db (see users.js). Signing in sets an HttpOnly session cookie;
   sessions live in memory, so restarting the dev server signs everyone out. */
import crypto from "node:crypto";
import { hasUsers, verify } from "./users.js";

const COOKIE = "nd_admin";
const TTL = 12 * 60 * 60 * 1000;            // a session lasts 12 hours
const WINDOW = 60 * 1000, MAX_FAILS = 5;    // at most 5 failed sign-ins a minute per address

const sessions = new Map();                 // token -> { email, exp }
const fails = new Map();                    // address -> [times of recent failures]

const tokenOf = (req) => {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]{64})"));
  return m ? m[1] : null;
};

/** The signed-in email for this request, or null. */
export function sessionOf(req) {
  const t = tokenOf(req), s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s.email;
}

/** Middleware for GET /api/session, POST /api/login and POST /api/logout. */
export function authRoutes() {
  return (req, res, next) => {
    const send = (code, body, cookie) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json");
      if (cookie) res.setHeader("Set-Cookie", cookie);
      res.end(JSON.stringify(body));
    };
    const url = req.url.split("?")[0];

    if (url === "/api/session" && req.method === "GET") return send(200, { email: sessionOf(req), configured: hasUsers() });

    if (url === "/api/logout" && req.method === "POST") {
      const t = tokenOf(req);
      if (t) sessions.delete(t);
      return send(200, { ok: true }, `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    }

    if (url === "/api/login" && req.method === "POST") {
      if (!hasUsers()) return send(503, { error: "No admin account yet. Run: npm run seed-admin -- <email> <password>" });
      const ip = req.socket.remoteAddress || "?", now = Date.now();
      const recent = (fails.get(ip) || []).filter((t) => now - t < WINDOW);
      if (recent.length >= MAX_FAILS) return send(429, { error: "Too many attempts. Wait a minute and try again." });
      let raw = "";
      req.on("data", (ch) => { raw += ch; if (raw.length > 4096) req.destroy(); });
      req.on("end", () => {
        let b;
        try { b = JSON.parse(raw); } catch { return send(400, { error: "The request wasn't valid JSON." }); }
        const email = verify(b.email, b.password ?? "");
        if (!email) {
          fails.set(ip, [...recent, now]);
          return send(401, { error: "Wrong email or password." });
        }
        fails.delete(ip);
        for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, { email, exp: now + TTL });
        send(200, { ok: true, email }, `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}`);
      });
      return;
    }
    next();
  };
}
