import { NextResponse } from "next/server";
export async function GET(req: Request) {
  if (!req.headers.get("x-payment")) return new NextResponse("Payment Required", { status: 402, headers: { "PAYMENT-REQUIREMENTS": "demo" } });
  return NextResponse.json({ ok: true, txHash: "0xdemo-protected" });
}
