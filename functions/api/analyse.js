/* Cloudflare Pages Function — AI-assisted tender analysis proxy.
 *
 * Route: /api/analyse  (POST)
 *
 * The browser sends ONLY figures the cost engine has already computed (rate
 * cards, per-load billing, the Method A vs B shipment simulation). This
 * function holds the Anthropic API key as an encrypted secret and asks Claude
 * to turn those verified numbers into a procurement-ready justification.
 *
 * The key never reaches the browser; the model never invents figures — it
 * reasons about the numbers it is given. See DEPLOY.md for how to set the
 * ANTHROPIC_API_KEY secret on the Pages project.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = [
  "You are a logistics pricing analyst at JD Refrigerated Transport, drafting the",
  "written rationale that accompanies a tender rate response.",
  "",
  "You will receive a JSON object of figures that have ALREADY been computed by",
  "the company's cost engine: per-lane $/tonne rate cards, per-load billing",
  "(MAX(Min Charge, band $/t x tonnes)), and — when present — a revenue",
  "simulation comparing Method A (band ceiling anchors) vs Method B (band",
  "midpoint anchors) across real historic shipments.",
  "",
  "Rules:",
  "- Ground every statement in the supplied numbers. Do NOT invent, estimate, or",
  "  recompute any figure. If something isn't in the data, don't claim it.",
  "- Be analytical and evidence-led, not promotional. No opinion or filler.",
  "- Where the Min Charge floor is doing the work for small loads, say so plainly",
  "  and explain why that protects cost recovery.",
  "- When a Method A vs B comparison is present, state the uplift and explain the",
  "  defensible reasoning (median loads cluster near band midpoints, not ceilings,",
  "  so midpoint anchors recover truck cost at the typical load).",
  "- Output concise GitHub-flavoured markdown: a one-line summary, then short",
  "  sections with headings and bullet points. Keep it tight — this is a",
  "  decision aid, not an essay."
].join("\n");

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

// GET /api/analyse — health check the UI can use to show whether the key is set.
export async function onRequestGet(context) {
  return json({ configured: Boolean(context.env && context.env.ANTHROPIC_API_KEY) });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "AI analysis isn't configured yet. Set the ANTHROPIC_API_KEY secret on the Cloudflare Pages project (see DEPLOY.md)." }, 503);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch (e) {
    return json({ error: "Could not read the analysis request." }, 400);
  }
  if (!payload || typeof payload !== "object") {
    return json({ error: "Empty analysis request." }, 400);
  }

  const userMessage =
    "Here are the engine-computed figures for this tender. Write the rate-response " +
    "rationale grounded only in these numbers.\n\n```json\n" +
    JSON.stringify(payload, null, 2) +
    "\n```";

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      })
    });
  } catch (e) {
    return json({ error: "Could not reach the analysis service. On a locked-down network, api.anthropic.com may be blocked." }, 502);
  }

  if (!upstream.ok) {
    let detail = "";
    try {
      const err = await upstream.json();
      detail = (err && err.error && err.error.message) || "";
    } catch (e) { /* ignore */ }
    const msg = upstream.status === 401
      ? "The configured Anthropic API key was rejected (401). Check the ANTHROPIC_API_KEY secret."
      : "The analysis service returned an error (" + upstream.status + ")" + (detail ? ": " + detail : ".");
    return json({ error: msg }, 502);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ error: "The analysis service returned an unreadable response." }, 502);
  }

  const text = Array.isArray(data.content)
    ? data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n")
    : "";

  if (!text) {
    return json({ error: "The model returned no text (stop reason: " + (data.stop_reason || "unknown") + ")." }, 502);
  }

  return json({ text: text, model: data.model || null });
}
