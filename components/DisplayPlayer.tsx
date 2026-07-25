"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { useRoom } from "@/lib/room-context";
import {
  loadYoutubeIframeApi,
  YT_STATE,
  type YtPlayer,
  type YtPlayerEvent,
} from "@/lib/youtube";
import styles from "./DisplayPlayer.module.css";

const DRIFT_SOFT_SEC = 1.25;
const DRIFT_HARD_SEC = 0.85;
const HOST_HEARTBEAT_MS = 3500;
const FOLLOWER_CORRECT_MS = 2000;
const PLAYER_ELEMENT_ID = "boh-dj-yt-player";

function forcePlay(player: YtPlayer, startSeconds?: number) {
  try {
    player.mute();
  } catch {
    // ignore
  }
  if (typeof startSeconds === "number" && Number.isFinite(startSeconds)) {
    try {
      player.seekTo(Math.max(0, startSeconds), true);
    } catch {
      // ignore
    }
  }
  try {
    player.playVideo();
  } catch {
    // ignore
  }
  window.setTimeout(() => {
    try {
      player.unMute();
    } catch {
      // ignore
    }
  }, 350);
}

function targetSecondsFromSession(session: {
  playback_state: string;
  playback_position_ms: number;
  playback_updated_at: string;
}) {
  if (session.playback_state !== "playing") {
    return Math.max(0, session.playback_position_ms / 1000);
  }
  const elapsed = Math.max(
    0,
    Date.now() - new Date(session.playback_updated_at).getTime(),
  );
  return Math.max(0, (session.playback_position_ms + elapsed) / 1000);
}

export function DisplayPlayer() {
  const {
    ready,
    session,
    estimatedPositionMs,
    clientId,
    isHost,
    claimHost,
    syncPlayback,
    publishHostClock,
    onLocalVideoEnded,
    currentLikes,
  } = useRoom();

  const [needsUnlock, setNeedsUnlock] = useState(false);

  const playerRef = useRef<YtPlayer | null>(null);
  const readyRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const lastVideoIdRef = useRef<string | null>(null);
  const lastRemoteKeyRef = useRef("");
  const endedHandledRef = useRef(false);
  const estimatedRef = useRef(estimatedPositionMs);
  const sessionRef = useRef(session);
  const syncPlaybackRef = useRef(syncPlayback);
  const publishHostClockRef = useRef(publishHostClock);
  const onEndedRef = useRef(onLocalVideoEnded);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHostRef = useRef(isHost);

  estimatedRef.current = estimatedPositionMs;
  sessionRef.current = session;
  syncPlaybackRef.current = syncPlayback;
  publishHostClockRef.current = publishHostClock;
  onEndedRef.current = onLocalVideoEnded;
  isHostRef.current = isHost;

  useEffect(() => {
    if (!ready || !clientId) return;
    void claimHost();
  }, [ready, clientId, claimHost]);

  const scheduleUnlockCheck = useCallback(() => {
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = setTimeout(() => {
      const player = playerRef.current;
      const snap = sessionRef.current;
      if (
        !player ||
        snap.playback_state !== "playing" ||
        !snap.current_video_id
      ) {
        setNeedsUnlock(false);
        return;
      }
      try {
        const state = player.getPlayerState();
        if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) {
          setNeedsUnlock(true);
        } else {
          setNeedsUnlock(false);
        }
      } catch {
        setNeedsUnlock(true);
      }
    }, 900);
  }, []);

  const unlockPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    applyingRemoteRef.current = true;
    const seek = Math.max(0, estimatedRef.current / 1000);
    forcePlay(player, seek);
    setNeedsUnlock(false);
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 700);
  }, []);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    const createPlayer = async () => {
      await loadYoutubeIframeApi();
      if (cancelled || !window.YT?.Player) return;

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      if (cancelled) return;

      const mount = document.getElementById(PLAYER_ELEMENT_ID);
      if (!mount) return;

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      const current = sessionRef.current;
      const startSeconds = Math.max(
        0,
        Math.floor(estimatedRef.current / 1000),
      );

      playerRef.current = new window.YT.Player(PLAYER_ELEMENT_ID, {
        width: "100%",
        height: "100%",
        videoId: current.current_video_id ?? undefined,
        playerVars: {
          autoplay: current.playback_state === "playing" ? 1 : 0,
          mute: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
          start: startSeconds,
        },
        events: {
          onReady: (event) => {
            readyRef.current = true;
            lastVideoIdRef.current = sessionRef.current.current_video_id;
            applyingRemoteRef.current = true;
            try {
              const snap = sessionRef.current;
              const seek = Math.max(
                0,
                Math.floor(estimatedRef.current / 1000),
              );
              if (snap.current_video_id) {
                if (snap.playback_state === "playing") {
                  forcePlay(event.target, seek);
                  scheduleUnlockCheck();
                } else {
                  event.target.cueVideoById({
                    videoId: snap.current_video_id,
                    startSeconds: seek,
                  });
                }
              }
            } finally {
              window.setTimeout(() => {
                applyingRemoteRef.current = false;
              }, 600);
            }
          },
          onStateChange: (event: YtPlayerEvent) => {
            const state = event.data;

            if (state === YT_STATE.PLAYING) {
              setNeedsUnlock(false);
              endedHandledRef.current = false;
            }

            // Always handle ENDED — even during remote apply.
            // Heartbeats briefly set applyingRemoteRef and used to swallow ENDED.
            if (state === YT_STATE.ENDED) {
              if (endedHandledRef.current) return;
              endedHandledRef.current = true;
              onEndedRef.current();
              return;
            }

            if (applyingRemoteRef.current) return;

            if (state === YT_STATE.PAUSED) {
              void syncPlaybackRef.current({
                state: "paused",
                positionMs: event.target.getCurrentTime() * 1000,
                durationMs: event.target.getDuration() * 1000,
              });
              return;
            }

            if (state === YT_STATE.PLAYING) {
              const snap = sessionRef.current;

              // A late autoplay (e.g. buffering finished after a remote pause)
              // must not push the room back to playing.
              if (snap.playback_state === "paused") {
                applyingRemoteRef.current = true;
                try {
                  event.target.pauseVideo();
                } catch {
                  // ignore
                }
                window.setTimeout(() => {
                  applyingRemoteRef.current = false;
                }, 500);
                return;
              }

              if (isHostRef.current || snap.playback_state !== "playing") {
                void syncPlaybackRef.current({
                  state: "playing",
                  positionMs: event.target.getCurrentTime() * 1000,
                  durationMs: event.target.getDuration() * 1000,
                });
              }
            }
          },
        },
      });
    };

    void createPlayer();

    return () => {
      cancelled = true;
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      readyRef.current = false;
    };
  }, [ready, scheduleUnlockCheck]);

  useEffect(() => {
    if (!ready || !readyRef.current || !playerRef.current) return;

    const player = playerRef.current;
    const videoId = session.current_video_id;
    const remoteKey = `${videoId}|${session.playback_state}|${session.playback_updated_at}|${session.playback_position_ms}`;
    if (remoteKey === lastRemoteKeyRef.current) return;

    // Host is the clock — ignore own heartbeat position ticks unless video/state
    // changed or control issued a real seek (large jump).
    if (isHost) {
      const prev = lastRemoteKeyRef.current;
      const videoStatePrefix = `${videoId}|${session.playback_state}|`;
      if (prev.startsWith(videoStatePrefix)) {
        const targetSec = targetSecondsFromSession(session);
        let current = 0;
        try {
          current = player.getCurrentTime();
        } catch {
          current = 0;
        }
        if (Math.abs(current - targetSec) < 2.5) {
          lastRemoteKeyRef.current = remoteKey;
          return;
        }
      }
    }

    lastRemoteKeyRef.current = remoteKey;

    applyingRemoteRef.current = true;
    // Don't clear endedHandled here on heartbeat — only when video changes below

    const targetSec = targetSecondsFromSession(session);

    try {
      if (!videoId) {
        try {
          player.pauseVideo();
        } catch {
          // ignore
        }
        lastVideoIdRef.current = null;
        endedHandledRef.current = false;
        setNeedsUnlock(false);
        return;
      }

      const videoChanged = lastVideoIdRef.current !== videoId;

      if (videoChanged) {
        lastVideoIdRef.current = videoId;
        endedHandledRef.current = false;
        if (session.playback_state === "playing") {
          try {
            player.mute();
          } catch {
            // ignore
          }
          player.loadVideoById({ videoId, startSeconds: targetSec });
          window.setTimeout(() => forcePlay(player, targetSec), 200);
          scheduleUnlockCheck();
        } else {
          player.cueVideoById({ videoId, startSeconds: targetSec });
          setNeedsUnlock(false);
        }
        return;
      }

      let currentTime = 0;
      try {
        currentTime = player.getCurrentTime();
      } catch {
        currentTime = 0;
      }

      if (Math.abs(currentTime - targetSec) > DRIFT_HARD_SEC) {
        player.seekTo(targetSec, true);
      }

      const playerState = (() => {
        try {
          return player.getPlayerState();
        } catch {
          return YT_STATE.UNSTARTED;
        }
      })();

      if (session.playback_state === "playing") {
        if (
          playerState !== YT_STATE.PLAYING &&
          playerState !== YT_STATE.BUFFERING
        ) {
          // Don't forcePlay over ENDED — let advance handle next track
          if (playerState !== YT_STATE.ENDED) {
            forcePlay(player, targetSec);
            scheduleUnlockCheck();
          }
        }
      } else if (playerState !== YT_STATE.PAUSED && playerState !== YT_STATE.ENDED) {
        // Includes BUFFERING/UNSTARTED — a pause issued mid-buffer used to be
        // dropped, leaving the video playing while the room said paused.
        try {
          player.pauseVideo();
        } catch {
          // ignore
        }
        setNeedsUnlock(false);
      }
    } finally {
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 700);
    }
  }, [
    ready,
    isHost,
    scheduleUnlockCheck,
    session.current_video_id,
    session.playback_position_ms,
    session.playback_state,
    session.playback_updated_at,
  ]);

  useEffect(() => {
    if (!ready) return;
    if (session.playback_state !== "playing") return;
    if (!isHost) return;

    const tick = () => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      try {
        const state = player.getPlayerState();
        if (state === YT_STATE.ENDED) {
          if (!endedHandledRef.current) {
            endedHandledRef.current = true;
            onEndedRef.current();
          }
          return;
        }
        if (applyingRemoteRef.current) return;
        if (sessionRef.current.playback_state !== "playing") return;
        if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) return;
        void publishHostClockRef.current({
          positionMs: player.getCurrentTime() * 1000,
          durationMs: player.getDuration() * 1000,
        });
      } catch {
        // ignore
      }
    };

    const timer = window.setInterval(tick, HOST_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [ready, isHost, session.playback_state]);

  useEffect(() => {
    if (!ready) return;
    if (session.playback_state !== "playing") return;
    if (isHost) return;

    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current || applyingRemoteRef.current) return;

      try {
        const state = player.getPlayerState();
        if (state === YT_STATE.ENDED) {
          if (!endedHandledRef.current) {
            endedHandledRef.current = true;
            onEndedRef.current();
          }
          return;
        }
        if (state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) {
          const target = targetSecondsFromSession(sessionRef.current);
          forcePlay(player, target);
          scheduleUnlockCheck();
          return;
        }

        const target = targetSecondsFromSession(sessionRef.current);
        const current = player.getCurrentTime();
        if (Math.abs(current - target) > DRIFT_SOFT_SEC) {
          applyingRemoteRef.current = true;
          player.seekTo(target, true);
          window.setTimeout(() => {
            applyingRemoteRef.current = false;
          }, 500);
        }
      } catch {
        // ignore
      }
    }, FOLLOWER_CORRECT_MS);

    return () => window.clearInterval(timer);
  }, [ready, isHost, scheduleUnlockCheck, session.playback_state]);

  return (
    <div className={styles.layer}>
      <div className={styles.stage}>
        <div className={styles.playerWrap}>
          <div id={PLAYER_ELEMENT_ID} className={styles.player} />
          {!session.current_video_id ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>รอคิวเพลงจาก LINE</p>
              <p className={styles.emptyHint}>
                ส่งลิงก์ YouTube เข้าแชท แล้วโบ้จะใส่คิวให้อัตโนมัติ
              </p>
            </div>
          ) : null}
          {needsUnlock && session.current_video_id ? (
            <button
              type="button"
              className={styles.unlock}
              onClick={unlockPlayback}
            >
              <span className={styles.unlockTitle}>แตะเพื่อเปิดเสียง</span>
              <span className={styles.unlockHint}>
                เบราว์เซอร์บล็อก autoplay — กดครั้งเดียวพอ
              </span>
            </button>
          ) : null}
        </div>
        {session.current_title ? (
          <div className={styles.nowPlaying}>
            <span className={styles.nowLabel}>กำลังเล่น</span>
            <span className={styles.nowTitle}>{session.current_title}</span>
            {session.current_owner_name ? (
              <span className={styles.nowOwner}>
                ขอโดย {session.current_owner_name}
              </span>
            ) : null}
            {currentLikes.length > 0 ? (
              <span className={styles.nowLikes}>
                <Heart size={16} strokeWidth={2.4} fill="currentColor" />
                {currentLikes.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
