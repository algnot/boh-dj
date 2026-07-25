import { NextResponse } from "next/server";
import { pushRoomText } from "@/lib/line-bot";
import { claimTrackScore } from "@/lib/room-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params;

  try {
    const body = (await request.json()) as { playId?: unknown };
    const playId = typeof body.playId === "string" ? body.playId : "";
    if (!playId) {
      return NextResponse.json({ error: "playId required" }, { status: 400 });
    }

    const score = await claimTrackScore(roomId, playId);
    if (!score) {
      return NextResponse.json({ ok: false, reason: "no_score" });
    }

    const owner = score.ownerName || "ใครบางคน";
    const likers = score.likerNames.slice(0, 5).join(", ");
    const more = score.likerNames.length > 5 ? " และอีกหลายคน" : "";

    const lines = [
      `จบเพลงแล้ว "${score.trackTitle}"`,
      "",
      `${owner} ได้ ${score.points} คะแนน`,
    ];
    if (likers) lines.push(`ถูกใจโดย ${likers}${more}`);

    await pushRoomText(roomId, lines.join("\n"));
    return NextResponse.json({ ok: true, points: score.points });
  } catch (error) {
    console.error("track-score notify error", error);
    return NextResponse.json({ error: "notify failed" }, { status: 500 });
  }
}
