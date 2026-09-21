import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BeautyNavIcon, type BeautyNavIconName } from "@/components/beauty-nav-icon";

const names: BeautyNavIconName[] = [
  "home", "today", "inventory", "profile", "daily-skin", "care-preferences",
  "weather", "knowledge", "add-product", "notification", "am", "pm",
  "usage-feedback", "edit", "save", "back",
];
const sizes = [16, 20, 24] as const;

describe("BeautyNavIcon", () => {
  it.each(names)("%s 在 16/20/24px 都保持 24px viewBox", (name) => {
    for (const size of sizes) {
      const markup = renderToStaticMarkup(<BeautyNavIcon name={name} size={size} />);
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain(`height="${size}"`);
      expect(markup).toContain(`width="${size}"`);
      expect(markup).toContain('stroke="currentColor"');
    }
  });

  it.each(names)("%s inactive 单色、active 才使用 accent fill", (name) => {
    const inactive = renderToStaticMarkup(<BeautyNavIcon name={name} />);
    const active = renderToStaticMarkup(<BeautyNavIcon active name={name} />);

    expect(inactive).not.toContain("var(--blossom)");
    expect(inactive).not.toContain("var(--apricot)");
    expect(inactive).not.toContain("var(--lavender)");
    expect(inactive).not.toContain("var(--petal)");
    expect(inactive).not.toContain("var(--mint)");
    expect(active).toMatch(/var\(--(blossom|apricot|lavender|petal|mint)\)/);
  });
});
