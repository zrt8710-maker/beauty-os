import { describe, expect, it } from "vitest";

import { readRoutineApiResponse } from "@/features/today/today-routine-generate-response";

const routine = {
  id: "10000000-0000-4000-8000-000000000001",
  routine_date: "2026-09-06",
  period: "pm",
  skin_snapshot: {},
  weather_snapshot: {},
  decision_snapshot: null,
  excluded_products: [],
  status: "generated",
  created_at: "2026-09-06T00:00:00.000Z",
  updated_at: "2026-09-06T00:00:00.000Z",
  steps: [],
};

describe("Today generate response", () => {
  it.each([200, 201, 202])("accepts every 2xx response with a valid routine (%s)", async (status) => {
    const response = new Response(JSON.stringify({ data: routine }), { status });
    await expect(readRoutineApiResponse(response)).resolves.toEqual(expect.objectContaining({
      kind: "success", status, ok: true, jsonParsed: true, contractParsed: true, routine, generationResult: "generated",
    }));
  });

  it.each(["generated", "reused", "retained_after_failure", "deterministic_fallback", "retained_previous"] as const)(
    "preserves the generation result %s",
    async (generationResult) => {
      const response = new Response(JSON.stringify({ data: routine, generationResult }), { status: 201 });
      await expect(readRoutineApiResponse(response)).resolves.toEqual(expect.objectContaining({ kind: "success", generationResult }));
    },
  );

  it("consumes a user-facing generation explanation when supplied", async () => {
    const response = new Response(JSON.stringify({ data: routine, generationResult: "reused", generationExplanation: "当前方案仍能覆盖今天的主要需要。" }), { status: 200 });
    await expect(readRoutineApiResponse(response)).resolves.toEqual(expect.objectContaining({
      kind: "success",
      generationResult: "reused",
      generationExplanation: "当前方案仍能覆盖今天的主要需要。",
    }));
  });

  it("preserves and derives deterministic fallback outcomes", async () => {
    const fallbackRoutine = {
      ...routine,
      decision_snapshot: {
        version: 1,
        dailyCareNeeds: { priorities: [], requiredRoles: [], optionalRoles: [], restrictions: [], reasons: [], unknowns: [] },
        routinePolicy: { baselineRoles: [], baselineCoverage: [], residualPriorities: [], unresolvedResidualPriorities: [] },
        selectedSteps: [], abstentions: [], capabilityGaps: [],
        planner: { version: 1, generationSource: "deterministic_fallback", strategy: null, strategySummary: null, structuredDecision: null },
      },
    };
    const explicit = new Response(JSON.stringify({ data: fallbackRoutine, generationResult: "deterministic_fallback" }), { status: 201 });
    const derived = new Response(JSON.stringify({ data: fallbackRoutine }), { status: 200 });
    await expect(readRoutineApiResponse(explicit)).resolves.toEqual(expect.objectContaining({ kind: "success", generationResult: "deterministic_fallback" }));
    await expect(readRoutineApiResponse(derived)).resolves.toEqual(expect.objectContaining({ kind: "success", generationResult: "deterministic_fallback" }));
  });

  it("separates an invalid success envelope from an actual HTTP failure", async () => {
    await expect(readRoutineApiResponse(new Response(JSON.stringify({ data: { id: "not-a-routine" } }), { status: 201 }))).resolves.toEqual(expect.objectContaining({ kind: "contract_error", status: 201, ok: true, jsonParsed: true, contractParsed: false }));
    await expect(readRoutineApiResponse(new Response(JSON.stringify({ error: { code: "ROUTINE_GENERATE_FAILED" } }), { status: 500 }))).resolves.toEqual(expect.objectContaining({ kind: "http_error", status: 500, ok: false }));
  });
});
