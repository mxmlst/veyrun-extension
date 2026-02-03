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
      resource: "/article",
      amount: "1.00"
    });
    const headers = new Headers();
    headers.set(receiptHeader.header, receiptHeader.value);
    return NextResponse.json(
      {
        content:
          "You unlocked the article. This is premium content delivered after a mock payment."
      },
      { status: 200, headers }
    );
  }

  const requiredHeader = buildPaymentRequiredHeader({
    amount: "1.00",
    nonce: "article"
  });
  const headers = new Headers();
  headers.set(requiredHeader.header, requiredHeader.value);
  return NextResponse.json({ error: "Payment Required" }, { status: 402, headers });
}