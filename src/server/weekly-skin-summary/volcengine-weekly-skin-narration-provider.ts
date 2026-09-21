import "server-only";
import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";

import type { WeeklySkinNarrationFacts, WeeklySkinNarrationProvider } from "./weekly-skin-narration-service";

const instructions = "You are Beauty OS's professional, non-medical skincare advisor. Write natural, warm Chinese for one completed seven-record skin summary. You receive only deterministic facts that have already been decided. Do not recalculate facts, invent a concern, infer an absence, add a cause, diagnosis, product recommendation, medical claim, or any fact outside this input. Do not expose field names, grades, evidence, unknowns, technical validation, or internal terms. Write one coherent user-facing summary of 2–5 natural sentences. When facts support them, naturally cover the overall rhythm, repeated or changing observations, stable points, useful long-term baseline context, and a restrained next observation. A stable week is still a real summary: explain that the recorded rhythm is steady without claiming every ungraded feeling is normal. Return JSON only.";

export function createVolcengineWeeklySkinNarrationProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): WeeklySkinNarrationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return { async narrate(facts: WeeklySkinNarrationFacts) {
    let response: Response;
    try {
      response = await fetchImpl(options.baseUrl, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" }, signal: providerRequestSignal(options.timeoutMs), body: JSON.stringify({ model: options.model, store: false, thinking: { type: "disabled" }, instructions, input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(facts) }] }], text: { format: { type: "json_schema", name: "weekly_skin_narration", strict: true, schema: responseSchema } }, max_output_tokens: 1200 }) });
    } catch { throw new Error("WEEKLY_SKIN_NARRATION_UNAVAILABLE"); }
    if (!response.ok) throw new Error("WEEKLY_SKIN_NARRATION_UNAVAILABLE");
    const payload = await response.json() as { output_text?: unknown; output?: unknown };
    const text = outputText(payload);
    if (!text) throw new Error("WEEKLY_SKIN_NARRATION_INVALID_OUTPUT");
    return JSON.parse(text);
  } };
}

export function createConfiguredVolcengineWeeklySkinNarrationProvider(): WeeklySkinNarrationProvider | null {
  const apiKey = (process.env.WEEKLY_SKIN_NARRATION_KEY ?? process.env.VOLCENGINE_AGENT_PLAN_KEY)?.trim();
  const model = (process.env.WEEKLY_SKIN_NARRATION_MODEL ?? process.env.VOLCENGINE_AGENT_PLAN_MODEL)?.trim();
  const baseUrl = (process.env.WEEKLY_SKIN_NARRATION_BASE_URL ?? process.env.VOLCENGINE_AGENT_PLAN_BASE_URL)?.trim();
  return apiKey && model && baseUrl ? createVolcengineWeeklySkinNarrationProvider({ apiKey, model, baseUrl }) : null;
}

const responseSchema = { type: "object", additionalProperties: false, required: ["narration"], properties: { narration: { type: "string", minLength: 80, maxLength: 1600 } } };
function outputText(payload: { output_text?: unknown; output?: unknown }) { if (typeof payload.output_text === "string") return payload.output_text; if (!Array.isArray(payload.output)) return null; for (const item of payload.output) { if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue; for (const content of item.content) if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") return content.text; } return null; }
