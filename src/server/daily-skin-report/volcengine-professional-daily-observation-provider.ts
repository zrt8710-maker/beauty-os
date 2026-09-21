import "server-only";
import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";
import { professionalDailyObservationSchema, type ProfessionalDailyObservationProvider } from "./professional-daily-observation-service";

const unsafe = /屏障受损|缺水性出油|炎症|激素|过敏|产品刺激|敏感肌|诊断/;
const prompt = "You are Beauty OS's professional, non-medical skincare advisor. Use only supplied confirmed daily facts, profile baseline, and deterministic trends. Never invent concerns, absences, severity, causes, diagnoses, or trends. Profile is comparison context, never the opening subject unless it directly explains a confirmed change. Prioritize what changed today, then meaningful stability, then at most one restrained observation direction. Do not use internal field names or system-recording language. When presentation_mode is short_history, overall_observation must be a natural 1–3 sentence quick review; when daily_overview, keep it concise but useful. Return JSON only with overall_observation, baseline_comparison, key_observations.";

export function createVolcengineProfessionalDailyObservationProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ProfessionalDailyObservationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return { async generate(input) {
    let response: Response;
    try { response = await fetchImpl(options.baseUrl, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" }, signal: providerRequestSignal(options.timeoutMs), body: JSON.stringify({ model: options.model, store: false, thinking: { type: "disabled" }, instructions: prompt, input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }], text: { format: { type: "json_schema", name: "professional_daily_observation", strict: true, schema: { type: "object", additionalProperties: false, required: ["overall_observation", "baseline_comparison", "key_observations"], properties: { overall_observation: { type: "string", minLength: 1, maxLength: 2400 }, baseline_comparison: { type: ["string", "null"], maxLength: 1800 }, key_observations: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 480 } } } } } }, max_output_tokens: 1600 }) }); } catch { throw new Error("REPORT_PROVIDER_UNAVAILABLE"); }
    if (!response.ok) throw new Error("REPORT_PROVIDER_UNAVAILABLE");
    const payload = await response.json() as { output_text?: unknown; output?: unknown };
    const outputText = outputTextFromResponse(payload);
    if (!outputText) throw new Error("INVALID_REPORT");
    const report = professionalDailyObservationSchema.parse(sanitizeProfessionalDailyObservation(JSON.parse(outputText)));
    if (unsafe.test(JSON.stringify(report))) throw new Error("UNSAFE_REPORT");
    return report;
  } };
}

/** Keeps the canonical report contract strict while recovering harmless provider wrappers and formatting. */
export function sanitizeProfessionalDailyObservation(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const report = value as Record<string, unknown>;
  return {
    overall_observation: trimText(report.overall_observation),
    baseline_comparison: report.baseline_comparison === null || report.baseline_comparison === undefined ? null : trimText(report.baseline_comparison),
    key_observations: Array.isArray(report.key_observations) ? report.key_observations.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : report.key_observations,
  };
}

function trimText(value: unknown) { return typeof value === "string" ? value.trim() : value; }
function outputTextFromResponse(payload: { output_text?: unknown; output?: unknown }) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") return content.text;
  }
  return null;
}

export function createConfiguredVolcengineProfessionalDailyObservationProvider() {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim(); const model = process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim(); const baseUrl = process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
  return apiKey && model && baseUrl ? createVolcengineProfessionalDailyObservationProvider({ apiKey, model, baseUrl }) : null;
}
