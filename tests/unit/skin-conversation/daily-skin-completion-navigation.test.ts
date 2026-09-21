import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Daily Skin completion navigation", () => {
  it("keeps the saved state visible and offers both Today and the saved record", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/features/skin-conversation/skin-conversation.tsx"),
      "utf8",
    );

    expect(source).not.toContain("router.push(`/check-in");
    expect(source).toContain('render={<Link href="/today/am" />}');
    expect(source).toContain("查看今日记录");
    expect(source).toContain('status !== "saved" ? <ChatComposer');
  });

  it("uses one Home composer shell with inline actions and an icon send button", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/features/skin-conversation/skin-conversation.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      path.join(process.cwd(), "src/features/chat/chat-shell.tsx"),
      "utf8",
    );

    expect(shell).toContain('rows={roomy ? 1 : 2}');
    expect(shell).toContain('"max-h-[120px] w-full resize-none');
    expect(shell).toContain('roomy ? "block min-h-[52px] px-5 pt-4 pb-3 leading-6"');
    expect(source).toContain('roomy={presentation === "home"}');
    expect(shell).toContain('aria-label="发送"');
    expect(shell).toContain("<SendIcon />");
    expect(source.indexOf("手动记录")).toBeLessThan(source.indexOf("结束并整理今日状态"));
    expect(source).toContain("isHomePresentation ? topActions : null");
    expect(shell).toContain('"relative min-h-0 flex-1 space-y-4 overflow-y-auto');
    expect(shell).toContain('sm:max-w-[64%]');
    expect(shell).toContain('sm:max-w-[76%]');
    expect(shell).toContain('max-h-[176px]');
    expect(source).toContain('messages.every((message) => message.kind === "opening") ? [] : messages');
    expect(source).toContain('showHomeWatermark = isHomePresentation && visibleMessages.length === 0');
    expect(source).toContain('/brand/beauty-os-watermark.png');
    expect(source).toContain('w-[280px] opacity-[0.1] sm:w-[470px]');
  });
});
