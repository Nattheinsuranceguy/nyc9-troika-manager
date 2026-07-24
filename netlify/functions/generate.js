const https = require("https");

function makeRequest(hostname, path, method, headers, payload) {
  return new Promise((resolve) => {
    const opts = {
      hostname, path, method,
      headers: { "Content-Type": "application/json", ...headers }
    };
    if (payload) opts.headers["Content-Length"] = Buffer.byteLength(payload);
    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", (e) => resolve({ status: 500, body: JSON.stringify({ error: e.message }) }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 504, body: JSON.stringify({ error: "Timeout" }) }); });
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async function(event) {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: h, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: h, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch(e) { return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Bad request body" }) }; }

  // ── Airtable requests ──────────────────────────────────────────────────────
  if (body.service === "airtable") {
    const atToken = process.env.AIRTABLE_TOKEN;
    if (!atToken) return { statusCode: 500, headers: h, body: JSON.stringify({ error: "AIRTABLE_TOKEN not set in Netlify environment variables" }) };

    const { atPath, atMethod, atBody } = body;
    if (!atPath) return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Missing atPath" }) };

    const payload = atBody ? JSON.stringify(atBody) : null;
    const result = await makeRequest(
      "api.airtable.com", atPath, atMethod || "GET",
      { "Authorization": "Bearer " + atToken },
      payload
    );
    return { statusCode: result.status, headers: h, body: result.body };
  }

  // ── Anthropic requests ─────────────────────────────────────────────────────
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: h, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set in Netlify environment variables" }) };

  if (body.messages) {
    body.messages = body.messages.map(msg => {
      if (Array.isArray(msg.content)) {
        msg.content = msg.content.filter(b => b.type !== "document");
        if (msg.content.length === 1 && msg.content[0].type === "text") msg.content = msg.content[0].text;
      }
      return msg;
    });
  }
  body.max_tokens = Math.min(body.max_tokens || 2000, 2000);

  const payload = JSON.stringify(body);
  const result = await makeRequest(
    "api.anthropic.com", "/v1/messages", "POST",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    payload
  );
  return { statusCode: result.status, headers: h, body: result.body };
};
