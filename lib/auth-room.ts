import { getRoomById } from "@/lib/room-service";

export async function verifyControlAccess(roomId: string, token: string | null) {
  const room = await getRoomById(roomId);
  if (!room) {
    return { ok: false as const, reason: "not_found" as const };
  }
  if (!token || token !== room.control_token) {
    return { ok: false as const, reason: "unauthorized" as const };
  }
  return { ok: true as const, room };
}
