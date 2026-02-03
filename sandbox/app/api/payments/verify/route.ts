import { NextResponse } from "next/server";
import { verifyPayment } from "../../../../lib/verifyPayment";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const txHash = typeof body.txHash === "string" ? body.txHash : null;
  const recipient = typeof body.recipient === "string" ? body.recipient : null;
  const amount = typeof body.amount === "string" ? body.amount : null;
  const resource = typeof body.resource === "string" ? body.resource : undefined;

  if (!txHash || !recipient || !amount) {
    return NextResponse.json(
      { ok: false, error: "Missing fields" },
      { status: 400 }
    );
  }

  try {
    const receipt = await verifyPayment({ txHash, recipient, amount, resource });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 400 }
    );
  }
}