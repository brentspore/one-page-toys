/* /api/admin — the admin page's one endpoint.
 *   GET  ?op=session        { signedIn, email?, clientId, missing[] }
 *   POST ?op=login          { credential } from "Sign in with Google" -> session cookie
 *   POST ?op=logout         clears it
 *   GET  ?op=stats&days=N   the dashboard's numbers (signed in only), N = 7 | 28 | 90
 *   GET  ?op=advice&days=N  Claude's "What to do next" for that range (signed in only;
 *                           &fresh=1 rewrites it). { configured:false } without a key.
 */
"use strict";

const A = require("./_admin.js");

function send(res, status, body, cookie) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  if (cookie) res.setHeader("set-cookie", cookie);
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  const op = String((req.query && req.query.op) || "");
  try {
    if (op === "session") {
      const s = A.readSession(req);
      return send(res, 200, { signedIn: !!s, email: s ? s.email : null, clientId: A.env().clientId || null, missing: A.missing(), demo: A.DEMO });
    }

    if (op === "login") {
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      if (!/application\/json/.test(String(req.headers["content-type"] || ""))) return send(res, 415, { error: "JSON only" });
      if (A.missing().length) return send(res, 503, { error: "Not set up yet", missing: A.missing() });
      let email;
      if (A.DEMO) email = "demo@localhost";
      else {
        try { email = await A.verifyGoogleToken(req.body && req.body.credential); }
        catch (e) { return send(res, 401, { error: "Sign-in failed: " + e.message }); }
        if (!A.env().admins.includes(email)) return send(res, 403, { error: email + " is not an admin on this site." });
      }
      return send(res, 200, { signedIn: true, email }, A.sessionCookie(A.makeSession(email), A.SESSION_DAYS * 86400));
    }

    if (op === "logout") {
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      return send(res, 200, { signedIn: false }, A.sessionCookie("", 0));
    }

    if (op === "stats") {
      if (!A.readSession(req)) return send(res, 401, { error: "Sign in first" });
      if (A.missing().length) return send(res, 503, { error: "Not set up yet", missing: A.missing() });
      const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
      if (A.DEMO) {
        const registry = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "tools-registry.json"), "utf8"));
        return send(res, 200, A.demoStats(days, registry));
      }
      return send(res, 200, await A.stats(days));
    }

    if (op === "advice") {
      if (!A.readSession(req)) return send(res, 401, { error: "Sign in first" });
      if (A.missing().length) return send(res, 503, { error: "Not set up yet", missing: A.missing() });
      const days = [7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
      if (!A.adviceReady()) return send(res, 200, A.DEMO ? A.demoAdvice(days) : { configured: false });
      return send(res, 200, await A.advice(days, req.query.fresh === "1"));
    }

    return send(res, 404, { error: "Unknown op" });
  } catch (e) {
    return send(res, 500, { error: e.message || "Something went wrong" });
  }
};
