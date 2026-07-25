import { ControlLiffApp } from "@/components/ControlLiffApp";
import { verifyControlAccess } from "@/lib/auth-room";
import styles from "./page.module.css";

type PageProps = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ t?: string }>;
};

export default async function ControlPage({ params, searchParams }: PageProps) {
  const { roomId } = await params;
  const { t } = await searchParams;
  const access = await verifyControlAccess(roomId, t ?? null);

  if (!access.ok) {
    return (
      <main className={styles.blocked}>
        <h1 className={styles.title}>
          {access.reason === "not_found"
            ? "ไม่พบห้องนี้"
            : "ลิงก์ควบคุมไม่ถูกต้อง"}
        </h1>
        <p className={styles.hint}>
          พิมพ์คำว่า <strong>โบ้</strong> ใน LINE เพื่อรับลิงก์ควบคุมใหม่
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <ControlLiffApp roomId={roomId} />
    </main>
  );
}
