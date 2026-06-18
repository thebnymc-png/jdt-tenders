/* Cloudflare Pages Function — AI proxy for the JD Tender Hub.
 *
 * Route: /api/analyse
 *   GET  -> { configured: boolean }            (does the server have a key?)
 *   POST -> two modes, chosen by the request body:
 *     • figures mode (default): engine-computed numbers -> markdown rationale
 *     • agent mode (kind:"agent"): a workbook + a free-text instruction ->
 *       a short answer plus structured ACTIONS the app applies to populate
 *       tenders, lanes and shipments. End-to-end tender assistant.
 *
 * The Anthropic API key is held as an encrypted secret and never reaches the
 * browser. The model is told never to invent figures — it reasons about, and
 * maps, the data it is given. See DEPLOY.md for the secret setup.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";

const FIGURES_SYSTEM = [
  "You are a logistics pricing analyst at JD Refrigerated Transport, drafting the",
  "written rationale that accompanies a tender rate response.",
  "",
  "You will receive a JSON object of figures ALREADY computed by the company's",
  "cost engine: per-lane $/tonne rate cards, per-load billing",
  "(MAX(Min Charge, band $/t x tonnes)), and — when present — a revenue",
  "simulation comparing Method A (band ceiling anchors) vs Method B (band",
  "midpoint anchors) across real historic shipments.",
  "",
  "Rules:",
  "- Ground every statement in the supplied numbers. Do NOT invent, estimate, or",
  "  recompute any figure. If something isn't in the data, don't claim it.",
  "- Be analytical and evidence-led, not promotional. No opinion or filler.",
  "- Where the Min Charge floor is doing the work for small loads, say so plainly.",
  "- When a Method A vs B comparison is present, state the uplift and explain the",
  "  defensible reasoning (median loads cluster near band midpoints, not ceilings).",
  "- Output concise GitHub-flavoured markdown: a one-line summary then short",
  "  sections with headings and bullets."
].join("\n");

const AGENT_SYSTEM = [
  "You are the AI assistant inside the JD Refrigerated Transport tender hub. You",
  "help the user manage tenders end-to-end: answering questions about an uploaded",
  "workbook, finding data, presenting options, and — when asked — populating the",
  "app's records via the tools provided.",
  "",
  "You are given a compact view of the user's uploaded workbook: each sheet's",
  "name, column headers, row count, and a sample of rows. Use the EXACT header",
  "strings shown when you map columns — never invent header names.",
  "",
  "How to respond:",
  "- ALWAYS include a brief plain-text explanation of what you found or did, in",
  "  markdown. Lead with the answer.",
  "- When the user asks you to set up or populate something (a tender, lanes,",
  "  shipments), call the appropriate tools. The app executes them against the",
  "  full workbook it holds locally, so you only choose the sheet + column mapping;",
  "  you do not need to transcribe rows.",
  "- For pure questions (find data, compare, present options), answer in text and",
  "  do not call tools.",
  "- Never invent figures or columns. If the data can't support a request, say so.",
  "",
  "Mapping guidance:",
  "- Lanes need origin/destination and the cost drivers (pallets/weight/tonnes,",
  "  vehicle, frequency, hours, km). Map only the columns that exist.",
  "- Shipments need a destination column and a tonnage source — either a tonnes",
  "  column or a weight column (state which; weight is assumed kilograms)."
].join("\n");

const AGENT_TOOLS = [
  {
    name: "create_tender",
    description: "Create a new tender record and optionally set its overview fields. Call once before adding lanes/shipments unless the user is targeting an existing tender.",
    input_schema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "RFQ / reference number" },
        customer: { type: "string" },
        title: { type: "string" },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        owner: { type: "string" },
        notes: { type: "string", description: "Assumptions, scope, exclusions" }
      }
    }
  },
  {
    name: "add_lanes_from_sheet",
    description: "Populate operational lanes from a worksheet by mapping JDT lane fields to that sheet's column headers (exact header strings). The app reads every row of the sheet.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string", description: "Worksheet name" },
        mapping: {
          type: "object",
          description: "JDT lane field -> header name in this sheet. Include only fields that exist.",
          properties: {
            collPostcode: { type: "string" }, collSuburb: { type: "string" },
            delPostcode: { type: "string" }, delSuburb: { type: "string" },
            pallets: { type: "string" }, weightKg: { type: "string" }, tonnes: { type: "string" },
            vehicle: { type: "string" }, freq: { type: "string" }, hrs: { type: "string" }, km: { type: "string" }
          }
        }
      },
      required: ["sheet", "mapping"]
    }
  },
  {
    name: "add_shipments_from_sheet",
    description: "Load raw shipment history for per-tonne analysis from a worksheet. Give the destination column and a tonnage source (tonnes or weight) by exact header name. The app reads every row.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        destColumn: { type: "string", description: "Header for the delivery destination (suburb/town/name)" },
        postcodeColumn: { type: "string", description: "Header for the delivery postcode/zone, if present" },
        tonnesColumn: { type: "string", description: "Header for tonnes per shipment, if present" },
        weightColumn: { type: "string", description: "Header for weight (kg) per shipment, if tonnes absent" }
      },
      required: ["sheet", "destColumn"]
    }
  },
  {
    name: "set_method",
    description: "Set the per-tonne anchoring method on the tender: A (band ceiling, current card) or B (band midpoint, proposed).",
    input_schema: {
      type: "object",
      properties: { method: { type: "string", enum: ["A", "B"] } },
      required: ["method"]
    }
  }
];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function callAnthropic(env, requestBody) {
  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (e) {
    return { error: "Could not reach the analysis service. On a locked-down network, api.anthropic.com may be blocked.", status: 502 };
  }
  if (!upstream.ok) {
    let detail = "";
    try { var err = await upstream.json(); detail = (err && err.error && err.error.message) || ""; } catch (e) { /* ignore */ }
    var msg = upstream.status === 401
      ? "The configured Anthropic API key was rejected (401). Check the ANTHROPIC_API_KEY secret."
      : "The analysis service returned an error (" + upstream.status + ")" + (detail ? ": " + detail : ".");
    return { error: msg, status: 502 };
  }
  try { return { data: await upstream.json() }; }
  catch (e) { return { error: "The analysis service returned an unreadable response.", status: 502 }; }
}

function textOf(content) {
  return Array.isArray(content)
    ? content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n")
    : "";
}

// GET — health check the UI uses to know whether the key is set.
export async function onRequestGet(context) {
  return json({ configured: Boolean(context.env && context.env.ANTHROPIC_API_KEY) });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "AI isn't configured yet. Set the ANTHROPIC_API_KEY secret on the Cloudflare Pages project (see DEPLOY.md)." }, 503);
  }

  let payload;
  try { payload = await context.request.json(); }
  catch (e) { return json({ error: "Could not read the request." }, 400); }
  if (!payload || typeof payload !== "object") return json({ error: "Empty request." }, 400);

  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  // ----- agent mode: workbook + instruction -> answer + actions -----
  if (payload.kind === "agent") {
    if (!payload.prompt || !String(payload.prompt).trim()) {
      return json({ error: "Tell the assistant what you'd like it to do." }, 400);
    }
    const userMessage =
      "Instruction:\n" + String(payload.prompt).trim() +
      "\n\nTarget: " + (payload.target === "current" ? "the currently open tender" : "a new tender") +
      "\n\nUploaded workbook (headers, row counts, sample rows):\n```json\n" +
      JSON.stringify(payload.workbook || {}, null, 2) + "\n```";

    const res = await callAnthropic(env, {
      model: model, max_tokens: 3000, system: AGENT_SYSTEM, tools: AGENT_TOOLS,
      messages: [{ role: "user", content: userMessage }]
    });
    if (res.error) return json({ error: res.error }, res.status || 502);

    const content = res.data.content || [];
    const actions = content.filter(function (b) { return b.type === "tool_use"; })
      .map(function (b) { return { name: b.name, input: b.input || {} }; });
    const answer = textOf(content);
    if (!answer && !actions.length) {
      return json({ error: "The model returned nothing usable (stop reason: " + (res.data.stop_reason || "unknown") + ")." }, 502);
    }
    return json({ answer: answer, actions: actions, model: res.data.model || null });
  }

  // ----- figures mode (default): computed numbers -> rationale -----
  const userMessage =
    "Here are the engine-computed figures for this tender. Write the rate-response " +
    "rationale grounded only in these numbers.\n\n```json\n" + JSON.stringify(payload, null, 2) + "\n```";
  const res = await callAnthropic(env, {
    model: model, max_tokens: 2000, system: FIGURES_SYSTEM,
    messages: [{ role: "user", content: userMessage }]
  });
  if (res.error) return json({ error: res.error }, res.status || 502);
  const text = textOf(res.data.content);
  if (!text) return json({ error: "The model returned no text (stop reason: " + (res.data.stop_reason || "unknown") + ")." }, 502);
  return json({ text: text, model: res.data.model || null });
}
