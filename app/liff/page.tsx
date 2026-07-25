import { Suspense } from "react";
import LiffEntryClient from "./LiffEntryClient";
import styles from "./page.module.css";

export default function LiffPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <p className={styles.brand}>โบ้ DJ</p>
          <p className={styles.hint}>กำลังเปิดรีโมท…</p>
        </main>
      }
    >
      <LiffEntryClient />
    </Suspense>
  );
}
