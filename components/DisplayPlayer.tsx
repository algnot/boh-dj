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
const WATCHDOG_MS = 4000;
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

function isLivePlayback(state: number) {
  return state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING;
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
  const [playerEpoch, setPlayerEpoch] = useState(0);

  const playerRef = useRef<YtPlayer | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);
  // Expiry timestamp instead of a sticky boolean — a missed timeout used to
  // freeze the player forever until a hard refresh.
  const applyingRemoteUntilRef = useRef(0);
  const lastVideoIdRef = useRef<string | null>(null);
  const lastRemoteKeyRef = useRef("");
  const endedHandledRef = useRef(false);
  const stuckTicksRef = useRef(0);
  const bufferingTicksRef = useRef(0);
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

  const beginApplyingRemote = useCallback((ms = 700) => {
    applyingRemoteUntilRef.current = Date.now() + ms;
  }, []);

  const isApplyingRemote = useCallback(
    () => Date.now() < applyingRemoteUntilRef.current,
    [],
  );

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
        if (!isLivePlayback(state) && state !== YT_STATE.ENDED) {
          setNeedsUnlock(true);
        } else {
          setNeedsUnlock(false);
        }
      } catch {
        setNeedsUnlock(true);
      }
    }, 900);
  }, []);

  const ensureMountNode = useCallback(() => {
    const wrap = mountRef.current;
    if (!wrap) return null;
    let node = document.getElementById(PLAYER_ELEMENT_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = PLAYER_ELEMENT_ID;
      node.className = styles.player;
      wrap.insertBefore(node, wrap.firstChild);
    }
    return node;
  }, []);

  const unlockPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    beginApplyingRemote(700);
    const seek = Math.max(0, estimatedRef.current / 1000);
    forcePlay(player, seek);
    setNeedsUnlock(false);
  }, [beginApplyingRemote]);

  const hardReloadCurrent = useCallback(() => {
    const player = playerRef.current;
    const snap = sessionRef.current;
    if (!player || !snap.current_video_id) return;
    const target = targetSecondsFromSession(snap);
    beginApplyingRemote(1200);
    endedHandledRef.current = false;
    try {
      player.mute();
    } catch {
      // ignore
    }
    try {
      player.loadVideoById({
        videoId: snap.current_video_id,
        startSeconds: target,
      });
    } catch {
      setPlayerEpoch((n) => n + 1);
      return;
    }
    window.setTimeout(() => forcePlay(player, target), 250);
    scheduleUnlockCheck();
  }, [beginApplyingRemote, scheduleUnlockCheck]);

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

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      readyRef.current = false;

      const mount = ensureMountNode();
      if (!mount) return;

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
            if (cancelled) return;
            readyRef.current = true;
            lastVideoIdRef.current = sessionRef.current.current_video_id;
            lastRemoteKeyRef.current = "";
            stuckTicksRef.current = 0;
            bufferingTicksRef.current = 0;
            beginApplyingRemote(600);
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
            } catch {
              // ignore
            }
          },
          onError: () => {
            // Bad video id / embed restricted / iframe hiccup — try once more,
            // then rebuild the whole player.
            if (stuckTicksRef.current < 1) {
              stuckTicksRef.current = 1;
              hardReloadCurrent();
            } else {
              setPlayerEpoch((n) => n + 1);
            }
          },
          onStateChange: (event: YtPlayerEvent) => {
            const state = event.data;

            if (state === YT_STATE.PLAYING) {
              setNeedsUnlock(false);
              endedHandledRef.current = false;
              stuckTicksRef.current = 0;
              bufferingTicksRef.current = 0;
            }

            // Always handle ENDED — even during remote apply.
            if (state === YT_STATE.ENDED) {
              if (endedHandledRef.current) return;
              endedHandledRef.current = true;
              onEndedRef.current();
              return;
            }

            if (isApplyingRemote()) return;

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

              if (snap.playback_state === "paused") {
                beginApplyingRemote(500);
                try {
                  event.target.pauseVideo();
                } catch {
                  // ignore
                }
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
  }, [
    ready,
    playerEpoch,
    beginApplyingRemote,
    ensureMountNode,
    hardReloadCurrent,
    isApplyingRemote,
    scheduleUnlockCheck,
  ]);

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
        // Own heartbeat ticks report the player's own position (~0 drift), so a
        // meaningful gap here means another client seeked — apply it.
        if (Math.abs(current - targetSec) < 1.2) {
          lastRemoteKeyRef.current = remoteKey;
          return;
        }
      }
    }

    lastRemoteKeyRef.current = remoteKey;
    beginApplyingRemote(700);

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
        stuckTicksRef.current = 0;
        bufferingTicksRef.current = 0;
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
        if (!isLivePlayback(playerState)) {
          // Don't forcePlay over ENDED — let advance / watchdog handle next track
          if (playerState !== YT_STATE.ENDED) {
            forcePlay(player, targetSec);
            scheduleUnlockCheck();
          }
        }
      } else if (
        playerState !== YT_STATE.PAUSED &&
        playerState !== YT_STATE.ENDED
      ) {
        try {
          player.pauseVideo();
        } catch {
          // ignore
        }
        setNeedsUnlock(false);
      }
    } catch {
      // Dead player iframe — rebuild on next watchdog / epoch bump.
      setPlayerEpoch((n) => n + 1);
    }
  }, [
    ready,
    isHost,
    beginApplyingRemote,
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
        if (isApplyingRemote()) return;
        if (sessionRef.current.playback_state !== "playing") return;
        if (!isLivePlayback(state)) return;
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
  }, [ready, isHost, isApplyingRemote, session.playback_state]);

  useEffect(() => {
    if (!ready) return;
    if (session.playback_state !== "playing") return;
    if (isHost) return;

    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current || isApplyingRemote()) return;

      try {
        const state = player.getPlayerState();
        if (state === YT_STATE.ENDED) {
          if (!endedHandledRef.current) {
            endedHandledRef.current = true;
            onEndedRef.current();
          }
          return;
        }
        if (!isLivePlayback(state)) {
          const target = targetSecondsFromSession(sessionRef.current);
          forcePlay(player, target);
          scheduleUnlockCheck();
          return;
        }

        const target = targetSecondsFromSession(sessionRef.current);
        const current = player.getCurrentTime();
        if (Math.abs(current - target) > DRIFT_SOFT_SEC) {
          beginApplyingRemote(500);
          player.seekTo(target, true);
        }
      } catch {
        // ignore
      }
    }, FOLLOWER_CORRECT_MS);

    return () => window.clearInterval(timer);
  }, [
    ready,
    isHost,
    beginApplyingRemote,
    isApplyingRemote,
    scheduleUnlockCheck,
    session.playback_state,
  ]);

  // Recover when the iframe goes silent while the room still says "playing".
  // Without this the Control clock keeps walking (wall-clock estimate) and the
  // Display stays black until a manual refresh.
  useEffect(() => {
    if (!ready) return;

    const timer = window.setInterval(() => {
      const snap = sessionRef.current;
      if (!snap.current_video_id || snap.playback_state !== "playing") {
        stuckTicksRef.current = 0;
        bufferingTicksRef.current = 0;
        return;
      }

      const player = playerRef.current;
      if (!player || !readyRef.current) return;

      let state: number;
      try {
        state = player.getPlayerState();
      } catch {
        setPlayerEpoch((n) => n + 1);
        return;
      }

      if (state === YT_STATE.ENDED) {
        if (!endedHandledRef.current) {
          endedHandledRef.current = true;
          onEndedRef.current();
          stuckTicksRef.current = 0;
          return;
        }
        // Advance was already requested but the player is still ENDED — ask again.
        stuckTicksRef.current += 1;
        if (stuckTicksRef.current >= 2) {
          endedHandledRef.current = false;
          onEndedRef.current();
          stuckTicksRef.current = 0;
        }
        return;
      }

      if (state === YT_STATE.BUFFERING) {
        bufferingTicksRef.current += 1;
        // Stuck buffering for ~12s → hard reload the same video.
        if (bufferingTicksRef.current >= 3) {
          bufferingTicksRef.current = 0;
          hardReloadCurrent();
        }
        return;
      }

      if (isLivePlayback(state)) {
        stuckTicksRef.current = 0;
        bufferingTicksRef.current = 0;
        return;
      }

      // PAUSED / CUED / UNSTARTED while room expects playback.
      stuckTicksRef.current += 1;
      applyingRemoteUntilRef.current = 0;
      const target = targetSecondsFromSession(snap);

      if (stuckTicksRef.current === 1) {
        forcePlay(player, target);
        scheduleUnlockCheck();
        return;
      }

      if (stuckTicksRef.current === 2) {
        hardReloadCurrent();
        return;
      }

      // Third strike: rebuild the iframe entirely.
      stuckTicksRef.current = 0;
      setPlayerEpoch((n) => n + 1);
    }, WATCHDOG_MS);

    return () => window.clearInterval(timer);
  }, [ready, hardReloadCurrent, scheduleUnlockCheck]);

  return (
    <div className={styles.layer}>
      <div className={styles.stage}>
        <div className={styles.playerWrap} ref={mountRef}>
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
