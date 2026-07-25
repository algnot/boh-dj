import {
  messagingApi,
  webhook,
  validateSignature,
  SignatureValidationFailed,
} from "@line/bot-sdk";
import {
  addYoutubeFromLineMessage,
  controlUrl,
  displayUrl,
  getOrCreateRoomForLineSource,
  getRoomByLineSource,
} from "@/lib/room-service";
import { roomReadyFlex, songQueuedFlex } from "@/lib/line-flex";
import type { LineSourceType } from "@/lib/types";

type Message = messagingApi.Message;
type WebhookEvent = webhook.Event;

function getLineConfig() {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelAccessToken) {
    throw new Error("Missing LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN");
  }

  return { channelSecret, channelAccessToken };
}

function getMessagingClient() {
  const { channelAccessToken } = getLineConfig();
  return new messagingApi.MessagingApiClient({ channelAccessToken });
}

function sourceFromEvent(event: WebhookEvent): {
  sourceType: LineSourceType;
  sourceId: string;
} | null {
  const source = event.source;
  if (!source) return null;

  if (source.type === "user" && source.userId) {
    return { sourceType: "user", sourceId: source.userId };
  }
  if (source.type === "group" && source.groupId) {
    return { sourceType: "group", sourceId: source.groupId };
  }
  if (source.type === "room" && source.roomId) {
    return { sourceType: "room", sourceId: source.roomId };
  }
  return null;
}

function getReplyToken(event: WebhookEvent): string | null {
  if ("replyToken" in event && typeof event.replyToken === "string") {
    return event.replyToken;
  }
  return null;
}

async function resolveDisplayName(event: WebhookEvent): Promise<string> {
  const client = getMessagingClient();
  const source = event.source;
  if (!source) return "เพื่อน";

  try {
    if (source.type === "group" && source.groupId && source.userId) {
      const profile = await client.getGroupMemberProfile(
        source.groupId,
        source.userId,
      );
      return profile.displayName || "เพื่อนในกลุ่ม";
    }
    if (source.type === "room" && source.roomId && source.userId) {
      const profile = await client.getRoomMemberProfile(
        source.roomId,
        source.userId,
      );
      return profile.displayName || "เพื่อนในห้อง";
    }
    if (source.type === "user" && source.userId) {
      const profile = await client.getProfile(source.userId);
      return profile.displayName || "คุณ";
    }
  } catch {
    // ignore profile lookup failures
  }

  return "เพื่อน";
}

function textMessage(text: string): Message {
  return { type: "text", text };
}

async function reply(replyToken: string, messages: Message[]) {
  const client = getMessagingClient();
  await client.replyMessage({ replyToken, messages });
}

async function handleBohCommand(event: WebhookEvent) {
  if (event.type !== "message") return false;
  if (!("message" in event) || event.message.type !== "text") return false;

  const text = event.message.text.trim();
  if (text !== "โบ้") return false;

  const replyToken = getReplyToken(event);
  if (!replyToken) return true;

  const source = sourceFromEvent(event);
  if (!source) return true;

  const displayName = await resolveDisplayName(event);
  const { room, created } = await getOrCreateRoomForLineSource({
    ...source,
    createdByName: displayName,
  });

  await reply(replyToken, [
    roomReadyFlex({
      created,
      roomId: room.id,
      controlUrl: controlUrl(room),
      displayUrl: displayUrl(room.id),
    }),
  ]);

  return true;
}

async function handleYoutubeLink(event: WebhookEvent) {
  if (event.type !== "message") return false;
  if (!("message" in event) || event.message.type !== "text") return false;

  const replyToken = getReplyToken(event);
  if (!replyToken) return false;

  const source = sourceFromEvent(event);
  if (!source) return false;

  const displayName = await resolveDisplayName(event);
  const result = await addYoutubeFromLineMessage({
    sourceId: source.sourceId,
    text: event.message.text,
    addedByName: displayName,
  });

  if (!result.ok) {
    return false;
  }

  const room = await getRoomByLineSource(source.sourceId);
  await reply(replyToken, [
    songQueuedFlex({
      mode: result.mode,
      title: result.title,
      controlUrl: room ? controlUrl(room) : undefined,
      displayUrl: room ? displayUrl(room.id) : undefined,
    }),
  ]);

  return true;
}

const WELCOME_TEXT = [
  "ยินดีต้อนรับสู่ โบ้ DJ 🎧",
  "",
  "ที่นี่เราฟังเพลง YouTube พร้อมกันได้ทั้งแชทเดี่ยวและกลุ่ม",
  "",
  "เริ่มเลย:",
  "1. พิมพ์ \"โบ้\" เพื่อสร้างห้อง — เดี๋ยวส่งลิงก์รีโมทให้",
  "2. เปิดรีโมทแล้วกดไปหน้า Display เพื่อเปิดจอ+เสียง",
  "3. ส่งลิงก์ YouTube เข้ามา เดี๋ยวจัดคิวให้อัตโนมัติ",
  "",
  "อยากฟังด้วยกันทั้งแก๊ง? ชวนโบ้เข้ากลุ่มแล้วพิมพ์ \"โบ้\" ได้เลย",
].join("\n");

const FIRST_REPLY_TEXT = [
  "พิมพ์ \"โบ้\" เพื่อสร้างห้องฟังเพลงได้เลย 🎧",
  "หรือส่งลิงก์ YouTube เข้ามาเพื่อเพิ่มเข้าคิว",
].join("\n");

async function handleFollow(event: WebhookEvent) {
  if (event.type !== "follow") return false;
  const replyToken = getReplyToken(event);
  if (!replyToken) return true;
  await reply(replyToken, [textMessage(WELCOME_TEXT)]);
  return true;
}

async function handleDefaultReply(event: WebhookEvent) {
  if (event.type !== "message") return false;
  if (!("message" in event) || event.message.type !== "text") return false;

  const source = sourceFromEvent(event);
  // Only auto-reply in 1:1 chats so we don't spam groups
  if (!source || source.sourceType !== "user") return false;

  const replyToken = getReplyToken(event);
  if (!replyToken) return false;

  await reply(replyToken, [textMessage(FIRST_REPLY_TEXT)]);
  return true;
}

export async function handleLineWebhook(rawBody: string, signature: string) {
  const { channelSecret } = getLineConfig();

  if (!validateSignature(rawBody, channelSecret, signature)) {
    throw new SignatureValidationFailed("Invalid signature", { signature });
  }

  const body = JSON.parse(rawBody) as { events?: WebhookEvent[] };
  const events = body.events ?? [];

  await Promise.all(
    events.map(async (event) => {
      try {
        if (await handleFollow(event)) return;
        if (await handleBohCommand(event)) return;
        if (await handleYoutubeLink(event)) return;
        if (await handleDefaultReply(event)) return;
      } catch (error) {
        console.error("LINE event error", error);
      }
    }),
  );
}
