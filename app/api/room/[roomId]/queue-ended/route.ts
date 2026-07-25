import { NextResponse } from "next/server";
import { pushRoomText } from "@/lib/line-bot";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

const QUEUE_ENDED_TEXT = [
  "เพลงในคิวหมดแล้ว โบ้ขอพักก่อนนะ 🎧",
  "",
  "ส่งลิงก์ YouTube เข้ามาได้เลย เดี๋ยวจัดคิวให้ต่อ",
].join("\n");

export async function POST(
  _request: Request,
  context: RouteContext,
) {
  const { roomId } = await context.params;

  try {
    const sent = await pushRoomText(roomId, QUEUE_ENDED_TEXT);
    return NextResponse.json({ ok: sent });
  } catch (error) {
    console.error("queue-ended notify error", error);
    return NextResponse.json({ error: "notify failed" }, { status: 500 });
  }
}
