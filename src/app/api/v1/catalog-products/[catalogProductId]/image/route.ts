import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ catalogProductId: string }> },
) {
  const parsedId = z.uuid().safeParse((await params).catalogProductId);
  if (!parsedId.success) return new Response(null, { status: 404, headers: noStoreHeaders });

  const { data, error } = await createAdminClient()
    .from("catalog_products")
    .select("catalog_image_url")
    .eq("id", parsedId.data)
    .in("status", ["candidate", "verified"])
    .maybeSingle();
  if (error) return new Response(null, { status: 502, headers: noStoreHeaders });
  if (!data?.catalog_image_url) return new Response(null, { status: 404, headers: noStoreHeaders });

  try {
    const source = new URL(data.catalog_image_url);
    if (source.protocol !== "https:" || !isAllowedHost(source.hostname)) {
      return new Response(null, { status: 502, headers: noStoreHeaders });
    }

    const upstream = await fetch(source, {
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!upstream.ok || !contentType || !imageTypes.has(contentType)) {
      await upstream.body?.cancel();
      return new Response(null, { status: 502, headers: noStoreHeaders });
    }

    const contentLength = Number(upstream.headers.get("content-length"));
    if (contentLength > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
      return new Response(null, { status: 502, headers: noStoreHeaders });
    }
    const bytes = await readBoundedImage(upstream.body);
    if (!bytes) return new Response(null, { status: 502, headers: noStoreHeaders });

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: noStoreHeaders });
  }
}

function isAllowedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/u.test(host)) return false;
  return true;
}

async function readBoundedImage(body: ReadableStream<Uint8Array> | null) {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return null;
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
