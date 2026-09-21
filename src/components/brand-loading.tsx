import Image from "next/image";

/** Reuses the symbol in the existing brand image without redrawing the logo. */
export function BrandLoading({ label = "正在整理…" }: { label?: string }) {
  return (
    <div className="beauty-brand-loading" role="status">
      <span className="beauty-brand-loading-symbol" aria-hidden="true">
        <Image alt="" src="/brand/beauty-os-watermark.png" width={128} height={85} unoptimized />
      </span>
      <span>{label}</span>
    </div>
  );
}
