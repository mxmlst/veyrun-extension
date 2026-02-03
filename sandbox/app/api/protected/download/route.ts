import { NextRequest, NextResponse } from "next/server";
import { HEADER_PAYMENT_SIGNATURE } from "@veyrun/shared";
import {
  buildPaymentRequiredHeader,
  buildPaymentResponseHeader,
  isValidSignature
} from "../../../../lib/mockPayments";

export async function GET(request: NextRequest) {
  const signature = request.headers.get(HEADER_PAYMENT_SIGNATURE);

  if (isValidSignature(signature)) {
    const receiptHeader = buildPaymentResponseHeader({
      resource: "/download",
      amount: "2.50"
    });
    const headers = new Headers();
    headers.set(receiptHeader.header, receiptHeader.value);
    return NextResponse.json(
      {
        token: "download-token-123"
      },
      { status: 200, headers }
    );
  }

  const requiredHeader = buildPaymentRequiredHeader({
    amount: "2.50",
    nonce: "download"
  });
  const headers = new Headers();
  headers.set(requiredHeader.header, requiredHeader.value);
  return NextResponse.json({ error: "Payment Required" }, { status: 402, headers });
}