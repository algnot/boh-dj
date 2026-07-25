import { getSupabase } from "@/lib/supabase/client";
import type { RoomActor, RoomEvent, RoomEventType } from "@/lib/types";

export async function logRoomEvent(args: {
  roomId: string;
  eventType: RoomEventType;
  message: string;
  actor?: RoomActor | null;
  trackTitle?: string;
  trackVideoId?: string;
}): Promise<RoomEvent | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("room_events")
      .insert({
        room_id: args.roomId,
        event_type: args.eventType,
        message: args.message,
        actor_name: args.actor?.name ?? "โบ้",
        actor_user_id: args.actor?.userId ?? "",
        actor_picture_url: args.actor?.pictureUrl ?? "",
        track_title: args.trackTitle ?? "",
        track_video_id: args.trackVideoId ?? "",
      })
      .select("*")
      .single();

    if (error) {
      console.error("logRoomEvent failed", error);
      return null;
    }
    return data as RoomEvent;
  } catch (error) {
    console.error("logRoomEvent failed", error);
    return null;
  }
}

export function formatEventTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
