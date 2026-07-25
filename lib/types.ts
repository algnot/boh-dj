export type PlaybackState = "playing" | "paused";

export type LoopMode = "off" | "one" | "all" | "shuffle";

export type LineSourceType = "user" | "group" | "room";

export type HistoryTrack = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  ownerName?: string;
  ownerUserId?: string;
};

export type Room = {
  id: string;
  line_source_type: LineSourceType;
  line_source_id: string;
  control_token: string;
  created_at: string;
};

export type RoomSession = {
  room_id: string;
  current_video_id: string | null;
  current_title: string;
  current_thumbnail_url: string;
  current_play_id: string;
  current_owner_name: string;
  current_owner_user_id: string;
  playback_state: PlaybackState;
  playback_position_ms: number;
  playback_updated_at: string;
  duration_ms: number;
  loop_mode: LoopMode;
  host_client_id: string | null;
  history: HistoryTrack[];
  updated_at: string;
};

export type QueueItem = {
  id: string;
  room_id: string;
  youtube_video_id: string;
  title: string;
  thumbnail_url: string;
  added_by_name: string;
  added_by_user_id: string;
  is_recycled: boolean;
  sort_order: number;
  created_at: string;
};

export type RoomLike = {
  id: string;
  room_id: string;
  play_id: string;
  video_id: string;
  track_title: string;
  owner_name: string;
  owner_user_id: string;
  liker_key: string;
  liker_name: string;
  liker_picture_url: string;
  created_at: string;
};

export type ScoreTrack = {
  videoId: string;
  title: string;
  points: number;
};

export type ScoreEntry = {
  key: string;
  name: string;
  points: number;
  tracks: ScoreTrack[];
};

export type RoomEventType =
  | "room_created"
  | "song_added"
  | "song_playing"
  | "play"
  | "pause"
  | "skip_next"
  | "play_previous"
  | "loop_changed"
  | "seek"
  | "queue_removed"
  | "play_from_queue"
  | "song_liked";

export type RoomEvent = {
  id: string;
  room_id: string;
  event_type: RoomEventType | string;
  message: string;
  actor_name: string;
  actor_user_id: string;
  actor_picture_url: string;
  track_title: string;
  track_video_id: string;
  created_at: string;
};

export type RoomActor = {
  name: string;
  userId?: string;
  pictureUrl?: string;
};

export type Database = {
  public: {
    Tables: {
      rooms: {
        Row: Room;
        Insert: {
          id: string;
          line_source_type: LineSourceType;
          line_source_id: string;
          control_token: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          line_source_type?: LineSourceType;
          line_source_id?: string;
          control_token?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      room_sessions: {
        Row: RoomSession;
        Insert: {
          room_id: string;
          current_video_id?: string | null;
          current_title?: string;
          current_thumbnail_url?: string;
          current_play_id?: string;
          current_owner_name?: string;
          current_owner_user_id?: string;
          playback_state?: string;
          playback_position_ms?: number;
          playback_updated_at?: string;
          duration_ms?: number;
          loop_mode?: string;
          host_client_id?: string | null;
          history?: HistoryTrack[];
          updated_at?: string;
        };
        Update: {
          room_id?: string;
          current_video_id?: string | null;
          current_title?: string;
          current_thumbnail_url?: string;
          current_play_id?: string;
          current_owner_name?: string;
          current_owner_user_id?: string;
          playback_state?: string;
          playback_position_ms?: number;
          playback_updated_at?: string;
          duration_ms?: number;
          loop_mode?: string;
          host_client_id?: string | null;
          history?: HistoryTrack[];
          updated_at?: string;
        };
        Relationships: [];
      };
      room_queue: {
        Row: QueueItem;
        Insert: {
          id?: string;
          room_id: string;
          youtube_video_id: string;
          title?: string;
          thumbnail_url?: string;
          added_by_name?: string;
          added_by_user_id?: string;
          is_recycled?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          youtube_video_id?: string;
          title?: string;
          thumbnail_url?: string;
          added_by_name?: string;
          added_by_user_id?: string;
          is_recycled?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      room_likes: {
        Row: RoomLike;
        Insert: {
          id?: string;
          room_id: string;
          play_id: string;
          video_id: string;
          track_title?: string;
          owner_name?: string;
          owner_user_id?: string;
          liker_key: string;
          liker_name?: string;
          liker_picture_url?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          play_id?: string;
          video_id?: string;
          track_title?: string;
          owner_name?: string;
          owner_user_id?: string;
          liker_key?: string;
          liker_name?: string;
          liker_picture_url?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      room_score_announcements: {
        Row: {
          play_id: string;
          room_id: string;
          created_at: string;
        };
        Insert: {
          play_id: string;
          room_id: string;
          created_at?: string;
        };
        Update: {
          play_id?: string;
          room_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      room_events: {
        Row: RoomEvent;
        Insert: {
          id?: string;
          room_id: string;
          event_type: string;
          message?: string;
          actor_name?: string;
          actor_user_id?: string;
          actor_picture_url?: string;
          track_title?: string;
          track_video_id?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          event_type?: string;
          message?: string;
          actor_name?: string;
          actor_user_id?: string;
          actor_picture_url?: string;
          track_title?: string;
          track_video_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
