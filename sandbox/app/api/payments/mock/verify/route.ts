import { NextResponse } from "next/server";
import { buildPaymentResponseHeader, isValidSignature } from "../../../../../lib/mockPayments";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const signature = typeof body.signature === "string" ? body.signature : null;
  const resource = typeof body.resource === "string" ? body.resource : "unknown";
  const amount = typeof body.amount === "string" ? body.amount : "1.00";

  if (!isValidSignature(signature)) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  const receiptHeader = buildPaymentResponseHeader({ resource, amount });
  return NextResponse.json({ ok: true, receipt: receiptHeader.receipt });
}