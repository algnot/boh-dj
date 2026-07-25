import { getRoomById } from "@/lib/room-service";
import { RoomProvider } from "@/lib/room-context";
import { DisplayPlayer } from "@/components/DisplayPlayer";
import styles from "./page.module.css";

type PageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function DisplayPage({ params }: PageProps) {
  const { roomId } = await params;
  const room = await getRoomById(roomId);

  if (!room) {
    return (
      <main className={styles.blocked}>
        <h1 className={styles.title}>ไม่พบห้องนี้</h1>
        <p className={styles.hint}>
          พิมพ์คำว่า <strong>โบ้</strong> ใน LINE เพื่อสร้างห้องใหม่
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <RoomProvider roomId={roomId}>
        <DisplayPlayer />
      </RoomProvider>
    </main>
  );
}
