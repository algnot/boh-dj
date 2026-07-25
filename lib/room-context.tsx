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
import type {
  HistoryTrack,
  LoopMode,
  PlaybackState,
  QueueItem,
  RoomActor,
  RoomEvent,
  RoomSession,
} from "@/lib/types";
import {
  extractYoutubeVideoId,
  fetchYoutubeMeta,
  youtubeThumbnailUrl,
} from "@/lib/youtube";

const LOOP_ORDER: LoopMode[] = ["all", "one", "off"];

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

function sortQueue(items: QueueItem[]) {
  return [...items].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
  );
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

function normalizeSession(row: RoomSession): RoomSession {
  return { ...row, history: parseHistory(row.history) };
}

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
  removeFromQueue: (id: string) => Promise<void>;
  playQueueItem: (id: string) => Promise<void>;
  addToQueue: (urlOrId: string) => Promise<boolean>;
  syncPlayback: (args: {
    state: PlaybackState;
    positionMs: number;
    durationMs?: number;
    force?: boolean;
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
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const sessionRef = useRef(session);
  const queueRef = useRef(queue);
  const syncingRef = useRef(false);
  const advancingRef = useRef(false);
  const lastLocalSyncAtRef = useRef(0);

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
      lastLocalSyncAtRef.current = Date.now();

      const { error } = await supabase.from("room_sessions").upsert({
        room_id: roomId,
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
          sort_order: maxOrder + 1,
        })
        .select("*")
        .single();

      if (error) throw error;
      if (data) {
        setQueue((prev) => sortQueue([...prev, data as QueueItem]));
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
          },
        ].slice(-30);
      }

      const now = new Date().toISOString();
      await writeSession({
        current_video_id: args.videoId,
        current_title: args.title,
        current_thumbnail_url: args.thumbnailUrl,
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

        const next = sortQueue(queueRef.current)[0];

        if (next) {
          if (loop === "all" && current.current_video_id) {
            await enqueueVideo({
              videoId: current.current_video_id,
              title: current.current_title || current.current_video_id,
              thumbnailUrl:
                current.current_thumbnail_url ||
                youtubeThumbnailUrl(current.current_video_id),
              addedByName: "โบ้",
            });
          }

          await playTrack({
            videoId: next.youtube_video_id,
            title: next.title,
            thumbnailUrl:
              next.thumbnail_url ||
              youtubeThumbnailUrl(next.youtube_video_id),
          });

          const supabase = getSupabase();
          await supabase.from("room_queue").delete().eq("id", next.id);
          setQueue((prev) => prev.filter((item) => item.id !== next.id));
          return;
        }

        if (loop === "all" && current.current_video_id) {
          const now = new Date().toISOString();
          await writeSession({
            playback_state: "playing",
            playback_position_ms: 0,
            playback_updated_at: now,
          });
          return;
        }

        const now = new Date().toISOString();
        await writeSession({
          current_video_id: null,
          current_title: "",
          current_thumbnail_url: "",
          playback_state: "paused",
          playback_position_ms: 0,
          playback_updated_at: now,
          duration_ms: 0,
        });
      } finally {
        advancingRef.current = false;
      }
    },
    [enqueueVideo, playTrack, writeSession],
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
            added_by_name: "โบ้",
            sort_order: minOrder - 1,
          })
          .select("*")
          .single();
        if (!error && data) {
          setQueue((rows) => sortQueue([data as QueueItem, ...rows]));
        }
      }

      const history = current.history.slice(0, -1);
      const now = new Date().toISOString();
      await writeSession({
        current_video_id: prev.videoId,
        current_title: prev.title,
        current_thumbnail_url: prev.thumbnailUrl,
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
      next === "one" ? "ลูปเพลงเดียว" : next === "all" ? "ลูปทั้งคิว" : "ปิดลูป";
    await recordEvent({
      eventType: "loop_changed",
      message: `${actorRef.current.name} เปลี่ยนเป็น${label}`,
    });
  }, [recordEvent, writeSession]);

  const removeFromQueue = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      const supabase = getSupabase();
      await supabase.from("room_queue").delete().eq("id", id);
      setQueue((prev) => prev.filter((row) => row.id !== id));
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
      const videoId = extractYoutubeVideoId(urlOrId);
      if (!videoId) return false;

      setBusy(true);
      try {
        const meta = await fetchYoutubeMeta(videoId);
        if (!sessionRef.current.current_video_id) {
          await playTrack({
            videoId: meta.videoId,
            title: meta.title,
            thumbnailUrl: meta.thumbnailUrl,
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
      const [sessionRes, queueRes, eventsRes] = await Promise.all([
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
      ]);

      if (cancelled) return;

      if (sessionRes.error) throw sessionRes.error;
      if (queueRes.error) throw queueRes.error;

      if (sessionRes.data) {
        setSession(normalizeSession(sessionRes.data as RoomSession));
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
          if (Date.now() - lastLocalSyncAtRef.current < 400) return;
          if (payload.eventType === "DELETE") return;
          const row = payload.new as RoomSession;
          if (!row?.room_id) return;
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
            if (!row.id) return;
            setQueue((prev) => prev.filter((item) => item.id !== row.id));
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
      removeFromQueue,
      playQueueItem,
      addToQueue,
      syncPlayback,
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
      removeFromQueue,
      playQueueItem,
      addToQueue,
      syncPlayback,
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
