import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    token: "download-token-123"
  });
}
