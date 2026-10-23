"use strict";
/**
 * Creates an organization and its first administrator from the server's command line.
 *   node scripts/create-admin.js --email you@example.com --name "Your Name" --org "Your Company"
 * The password is read from ADMIN_PASSWORD or prompted for. It is never printed.
 */
const readline = require("readline");
const S = require("../src/store");
const A = require("../src/auth");

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
const ask = (q) => new Promise((ok) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); ok(a); }); });

(async () => {
  const email = (arg("email") || await ask("Email: ")).trim().toLowerCase();
  const name = (arg("name") || await ask("Full name: ")).trim();
  const org = (arg("org") || await ask("Organization name: ")).trim();
  const password = process.env.ADMIN_PASSWORD || await ask("Password (min 8 characters): ");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || !org || password.length < 8) {
    console.error("Email, name, organization and a password of 8+ characters are all required."); process.exit(1);
  }
  if (S.findAccountByEmail(email)) { console.error("That email already has an account."); process.exit(1); }
  const o = S.createOrganization(org);
  const a = S.createAccount({ email, passwordHash: A.hash(password), fullName: name, role: "MANAGER",
                              orgId: o.id, orgAdmin: 1, profileComplete: 1 });
  S.audit(a, "ADMIN_CREATED_BY_CLI", "organization", o.id, org);
  console.log(`Created organization "${org}" with administrator ${email}.`);
})();
