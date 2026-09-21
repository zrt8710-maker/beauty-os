import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { createRequestProductRecognitionService } from "@/server/product-recognition/product-recognition-composition";
import { issueRecognitionReference } from "@/server/product-recognition/recognition-confirmation-token";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "UNAUTHORIZED", "请先登录。");

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const service = await createRequestProductRecognitionService();
    const result = await service.recognize(input);
    return NextResponse.json({
      data: {
        ...result,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          ...issueRecognitionReference(user.id, candidate),
        })),
      },
    }, { headers });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "PRODUCT_RECOGNITION_INVALID",
        "产品识别线索不符合要求。",
        error.flatten().fieldErrors,
      );
    }
    return errorResponse(500, "PRODUCT_RECOGNITION_FAILED", "暂时无法识别该产品。");
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status, headers },
  );
}
