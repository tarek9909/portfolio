/* npm run seed-admin -- <email> <password>
   Creates an admin account in content/users.db, or resets the password of an existing one. */
import { setUser, USERS_PATH } from "./users.js";

const [email, password] = process.argv.slice(2);
if (!email || !email.includes("@") || !password) {
  console.error("Usage: npm run seed-admin -- <email> <password>");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}
setUser(email, password);
console.log(`Admin account ready: ${email.trim().toLowerCase()} (${USERS_PATH})`);
