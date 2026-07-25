import type { messagingApi } from "@line/bot-sdk";

type FlexMessage = Extract<messagingApi.Message, { type: "flex" }>;

export function roomReadyFlex(args: {
  created: boolean;
  roomId: string;
  controlUrl: string;
  displayUrl: string;
}): FlexMessage {
  const title = args.created ? "สร้างห้องแล้ว" : "ห้องพร้อมแล้ว";

  return {
    type: "flex",
    altText: `${title} — โบ้ DJ ห้อง ${args.roomId}`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "20px",
        backgroundColor: "#0B0C10",
        contents: [
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "โบ้ DJ",
                weight: "bold",
                size: "sm",
                color: "#FF7A18",
              },
              {
                type: "text",
                text: title,
                weight: "bold",
                size: "xl",
                color: "#FFF7ED",
                wrap: true,
              },
              {
                type: "text",
                text: `รหัสห้อง  ${args.roomId}`,
                size: "sm",
                color: "#A8A29E",
                wrap: true,
              },
            ],
          },
          {
            type: "separator",
            color: "#2A2E38",
          },
          {
            type: "text",
            text: "เปิดรีโมทเพื่อคุมคิว หรือเปิดจอเพื่อเล่นเสียง",
            size: "sm",
            color: "#D6D3D1",
            wrap: true,
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "md",
                color: "#FF7A18",
                action: {
                  type: "uri",
                  label: "เปิดรีโมท",
                  uri: args.controlUrl,
                },
              },
              {
                type: "button",
                style: "primary",
                height: "md",
                color: "#14B8A6",
                action: {
                  type: "uri",
                  label: "เปิดจอ Display",
                  uri: args.displayUrl,
                },
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            margin: "md",
            contents: [
              {
                type: "text",
                text: "วิธีใช้สั้น ๆ",
                size: "xs",
                color: "#FF7A18",
                weight: "bold",
              },
              {
                type: "text",
                text: "1. กดเปิดจอ Display บนเครื่องที่จะเปิดลำโพง\n2. กดเปิดรีโมทเพื่อคุมเล่น/หยุด/คิว\n3. ส่งลิงก์ YouTube เข้าแชทนี้ได้เลย",
                size: "xs",
                color: "#A8A29E",
                wrap: true,
              },
            ],
          },
        ],
      },
    },
  };
}

export function songQueuedFlex(args: {
  mode: "play" | "queue";
  title: string;
  thumbnailUrl?: string;
  controlUrl?: string;
  displayUrl?: string;
}): FlexMessage {
  const heading = args.mode === "play" ? "เริ่มเล่นแล้ว" : "เพิ่มเข้าคิวแล้ว";
  const emoji = args.mode === "play" ? "▶️" : "➕";

  const buttons: messagingApi.FlexComponent[] = [];
  if (args.controlUrl) {
    buttons.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#FF7A18",
      action: {
        type: "uri",
        label: "เปิดรีโมท",
        uri: args.controlUrl,
      },
    });
  }
  if (args.displayUrl) {
    buttons.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#14B8A6",
      action: {
        type: "uri",
        label: "เปิดจอ",
        uri: args.displayUrl,
      },
    });
  }

  const bodyContents: messagingApi.FlexComponent[] = [
    {
      type: "text",
      text: `${emoji}  ${heading}`,
      weight: "bold",
      size: "md",
      color: "#FFF7ED",
    },
    {
      type: "text",
      text: args.title,
      size: "sm",
      color: "#D6D3D1",
      wrap: true,
      maxLines: 3,
    },
  ];

  if (buttons.length > 0) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      spacing: "sm",
      margin: "md",
      contents: buttons,
    });
  }

  return {
    type: "flex",
    altText: `${emoji} ${heading}: ${args.title}`,
    contents: {
      type: "bubble",
      size: "kilo",
      hero: args.thumbnailUrl
        ? {
            type: "image",
            url: args.thumbnailUrl,
            size: "full",
            aspectRatio: "16:9",
            aspectMode: "cover",
          }
        : undefined,
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "16px",
        backgroundColor: "#0B0C10",
        contents: bodyContents,
      },
    },
  };
}
