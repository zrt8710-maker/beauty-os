import "server-only";

import { z } from "zod";

import type { ProductRecognitionRequest } from "@/schemas/product-recognition";
import type { ProductRecognitionProvider } from "@/server/product-recognition/provider";

const URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const observedSchema = z.object({
  value: z.string().trim().min(1).max(500),
  type: z.enum(["brand", "product_name", "package_size", "barcode", "marketing_text", "unknown"]),
}).strict();
const outputSchema = z.object({
  candidates: z.array(z.object({
    brand_name: z.string().trim().min(1).max(120).nullable(),
    product_name: z.string().trim().min(1).max(200).nullable(),
    confidence: z.number().min(0).max(100),
    observed_text: z.array(observedSchema).max(30),
  }).strict()).max(3),
}).strict();

export function createBailianProductRecognitionProvider(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): ProductRecognitionProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    providerCode: "bailian_product_recognition",
    executionPolicy: "on_empty_result",
    async recognize(input) {
      try {
        const response = await fetchImpl(URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody(options.model, input)),
        });
        if (!response.ok) return [];
        const envelope = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = envelope.choices?.[0]?.message?.content;
        if (typeof content !== "string") return [];
        const raw = unwrap(content);
        const parsed = outputSchema.safeParse(normalize(raw));
        if (!parsed.success) return [];
        return parsed.data.candidates.map((candidate) => ({
          ...candidate,
          confidence: Math.round(candidate.confidence),
          recognition_reference: null,
        }));
      } catch {
        return [];
      }
    },
  };
}

export function createConfiguredBailianProductRecognitionProvider(): ProductRecognitionProvider | null {
  const apiKey = process.env.BAILIAN_API_KEY?.trim();
  const model = process.env.BAILIAN_MODEL?.trim();
  return apiKey && model ? createBailianProductRecognitionProvider({ apiKey, model }) : null;
}

function requestBody(model: string, input: ProductRecognitionRequest) {
  return {
    model,
    response_format: { type: "json_object" },
    messages: [{
      role: "system",
      content: [
        "你是包装视觉文字观察器，只记录图片或用户文字中明确可见的内容。",
        "仅返回 JSON：{candidates:[{brand_name,product_name,confidence,observed_text:[{value,type}]}]}。",
        "type 只能是 brand、product_name、package_size、barcode、marketing_text、unknown。",
        "允许抄录品牌、完整产品名称、明确容量、条码和宣传文字。",
        "禁止推断产品类型、规格版本、功效、成分、适用肤质或真实商品身份。看不到就填 null，不得猜测。",
      ].join(""),
    }, {
      role: "user",
      content: input.mode === "image"
        ? [...input.images.map((image) => ({ type: "image_url", image_url: { url: image.data_url } })), { type: "text", text: "请逐字观察包装。" }]
        : [{ type: "text", text: `品牌文字：${input.brand_name ?? "未提供"}\n产品名称文字：${input.product_name}` }],
    }],
  };
}

function unwrap(content: string): unknown {
  let value = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  for (let index = 0; index < 2; index += 1) {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "string") return parsed;
    value = parsed;
  }
  return value;
}

function normalize(value: unknown): unknown {
  const root = isRecord(value) ? value : null;
  const list = Array.isArray(root?.candidates) ? root.candidates : root ? [root] : [];
  return { candidates: list.map((item) => normalizeCandidate(item)) };
}

function normalizeCandidate(value: unknown) {
  if (!isRecord(value)) return value;
  const brand = text(value.brand_name ?? value.brand);
  const product = text(value.product_name ?? value.product ?? value.name);
  const supplied = Array.isArray(value.observed_text) ? value.observed_text : [];
  const observed = supplied.map(normalizeObserved).filter((item) => item !== null);
  return {
    brand_name: brand,
    product_name: product,
    confidence: normalizeConfidence(value.confidence),
    observed_text: observed.length > 0 ? observed : [
      ...(brand ? [{ value: brand, type: "brand" }] : []),
      ...(product ? [{ value: product, type: "product_name" }] : []),
    ],
  };
}

function normalizeObserved(value: unknown) {
  if (!isRecord(value)) return null;
  const itemValue = text(value.value ?? value.text);
  const rawType = text(value.type ?? value.observed_text_type);
  if (!itemValue || !rawType) return null;
  const aliases: Record<string, string> = { marketing_claim: "marketing_text", variant: "package_size" };
  const type = aliases[rawType] ?? rawType;
  return ["brand", "product_name", "package_size", "barcode", "marketing_text", "unknown"].includes(type)
    ? { value: itemValue, type }
    : { value: itemValue, type: "unknown" };
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return 0;
  return number > 0 && number <= 1 ? Math.round(number * 100) : Math.round(number);
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
