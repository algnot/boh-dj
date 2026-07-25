import { randomBytes, randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Database,
  HistoryTrack,
  LineSourceType,
  LoopMode,
  QueueItem,
  Room,
  RoomLike,
  RoomSession,
} from "@/lib/types";
import {
  fetchYoutubeMeta,
  resolveYoutubeVideoIdFromText,
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
    current_play_id: "",
    current_owner_name: "",
    current_owner_user_id: "",
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
    .map((item): HistoryTrack | null => {
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
        ownerName: typeof row.ownerName === "string" ? row.ownerName : "",
        ownerUserId:
          typeof row.ownerUserId === "string" ? row.ownerUserId : "",
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

type SessionInsert = Database["public"]["Tables"]["room_sessions"]["Insert"];

const SESSION_COLUMNS = [
  "current_video_id",
  "current_title",
  "current_thumbnail_url",
  "current_play_id",
  "current_owner_name",
  "current_owner_user_id",
  "playback_state",
  "playback_position_ms",
  "playback_updated_at",
  "duration_ms",
  "loop_mode",
  "host_client_id",
  "history",
] as const satisfies readonly (keyof RoomSession)[];

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

  // Only write the changed columns so a concurrent control action (loop mode,
  // pause) isn't reverted by this snapshot.
  const dbPatch: SessionInsert = { room_id: roomId, updated_at: now };
  const columns = dbPatch as Record<string, unknown>;
  for (const column of SESSION_COLUMNS) {
    if (column in patch) columns[column] = next[column];
  }

  const { error } = await supabase.from("room_sessions").upsert(dbPatch);

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
  addedByUserId?: string;
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
      added_by_user_id: args.addedByUserId ?? "",
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
  ownerName?: string;
  ownerUserId?: string;
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
        ownerName: current.current_owner_name,
        ownerUserId: current.current_owner_user_id,
      },
    ].slice(-30);
  }

  const now = new Date().toISOString();
  return writeSession(args.roomId, {
    current_video_id: args.videoId,
    current_title: args.title,
    current_thumbnail_url: args.thumbnailUrl,
    current_play_id: randomUUID(),
    current_owner_name: args.ownerName ?? "",
    current_owner_user_id: args.ownerUserId ?? "",
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
  addedByUserId?: string;
}): Promise<
  | { ok: true; title: string; mode: "play" | "queue"; thumbnailUrl: string; videoId: string }
  | { ok: false; reason: string }
> {
  const videoId = await resolveYoutubeVideoIdFromText(args.text);
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
      ownerName: args.addedByName,
      ownerUserId: args.addedByUserId,
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
    addedByUserId: args.addedByUserId,
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
        addedByName: session.current_owner_name || "โบ้",
        addedByUserId: session.current_owner_user_id,
      });
    }

    await playTrack({
      roomId,
      videoId: next.youtube_video_id,
      title: next.title,
      thumbnailUrl: next.thumbnail_url || youtubeThumbnailUrl(next.youtube_video_id),
      ownerName: next.added_by_name,
      ownerUserId: next.added_by_user_id,
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
    current_play_id: "",
    current_owner_name: "",
    current_owner_user_id: "",
    playback_state: "paused",
    playback_position_ms: 0,
    playback_updated_at: now,
    duration_ms: 0,
  });
}

/**
 * Likes collected for one play of a track. Returns null when the play earned
 * nothing, or when its score was already announced.
 */
export async function claimTrackScore(roomId: string, playId: string) {
  if (!playId) return null;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("room_likes")
    .select("*")
    .eq("room_id", roomId)
    .eq("play_id", playId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  const likes = (data ?? []) as RoomLike[];
  if (likes.length === 0) return null;

  // The primary key makes this the dedupe: a second caller loses the race.
  const claim = await supabase
    .from("room_score_announcements")
    .insert({ play_id: playId, room_id: roomId });
  if (claim.error) return null;

  const first = likes[0];
  if (!first) return null;

  return {
    ownerName: first.owner_name,
    trackTitle: first.track_title || first.video_id,
    points: likes.length,
    likerNames: [...new Set(likes.map((like) => like.liker_name))].filter(
      Boolean,
    ),
  };
}

export { LOOP_ORDER, emptySession, writeSession, listQueue, enqueue, playTrack };
