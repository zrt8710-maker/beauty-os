import { describe, expect, it } from "vitest";

import { IncrementalReplyJsonExtractor, readStructuredResponseStream } from "@/server/skin-conversation/structured-reply-stream";

describe("structured reply streaming", () => {
  it("emits only the top-level reply across arbitrary chunks without exposing JSON", () => {
    const extractor = new IncrementalReplyJsonExtractor();
    const raw = '{"reply":"他说：\\"好\\"\\n下一行 \\u4f60\\u597d","readiness":"ready","confidence":80}';
    const parts = [raw.slice(0, 12), raw.slice(12, 24), raw.slice(24, 39), raw.slice(39)];
    const visible = parts.flatMap((part) => extractor.push(part)).join("");
    expect(visible).toBe('他说："好"\n下一行 你好');
    expect(visible).not.toContain("readiness");
  });

  it("accumulates provider output while forwarding only reply deltas", async () => {
    const encoder = new TextEncoder();
    const first = '{"reply":"先看'; const second = '看脸颊。","daily_state":null}';
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: first })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: second })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.completed" })}\n\n`));
      controller.close();
    } });
    const extractor = new IncrementalReplyJsonExtractor(); const visible: string[] = []; let events = 0;
    const output = await readStructuredResponseStream(body, { onFirstEvent: () => { events += 1; }, onOutputTextDelta: (delta) => visible.push(...extractor.push(delta)) });
    expect(output).toBe(first + second);
    expect(visible.join("")).toBe("先看看脸颊。");
    expect(events).toBe(1);
  });
});
