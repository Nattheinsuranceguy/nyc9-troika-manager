const https = require("https");

exports.handler = async function(event) {
  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: h, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: h, body: JSON.stringify({ error: "Method not allowed" }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: h, body: JSON.stringify({ error: "No API key configured" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch(e) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Bad request body" }) };
  }

  // Strip any PDF/document content to keep request small and fast
  // The PDF text should already be extracted client-side
  if (body.messages) {
    body.messages = body.messages.map(msg => {
      if (Array.isArray(msg.content)) {
        msg.content = msg.content.filter(block => block.type !== "document");
        // If only one text block remains, simplify to string
        if (msg.content.length === 1 && msg.content[0].type === "text") {
          msg.content = msg.content[0].text;
        }
      }
      return msg;
    });
  }

  // Keep max_tokens reasonable
  body.max_tokens = Math.min(body.max_tokens || 2000, 2000);

  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      }
    }, (res) => {
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: h, body: d });
      });
    });

    req.on("error", (e) => {
      resolve({ statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) });
    });

    // 25 second timeout
    req.setTimeout(25000, () => {
      req.destroy();
      resolve({ statusCode: 504, headers: h, body: JSON.stringify({ error: "Request timed out — try again without PDF or with fewer attendees" }) });
    });

    req.write(payload);
    req.end();
  });
};
