"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "@/app/page.module.css";

const ADD_FRIEND_URL =
  process.env.NEXT_PUBLIC_LINE_ADD_FRIEND_URL ??
  "https://line.me/R/ti/p/@267hubty";

export function HomeActions() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    const roomId = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!roomId) {
      setError("ใส่รหัสห้องก่อน");
      return;
    }
    setError("");
    router.push(`/display/${roomId}`);
  };

  return (
    <div className={styles.stack}>
      <a
        href={ADD_FRIEND_URL}
        target="_blank"
        rel="noreferrer"
        className={styles.addButton}
        aria-label="เพิ่มเพื่อนใน LINE"
      >
        <svg
          className={styles.lineLogo}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2C6.48 2 2 5.69 2 10.23c0 4.07 3.55 7.48 8.35 8.12.32.07.77.21.88.49.1.25.07.63.03.88l-.14.86c-.04.25-.2.99.87.54 1.07-.45 5.77-3.4 7.87-5.82C21.4 13.7 22 12.03 22 10.23 22 5.69 17.52 2 12 2ZM8.15 12.85H6.16a.53.53 0 0 1-.53-.53V8.34a.53.53 0 0 1 1.06 0v3.45h1.46a.53.53 0 0 1 0 1.06Zm2.08-.53a.53.53 0 0 1-1.06 0V8.34a.53.53 0 0 1 1.06 0v3.98Zm4.62 0a.53.53 0 0 1-.36.5.55.55 0 0 1-.17.03.53.53 0 0 1-.43-.21l-2.04-2.78v2.46a.53.53 0 0 1-1.06 0V8.34a.53.53 0 0 1 .36-.5.53.53 0 0 1 .6.18l2.04 2.78V8.34a.53.53 0 0 1 1.06 0v3.98Zm3.3-2.52a.53.53 0 0 1 0 1.06h-1.46v.93h1.46a.53.53 0 0 1 0 1.06h-1.99a.53.53 0 0 1-.53-.53V8.34a.53.53 0 0 1 .53-.53h1.99a.53.53 0 0 1 0 1.06h-1.46v.93h1.46Z" />
        </svg>
        <span className={styles.addLabel}>เพิ่มเพื่อน</span>
      </a>

      <form className={styles.codeForm} onSubmit={onJoin}>
        <input
          className={styles.codeInput}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError("");
          }}
          placeholder="รหัสห้อง"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-label="รหัสห้อง"
        />
        <button type="submit" className={styles.joinBtn}>
          เปิดจอ
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
