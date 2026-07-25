"use client";

import { ControlPanel } from "@/components/ControlPanel";
import { LiffProvider, useLiff } from "@/lib/liff-context";
import { RoomProvider } from "@/lib/room-context";
import styles from "@/app/control/[roomId]/page.module.css";

function ControlLiffBody({ roomId }: { roomId: string }) {
  const { ready, error, isLoggedIn, profile, login } = useLiff();

  if (!ready) {
    return (
      <div className={styles.liffGate}>
        <p className={styles.liffHint}>กำลังเข้าสู่ระบบ LINE…</p>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className={styles.liffGate}>
        <h1 className={styles.title}>เปิด LIFF ไม่สำเร็จ</h1>
        <p className={styles.hint}>{error}</p>
        <p className={styles.hint}>
          ตั้งค่า LIFF ใน LINE Developers แล้วใส่{" "}
          <code>NEXT_PUBLIC_LIFF_ID</code>
        </p>
      </div>
    );
  }

  if (!isLoggedIn || !profile) {
    return (
      <div className={styles.liffGate}>
        <h1 className={styles.title}>เข้าสู่ระบบ LINE</h1>
        <p className={styles.hint}>ต้องล็อกอินเพื่อควบคุมห้องและบันทึกว่าใครทำอะไร</p>
        <button type="button" className={styles.loginBtn} onClick={login}>
          เข้าสู่ระบบด้วย LINE
        </button>
      </div>
    );
  }

  return (
    <RoomProvider
      roomId={roomId}
      actor={{
        name: profile.displayName,
        userId: profile.userId,
        pictureUrl: profile.pictureUrl,
      }}
    >
      <ControlPanel />
    </RoomProvider>
  );
}

export function ControlLiffApp({ roomId }: { roomId: string }) {
  return (
    <LiffProvider>
      <ControlLiffBody roomId={roomId} />
    </LiffProvider>
  );
}
