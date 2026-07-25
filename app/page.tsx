import { HomeActions } from "@/components/HomeActions";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden />
      <HomeActions />
    </main>
  );
}
