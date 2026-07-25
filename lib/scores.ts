import type { RoomLike, ScoreEntry } from "@/lib/types";

/** Stable identity for a requester: LINE user id when known, else the name. */
export function ownerKey(like: Pick<RoomLike, "owner_user_id" | "owner_name">) {
  return like.owner_user_id || `name:${like.owner_name}`;
}

/** Points earned per requester, with the songs that earned them. */
export function buildLeaderboard(likes: RoomLike[]): ScoreEntry[] {
  const byOwner = new Map<string, ScoreEntry>();

  for (const like of likes) {
    const key = ownerKey(like);
    const entry = byOwner.get(key) ?? {
      key,
      name: like.owner_name || "ไม่ทราบชื่อ",
      points: 0,
      tracks: [],
    };

    entry.points += 1;
    const track = entry.tracks.find((item) => item.videoId === like.video_id);
    if (track) {
      track.points += 1;
    } else {
      entry.tracks.push({
        videoId: like.video_id,
        title: like.track_title || like.video_id,
        points: 1,
      });
    }

    byOwner.set(key, entry);
  }

  const entries = [...byOwner.values()];
  for (const entry of entries) {
    entry.tracks.sort(
      (a, b) => b.points - a.points || a.title.localeCompare(b.title),
    );
  }
  entries.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return entries;
}
