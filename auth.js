const crypto = require("crypto");

// In production, set this via an environment variable so it stays stable
// across restarts/deploys. Falls back to a fixed dev secret otherwise.
const SECRET = process.env.CHAT_SECRET || "same-wave-dev-secret-change-me";

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(input) {
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64").toString();
}

function sign(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(fromBase64url(body));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function makeToken(username) {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return sign({ username, exp: Date.now() + THIRTY_DAYS });
}

module.exports = { makeToken, verify };
