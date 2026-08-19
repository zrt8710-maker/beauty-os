import { NextResponse } from "next/server";

export const purchaseNoStoreHeaders = { "Cache-Control": "private, no-store" };
export function purchaseErrorResponse(status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) { return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers: purchaseNoStoreHeaders }); }
