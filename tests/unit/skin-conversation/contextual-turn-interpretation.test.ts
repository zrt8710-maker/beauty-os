import { describe, expect, it } from "vitest";

import { deriveActiveQuestionContext, parseDeterministicShortAnswer } from "@/server/skin-conversation/contextual-turn-interpretation";

function context(question: string) { return deriveActiveQuestionContext({ active_turn_context: [`Beauty OS：${question}`], existing_checkin: null }); }

describe("contextual Daily Skin turn interpretation", () => {
  it("maps a T-zone fragment to the area asked for oiliness", () => {
    expect(parseDeterministicShortAnswer("T区", context("主要是哪些部位出油比较明显呀？"))).toMatchObject({ kind: "area", value: "t_zone" });
  });
  it("understands timing and severity fragments in their question context", () => {
    expect(parseDeterministicShortAnswer("下午", context("出油是什么时候更明显？"))).toMatchObject({ kind: "timing", value: "下午" });
    expect(parseDeterministicShortAnswer("一点点", context("鼻翼起皮程度明显吗，还是一点点？"))).toMatchObject({ kind: "severity", value: "一点点" });
  });
  it("only reads absence and count with an explicit relevant question", () => {
    expect(parseDeterministicShortAnswer("没有", context("今天有刺痛或发痒吗？"))).toMatchObject({ kind: "absence" });
    expect(parseDeterministicShortAnswer("三颗", context("新痘大概有几颗？"))).toMatchObject({ kind: "amount", value: "三颗" });
    expect(parseDeterministicShortAnswer("没有", context("主要是哪些部位出油？"))).toBeNull();
  });
  it("leaves ambiguous fragments for a natural clarification", () => {
    expect(parseDeterministicShortAnswer("那里", context("主要是哪些部位出油？"))).toBeNull();
  });
});
