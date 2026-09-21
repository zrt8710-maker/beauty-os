import { routineSchema, type Routine } from "@/schemas/routine";

export type RoutineGenerationResult =
  | "generated"
  | "reused"
  | "retained_after_failure"
  | "retained_previous"
  | "deterministic_fallback";

type ResponseDiagnostics = {
  status: number;
  ok: boolean;
  jsonParsed: boolean;
  contractParsed: boolean;
  rawBody?: string;
};

export type RoutineApiReadResult =
  | (ResponseDiagnostics & { kind: "success"; routine: Routine; generationResult: RoutineGenerationResult; generationExplanation?: string })
  | (ResponseDiagnostics & { kind: "http_error" })
  | (ResponseDiagnostics & { kind: "json_error" })
  | (ResponseDiagnostics & { kind: "contract_error" });

/** Read the actual response text once, then classify transport, JSON and contract failures separately. */
export async function readRoutineApiResponse(
  response: Response,
  options: { includeRawBody?: boolean } = {},
): Promise<RoutineApiReadResult> {
  const raw = await response.text().catch(() => null);
  const diagnostics: ResponseDiagnostics = {
    status: response.status,
    ok: response.ok,
    jsonParsed: false,
    contractParsed: false,
    ...(options.includeRawBody && raw !== null ? { rawBody: raw } : {}),
  };
  if (!response.ok) return { kind: "http_error", ...diagnostics };
  if (raw === null) return { kind: "json_error", ...diagnostics };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
    diagnostics.jsonParsed = true;
  } catch {
    return { kind: "json_error", ...diagnostics };
  }
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return { kind: "contract_error", ...diagnostics };
  }
  const parsed = routineSchema.safeParse(payload.data);
  if (!parsed.success) return { kind: "contract_error", ...diagnostics };
  diagnostics.contractParsed = true;
  const responseResult = (payload as Record<string, unknown>).generationResult;
  const generationResult: RoutineGenerationResult = isRoutineGenerationResult(responseResult)
    ? responseResult
    : parsed.data.decision_snapshot?.planner?.generationSource === "deterministic_fallback"
      ? "deterministic_fallback"
      : "generated";
  const responseExplanation = (payload as Record<string, unknown>).generationExplanation;
  return {
    kind: "success",
    ...diagnostics,
    routine: parsed.data,
    generationResult,
    ...(typeof responseExplanation === "string" && responseExplanation.trim()
      ? { generationExplanation: responseExplanation.trim() }
      : {}),
  };
}

function isRoutineGenerationResult(value: unknown): value is RoutineGenerationResult {
  return value === "generated"
    || value === "reused"
    || value === "retained_after_failure"
    || value === "retained_previous"
    || value === "deterministic_fallback";
}
