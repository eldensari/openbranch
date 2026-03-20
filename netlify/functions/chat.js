// In-memory rate limit store (resets on cold start)
const ipCounts = {};
const DAILY_LIMIT = 10;

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function checkRateLimit(ip) {
  const day = getDateKey();
  const key = ip + ":" + day;
  if (!ipCounts[key]) ipCounts[key] = 0;
  if (ipCounts[key] >= DAILY_LIMIT) return false;
  ipCounts[key]++;
  return true;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("client-ip")
    || "unknown";

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "RATE_LIMIT", message: "Daily free message limit reached." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured: missing API key." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { messages, model } = body;
  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: "messages array is required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || "Anthropic API error", status: res.status }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to call Anthropic API: " + e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
