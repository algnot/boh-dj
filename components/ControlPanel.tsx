"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  Activity,
  ListMusic,
  MonitorPlay,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Repeat2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { formatMs } from "@/lib/format-time";
import { formatEventTime } from "@/lib/room-events";
import { useRoom } from "@/lib/room-context";
import type { LoopMode } from "@/lib/types";
import styles from "./ControlPanel.module.css";

function loopInfo(mode: LoopMode) {
  if (mode === "one") {
    return {
      title: "วนเพลงนี้",
      hint: "จบแล้วเล่นเพลงเดิมซ้ำ",
      className: styles.loopOne,
    };
  }
  if (mode === "all") {
    return {
      title: "วนทั้งคิว",
      hint: "จบแล้วไปเพลงถัดไป วนครบคิว",
      className: styles.loopAll,
    };
  }
  return {
    title: "ไม่วนซ้ำ",
    hint: "เล่นครบคิวแล้วหยุด",
    className: styles.loopOff,
  };
}

function LoopIcon({ mode }: { mode: LoopMode }) {
  if (mode === "one") return <Repeat1 size={20} strokeWidth={2.2} />;
  if (mode === "all") return <Repeat2 size={20} strokeWidth={2.2} />;
  return <Repeat size={20} strokeWidth={2.2} className={styles.loopOffIcon} />;
}

export function ControlPanel() {
  const {
    ready,
    loadError,
    roomId,
    session,
    queue,
    events,
    actor,
    busy,
    estimatedPositionMs,
    togglePlayPause,
    seekToMs,
    skipNext,
    playPrevious,
    cycleLoopMode,
    removeFromQueue,
    playQueueItem,
    addToQueue,
  } = useRoom();

  const [activeTab, setActiveTab] = useState<"queue" | "activity">("queue");
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState("");
  const [seeking, setSeeking] = useState<number | null>(null);

  const duration = session.duration_ms > 0 ? session.duration_ms : 0;
  const displayMs = seeking ?? estimatedPositionMs;
  const progress =
    duration > 0 ? Math.min(100, (displayMs / duration) * 100) : 0;
  const loop = loopInfo(session.loop_mode);

  const thumb = useMemo(() => {
    if (session.current_thumbnail_url) return session.current_thumbnail_url;
    if (session.current_video_id) {
      return `https://i.ytimg.com/vi/${session.current_video_id}/hqdefault.jpg`;
    }
    return null;
  }, [session.current_thumbnail_url, session.current_video_id]);

  const onSeekCommit = async (value: number) => {
    setSeeking(null);
    await seekToMs(value);
  };

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    const value = urlInput.trim();
    if (!value || busy) return;
    setError("");
    const ok = await addToQueue(value);
    if (!ok) {
      setError("ลิงก์ YouTube ไม่ถูกต้อง");
      return;
    }
    setUrlInput("");
  };

  if (!ready) {
    return (
      <div className={styles.shell}>
        <p className={styles.loading}>กำลังโหลดห้อง…</p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.userRow}>
            {actor.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={actor.pictureUrl}
                alt=""
                className={styles.avatar}
                width={28}
                height={28}
              />
            ) : (
              <span className={styles.avatarFallback} aria-hidden />
            )}
            <div>
              <p className={styles.userName}>{actor.name}</p>
              <p className={styles.roomMeta}>ห้อง {roomId}</p>
            </div>
          </div>
        </div>
        <Link
          href={`/display/${roomId}`}
          className={styles.displayLink}
          target="_blank"
          rel="noreferrer"
        >
          <MonitorPlay size={18} strokeWidth={2.2} />
          หน้า Display
        </Link>
      </header>

      <section className={styles.now}>
        <div
          className={styles.art}
          style={
            thumb
              ? { backgroundImage: `url(${thumb})` }
              : undefined
          }
          aria-hidden
        />
        <div className={styles.nowText}>
          <p className={styles.nowLabel}>กำลังเล่น</p>
          <h1 className={styles.title}>
            {session.current_title || "ยังไม่มีเพลง"}
          </h1>
        </div>
      </section>

      <section className={styles.transport}>
        <div className={styles.timeRow}>
          <span>{formatMs(displayMs)}</span>
          <span>{duration > 0 ? formatMs(duration) : "--:--"}</span>
        </div>
        <input
          className={styles.seek}
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={250}
          value={Math.min(displayMs, Math.max(duration, 1))}
          disabled={!session.current_video_id}
          onChange={(event) => setSeeking(Number(event.target.value))}
          onMouseUp={(event) =>
            void onSeekCommit(Number(event.currentTarget.value))
          }
          onTouchEnd={(event) =>
            void onSeekCommit(Number(event.currentTarget.value))
          }
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              void onSeekCommit(Number(event.currentTarget.value));
            }
          }}
          style={{ "--progress": `${progress}%` } as CSSProperties}
          aria-label="ตำแหน่งเพลง"
        />

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void playPrevious()}
            disabled={busy || session.history.length === 0}
            aria-label="เพลงก่อนหน้า"
          >
            <SkipBack size={22} strokeWidth={2.2} />
          </button>

          <button
            type="button"
            className={styles.playBtn}
            onClick={() => void togglePlayPause()}
            disabled={busy || !session.current_video_id}
            aria-label={
              session.playback_state === "playing" ? "หยุดชั่วคราว" : "เล่นต่อ"
            }
          >
            {session.playback_state === "playing" ? (
              <Pause size={28} strokeWidth={2.2} />
            ) : (
              <Play size={28} strokeWidth={2.2} />
            )}
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void skipNext()}
            disabled={busy}
            aria-label="เพลงถัดไป"
          >
            <SkipForward size={22} strokeWidth={2.2} />
          </button>
        </div>

        <div className={styles.secondary}>
          <button
            type="button"
            className={`${styles.loopBtn} ${loop.className}`}
            onClick={() => void cycleLoopMode()}
            disabled={busy}
            aria-label={`โหมดวนซ้ำ: ${loop.title}. ${loop.hint}. กดเพื่อเปลี่ยน`}
            title={loop.hint}
          >
            <span className={styles.loopIconWrap}>
              <LoopIcon mode={session.loop_mode} />
              {session.loop_mode === "off" ? (
                <span className={styles.loopSlash} aria-hidden />
              ) : null}
            </span>
            <span className={styles.loopText}>
              <span className={styles.loopTitle}>{loop.title}</span>
              <span className={styles.loopHint}>{loop.hint}</span>
            </span>
          </button>
        </div>
      </section>

      <form className={styles.addForm} onSubmit={onAdd}>
        <input
          className={styles.addInput}
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder="ลิงก์ YouTube / เพลลิสต์"
          disabled={busy}
        />
        <button type="submit" className={styles.addBtn} disabled={busy}>
          เพิ่ม
        </button>
      </form>
      {error || loadError ? (
        <p className={styles.error}>{error || loadError}</p>
      ) : null}

      <div className={styles.tabs} role="tablist" aria-label="ข้อมูลห้อง">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "queue"}
          className={`${styles.tab} ${
            activeTab === "queue" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("queue")}
        >
          <ListMusic size={18} strokeWidth={2.2} />
          คิวเพลง
          <span className={styles.tabCount}>{queue.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "activity"}
          className={`${styles.tab} ${
            activeTab === "activity" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("activity")}
        >
          <Activity size={18} strokeWidth={2.2} />
          กิจกรรม
        </button>
      </div>

      {activeTab === "queue" ? (
        <section className={styles.queue}>
          <h2 className={styles.queueTitle}>คิวเพลง</h2>
          {queue.length === 0 ? (
            <p className={styles.queueEmpty}>
              ยังไม่มีคิว — ส่งลิงก์ YouTube ใน LINE ได้เลย
            </p>
          ) : (
            <ul className={styles.queueList}>
              {queue.map((item, index) => (
                <li key={item.id} className={styles.queueItem}>
                  <button
                    type="button"
                    className={styles.queueMain}
                    onClick={() => void playQueueItem(item.id)}
                    disabled={busy}
                  >
                    <span
                      className={styles.queueThumb}
                      style={
                        item.thumbnail_url || item.youtube_video_id
                          ? {
                              backgroundImage: `url(${
                                item.thumbnail_url ||
                                `https://i.ytimg.com/vi/${item.youtube_video_id}/hqdefault.jpg`
                              })`,
                            }
                          : undefined
                      }
                      aria-hidden
                    />
                    <span className={styles.queueIndex}>{index + 1}</span>
                    <span className={styles.queueMeta}>
                      <span className={styles.queueSong}>{item.title}</span>
                      {item.added_by_name ? (
                        <span className={styles.queueBy}>
                          โดย {item.added_by_name}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.queueRemove}
                    onClick={() => void removeFromQueue(item.id)}
                    disabled={busy}
                    aria-label="ลบออกจากคิว"
                  >
                    ลบ
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "activity" ? (
        <section className={styles.activity}>
          <h2 className={styles.queueTitle}>ประวัติกิจกรรม</h2>
          {events.length === 0 ? (
            <p className={styles.queueEmpty}>ยังไม่มีกิจกรรมในห้องนี้</p>
          ) : (
            <ul className={styles.activityList}>
              {events.map((event) => (
                <li key={event.id} className={styles.activityItem}>
                  {event.actor_picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.actor_picture_url}
                      alt=""
                      className={styles.activityAvatar}
                      width={32}
                      height={32}
                    />
                  ) : (
                    <span className={styles.activityAvatarFallback} aria-hidden>
                      {(event.actor_name || "?").slice(0, 1)}
                    </span>
                  )}
                  <div className={styles.activityBody}>
                    <p className={styles.activityMessage}>{event.message}</p>
                    <p className={styles.activityMeta}>
                      {event.actor_name}
                      {event.created_at
                        ? ` · ${formatEventTime(event.created_at)}`
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
