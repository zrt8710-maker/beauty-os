import "server-only";

export type OpenVikingMemory = { abstract: string; score: number | null; matchReason: string | null };

export type OpenVikingClient = {
  createSession(): Promise<string>;
  addMessage(sessionId: string, message: { role: "user" | "assistant"; content: string }): Promise<void>;
  commitSession(sessionId: string): Promise<void>;
  findMemories(input: { query: string; limit: number; scoreThreshold?: number }): Promise<OpenVikingMemory[]>;
};

const REQUEST_TIMEOUT_MS = 3000;
// Commit triggers server-side memory extraction, unlike the lightweight find,
// session-create, and message-add calls. The measured commit response exceeded
// the shared 3s budget, so it gets a bounded endpoint-specific allowance.
const SESSION_COMMIT_TIMEOUT_MS = 10_000;
type OpenVikingRequestStage = "session_create" | "message_add" | "session_commit" | "memory_find";

class OpenVikingRequestError extends Error {
  constructor(
    readonly stage: OpenVikingRequestStage,
    readonly kind: "http" | "timeout" | "network" | "invalid_response",
    readonly httpStatus: number | null,
  ) {
    super(kind === "http" ? `OPENVIKING_HTTP_${httpStatus}` : `OPENVIKING_${kind.toUpperCase()}`);
    this.name = "OpenVikingRequestError";
  }
}

/**
 * This integration is deliberately unavailable in production. A single fixed
 * credential has one OpenViking identity and is not a Beauty OS multi-user
 * boundary. Production must use per-user credentials, trusted identity, or OIDC.
 */
export function createConfiguredOpenVikingClient(): OpenVikingClient | null {
  if (process.env.OPENVIKING_MEMORY_MODE !== "single_user_dev") return null;
  if (process.env.NODE_ENV === "production") return null;
  const baseUrl = process.env.OPENVIKING_BASE_URL?.trim().replace(/\/$/u, "");
  const apiKey = process.env.OPENVIKING_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return createOpenVikingClient({ baseUrl, apiKey });
}

export function createOpenVikingClient(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): OpenVikingClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = async (stage: OpenVikingRequestStage, path: string, body?: unknown) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      stage === "session_commit" ? SESSION_COMMIT_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(`${options.baseUrl.replace(/\/$/u, "")}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new OpenVikingRequestError(stage, "http", response.status);
      try {
        const payload = await response.json() as unknown;
        logRequest(stage, startedAt, { request_status: "success", http_status: response.status });
        return payload;
      } catch {
        throw new OpenVikingRequestError(stage, "invalid_response", response.status);
      }
    } catch (error) {
      const requestError = error instanceof OpenVikingRequestError
        ? error
        : new OpenVikingRequestError(stage, controller.signal.aborted ? "timeout" : "network", null);
      logRequest(stage, startedAt, {
        request_status: "failed",
        error_kind: requestError.kind,
        http_status: requestError.httpStatus,
      });
      throw requestError;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    async createSession() {
      const payload = await request("session_create", "/api/v1/sessions", {});
      const sessionId = readString(payload, ["result", "session_id"]) ?? readString(payload, ["session_id"]);
      if (!sessionId) throw new Error("OPENVIKING_SESSION_ID_MISSING");
      return sessionId;
    },
    async addMessage(sessionId, message) {
      await request("message_add", `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, message);
    },
    async commitSession(sessionId) {
      await request("session_commit", `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {});
    },
    async findMemories(input) {
      const payload = await request("memory_find", "/api/v1/search/find", {
        query: input.query,
        context_type: "memory",
        target_uri: "viking://~/memories",
        limit: input.limit,
        ...(input.scoreThreshold === undefined ? {} : { score_threshold: input.scoreThreshold }),
      });
      const memories = readArray(payload, ["result", "memories"]);
      return memories.flatMap((entry) => {
        const abstract = readString(entry, ["abstract"]);
        if (!abstract) return [];
        return [{ abstract: abstract.slice(0, 500), score: readNumber(entry, ["score"]), matchReason: readString(entry, ["match_reason"]) }];
      });
    },
  };
}

function logRequest(stage: OpenVikingRequestStage, startedAt: number, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info("[openviking-memory]", { stage: `openviking_${stage}`, durationMs: Date.now() - startedAt, ...details });
  }
}

function readObject(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function readString(value: unknown, path: string[]) { const result = readObject(value, path); return typeof result === "string" ? result : null; }
function readNumber(value: unknown, path: string[]) { const result = readObject(value, path); return typeof result === "number" && Number.isFinite(result) ? result : null; }
function readArray(value: unknown, path: string[]) { const result = readObject(value, path); return Array.isArray(result) ? result : []; }
