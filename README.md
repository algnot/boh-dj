# โบ้ DJ

ฟัง YouTube ด้วยกันผ่าน LINE — พิมพ์คำว่า **โบ้** เพื่อสร้างห้อง แล้วใช้หน้า Control (LIFF) / Display

## Features

- พิมพ์ `โบ้` ในแชท LINE (กลุ่มหรือส่วนตัว) → บอทสร้างห้องและส่งลิงก์ Control แบบ LIFF
- หน้า **Control (LIFF)**: ล็อกอินด้วย LINE แล้วคุมเล่น/หยุด, คิว, ลูป, ข้าม/ย้อน, scrub เวลา — **ไม่เล่นเสียง/วิดีโอ**
- แสดงว่า **ใครเพิ่มเพลง / กดอะไร** ใน activity feed
- หน้า **Display**: autoplay วิดีโอ + เสียง (sync จาก Supabase realtime)
- ส่งลิงก์ YouTube ในแชท → บอทใส่คิวอัตโนมัติและตอบกลับ
- **กดถูกใจเพลง**: คนอื่น (ที่ไม่ใช่คนขอ) กดหัวใจได้คนละ 1 ครั้งต่อเพลง → คนขอเพลงได้คะแนน
  - จบเพลงที่มีคนถูกใจ บอทจะบอกในแชทว่าใครได้กี่คะแนน
  - กดรูปถ้วยรางวัลในหน้า Control เพื่อดูอันดับ แล้วแตะชื่อคนเพื่อดูเพลงที่ทำคะแนน

## Setup

1. คัดลอก `example.env` เป็น `.env` / `.env.local` แล้วใส่ค่าจริง
2. สร้าง Supabase project แล้วรัน:
   - `supabase/schema.sql` (โปรเจกต์ใหม่) **หรือ**
   - `supabase/migration-add-room-events.sql` (ถ้ามี schema เดิมแล้ว เพิ่ม activity)
   - `supabase/migration-add-song-likes.sql` (ถ้ามี schema เดิมแล้ว เพิ่มระบบถูกใจ/คะแนน)
   - เปิด Realtime ให้ `room_sessions`, `room_queue`, `room_events`, `room_likes`
3. สร้าง LINE Messaging API channel
   - Webhook URL: `https://<your-domain>/api/line/webhook`
   - ใส่ `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN`
4. สร้าง **LINE Login** channel → แท็บ LIFF → Add
   - Endpoint URL = `https://<your-domain>/liff` (สำคัญ: ต้องลงท้าย `/liff`)
   - Size: Full / Tall
   - Scopes: `profile`, `openid`
   - ใส่ LIFF ID ใน `NEXT_PUBLIC_LIFF_ID`
5. ตั้ง `NEXT_PUBLIC_APP_URL` เป็นโดเมนจริง
6. รันแอป:

```bash
npm install
npm run dev
```

บอทจะส่งลิงก์แบบ `https://liff.line.me/<LIFF_ID>?room=<roomId>&t=...` → เข้า `/liff` แล้วพาไปหน้า Control

## Usage

1. Invite บอทเข้ากลุ่ม หรือแชทส่วนตัวกับบอท
2. พิมพ์ `โบ้`
3. เปิดลิงก์ Control จากข้อความบอท (ใน LINE)
4. กด **หน้า Display** บนเครื่องที่จะเปิดลำโพง/จอ
5. ส่งลิงก์ YouTube เข้าแชทเพื่อเพิ่มคิว — ดูได้ในหน้า Control ว่าใครเพิ่มอะไร
