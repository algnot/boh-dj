"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

/**
 * LIFF entrypoint.
 * Set Endpoint URL in LINE Developers to: {NEXT_PUBLIC_APP_URL}/liff
 * Bot opens: https://liff.line.me/{LIFF_ID}?room={id}&t={token}
 */
export default function LiffEntryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("กำลังเปิดรีโมท…");

  useEffect(() => {
    const room = (searchParams.get("room") ?? "").trim();
    const token = (searchParams.get("t") ?? "").trim();
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
