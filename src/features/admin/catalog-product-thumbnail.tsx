"use client";

import { useState } from "react";

export function CatalogProductThumbnail({ imageUrl, productName }: { imageUrl: string | null; productName: string }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return <div aria-label={`${productName} 暂无可用产品图片`} className="h-16 w-16 rounded-lg border bg-muted/30" role="img" />;
  return <img alt={`${productName} 产品图`} className="h-16 w-16 rounded-lg border object-contain" onError={() => setFailed(true)} src={imageUrl} />;
}
