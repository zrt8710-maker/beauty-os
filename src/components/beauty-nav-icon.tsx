import type { SVGProps } from "react";

export type BeautyNavIconName =
  | "home" | "today" | "inventory" | "profile" | "daily-skin"
  | "care-preferences" | "weather" | "knowledge" | "add-product"
  | "notification" | "am" | "pm" | "usage-feedback" | "edit" | "save" | "back";

type BeautyNavIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  active?: boolean;
  name: BeautyNavIconName;
  size?: 16 | 20 | 24;
};

const accentByName: Record<BeautyNavIconName, string> = {
  home: "var(--blossom)", today: "var(--apricot)", inventory: "var(--lavender)", profile: "var(--petal)",
  "daily-skin": "var(--blossom)", "care-preferences": "var(--lavender)", weather: "var(--apricot)",
  knowledge: "var(--lavender)", "add-product": "var(--petal)", notification: "var(--blossom)",
  am: "var(--apricot)", pm: "var(--lavender)", "usage-feedback": "var(--mint)", edit: "var(--petal)",
  save: "var(--mint)", back: "var(--lavender)",
};

export function BeautyNavIcon({ active = false, name, size = 20, ...props }: BeautyNavIconProps) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  const accent = active ? accentByName[name] : "none";

  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size} {...props}>
      {name === "home" ? <><ellipse {...common} cx="12" cy="9" fill={accent} rx="5.2" ry="5.8" /><path {...common} d="M12 14.8v3.1M8.2 20h7.6M9.6 17.9h4.8" /><path {...common} d="M8.7 7.6c.8-1.5 2.1-2.4 3.8-2.5" strokeWidth="1.35" /></> : null}
      {name === "today" ? <><path {...common} d="M6.4 13a5.6 5.6 0 0 1 11.2 0" fill={accent} /><path {...common} d="M4 13h16M12 3.5v2M5.8 6.7l1.4 1.4M18.2 6.7l-1.4 1.4" /><path {...common} d="M6 18h12" strokeWidth="1.35" /><circle cx="7" cy="18" fill="currentColor" r="1" /><circle cx="12" cy="18" fill="currentColor" r="1" /><circle cx="17" cy="18" fill="currentColor" r="1" /></> : null}
      {name === "inventory" ? <><path {...common} d="M4.5 19.2c3.9 1.5 11.1 1.5 15 0M5.5 16.8h13" /><path {...common} d="M7.1 8.2h4.2v8.6H7.1z" fill={accent} /><path {...common} d="M7.9 5.5h2.6v2.7M14.1 10.4h3.2l.8 6.4h-4.8zM14.7 8.1h2" /></> : null}
      {name === "profile" ? <><path {...common} d="M6.2 4.2h9.1l2.5 2.5v13.1H6.2z" fill={accent} /><path {...common} d="M15.3 4.2v2.6h2.5M12.7 8.2c-1.9.2-3.2 1.6-3.2 3.4 0 1.7 1.1 2.9 2.7 3.2-.3 1-1.1 1.7-2.2 2.1M12.5 10.2h.1" /></> : null}
      {name === "daily-skin" ? <><path {...common} d="M12 3.8c2.6 3.3 4.6 5.8 4.6 8.7a4.6 4.6 0 0 1-9.2 0c0-2.9 2-5.4 4.6-8.7Z" fill={accent} /><path {...common} d="M9.8 13.3c.4 1 1.2 1.6 2.3 1.7" strokeWidth="1.35" /></> : null}
      {name === "care-preferences" ? <><path {...common} d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3" /><circle {...common} cx="16" cy="7" fill={accent} r="2" /><circle {...common} cx="9" cy="12" fill={accent} r="2" /><circle {...common} cx="14" cy="17" fill={accent} r="2" /></> : null}
      {name === "weather" ? <><path {...common} d="M8.2 15.8h8.4a3.1 3.1 0 0 0 .2-6.2A5 5 0 0 0 7.4 8a3.9 3.9 0 0 0 .8 7.8Z" fill={accent} /><path {...common} d="M16.8 4.3V2.8M20 5.5l1-1M20.5 8.8H22" strokeWidth="1.35" /></> : null}
      {name === "knowledge" ? <><path {...common} d="M4.8 5.2h4.1c1.7 0 3.1 1.1 3.1 2.7v11c0-1.6-1.4-2.7-3.1-2.7H4.8zM19.2 5.2h-4.1c-1.7 0-3.1 1.1-3.1 2.7v11c0-1.6 1.4-2.7 3.1-2.7h4.1z" fill={accent} /><path {...common} d="M7.2 9h2.2M14.6 9h2.2" strokeWidth="1.35" /></> : null}
      {name === "add-product" ? <><path {...common} d="M5.5 8.2h7.1v11H5.5z" fill={accent} /><path {...common} d="M7 5h4.1v3.2M16.8 9.2v7.2M13.2 12.8h7.2" /></> : null}
      {name === "notification" ? <><path {...common} d="M7 10.2a5 5 0 0 1 10 0v3.4l1.4 2.4H5.6L7 13.6z" fill={accent} /><path {...common} d="M10 18.3a2.2 2.2 0 0 0 4 0" /></> : null}
      {name === "am" ? <><path {...common} d="M6.2 14a5.8 5.8 0 0 1 11.6 0" fill={accent} /><path {...common} d="M4 14h16M12 3.5v2.2M5.7 7.1l1.5 1.5M18.3 7.1l-1.5 1.5M7 18.5h10" /></> : null}
      {name === "pm" ? <><path {...common} d="M16.7 16.8A7.2 7.2 0 0 1 8 5.4a7.2 7.2 0 1 0 8.7 11.4Z" fill={accent} /><path {...common} d="m17.5 5 .4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z" strokeWidth="1.35" /></> : null}
      {name === "usage-feedback" ? <><path {...common} d="M4.5 5.5h15v10.2H10l-4.2 3v-3H4.5z" fill={accent} /><path {...common} d="m8.3 10.8 2.1 2 5-5" /></> : null}
      {name === "edit" ? <><path {...common} d="m6 15.7-.8 3.1 3.1-.8L17.5 8.8l-2.3-2.3z" fill={accent} /><path {...common} d="m13.8 7.9 2.3 2.3M5.5 20h13" /></> : null}
      {name === "save" ? <><path {...common} d="M5 4.5h12l2 2v13H5z" fill={accent} /><path {...common} d="M8 4.5v5h7v-5M8 15.1l2.2 2 4.5-4.6" /></> : null}
      {name === "back" ? <><path {...common} d="m10.2 5.2-6.3 6.3 6.3 6.3M4.4 11.5h9.1c3.5 0 5.6 1.8 6.1 5" /><circle cx="10.2" cy="5.2" fill={active ? accentByName.back : "currentColor"} r=".8" /></> : null}
    </svg>
  );
}
