/* Admin accounts: content/users.db (SQLite), kept apart from portfolio.db so password hashes are never committed.
   Passwords are stored as scrypt hashes with a per-user salt.
   Add or reset an account with:  npm run seed-admin -- <email> <password> */
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const USERS_PATH = path.join(ROOT, "content", "users.db");

let db = null;
function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  db = new DatabaseSync(USERS_PATH);
  db.exec("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL)");
  return db;
}

const norm = (email) => String(email || "").trim().toLowerCase();
const hashOf = (password, salt) => crypto.scryptSync(String(password), salt, 64);
// checked against when the email is unknown, so a miss takes as long as a wrong password
const DUMMY = { salt: crypto.randomBytes(16).toString("hex"), hash: crypto.randomBytes(64).toString("hex") };

export const hasUsers = () => open().prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;

/** Creates the account, or resets its password if it exists. */
export function setUser(email, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  open().prepare("INSERT INTO users (email, salt, hash) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET salt = excluded.salt, hash = excluded.hash")
    .run(norm(email), salt, hashOf(password, salt).toString("hex"));
}

/** The normalized email when the credentials match, otherwise null. */
export function verify(email, password) {
  const row = open().prepare("SELECT salt, hash FROM users WHERE email = ?").get(norm(email));
  const { salt, hash } = row || DUMMY;
  const ok = crypto.timingSafeEqual(hashOf(password, salt), Buffer.from(hash, "hex"));
  return ok && row ? norm(email) : null;
}
