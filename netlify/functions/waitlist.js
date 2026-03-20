import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
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

  const email = body.email?.trim()?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: "Valid email required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const store = getStore("waitlist");

    // Check duplicate
    const existing = await store.get(email);
    if (existing) {
      return new Response(
        JSON.stringify({ ok: true, message: "Already on the waitlist!" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Store with timestamp
    await store.set(email, JSON.stringify({ email, ts: new Date().toISOString() }));

    return new Response(
      JSON.stringify({ ok: true, message: "You're on the list!" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to save: " + e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
