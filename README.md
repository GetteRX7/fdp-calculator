# FDP ลูกเรือ — เครื่องคำนวณ FDP / in-flight rest / rest ขั้นต่ำ

เว็บแอป HTML + CSS + JavaScript ล้วน (ES modules ไม่มี build step ไม่มี backend ไม่ส่งข้อมูลออกนอกเครื่อง)
อิงกฎ **Thai Airways CCM Part 1 · 1.7 · Issue 02 Rev 03 (20-OCT-26)** — เป็นเครื่องมือช่วยตรวจทานเท่านั้น ค่าที่ผูกพันคือ OP-1 / roster / คู่มือฉบับจริง

## วิธีรัน

```bash
npm install        # ครั้งแรกเท่านั้น (สำหรับเทสต์/อัปเดต vendor)
npm test           # = node --test  → tests/engine.test.js
npm run serve      # เปิด http://localhost:8080
```

ES modules ต้องเปิดผ่าน http (เปิดไฟล์ `index.html` ตรงๆ ด้วย `file://` ไม่ได้) จะใช้ static server ตัวไหนก็ได้ หรือ deploy ทั้งโฟลเดอร์ขึ้น static hosting (ไม่ต้องใช้ `node_modules/`, `scripts/`, `tests/`)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `js/data/rules.js` | **ตารางกฎทั้งหมด** (data ล้วน หน่วยนาที) |
| `js/engine.js` | rules engine — pure functions ไม่แตะ DOM ใช้ทั้ง UI และเทสต์ |
| `js/ui.js`, `index.html`, `css/style.css` | หน้าจอ 3 หน้า: กรอก · ผล · ตารางพัก–FDP |
| `js/data/airports.js` | สนามบิน ~7,950 แห่ง `[IATA, city, name, country, IANA tz, ชื่อไทย]` สร้างจาก `scripts/build-airports.py` |
| `js/vendor/luxon.js` | Luxon 3.7.2 (copy จาก npm) — เขตเวลา/DST ทั้งหมดผ่าน IANA tz |
| `css/fonts/` | Noto Sans Thai (self-hosted) |

## เมื่อ CCM ออก Rev ใหม่

1. แก้ **`js/data/rules.js` ไฟล์เดียว** — ค่าเวลาเขียนแบบ `hm('13:00')`, `null` = NA, แก้ `source` / `revisionLabel` ให้ตรง Rev (footer อ่านจาก `revisionLabel`)
2. ถ้าตัวเลขในตารางเปลี่ยน ให้อัปเดตค่าที่คาดหวังใน `tests/engine.test.js` ให้ตรงคู่มือ
3. `npm test` ต้องผ่านทั้งหมด

อัปเดตข้อมูลสนามบิน: `pip install airportsdata && python scripts/build-airports.py`

## ข้อจำกัด

- **ลูกเรือเท่านั้น** — ไม่มีโหมดนักบิน (FDP จริงยังถูกจำกัดด้วยการเสริมนักบินและ class ที่นักบินใช้)
- **ไม่มี Method 3** (split duty)
- **ไม่นับขีดจำกัดสะสม** (60/110/190 ชม., ชั่วโมงบินสะสม) และไม่นับจำนวนครั้งที่ใช้ Method 1 ใน 7 วัน (แสดงเป็นคำเตือน)
- home base = BKK

### การตีความที่ต้องรู้ (ตรวจกับ OP-1)

- **Acclimatisation**: เมื่อ duty ใดเป็นสถานะ D ระบบถือว่าปรับตัวตามเขตเวลานั้น และนับ `t` ใหม่จาก report ของ duty นั้น · ความต่างเขตเวลา `d` คิดทางที่สั้นกว่า (≤ 12 ชม.) · rotation จบเมื่อ duty ปลายทางเป็น BKK
- **Class ของ duty** = class ดีที่สุดในบรรดา sector ที่ operating
- **สถานะ X**: ไม่เปิด Method 1 (ตาราง 1.7.6 อิงเวลาเริ่มแบบ acclimatised) · Table 1.7.4 > 8 sectors ไม่มีค่า → แจ้ง TODO
- **Standby ช่วง 23:00–07:00**: ผู้ใช้กรอกจำนวนชั่วโมงในช่วงนั้นก่อน OP-1 ติดต่อเอง แล้วระบบไม่นับส่วนนั้นในการลด max
- **Delayed reporting**: กรอกเวลา report ที่เลื่อน (ครั้งแรก) และเวลาแจ้งครั้งที่ 2 (ถ้ามี)
- เลขหัวข้อ CCM ที่สเปกไม่ได้ระบุ (report, standby, delay, rest) แสดงเป็น `1.7` และมี TODO ใน `rules.js` ให้เติม
