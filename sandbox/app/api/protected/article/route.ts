import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    content:
      "You unlocked the article. This is premium content delivered after a verified x402 payment."
  });
}
