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
  "workbook, extracting and aggregating data, presenting options, and — when asked",
  "— populating the app's records via the tools provided. This is a multi-turn",
  "conversation; the user may keep asking follow-ups and adjustments.",
  "",
  "You are given a compact view of the workbook: each sheet's name, column",
  "headers, row count, and a SAMPLE of rows. The sample is not the full data. Use",
  "the EXACT header strings shown — never invent header or sheet names.",
  "",
  "Two kinds of tools:",
  "",
  "1) QUERY tools — read_sheet_rows and aggregate_sheet — are run immediately by",
  "   the app over the FULL data and their results are returned to you. Use them to",
  "   answer data questions accurately instead of guessing from the sample. Prefer",
  "   aggregate_sheet for grouped questions (totals, averages, medians, top-N by a",
  "   column, e.g. highest-volume lanes or average tonnage per lane) — it computes",
  "   exact figures over every row. Use read_sheet_rows to inspect specific rows.",
  "",
  "2) ACTION tools — create_tender, set_tender_fields, add_lanes_from_sheet,",
  "   add_shipments_from_sheet, add_bids, add_carriers, set_method — are PROPOSED",
  "   to the user, who reviews and confirms them before anything changes. The app",
  "   then applies confirmed actions against the full workbook it holds locally, so",
  "   you only choose the sheet + column mapping; never transcribe rows.",
  "",
  "Rules:",
  "- ALWAYS include a brief markdown explanation of what you found or propose.",
  "  Lead with the answer/result.",
  "- Read/aggregate FIRST (in their own turns), then propose actions in a later",
  "  turn. Do NOT mix query tools and action tools in the same response.",
  "- For pure data questions, answer in text after querying — don't propose actions.",
  "- Never invent figures or columns. If the data can't support a request, say so.",
  "",
  "Mapping guidance:",
  "- Lanes need origin/destination and cost drivers (pallets/weight/tonnes,",
  "  vehicle, frequency, hours, km). Map only columns that exist.",
  "- Shipments need a destination column and a tonnage source — a tonnes column or",
  "  a weight column (weight is assumed kilograms)."
].join("\n");

const AGENT_TOOLS = [
  {
    name: "read_sheet_rows",
    description: "QUERY (runs immediately): return actual rows from a sheet over the full data. Optionally project specific columns and paginate with offset/limit.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        columns: { type: "array", items: { type: "string" }, description: "Header names to include; omit for all" },
        offset: { type: "integer", description: "Row offset (default 0)" },
        limit: { type: "integer", description: "Max rows to return (default 200, hard cap 500)" }
      },
      required: ["sheet"]
    }
  },
  {
    name: "aggregate_sheet",
    description: "QUERY (runs immediately): group every row of a sheet by one column and compute count/sum/avg/median/min/max of a numeric value column. Use for totals, averages, and top-N rankings.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        groupBy: { type: "string", description: "Header to group by (omit to aggregate the whole sheet)" },
        value: { type: "string", description: "Numeric header to aggregate" },
        valueUnit: { type: "string", enum: ["raw", "kg", "t"], description: "If the value is weight in kg, use 'kg' to report tonnes" },
        sortBy: { type: "string", enum: ["count", "sum", "avg", "median", "min", "max"], description: "Metric to sort groups by (default sum)" },
        order: { type: "string", enum: ["desc", "asc"] },
        top: { type: "integer", description: "Return only the top N groups (default 20)" }
      },
      required: ["sheet"]
    }
  },
  {
    name: "create_tender",
    description: "ACTION (needs confirmation): create a new tender. Call once before adding lanes/shipments unless targeting an existing tender.",
    input_schema: {
      type: "object",
      properties: {
        reference: { type: "string" }, customer: { type: "string" }, title: { type: "string" },
        dueDate: { type: "string", description: "ISO date YYYY-MM-DD" }, owner: { type: "string" },
        notes: { type: "string" }
      }
    }
  },
  {
    name: "set_tender_fields",
    description: "ACTION (needs confirmation): set fields on the tender, in any RFQ section.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["overview", "schedule", "commercial", "technology", "contract"] },
        fields: {
          type: "object",
          description: "Key/value fields for the section. overview: reference, customer, title, dueDate, owner, probability, notes. schedule: collectionWindows, deliveryTimeframes, weekend, bookingRules. commercial: fuelSurcharge, paymentTerms, minInsurance, serviceCredits, claims. technology: tracking, ediApi, pod. contract: duration, startDate, accessorials, disputeRules."
        }
      },
      required: ["section", "fields"]
    }
  },
  {
    name: "add_lanes_from_sheet",
    description: "ACTION (needs confirmation): populate operational lanes from a worksheet by mapping JDT lane fields to that sheet's exact column headers. The app reads every row.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        mapping: {
          type: "object",
          description: "JDT lane field -> header name. Include only fields that exist.",
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
    description: "ACTION (needs confirmation): load raw shipment history for per-tonne analysis. Give the destination column and a tonnage source (tonnes or weight) by exact header name. The app reads every row.",
    input_schema: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        destColumn: { type: "string" }, postcodeColumn: { type: "string" },
        tonnesColumn: { type: "string" }, weightColumn: { type: "string" }
      },
      required: ["sheet", "destColumn"]
    }
  },
  {
    name: "add_bids",
    description: "ACTION (needs confirmation): record competing carrier bids on the tender.",
    input_schema: {
      type: "object",
      properties: {
        bids: {
          type: "array",
          items: {
            type: "object",
            properties: { carrier: { type: "string" }, amount: { type: "number" }, status: { type: "string", enum: ["Pending", "Awarded", "Rejected"] } },
            required: ["carrier"]
          }
        }
      },
      required: ["bids"]
    }
  },
  {
    name: "add_carriers",
    description: "ACTION (needs confirmation): add carriers to the carrier network register.",
    input_schema: {
      type: "object",
      properties: {
        carriers: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, base: { type: "string" }, fleet: { type: "string" }, lanes: { type: "string" }, rating: { type: "number" }, compliance: { type: "string" }, contact: { type: "string" } },
            required: ["name"]
          }
        }
      },
      required: ["carriers"]
    }
  },
  {
    name: "set_method",
    description: "ACTION (needs confirmation): set the per-tonne anchoring method: A (band ceiling) or B (band midpoint).",
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

  // ----- agent mode: conversation + workbook -> answer + proposed actions -----
  if (payload.kind === "agent") {
    const messages = Array.isArray(payload.messages) ? payload.messages : null;
    if (!messages || !messages.length) {
      return json({ error: "Tell the assistant what you'd like it to do." }, 400);
    }
    const res = await callAnthropic(env, {
      model: model, max_tokens: 3000, system: AGENT_SYSTEM, tools: AGENT_TOOLS, messages: messages
    });
    if (res.error) return json({ error: res.error }, res.status || 502);

    const content = res.data.content || [];
    const actions = content.filter(function (b) { return b.type === "tool_use"; })
      .map(function (b) { return { id: b.id, name: b.name, input: b.input || {} }; });
    const answer = textOf(content);
    if (!answer && !actions.length) {
      return json({ error: "The model returned nothing usable (stop reason: " + (res.data.stop_reason || "unknown") + ")." }, 502);
    }
    // `content` is returned verbatim so the client can echo this assistant turn
    // back on the next request (required to keep tool_use/tool_result valid).
    return json({ answer: answer, actions: actions, content: content, model: res.data.model || null });
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
