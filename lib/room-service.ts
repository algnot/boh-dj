import { randomBytes } from "crypto";
import { getSupabase } from "@/lib/supabase/client";
import type {
  HistoryTrack,
  LineSourceType,
  LoopMode,
  QueueItem,
  Room,
  RoomSession,
} from "@/lib/types";
import {
  extractYoutubeVideoIdFromText,
  fetchYoutubeMeta,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import { logRoomEvent } from "@/lib/room-events";

const LOOP_ORDER: LoopMode[] = ["all", "one", "off"];

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function makeRoomId() {
  return randomBytes(4).toString("hex");
}

function makeToken() {
  return randomBytes(16).toString("hex");
}

function emptySession(roomId: string): RoomSession {
  const now = new Date().toISOString();
  return {
    room_id: roomId,
    current_video_id: null,
    current_title: "",
    current_thumbnail_url: "",
    playback_state: "paused",
    playback_position_ms: 0,
    playback_updated_at: now,
    duration_ms: 0,
    loop_mode: "all",
    host_client_id: null,
    history: [],
    updated_at: now,
  };
}

function parseHistory(raw: unknown): HistoryTrack[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.videoId !== "string") return null;
      return {
        videoId: row.videoId,
        title: typeof row.title === "string" ? row.title : row.videoId,
        thumbnailUrl:
          typeof row.thumbnailUrl === "string"
            ? row.thumbnailUrl
            : youtubeThumbnailUrl(row.videoId),
      };
    })
    .filter((item): item is HistoryTrack => Boolean(item));
}

export function normalizeSession(row: RoomSession): RoomSession {
  return {
    ...row,
    history: parseHistory(row.history),
  };
}

export function controlUrl(room: Room) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  if (liffId) {
    // Query params survive LIFF → Endpoint. Endpoint must be {APP_URL}/liff
    const qs = new URLSearchParams({
      room: room.id,
      t: room.control_token,
    });
    return `https://liff.line.me/${liffId}?${qs.toString()}`;
  }
  return `${appBaseUrl()}/control/${room.id}?t=${room.control_token}`;
}

export function displayUrl(roomId: string) {
  return `${appBaseUrl()}/display/${roomId}`;
}

export async function getOrCreateRoomForLineSource(args: {
  sourceType: LineSourceType;
  sourceId: string;
  createdByName?: string;
}): Promise<{ room: Room; created: boolean }> {
  const supabase = getSupabase();

  const existing = await supabase
    .from("rooms")
    .select("*")
    .eq("line_source_id", args.sourceId)
    .maybeSingle();

  if (existing.data) {
    return { room: existing.data as Room, created: false };
  }

  const room: Room = {
    id: makeRoomId(),
    line_source_type: args.sourceType,
    line_source_id: args.sourceId,
    control_token: makeToken(),
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("rooms")
    .insert(room)
    .select("*")
    .single();

  if (error) {
    // Race: another request created the room
    const again = await supabase
      .from("rooms")
      .select("*")
      .eq("line_source_id", args.sourceId)
      .maybeSingle();
    if (again.data) {
      return { room: again.data as Room, created: false };
    }
    throw error;
  }

  const createdRoom = data as Room;
  await supabase.from("room_sessions").upsert(emptySession(createdRoom.id));
  const creator = args.createdByName?.trim() || "โบ้";
  await logRoomEvent({
    roomId: createdRoom.id,
    eventType: "room_created",
    message: `${creator} สร้างห้องโบ้ DJ`,
    actor: { name: creator },
  });

  return { room: createdRoom, created: true };
}

export async function getRoomById(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  return (data as Room | null) ?? null;
}

export async function getRoomByLineSource(sourceId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("line_source_id", sourceId)
    .maybeSingle();
  if (error) throw error;
  return (data as Room | null) ?? null;
}

export async function getSession(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_sessions")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return emptySession(roomId);
  return normalizeSession(data as RoomSession);
}

async function writeSession(roomId: string, patch: Partial<RoomSession>) {
  const supabase = getSupabase();
  const current = await getSession(roomId);
  const now = new Date().toISOString();
  const next: RoomSession = {
    ...current,
    ...patch,
    room_id: roomId,
    history: patch.history ?? current.history,
    updated_at: now,
  };

  const { error } = await supabase.from("room_sessions").upsert({
    room_id: next.room_id,
    current_video_id: next.current_video_id,
    current_title: next.current_title,
    current_thumbnail_url: next.current_thumbnail_url,
    playback_state: next.playback_state,
    playback_position_ms: next.playback_position_ms,
    playback_updated_at: next.playback_updated_at,
    duration_ms: next.duration_ms,
    loop_mode: next.loop_mode,
    host_client_id: next.host_client_id,
    history: next.history,
    updated_at: now,
  });

  if (error) throw error;
  return next;
}

async function listQueue(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_queue")
    .select("*")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as QueueItem[];
}

async function enqueue(args: {
  roomId: string;
  videoId: string;
  title: string;
  thumbnailUrl: string;
  addedByName: string;
}) {
  const supabase = getSupabase();
  const queue = await listQueue(args.roomId);
  const maxOrder = queue.reduce((max, item) => Math.max(max, item.sort_order), 0);

  const { data, error } = await supabase
    .from("room_queue")
    .insert({
      room_id: args.roomId,
      youtube_video_id: args.videoId,
      title: args.title,
      thumbnail_url: args.thumbnailUrl,
      added_by_name: args.addedByName,
      sort_order: maxOrder + 1,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as QueueItem;
}

async function playTrack(args: {
  roomId: string;
  videoId: string;
  title: string;
  thumbnailUrl: string;
  pushCurrentToHistory?: boolean;
}) {
  const current = await getSession(args.roomId);
  let history = [...current.history];

  if (
    args.pushCurrentToHistory !== false &&
    current.current_video_id &&
    current.current_video_id !== args.videoId
  ) {
    history = [
      ...history,
      {
        videoId: current.current_video_id,
        title: current.current_title || current.current_video_id,
        thumbnailUrl:
          current.current_thumbnail_url ||
          youtubeThumbnailUrl(current.current_video_id),
      },
    ].slice(-30);
  }

  const now = new Date().toISOString();
  return writeSession(args.roomId, {
    current_video_id: args.videoId,
    current_title: args.title,
    current_thumbnail_url: args.thumbnailUrl,
    playback_state: "playing",
    playback_position_ms: 0,
    playback_updated_at: now,
    duration_ms: 0,
    history,
  });
}

export async function addYoutubeFromLineMessage(args: {
  sourceId: string;
  text: string;
  addedByName: string;
}): Promise<
  | { ok: true; title: string; mode: "play" | "queue"; thumbnailUrl: string; videoId: string }
  | { ok: false; reason: string }
> {
  const videoId = extractYoutubeVideoIdFromText(args.text);
  if (!videoId) {
    return { ok: false, reason: "no_youtube" };
  }

  const room = await getRoomByLineSource(args.sourceId);
  if (!room) {
    return { ok: false, reason: "no_room" };
  }

  const meta = await fetchYoutubeMeta(videoId);
  const session = await getSession(room.id);

  if (!session.current_video_id) {
    await playTrack({
      roomId: room.id,
      videoId: meta.videoId,
      title: meta.title,
      thumbnailUrl: meta.thumbnailUrl,
      pushCurrentToHistory: false,
    });
    await logRoomEvent({
      roomId: room.id,
      eventType: "song_playing",
      message: `${args.addedByName} ส่งลิงก์แล้วเริ่มเล่น "${meta.title}"`,
      actor: { name: args.addedByName },
      trackTitle: meta.title,
      trackVideoId: meta.videoId,
    });
    return {
      ok: true,
      title: meta.title,
      mode: "play",
      thumbnailUrl: meta.thumbnailUrl,
      videoId: meta.videoId,
    };
  }

  await enqueue({
    roomId: room.id,
    videoId: meta.videoId,
    title: meta.title,
    thumbnailUrl: meta.thumbnailUrl,
    addedByName: args.addedByName,
  });
  await logRoomEvent({
    roomId: room.id,
    eventType: "song_added",
    message: `${args.addedByName} เพิ่มคิว "${meta.title}"`,
    actor: { name: args.addedByName },
    trackTitle: meta.title,
    trackVideoId: meta.videoId,
  });

  return {
    ok: true,
    title: meta.title,
    mode: "queue",
    thumbnailUrl: meta.thumbnailUrl,
    videoId: meta.videoId,
  };
}

export async function advanceQueue(roomId: string, opts?: { forceSkip?: boolean }) {
  const session = await getSession(roomId);
  const loop = session.loop_mode;
  const forceSkip = opts?.forceSkip === true;

  if (!forceSkip && loop === "one" && session.current_video_id) {
    const now = new Date().toISOString();
    await writeSession(roomId, {
      playback_state: "playing",
      playback_position_ms: 0,
      playback_updated_at: now,
    });
    return;
  }

  const queue = await listQueue(roomId);
  const next = queue[0];

  if (next) {
    if (loop === "all" && session.current_video_id) {
      await enqueue({
        roomId,
        videoId: session.current_video_id,
        title: session.current_title || session.current_video_id,
        thumbnailUrl:
          session.current_thumbnail_url ||
          youtubeThumbnailUrl(session.current_video_id),
        addedByName: "โบ้",
      });
    }

    await playTrack({
      roomId,
      videoId: next.youtube_video_id,
      title: next.title,
      thumbnailUrl: next.thumbnail_url || youtubeThumbnailUrl(next.youtube_video_id),
    });

    const supabase = getSupabase();
    await supabase.from("room_queue").delete().eq("id", next.id);
    return;
  }

  if (loop === "all" && session.current_video_id) {
    const now = new Date().toISOString();
    await writeSession(roomId, {
      playback_state: "playing",
      playback_position_ms: 0,
      playback_updated_at: now,
    });
    return;
  }

  const now = new Date().toISOString();
  await writeSession(roomId, {
    current_video_id: null,
    current_title: "",
    current_thumbnail_url: "",
    playback_state: "paused",
    playback_position_ms: 0,
    playback_updated_at: now,
    duration_ms: 0,
  });
}

export { LOOP_ORDER, emptySession, writeSession, listQueue, enqueue, playTrack };
