"use strict";
// Password strength rules for NEW passwords (sign-in never applies them, so existing accounts are unaffected).
// Length is the main defence; this list only stops the passwords attackers try first.
const COMMON = new Set(`12345678 123456789 1234567890 12341234 11223344 11111111 00000000 87654321 987654321 123123123 123321123
password password1 password12 password123 password1234 password! passw0rd p@ssw0rd p@ssword pass1234 pass12345 testtest test1234 test12345
qwerty123 qwertyui qwertyuiop qwerty12 qwerty1234 1q2w3e4r 1qaz2wsx zaq12wsx qazwsxedc asdfghjk asdf1234 asdfghjkl zxcvbnm1 abcd1234 abc12345 abcdefgh
iloveyou iloveyou1 welcome1 welcome12 welcome123 letmein1 letmein123 changeme changeme1 admin123 admin1234 administrator login123 master123 monkey123
dragon123 football1 baseball1 sunshine1 princess1 trustno1 superman1 estateops estateops1 estateops123 maintenance rosewood1 tenant123 manager123`.split(/\s+/));

const sequential = (s) => {
  if (s.length < 8) return false;
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) { const d = s.charCodeAt(i) - s.charCodeAt(i - 1); if (d !== 1) up = false; if (d !== -1) down = false; }
  return up || down;
};

/** Returns a message when the password is too easy to guess, otherwise null. */
function weakness(password, { email, name } = {}) {
  const p = String(password), low = p.toLowerCase();
  if (COMMON.has(low)) return "That password is one of the most common ones. Choose something less predictable.";
  if (/^(.)\1+$/.test(p)) return "A password made of one repeated character is too easy to guess.";
  if (/^(.{1,4})\1+$/.test(low)) return "A password made of a repeated short pattern is too easy to guess.";
  if (sequential(low)) return "A run of consecutive characters is too easy to guess.";
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return "Do not use your email address inside your password.";
  const first = String(name || "").trim().split(/\s+/)[0].toLowerCase();
  if (first.length >= 4 && low === first) return "Do not use your name as your password.";
  return null;
}
module.exports = { weakness };
