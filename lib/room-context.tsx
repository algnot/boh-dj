"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getClientId } from "@/lib/client-id";
import { logRoomEvent } from "@/lib/room-events";
import { getSupabase } from "@/lib/supabase/client";
import { buildLeaderboard } from "@/lib/scores";
import type {
  Database,
  HistoryTrack,
  LoopMode,
  PlaybackState,
  QueueItem,
  RoomActor,
  RoomEvent,
  RoomLike,
  RoomSession,
  ScoreEntry,
} from "@/lib/types";
import {
  extractYoutubeVideoId,
  fetchYoutubeMeta,
  youtubeThumbnailUrl,
} from "@/lib/youtube";

async function resolveVideoIdClient(urlOrId: string): Promise<string | null> {
  const direct = extractYoutubeVideoId(urlOrId);
  if (direct) return direct;

  try {
    const res = await fetch(
      `/api/youtube/resolve?q=${encodeURIComponent(urlOrId)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { videoId?: string };
    return data.videoId ?? null;
  } catch {
    return null;
  }
}

const LOOP_ORDER: LoopMode[] = ["all", "shuffle", "one", "off"];

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

function newPlayId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortQueue(items: QueueItem[]) {
  return [...items].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
  );
}

/**
 * Chooses the next track to play.
 * - shuffle: freshly-added songs (not recycled) play first in order; once the
 *   pool is all recycled it picks a random one, never the song just playing.
 * - other modes: plain front-of-queue.
 */
function pickNextTrack(
  queue: QueueItem[],
  loop: LoopMode,
  currentVideoId: string | null,
): QueueItem | undefined {
  if (loop !== "shuffle") return queue[0];

  const others = currentVideoId
    ? queue.filter((item) => item.youtube_video_id !== currentVideoId)
    : queue;
  const pool = others.length > 0 ? others : queue;
  if (pool.length === 0) return undefined;

  const fresh = pool.filter((item) => !item.is_recycled);
  if (fresh.length > 0) return fresh[0];

  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchQueueFromDb(roomId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_queue")
    .select("*")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return sortQueue((data ?? []) as QueueItem[]);
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

function normalizeSession(row: RoomSession): RoomSession {
  return { ...row, history: parseHistory(row.history) };
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

type RoomContextValue = {
  ready: boolean;
  loadError: string;
  roomId: string;
  session: RoomSession;
  queue: QueueItem[];
  events: RoomEvent[];
  actor: RoomActor;
  clientId: string;
  isHost: boolean;
  busy: boolean;
  estimatedPositionMs: number;
  claimHost: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekToMs: (positionMs: number) => Promise<void>;
  skipNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  cycleLoopMode: () => Promise<void>;
  likes: RoomLike[];
  currentLikes: RoomLike[];
  hasLikedCurrent: boolean;
  canLikeCurrent: boolean;
  ownsCurrentTrack: boolean;
  leaderboard: ScoreEntry[];
  toggleLikeCurrent: () => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  playQueueItem: (id: string) => Promise<void>;
  addToQueue: (urlOrId: string) => Promise<boolean>;
  syncPlayback: (args: {
    state: PlaybackState;
    positionMs: number;
    durationMs?: number;
    force?: boolean;
  }) => Promise<void>;
  publishHostClock: (args: {
    positionMs: number;
    durationMs?: number;
  }) => Promise<void>;
  onLocalVideoEnded: () => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({
  roomId,
  actor = null,
  children,
}: {
  roomId: string;
  actor?: RoomActor | null;
  children: ReactNode;
}) {
  const resolvedActor = useMemo<RoomActor>(
    () =>
      actor?.name
        ? {
            name: actor.name,
            userId: actor.userId,
            pictureUrl: actor.pictureUrl,
          }
        : { name: "ใครบางคน" },
    [actor?.name, actor?.userId, actor?.pictureUrl],
  );
  const actorRef = useRef(resolvedActor);
  actorRef.current = resolvedActor;

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<RoomSession>(() =>
    emptySession(roomId),
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [likes, setLikes] = useState<RoomLike[]>([]);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const sessionRef = useRef(session);
  const queueRef = useRef(queue);
  const syncingRef = useRef(false);
  const advancingRef = useRef(false);
  // updated_at instants this client wrote, so realtime echoes of our own writes
  // can be skipped without also dropping updates from the other side.
  const ownWritesRef = useRef<Set<number>>(new Set());
  // Latest session updated_at (epoch) this client has authoritatively seen.
  // The host clock uses it so its heartbeat never overwrites a fresh seek /
  // pause from another client that hasn't reached this tab yet.
  const lastSeenUatRef = useRef(0);

  sessionRef.current = session;
  queueRef.current = queue;

  const isHost =
    Boolean(clientId) && session.host_client_id === clientId;

  useEffect(() => {
    setClientId(getClientId());
  }, []);

  useEffect(() => {
    if (session.playback_state !== "playing") return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [session.playback_state]);

  const estimatedPositionMs = useMemo(() => {
    if (session.playback_state !== "playing") {
      return session.playback_position_ms;
    }
    const elapsed =
      nowTick - new Date(session.playback_updated_at).getTime();
    const estimated = Math.max(0, session.playback_position_ms + elapsed);
    if (session.duration_ms > 0) {
      return Math.min(estimated, session.duration_ms);
    }
    return estimated;
  }, [
    nowTick,
    session.duration_ms,
    session.playback_position_ms,
    session.playback_state,
    session.playback_updated_at,
  ]);

  // Postgres echoes timestamps back in its own format, so compare instants.
  const rememberOwnWrite = useCallback((updatedAt: string) => {
    const seen = ownWritesRef.current;
    seen.add(Date.parse(updatedAt));
    while (seen.size > 40) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }, []);

  const writeSession = useCallback(
    async (patch: Partial<RoomSession>) => {
      const supabase = getSupabase();
      const now = new Date().toISOString();
      const next: RoomSession = {
        ...sessionRef.current,
        ...patch,
        room_id: roomId,
        history: patch.history ?? sessionRef.current.history,
        updated_at: now,
      };

      setSession(next);
      rememberOwnWrite(now);
      lastSeenUatRef.current = Date.parse(now);

      // Only send the columns being changed. A full-row upsert would let a
      // stale snapshot (e.g. the host heartbeat) clobber loop_mode or a pause
      // that another client just wrote.
      const dbPatch: SessionInsert = { room_id: roomId, updated_at: now };
      const columns = dbPatch as Record<string, unknown>;
      for (const column of SESSION_COLUMNS) {
        if (column in patch) columns[column] = next[column];
      }

      const { error } = await supabase.from("room_sessions").upsert(dbPatch);

      if (error) throw error;
    },
    [rememberOwnWrite, roomId],
  );

  // The host publishes its clock every few seconds. It must never resurrect
  // playback that someone paused in the meantime, so the write is conditional
  // on the room still being in the playing state.
  const publishHostClock = useCallback(
    async (args: { positionMs: number; durationMs?: number }) => {
      const supabase = getSupabase();
      const positionMs = Math.max(0, Math.round(args.positionMs));

      // Read the authoritative row first. If someone else changed the session
      // (seek, pause, next track) since we last saw it, adopt that instead of
      // stomping it with our clock — otherwise a Control seek gets reverted
      // before the Display ever applies it.
      const current = await supabase
        .from("room_sessions")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();
      if (current.error) throw current.error;

      const row = current.data as RoomSession | null;
      if (row) {
        const uat = Date.parse(row.updated_at);
        if (uat !== lastSeenUatRef.current) {
          lastSeenUatRef.current = uat;
          if (!ownWritesRef.current.has(uat)) {
            setSession(normalizeSession(row));
          }
          return;
        }
        if (row.playback_state !== "playing") return;
      }

      const now = new Date().toISOString();
      const durationMs =
        args.durationMs != null
          ? Math.max(0, Math.round(args.durationMs))
          : sessionRef.current.duration_ms;

      rememberOwnWrite(now);
      lastSeenUatRef.current = Date.parse(now);
      setSession((prev) => ({
        ...prev,
        playback_position_ms: positionMs,
        playback_updated_at: now,
        duration_ms: durationMs,
        updated_at: now,
      }));

      const { error } = await supabase
        .from("room_sessions")
        .update({
          playback_position_ms: positionMs,
          playback_updated_at: now,
          duration_ms: durationMs,
          updated_at: now,
        })
        .eq("room_id", roomId)
        .eq("playback_state", "playing");

      if (error) throw error;
    },
    [rememberOwnWrite, roomId],
  );

  // Fire-and-forget: the API decides whether the play earned any points and
  // only announces each play once.
  const announceTrackScore = useCallback(
    (playId: string) => {
      if (!playId) return;
      void fetch(`/api/room/${roomId}/track-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playId }),
      }).catch(() => {});
    },
    [roomId],
  );

  const recordEvent = useCallback(
    async (args: {
      eventType: Parameters<typeof logRoomEvent>[0]["eventType"];
      message: string;
      trackTitle?: string;
      trackVideoId?: string;
    }) => {
      const row = await logRoomEvent({
        roomId,
        eventType: args.eventType,
        message: args.message,
        actor: actorRef.current,
        trackTitle: args.trackTitle,
        trackVideoId: args.trackVideoId,
      });
      if (row) {
        setEvents((prev) => {
          if (prev.some((item) => item.id === row.id)) return prev;
          return [row, ...prev].slice(0, 80);
        });
      }
    },
    [roomId],
  );

  const enqueueVideo = useCallback(
    async (args: {
      videoId: string;
      title: string;
      thumbnailUrl: string;
      addedByName?: string;
      addedByUserId?: string;
      isRecycled?: boolean;
    }) => {
      const supabase = getSupabase();
      const maxOrder = queueRef.current.reduce(
        (max, item) => Math.max(max, item.sort_order),
        0,
      );

      const { data, error } = await supabase
        .from("room_queue")
        .insert({
          room_id: roomId,
          youtube_video_id: args.videoId,
          title: args.title,
          thumbnail_url: args.thumbnailUrl,
          added_by_name: args.addedByName ?? actorRef.current.name,
          added_by_user_id:
            args.addedByUserId ?? actorRef.current.userId ?? "",
          is_recycled: args.isRecycled ?? false,
          sort_order: maxOrder + 1,
        })
        .select("*")
        .single();

      if (error) throw error;
      if (data) {
        const row = data as QueueItem;
        queueRef.current = sortQueue([...queueRef.current, row]);
        setQueue(queueRef.current);
      }
      return data as QueueItem | null;
    },
    [roomId],
  );

  const playTrack = useCallback(
    async (args: {
      videoId: string;
      title: string;
      thumbnailUrl: string;
      ownerName?: string;
      ownerUserId?: string;
      pushCurrentToHistory?: boolean;
      autoplay?: boolean;
    }) => {
      const current = sessionRef.current;
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
      await writeSession({
        current_video_id: args.videoId,
        current_title: args.title,
        current_thumbnail_url: args.thumbnailUrl,
        current_play_id: newPlayId(),
        current_owner_name: args.ownerName ?? "",
        current_owner_user_id: args.ownerUserId ?? "",
        playback_state: args.autoplay === false ? "paused" : "playing",
        playback_position_ms: 0,
        playback_updated_at: now,
        duration_ms: 0,
        history,
      });
    },
    [writeSession],
  );

  const claimHost = useCallback(async () => {
    if (!clientId) return;
    const current = sessionRef.current;
    if (current.host_client_id === clientId) return;
    await writeSession({ host_client_id: clientId });
  }, [clientId, writeSession]);

  const syncPlayback = useCallback(
    async (args: {
      state: PlaybackState;
      positionMs: number;
      durationMs?: number;
      force?: boolean;
    }) => {
      if (syncingRef.current) return;

      const current = sessionRef.current;
      const positionMs = Math.max(0, Math.round(args.positionMs));
      const sameState = current.playback_state === args.state;

      if (!args.force) {
        if (args.state === "playing" && current.playback_state === "playing") {
          const estimated =
            current.playback_position_ms +
            Math.max(
              0,
              Date.now() - new Date(current.playback_updated_at).getTime(),
            );
          if (positionMs + 2000 < estimated) return;
        }

        const samePos =
          Math.abs(current.playback_position_ms - positionMs) < 900;
        const sameDuration =
          args.durationMs == null ||
          Math.abs((current.duration_ms || 0) - args.durationMs) < 1000;
        if (sameState && samePos && sameDuration) return;
      }

      syncingRef.current = true;
      try {
        const now = new Date().toISOString();
        await writeSession({
          playback_state: args.state,
          playback_position_ms: positionMs,
          playback_updated_at: now,
          duration_ms:
            args.durationMs != null
              ? Math.max(0, Math.round(args.durationMs))
              : current.duration_ms,
        });
      } finally {
        syncingRef.current = false;
      }
    },
    [writeSession],
  );

  const advanceToNext = useCallback(
    async (opts?: { forceSkip?: boolean }) => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      try {
        const current = sessionRef.current;
        const loop = current.loop_mode ?? "all";
        const forceSkip = opts?.forceSkip === true;

        if (!forceSkip && loop === "one" && current.current_video_id) {
          const now = new Date().toISOString();
          await writeSession({
            playback_state: "playing",
            playback_position_ms: 0,
            playback_updated_at: now,
          });
          return;
        }

        // Always re-read the queue from DB so a delete on Control isn't
        // ignored because this host still has a stale in-memory list.
        const freshQueue = await fetchQueueFromDb(roomId);
        queueRef.current = freshQueue;
        setQueue(freshQueue);
        const next = pickNextTrack(freshQueue, loop, current.current_video_id);

        if (next) {
          // Both loop modes keep the finished song in rotation. Mark it
          // recycled so shuffle knows it's already been played.
          if (
            (loop === "all" || loop === "shuffle") &&
            current.current_video_id
          ) {
            await enqueueVideo({
              videoId: current.current_video_id,
              title: current.current_title || current.current_video_id,
              thumbnailUrl:
                current.current_thumbnail_url ||
                youtubeThumbnailUrl(current.current_video_id),
              addedByName: current.current_owner_name || "โบ้",
              addedByUserId: current.current_owner_user_id,
              isRecycled: true,
            });
          }

          announceTrackScore(current.current_play_id);

          await playTrack({
            videoId: next.youtube_video_id,
            title: next.title,
            thumbnailUrl:
              next.thumbnail_url ||
              youtubeThumbnailUrl(next.youtube_video_id),
            ownerName: next.added_by_name,
            ownerUserId: next.added_by_user_id,
          });

          const supabase = getSupabase();
          await supabase.from("room_queue").delete().eq("id", next.id);
          queueRef.current = queueRef.current.filter(
            (item) => item.id !== next.id,
          );
          setQueue((prev) => prev.filter((item) => item.id !== next.id));
          return;
        }

        // Nothing else to play (queue empty or only holds the current song):
        // loop all/shuffle just replays the current track.
        if ((loop === "all" || loop === "shuffle") && current.current_video_id) {
          const now = new Date().toISOString();
          await writeSession({
            playback_state: "playing",
            playback_position_ms: 0,
            playback_updated_at: now,
          });
          return;
        }

        const hadTrack = Boolean(current.current_video_id);
        announceTrackScore(current.current_play_id);

        const now = new Date().toISOString();
        await writeSession({
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

        // Queue ran out with no loop: let the LINE chat know.
        if (hadTrack && loop === "off") {
          void fetch(`/api/room/${roomId}/queue-ended`, {
            method: "POST",
          }).catch(() => {});
        }
      } finally {
        advancingRef.current = false;
      }
    },
    [announceTrackScore, enqueueVideo, playTrack, roomId, writeSession],
  );

  const pause = useCallback(async () => {
    const now = new Date().toISOString();
    const title = sessionRef.current.current_title;
    const videoId = sessionRef.current.current_video_id;
    await writeSession({
      playback_state: "paused",
      playback_position_ms: Math.round(
        sessionRef.current.playback_state === "playing"
          ? Math.max(
              0,
              sessionRef.current.playback_position_ms +
                (Date.now() -
                  new Date(sessionRef.current.playback_updated_at).getTime()),
            )
          : sessionRef.current.playback_position_ms,
      ),
      playback_updated_at: now,
    });
    await recordEvent({
      eventType: "pause",
      message: `${actorRef.current.name} หยุดเพลง${title ? ` "${title}"` : ""}`,
      trackTitle: title,
      trackVideoId: videoId ?? undefined,
    });
  }, [recordEvent, writeSession]);

  const play = useCallback(async () => {
    if (!sessionRef.current.current_video_id) return;
    const now = new Date().toISOString();
    const title = sessionRef.current.current_title;
    const videoId = sessionRef.current.current_video_id;
    await writeSession({
      playback_state: "playing",
      playback_updated_at: now,
    });
    await recordEvent({
      eventType: "play",
      message: `${actorRef.current.name} กดเล่นต่อ${title ? ` "${title}"` : ""}`,
      trackTitle: title,
      trackVideoId: videoId ?? undefined,
    });
  }, [recordEvent, writeSession]);

  const togglePlayPause = useCallback(async () => {
    if (sessionRef.current.playback_state === "playing") {
      await pause();
    } else {
      await play();
    }
  }, [pause, play]);

  const seekToMs = useCallback(
    async (positionMs: number) => {
      const now = new Date().toISOString();
      const clamped = Math.max(0, Math.round(positionMs));
      const title = sessionRef.current.current_title;
      const videoId = sessionRef.current.current_video_id;
      await writeSession({
        playback_position_ms: clamped,
        playback_updated_at: now,
      });
      await recordEvent({
        eventType: "seek",
        message: `${actorRef.current.name} เลื่อนเวลาเพลง${title ? ` "${title}"` : ""}`,
        trackTitle: title,
        trackVideoId: videoId ?? undefined,
      });
    },
    [recordEvent, writeSession],
  );

  const skipNext = useCallback(async () => {
    setBusy(true);
    try {
      const title = sessionRef.current.current_title;
      await advanceToNext({ forceSkip: true });
      await recordEvent({
        eventType: "skip_next",
        message: `${actorRef.current.name} ข้ามเพลง${title ? ` "${title}"` : ""}`,
        trackTitle: title,
        trackVideoId: sessionRef.current.current_video_id ?? undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [advanceToNext, recordEvent]);

  const playPrevious = useCallback(async () => {
    const current = sessionRef.current;
    const prev = current.history[current.history.length - 1];
    if (!prev) return;

    setBusy(true);
    try {
      // Put the current track back at the front of the queue
      if (current.current_video_id) {
        const supabase = getSupabase();
        const minOrder = queueRef.current.reduce(
          (min, item) => Math.min(min, item.sort_order),
          1,
        );
        const { data, error } = await supabase
          .from("room_queue")
          .insert({
            room_id: roomId,
            youtube_video_id: current.current_video_id,
            title: current.current_title || current.current_video_id,
            thumbnail_url:
              current.current_thumbnail_url ||
              youtubeThumbnailUrl(current.current_video_id),
            added_by_name: current.current_owner_name || "โบ้",
            added_by_user_id: current.current_owner_user_id,
            is_recycled: true,
            sort_order: minOrder - 1,
          })
          .select("*")
          .single();
        if (!error && data) {
          queueRef.current = sortQueue([data as QueueItem, ...queueRef.current]);
          setQueue(queueRef.current);
        }
      }

      const history = current.history.slice(0, -1);
      const now = new Date().toISOString();
      await writeSession({
        current_video_id: prev.videoId,
        current_title: prev.title,
        current_thumbnail_url: prev.thumbnailUrl,
        current_play_id: newPlayId(),
        current_owner_name: prev.ownerName ?? "",
        current_owner_user_id: prev.ownerUserId ?? "",
        playback_state: "playing",
        playback_position_ms: 0,
        playback_updated_at: now,
        duration_ms: 0,
        history,
      });
      await recordEvent({
        eventType: "play_previous",
        message: `${actorRef.current.name} เล่นเพลงก่อนหน้า "${prev.title}"`,
        trackTitle: prev.title,
        trackVideoId: prev.videoId,
      });
    } finally {
      setBusy(false);
    }
  }, [recordEvent, roomId, writeSession]);

  const cycleLoopMode = useCallback(async () => {
    const current = sessionRef.current.loop_mode ?? "all";
    const index = LOOP_ORDER.indexOf(current);
    const next = LOOP_ORDER[(index + 1) % LOOP_ORDER.length] ?? "all";
    await writeSession({ loop_mode: next });
    const label =
      next === "one"
        ? "ลูปเพลงเดียว"
        : next === "all"
          ? "ลูปทั้งคิว"
          : next === "shuffle"
            ? "ลูปสุ่มทั้งคิว"
            : "ปิดลูป";
    await recordEvent({
      eventType: "loop_changed",
      message: `${actorRef.current.name} เปลี่ยนเป็น${label}`,
    });
  }, [recordEvent, writeSession]);

  // One vote per listener per play. Falls back to the browser id so a guest
  // without a LINE profile still can't stack likes.
  const likerKey = resolvedActor.userId || clientId;

  const currentLikes = useMemo(() => {
    if (!session.current_play_id) return [];
    return likes.filter((like) => like.play_id === session.current_play_id);
  }, [likes, session.current_play_id]);

  const hasLikedCurrent = useMemo(
    () =>
      Boolean(likerKey) &&
      currentLikes.some((like) => like.liker_key === likerKey),
    [currentLikes, likerKey],
  );

  const ownsCurrentTrack = useMemo(() => {
    if (!session.current_video_id) return false;
    if (session.current_owner_user_id) {
      return session.current_owner_user_id === resolvedActor.userId;
    }
    return (
      Boolean(session.current_owner_name) &&
      session.current_owner_name === resolvedActor.name
    );
  }, [
    resolvedActor.name,
    resolvedActor.userId,
    session.current_owner_name,
    session.current_owner_user_id,
    session.current_video_id,
  ]);

  const canLikeCurrent =
    Boolean(session.current_video_id) &&
    Boolean(session.current_play_id) &&
    Boolean(likerKey) &&
    !ownsCurrentTrack;

  const leaderboard = useMemo<ScoreEntry[]>(
    () => buildLeaderboard(likes),
    [likes],
  );

  const toggleLikeCurrent = useCallback(async () => {
    const current = sessionRef.current;
    if (!current.current_video_id || !current.current_play_id) return;
    if (!likerKey) return;

    // You don't get to cheer for your own request.
    const isMine = current.current_owner_user_id
      ? current.current_owner_user_id === actorRef.current.userId
      : Boolean(current.current_owner_name) &&
        current.current_owner_name === actorRef.current.name;
    if (isMine) return;

    const supabase = getSupabase();
    const existing = likes.find(
      (like) =>
        like.play_id === current.current_play_id &&
        like.liker_key === likerKey,
    );

    if (existing) {
      setLikes((prev) => prev.filter((like) => like.id !== existing.id));
      await supabase.from("room_likes").delete().eq("id", existing.id);
      return;
    }

    const { data, error } = await supabase
      .from("room_likes")
      .insert({
        room_id: roomId,
        play_id: current.current_play_id,
        video_id: current.current_video_id,
        track_title: current.current_title || current.current_video_id,
        owner_name: current.current_owner_name,
        owner_user_id: current.current_owner_user_id,
        liker_key: likerKey,
        liker_name: actorRef.current.name,
        liker_picture_url: actorRef.current.pictureUrl ?? "",
      })
      .select("*")
      .single();

    // Duplicate likes are rejected by the unique index — nothing to report.
    if (error || !data) return;

    const row = data as RoomLike;
    setLikes((prev) =>
      prev.some((like) => like.id === row.id) ? prev : [row, ...prev],
    );

    await recordEvent({
      eventType: "song_liked",
      message: `${actorRef.current.name} ถูกใจเพลง "${
        current.current_title || current.current_video_id
      }"${current.current_owner_name ? ` ของ ${current.current_owner_name}` : ""}`,
      trackTitle: current.current_title,
      trackVideoId: current.current_video_id,
    });
  }, [likerKey, likes, recordEvent, roomId]);

  const removeFromQueue = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      const supabase = getSupabase();
      const { error } = await supabase.from("room_queue").delete().eq("id", id);
      if (error) throw error;

      // Update the ref immediately so a concurrent advanceToNext on this
      // client won't pick the deleted track from a stale snapshot.
      queueRef.current = queueRef.current.filter((row) => row.id !== id);
      setQueue(queueRef.current);

      if (item) {
        await recordEvent({
          eventType: "queue_removed",
          message: `${actorRef.current.name} ลบคิว "${item.title}"`,
          trackTitle: item.title,
          trackVideoId: item.youtube_video_id,
        });
      }
    },
    [recordEvent],
  );

  const playQueueItem = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      if (!item) return;

      setBusy(true);
      try {
        await playTrack({
          videoId: item.youtube_video_id,
          title: item.title,
          thumbnailUrl:
            item.thumbnail_url || youtubeThumbnailUrl(item.youtube_video_id),
          ownerName: item.added_by_name,
          ownerUserId: item.added_by_user_id,
        });
        const supabase = getSupabase();
        await supabase.from("room_queue").delete().eq("id", id);
        setQueue((prev) => prev.filter((q) => q.id !== id));
        await recordEvent({
          eventType: "play_from_queue",
          message: `${actorRef.current.name} เลือกเล่นจากคิว "${item.title}"`,
          trackTitle: item.title,
          trackVideoId: item.youtube_video_id,
        });
      } finally {
        setBusy(false);
      }
    },
    [playTrack, recordEvent],
  );

  const addToQueue = useCallback(
    async (urlOrId: string) => {
      setBusy(true);
      try {
        const videoId = await resolveVideoIdClient(urlOrId);
        if (!videoId) return false;

        const meta = await fetchYoutubeMeta(videoId);
        if (!sessionRef.current.current_video_id) {
          await playTrack({
            videoId: meta.videoId,
            title: meta.title,
            thumbnailUrl: meta.thumbnailUrl,
            ownerName: actorRef.current.name,
            ownerUserId: actorRef.current.userId ?? "",
            pushCurrentToHistory: false,
          });
          await recordEvent({
            eventType: "song_playing",
            message: `${actorRef.current.name} เริ่มเล่น "${meta.title}"`,
            trackTitle: meta.title,
            trackVideoId: meta.videoId,
          });
          return true;
        }

        await enqueueVideo({
          videoId: meta.videoId,
          title: meta.title,
          thumbnailUrl: meta.thumbnailUrl,
        });
        await recordEvent({
          eventType: "song_added",
          message: `${actorRef.current.name} เพิ่มคิว "${meta.title}"`,
          trackTitle: meta.title,
          trackVideoId: meta.videoId,
        });
        return true;
      } catch {
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enqueueVideo, playTrack, recordEvent],
  );

  const onLocalVideoEnded = useCallback(() => {
    void advanceToNext();
  }, [advanceToNext]);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();

    const bootstrap = async () => {
      const [sessionRes, queueRes, eventsRes, likesRes] = await Promise.all([
        supabase
          .from("room_sessions")
          .select("*")
          .eq("room_id", roomId)
          .maybeSingle(),
        supabase
          .from("room_queue")
          .select("*")
          .eq("room_id", roomId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("room_events")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("room_likes")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (sessionRes.error) throw sessionRes.error;
      if (queueRes.error) throw queueRes.error;

      if (sessionRes.data) {
        const row = sessionRes.data as RoomSession;
        lastSeenUatRef.current = Date.parse(row.updated_at);
        setSession(normalizeSession(row));
      } else {
        const blank = emptySession(roomId);
        setSession(blank);
        await supabase.from("room_sessions").upsert({
          room_id: roomId,
          current_video_id: null,
          current_title: "",
          current_thumbnail_url: "",
          playback_state: "paused",
          playback_position_ms: 0,
          playback_updated_at: blank.playback_updated_at,
          duration_ms: 0,
          loop_mode: "all",
          host_client_id: null,
          history: [],
          updated_at: blank.updated_at,
        });
      }

      setQueue(sortQueue((queueRes.data ?? []) as QueueItem[]));
      if (eventsRes.error) {
        console.warn("room_events load failed", eventsRes.error);
        setEvents([]);
      } else {
        setEvents((eventsRes.data ?? []) as RoomEvent[]);
      }
      if (likesRes.error) {
        console.warn("room_likes load failed", likesRes.error);
        setLikes([]);
      } else {
        setLikes((likesRes.data ?? []) as RoomLike[]);
      }
    };

    // Always leave the loading state, otherwise a failed query hangs the UI silently
    void bootstrap()
      .catch((error) => {
        console.error("Failed to load room", error);
        if (!cancelled) setLoadError("โหลดห้องไม่สำเร็จ — เช็ค Supabase");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const channel = supabase
      .channel(`boh-room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_sessions",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as RoomSession;
          if (!row?.room_id) return;
          const uat = row.updated_at ? Date.parse(row.updated_at) : 0;
          if (uat) lastSeenUatRef.current = uat;
          if (uat && ownWritesRef.current.has(uat)) {
            return;
          }
          setSession(normalizeSession(row));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_queue",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as QueueItem;
            setQueue((prev) => {
              if (prev.some((item) => item.id === row.id)) return prev;
              return sortQueue([...prev, row]);
            });
            return;
          }
          if (payload.eventType === "UPDATE") {
            const row = payload.new as QueueItem;
            setQueue((prev) =>
              sortQueue(
                prev.map((item) => (item.id === row.id ? row : item)),
              ),
            );
            return;
          }
          if (payload.eventType === "DELETE") {
            const row = payload.old as { id?: string };
            if (row.id) {
              setQueue((prev) => prev.filter((item) => item.id !== row.id));
              return;
            }
            // Some projects lack REPLICA IDENTITY FULL — old row may be empty.
            void fetchQueueFromDb(roomId)
              .then((fresh) => {
                queueRef.current = fresh;
                setQueue(fresh);
              })
              .catch(() => {});
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_events",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as RoomEvent;
          if (!row?.id) return;
          setEvents((prev) => {
            if (prev.some((item) => item.id === row.id)) return prev;
            return [row, ...prev].slice(0, 80);
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_likes",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const row = payload.old as { id?: string };
            if (!row.id) return;
            setLikes((prev) => prev.filter((like) => like.id !== row.id));
            return;
          }
          const row = payload.new as RoomLike;
          if (!row?.id) return;
          setLikes((prev) =>
            prev.some((like) => like.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  const value = useMemo<RoomContextValue>(
    () => ({
      ready,
      loadError,
      roomId,
      session,
      queue,
      events,
      actor: resolvedActor,
      clientId,
      isHost,
      busy,
      estimatedPositionMs,
      claimHost,
      togglePlayPause,
      play,
      pause,
      seekToMs,
      skipNext,
      playPrevious,
      cycleLoopMode,
      likes,
      currentLikes,
      hasLikedCurrent,
      canLikeCurrent,
      ownsCurrentTrack,
      leaderboard,
      toggleLikeCurrent,
      removeFromQueue,
      playQueueItem,
      addToQueue,
      syncPlayback,
      publishHostClock,
      onLocalVideoEnded,
    }),
    [
      ready,
      loadError,
      roomId,
      session,
      queue,
      events,
      resolvedActor,
      clientId,
      isHost,
      busy,
      estimatedPositionMs,
      claimHost,
      togglePlayPause,
      play,
      pause,
      seekToMs,
      skipNext,
      playPrevious,
      cycleLoopMode,
      likes,
      currentLikes,
      hasLikedCurrent,
      canLikeCurrent,
      ownsCurrentTrack,
      leaderboard,
      toggleLikeCurrent,
      removeFromQueue,
      playQueueItem,
      addToQueue,
      syncPlayback,
      publishHostClock,
      onLocalVideoEnded,
    ],
  );

  return (
    <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
  );
}

export function useRoom() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within RoomProvider");
  }
  return context;
}
