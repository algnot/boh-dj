"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

/**
 * LIFF moves extra query into `liff.state` (percent-encoded), e.g.
 *   /liff?liff.state=%3Froom%3Dabc%26t%3Dxyz  →  ?room=abc&t=xyz
 */
export function readRoomAndToken(searchParams: URLSearchParams): {
  room: string;
  token: string;
} {
  let room = (searchParams.get("room") ?? "").trim();
  let token = (searchParams.get("t") ?? "").trim();
  if (room && token) return { room, token };

  const rawState = searchParams.get("liff.state");
  if (!rawState) return { room, token };

  let state = rawState;
  try {
    // Decode once or twice in case of double-encoding
    state = decodeURIComponent(rawState);
    if (/%[0-9A-Fa-f]{2}/.test(state)) {
      state = decodeURIComponent(state);
    }
  } catch {
    state = rawState;
  }

  // /control/{room}?t={token}
  const controlMatch = state.match(/^\/control\/([^/?#]+)/);
  if (controlMatch) {
    room = decodeURIComponent(controlMatch[1] ?? "").trim();
    const q = state.includes("?") ? state.slice(state.indexOf("?") + 1) : "";
    token = (new URLSearchParams(q).get("t") ?? "").trim();
    return { room, token };
  }

  // ?room=x&t=y  OR  room=x&t=y
  const query = state.startsWith("?") ? state.slice(1) : state;
  if (query.includes("=")) {
    const parsed = new URLSearchParams(query);
    room = (parsed.get("room") ?? room).trim();
    token = (parsed.get("t") ?? token).trim();
  }

  return { room, token };
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

    const controlPath = `/control/${encodeURIComponent(room)}?t=${encodeURIComponent(token)}`;

    const boot = async () => {
      if (!liffId) {
        router.replace(controlPath);
        return;
      }

      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          const redirectUri = `${window.location.origin}/liff?room=${encodeURIComponent(room)}&t=${encodeURIComponent(token)}`;
          liff.login({ redirectUri });
          return;
        }

        router.replace(controlPath);
      } catch (error) {
        console.error("LIFF entry failed", error);
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
