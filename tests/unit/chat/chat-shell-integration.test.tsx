import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatBubble, ChatComposer, ChatShell } from "@/features/chat/chat-shell";
import { resolveHomeFeedbackAction, usageFeedbackHref, type HomeFeedbackRoutine } from "@/features/home/home-feedback-action";
import { UsageFeedbackConversation } from "@/features/usage-feedback-conversation/usage-feedback-conversation";
import type { Routine } from "@/schemas/routine";

describe("shared chat presentation", () => {
  it("provides shared bubbles and a single-shell icon composer", () => {
    const html = renderToStaticMarkup(
      <ChatShell
        composer={<ChatComposer onChange={() => undefined} onSend={() => undefined} placeholder="输入" value="" />}
        description="说明"
        title="标题"
      >
        <ChatBubble message={{ id: "a", role: "assistant", content: "你好" }} />
        <ChatBubble message={{ id: "u", role: "user", content: "还不错" }} />
      </ChatShell>,
    );

    expect(html).toContain('aria-label="Conversation messages"');
    expect(html).toContain('aria-label="Conversation composer"');
    expect(html).toContain('aria-label="发送"');
    expect(html).toContain('data-message-role="assistant"');
    expect(html).toContain('data-message-role="user"');
    expect(html).toContain("border-0 bg-transparent");
  });

  it("gives the Home composer content-like placeholder spacing without changing the shared default", () => {
    const roomy = renderToStaticMarkup(<ChatComposer onChange={() => undefined} onSend={() => undefined} placeholder="输入" roomy value="" />);
    const standard = renderToStaticMarkup(<ChatComposer onChange={() => undefined} onSend={() => undefined} placeholder="输入" value="" />);

    expect(roomy).toContain("min-h-[52px] px-5 pt-4 pb-3");
    expect(standard).not.toContain("px-5 pt-5");
  });

  it.each(["am", "pm"] as const)("keeps %s usage feedback on its period route without a Daily finalize action", (period) => {
    const routine = feedbackRoutine(period);
    const html = renderToStaticMarkup(<UsageFeedbackConversation routine={routine} />);

    expect(html).toContain(`href="/today/${period}"`);
    expect(html).toContain("Conversation composer");
    expect(html).toContain("和 Beauty OS 聊聊");
    expect(html).not.toContain("结束并整理今日状态");
  });

  it("routes Home feedback with both routine identity and period context", () => {
    expect(usageFeedbackHref({ id: "20000000-0000-4000-8000-000000000009", period: "pm" }))
      .toBe("/usage-feedback?routineId=20000000-0000-4000-8000-000000000009&period=pm");
  });

  it("resolves Home feedback as empty, direct, or AM/PM choice without inventing identity", () => {
    const am = feedbackIdentity("am", "8");
    const pm = feedbackIdentity("pm", "9");

    expect(resolveHomeFeedbackAction([])).toEqual({ kind: "empty" });
    expect(resolveHomeFeedbackAction([pm])).toEqual({ kind: "direct", routine: pm });
    expect(resolveHomeFeedbackAction([pm, am])).toEqual({ kind: "choose", routines: [am, pm] });
  });
});

function feedbackRoutine(period: "am" | "pm") {
  return {
    id: period === "am" ? "20000000-0000-4000-8000-000000000006" : "20000000-0000-4000-8000-000000000007",
    routine_date: "2026-09-18",
    period,
    status: "generated",
    steps: [],
    excluded_products: [],
  } as unknown as Routine;
}

function feedbackIdentity(period: "am" | "pm", suffix: string): HomeFeedbackRoutine {
  return { id: `20000000-0000-4000-8000-00000000000${suffix}`, period, status: "generated" };
}
