import "server-only";

/**
 * Extracts only the top-level JSON `reply` string while retaining the original
 * structured output for the existing server-side validator. This is a JSON
 * state machine, not a pattern match: quoted text, escaped characters,
 * unicode escapes, and arbitrary provider chunk boundaries are handled by
 * JSON.parse before a user-visible delta is emitted.
 */
export class IncrementalReplyJsonExtractor {
  private depth = 0;
  private expectingKey = false;
  private pendingKey: string | null = null;
  private awaitingValue = false;
  private stringKind: "key" | "reply" | "other" | null = null;
  private escaped = false;
  private rawString = "";
  private emittedReply = "";
  private replyComplete = false;

  push(fragment: string): string[] {
    const deltas: string[] = [];
    for (const character of fragment) {
      if (this.stringKind !== null) {
        this.consumeStringCharacter(character, deltas);
        continue;
      }
      this.consumeStructuralCharacter(character);
    }
    return deltas;
  }

  private consumeStructuralCharacter(character: string) {
    if (character === "{") {
      this.depth += 1;
      if (this.depth === 1) this.expectingKey = true;
      return;
    }
    if (character === "}" || character === "]") {
      this.depth = Math.max(0, this.depth - 1);
      return;
    }
    if (character === "[") {
      this.depth += 1;
      return;
    }
    if (character === "," && this.depth === 1) {
      this.expectingKey = true;
      this.pendingKey = null;
      this.awaitingValue = false;
      return;
    }
    if (character === ":" && this.depth === 1 && this.pendingKey !== null) {
      this.awaitingValue = true;
      this.expectingKey = false;
      return;
    }
    if (character !== '"') return;
    if (this.depth === 1 && this.expectingKey) this.stringKind = "key";
    else if (this.depth === 1 && this.awaitingValue && this.pendingKey === "reply" && !this.replyComplete) this.stringKind = "reply";
    else this.stringKind = "other";
    this.escaped = false;
    this.rawString = "";
  }

  private consumeStringCharacter(character: string, deltas: string[]) {
    if (this.escaped) {
      this.rawString += character;
      this.escaped = false;
      this.emitDecodableReplyDelta(deltas);
      return;
    }
    if (character === "\\") {
      this.rawString += character;
      this.escaped = true;
      return;
    }
    if (character === '"') {
      const completed = this.stringKind;
      if (completed === "key") {
        this.pendingKey = decodeJsonString(this.rawString);
        this.expectingKey = false;
      }
      if (completed === "reply") {
        this.emitDecodableReplyDelta(deltas);
        this.replyComplete = true;
        this.awaitingValue = false;
      }
      this.stringKind = null;
      this.rawString = "";
      return;
    }
    this.rawString += character;
    this.emitDecodableReplyDelta(deltas);
  }

  private emitDecodableReplyDelta(deltas: string[]) {
    if (this.stringKind !== "reply") return;
    let decoded: string;
    try {
      decoded = decodeJsonString(this.rawString);
    } catch {
      return;
    }
    if (!decoded.startsWith(this.emittedReply)) return;
    const delta = decoded.slice(this.emittedReply.length);
    if (delta) {
      this.emittedReply = decoded;
      deltas.push(delta);
    }
  }
}

export async function readStructuredResponseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: { onFirstEvent: () => void; onOutputTextDelta: (delta: string) => void },
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let receivedEvent = false;
  let completed = false;

  while (!completed) {
    const read = await reader.read();
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = parseSseFrame(buffer.slice(0, boundary).replace(/\r/g, ""));
      buffer = buffer.slice(boundary + 2);
      if (!event) continue;
      if (!receivedEvent) {
        receivedEvent = true;
        callbacks.onFirstEvent();
      }
      if (event.type === "response.output_text.delta") {
        if (typeof event.delta !== "string") throw new Error("MALFORMED_OUTPUT_TEXT_DELTA");
        outputText += event.delta;
        callbacks.onOutputTextDelta(event.delta);
      }
      if (event.type === "response.completed") completed = true;
    }
  }

  if (!receivedEvent || !completed || !outputText.trim()) throw new Error("INCOMPLETE_SKIN_CONVERSATION_STREAM");
  return outputText;
}

function parseSseFrame(frame: string): Record<string, unknown> | null {
  const data = frame.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new Error("MALFORMED_SSE_EVENT");
  }
  return parsed as Record<string, unknown>;
}

function decodeJsonString(raw: string) {
  return JSON.parse(`"${raw}"`) as string;
}
