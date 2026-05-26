import { NextResponse } from "next/server";
import { buildDemoReceipt } from "@/lib/receipt";
export async function GET(req: Request) {
  if (!req.headers.get("x-payment")) return new NextResponse("Payment Required", { status: 402 });
  return NextResponse.json({ ok: true, receipt: buildDemoReceipt() });
}
