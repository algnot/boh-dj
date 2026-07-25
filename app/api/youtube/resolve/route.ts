import { NextResponse } from "next/server";
import { resolveYoutubeVideoIdFromText } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }

  try {
    const videoId = await resolveYoutubeVideoIdFromText(q);
    if (!videoId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ videoId });
  } catch (error) {
    console.error("youtube resolve failed", error);
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }
}
