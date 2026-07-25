"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

const STORAGE_KEY = "boh-dj-liff-target";

/**
 * LIFF moves extra query into `liff.state` (percent-encoded), e.g.
 *   /liff?liff.state=%3Froom%3Dabc%26t%3Dxyz  →  ?room=abc&t=xyz
 *
 * After external-browser LINE Login, OAuth returns to /liff?code=...&state=...
 * without room/t — so we persist them in sessionStorage before login.
 */
export function readRoomAndToken(searchParams: URLSearchParams): {
  room: string;
  token: string;
} {
  let room = (searchParams.get("room") ?? "").trim();
  let token = (searchParams.get("t") ?? "").trim();
  if (room && token) return { room, token };

  const rawState = searchParams.get("liff.state");
  if (rawState) {
    let state = rawState;
    try {
      state = decodeURIComponent(rawState);
      if (/%[0-9A-Fa-f]{2}/.test(state)) {
        state = decodeURIComponent(state);
      }
    } catch {
      state = rawState;
    }

    const controlMatch = state.match(/^\/control\/([^/?#]+)/);
    if (controlMatch) {
      room = decodeURIComponent(controlMatch[1] ?? "").trim();
      const q = state.includes("?") ? state.slice(state.indexOf("?") + 1) : "";
      token = (new URLSearchParams(q).get("t") ?? "").trim();
      if (room && token) return { room, token };
    }

    const query = state.startsWith("?") ? state.slice(1) : state;
    if (query.includes("=")) {
      const parsed = new URLSearchParams(query);
      room = (parsed.get("room") ?? room).trim();
      token = (parsed.get("t") ?? token).trim();
      if (room && token) return { room, token };
    }
  }

  // Fallback after OAuth redirect wiped query params
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { room?: string; token?: string };
      room = (saved.room ?? "").trim();
      token = (saved.token ?? "").trim();
    }
  } catch {
    // ignore
  }

  return { room, token };
}

function rememberTarget(room: string, token: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ room, token }));
  } catch {
    // ignore
  }
}

function clearTarget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function LiffEntryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("กำลังเปิดรีโมท…");

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const { room, token } = readRoomAndToken(params);
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

    if (!room || !token) {
      setMessage("ลิงก์ไม่ครบ — พิมพ์คำว่า โบ้ ใน LINE เพื่อรับลิงก์ใหม่");
      return;
    }

    rememberTarget(room, token);

    const controlPath = `/control/${encodeURIComponent(room)}?t=${encodeURIComponent(token)}`;

    const boot = async () => {
      if (!liffId) {
        clearTarget();
        router.replace(controlPath);
        return;
      }

      try {
        const liff = (await import("@line/liff")).default;
        // Don't use withLoginOnExternalBrowser — it redirects to /liff without room/t.
        // We login manually after persisting the target in sessionStorage.
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          setMessage("กำลังเข้าสู่ระบบ LINE…");
          const redirectUri = `${window.location.origin}/liff?room=${encodeURIComponent(room)}&t=${encodeURIComponent(token)}`;
          liff.login({ redirectUri });
          return;
        }

        clearTarget();
        router.replace(controlPath);
      } catch (error) {
        console.error("LIFF entry failed", error);
        // Still try control — token is checked server-side
        clearTarget();
        router.replace(controlPath);
      }
    };

    void boot();
  }, [router, searchParams]);

  return (
    <main className={styles.page}>
      <p className={styles.brand}>โบ้ DJ</p>
      <p className={styles.hint}>{message}</p>
    </main>
  );
}
