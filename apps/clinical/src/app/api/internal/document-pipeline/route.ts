import { NextRequest, NextResponse } from "next/server";
import { drainDocumentPipeline } from "@/lib/documents/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  try {
    await drainDocumentPipeline();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "retry_scheduled" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
