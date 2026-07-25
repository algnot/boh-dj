import { NextResponse } from "next/server";
import { SignatureValidationFailed } from "@line/bot-sdk";
import { handleLineWebhook } from "@/lib/line-bot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("x-line-signature") ?? "";
  const rawBody = await request.text();

  try {
    await handleLineWebhook(rawBody, signature);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SignatureValidationFailed) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    console.error("LINE webhook error", error);
    return NextResponse.json({ error: "webhook failed" }, { status: 500 });
  }
}
