// =====================================================================
//  rules.js — กฎและตารางทั้งหมด (data ล้วน)
//  ที่มา: Thai Airways Cabin Crew Manual (CCM) Part 1, 1.7
//         Flight Time and Flight Duty Period Limitations
//         Issue 02 Rev 03 (20-OCT-26)
//
//  เมื่อ CCM ออก Rev ใหม่: แก้ไฟล์นี้ไฟล์เดียว แล้วรัน `npm test`
//  หน่วยเวลาทั้งหมด = นาที (minutes) · เวลาของวัน = นาทีนับจาก 00:00
//  null = NA (ไม่อนุญาต / ไม่มีในตาราง)
// =====================================================================

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export const RULES = {
  source: 'CCM Part 1 · 1.7 · Issue 02 Rev 03 (20-OCT-26)',
  revisionLabel: 'กติกาตาม CCM Issue 02 Rev 03',

  homeBase: { iata: 'BKK', tz: 'Asia/Bangkok' },

  // ---- 5.1 เวลา report (ลูกเรือ) ----
  report: {
    homeBase: hm('2:00'),     // duty เริ่มที่ home base: STD − 2:00
    lineStation: hm('1:15'),  // duty เริ่มที่ line station: STD − 1:15
    positioning: hm('1:15'),  // positioning: STD − 1:15
    ref: '1.7', // TODO: ใส่เลขหัวข้อย่อยจาก CCM (สเปกไม่ได้ระบุ)
  },

  // ---- 5.2 นิยามเวลา ----
  postFlightDuty: hm('0:30'),
  wocl: { start: hm('2:00'), end: hm('6:00'), ref: '1.7' }, // 02:00–05:59
  nightDutyWindow: { start: hm('2:00'), end: hm('5:00') },    // 02:00–04:59 (5.10 night duty)
  nightDutyConsecutiveSectorLimit: 4,
  maxSectors: 10,

  // ---- 5.3 Table 1.7.1 สถานะการปรับตัว ----
  // แถว: ขอบบนของ d (ชม.) และว่ารวมขอบหรือไม่ · คอลัมน์: t (ชม.) <48, 48–71:59, 72–95:59, 96–119:59, ≥120
  acclimatisation: {
    ref: '1.7.1',
    tBands: [48, 72, 96, 120], // ขอบล่างของคอลัมน์ที่ 2..5
    rows: [
      { dMax: 2, inclusive: true, states: ['D', 'D', 'D', 'D', 'D'] },
      { dMax: 4, inclusive: false, states: ['B', 'D', 'D', 'D', 'D'] },
      { dMax: 6, inclusive: true, states: ['B', 'X', 'D', 'D', 'D'] },
      { dMax: 9, inclusive: true, states: ['B', 'X', 'X', 'D', 'D'] },
      { dMax: 12, inclusive: true, states: ['B', 'X', 'X', 'X', 'D'] },
    ],
  },

  // ---- 5.4 Table 1.7.3 Max Basic FDP (acclimatised), ค่า 1–2 sectors ----
  // from/to = ช่วงเวลาเริ่ม FDP (refTz) รวมขอบทั้งสองข้าง ระดับนาที; ช่วงข้ามเที่ยงคืนใช้ from > to
  basicFdp: {
    ref: '1.7.3',
    bands: [
      { from: hm('6:00'), to: hm('13:29'), max: hm('13:00') },
      { from: hm('13:30'), to: hm('13:59'), max: hm('12:45') },
      { from: hm('14:00'), to: hm('14:29'), max: hm('12:30') },
      { from: hm('14:30'), to: hm('14:59'), max: hm('12:15') },
      { from: hm('15:00'), to: hm('15:29'), max: hm('12:00') },
      { from: hm('15:30'), to: hm('15:59'), max: hm('11:45') },
      { from: hm('16:00'), to: hm('16:29'), max: hm('11:30') },
      { from: hm('16:30'), to: hm('16:59'), max: hm('11:15') },
      { from: hm('17:00'), to: hm('4:59'), max: hm('11:00') },
      { from: hm('5:00'), to: hm('5:14'), max: hm('12:00') },
      { from: hm('5:15'), to: hm('5:29'), max: hm('12:15') },
      { from: hm('5:30'), to: hm('5:44'), max: hm('12:30') },
      { from: hm('5:45'), to: hm('5:59'), max: hm('12:45') },
    ],
    baseSectors: 2,                  // ค่าในตาราง = 1–2 sectors
    reductionPerSector: hm('0:30'),  // ทุก sector ที่เพิ่มลด 0:30
    floor: hm('9:00'),               // ขั้นต่ำ 9:00
    maxSectors: 10,
  },

  // ---- 5.5 Table 1.7.4 Max FDP — unknown state (X) ----
  unknownFdp: {
    ref: '1.7.4',
    bySectors: { 1: hm('11:00'), 2: hm('11:00'), 3: hm('10:30'), 4: hm('10:00'),
                 5: hm('9:30'), 6: hm('9:00'), 7: hm('9:00'), 8: hm('9:00') },
    // TODO: > 8 sectors ไม่มีในตารางที่ให้มา → engine คืน null (ตรวจกับ OP-1)
  },

  // ---- 5.6 Table 1.7.6 Method 1 (ไม่มี in-flight rest), 1–5 sectors ----
  method1: {
    ref: '1.7.6',
    maxUsesPer7Days: 2,
    maxSectors: 5,
    // WOCL encroachment → จำนวน sector สูงสุด
    woclSectorLimits: [
      { encroachMax: 0, limit: 5 },          // ไม่คร่อม
      { encroachMax: hm('2:00'), limit: 4 }, // คร่อม ≤ 2 ชม.
      { encroachMax: Infinity, limit: 2 },   // คร่อม > 2 ชม.
    ],
    // max ต่อจำนวน sector: [1–2, 3, 4, 5]
    bands: [
      { from: hm('6:00'), to: hm('6:14'), max: [null, null, null, null] },
      { from: hm('6:15'), to: hm('6:29'), max: [hm('13:15'), hm('12:45'), hm('12:15'), hm('11:45')] },
      { from: hm('6:30'), to: hm('6:44'), max: [hm('13:30'), hm('13:00'), hm('12:30'), hm('12:00')] },
      { from: hm('6:45'), to: hm('6:59'), max: [hm('13:45'), hm('13:15'), hm('12:45'), hm('12:15')] },
      { from: hm('7:00'), to: hm('13:29'), max: [hm('14:00'), hm('13:30'), hm('13:00'), hm('12:30')] },
      { from: hm('13:30'), to: hm('13:59'), max: [hm('13:45'), hm('13:15'), hm('12:45'), null] },
      { from: hm('14:00'), to: hm('14:29'), max: [hm('13:30'), hm('13:00'), hm('12:30'), null] },
      { from: hm('14:30'), to: hm('14:59'), max: [hm('13:15'), hm('12:45'), hm('12:15'), null] },
      { from: hm('15:00'), to: hm('15:29'), max: [hm('13:00'), hm('12:30'), hm('12:00'), null] },
      { from: hm('15:30'), to: hm('15:59'), max: [hm('12:45'), null, null, null] },
      { from: hm('16:00'), to: hm('16:29'), max: [hm('12:30'), null, null, null] },
      { from: hm('16:30'), to: hm('16:59'), max: [hm('12:15'), null, null, null] },
      { from: hm('17:00'), to: hm('17:29'), max: [hm('12:00'), null, null, null] },
      { from: hm('17:30'), to: hm('17:59'), max: [hm('11:45'), null, null, null] },
      { from: hm('18:00'), to: hm('18:29'), max: [hm('11:30'), null, null, null] },
      { from: hm('18:30'), to: hm('18:59'), max: [hm('11:15'), null, null, null] },
      { from: hm('19:00'), to: hm('6:14'), max: [null, null, null, null] },
    ],
  },

  // ---- 5.7 Table 1.7.7 Method 2 (in-flight rest) ----
  method2: {
    ref: '1.7.7',
    maxSectors: 3,
    minRestBlock: hm('1:30'),       // พักช่วงติดกัน ≥ 1:30
    // upTo = ขอบบนของแถว (Max Extended FDP); rest = { class: rest ขั้นต่ำต่อคน } (null = NA)
    rows: [
      { upTo: hm('14:30'), rest: { 1: hm('1:30'), 2: hm('1:30'), 3: hm('1:30') } },
      { upTo: hm('15:00'), rest: { 1: hm('1:45'), 2: hm('2:00'), 3: hm('2:20') } },
      { upTo: hm('15:30'), rest: { 1: hm('2:00'), 2: hm('2:20'), 3: hm('2:40') } },
      { upTo: hm('16:00'), rest: { 1: hm('2:15'), 2: hm('2:40'), 3: hm('3:00') } },
      { upTo: hm('16:30'), rest: { 1: hm('2:35'), 2: hm('3:00'), 3: null } },
      { upTo: hm('17:00'), rest: { 1: hm('3:00'), 2: hm('3:25'), 3: null } },
      { upTo: hm('17:30'), rest: { 1: hm('3:25'), 2: null, 3: null } },
      { upTo: hm('18:00'), rest: { 1: hm('3:50'), 2: null, 3: null } },
    ],
    crewCeiling: hm('18:00'),
    restAfterMin: hm('14:00'),      // rest หลัง duty Method 2: ≥ max(DP, 14:00)
    referenceRestSteps: { from: hm('1:30'), to: hm('4:00'), step: hm('0:15') },
  },

  // ---- 5.8 Standby ----
  standby: {
    ref: '1.7', // TODO: เลขหัวข้อย่อย standby
    other: {
      maxHours: hm('16:00'),
      awakeLimit: hm('18:00'),         // standby + FDP ไม่เกิน 18 ชม. (เตือน)
      threshold: hm('6:00'),           // ≤ 6 ชม. ไม่ลด
      thresholdInflightRest: hm('8:00'), // duty ใช้ in-flight rest / split duty → 8 ชม.
      nightWindow: { start: hm('23:00'), end: hm('7:00') },
    },
    airport: {
      maxHours: hm('8:00'),
      threshold: hm('4:00'),           // ลดด้วยส่วนที่เกิน 4 ชม.
      combinedLimit: hm('16:00'),      // airport standby + FDP ≤ 16 ชม. (เตือน)
    },
  },

  // ---- 5.9 Delay / Unforeseen ----
  delay: {
    ref: '1.7', // TODO: เลขหัวข้อย่อย delay/unforeseen
    picDiscretion: hm('2:00'),
    picDiscretionAugmented: hm('3:00'), // แสดงเป็น note
    picMinRestAfter: hm('10:00'),
    delayedReportThreshold: hm('4:00'),
    secondNoticeOffset: hm('1:00'),
    delayCountsAsRest: hm('10:00'),
  },

  // ---- 5.10 Rest ขั้นต่ำ ----
  rest: {
    ref: '1.7', // TODO: เลขหัวข้อย่อย rest (Table 1.7.10 = local nights)
    homeBase: hm('12:00'),
    awayFromBase: hm('10:00'),
    awaySleepOpportunity: hm('8:00'),
    timeZoneCrossingThreshold: 4,     // ชม.
    afterTimeZoneCrossing: hm('14:00'),
    // Table 1.7.10 local nights หลังกลับ home base
    localNights: {
      ref: '1.7.10',
      tBands: [48, 72, 96],           // คอลัมน์: <48, 48–71:59, 72–95:59, ≥96
      rows: [
        { dMax: 6, nights: [2, 2, 3, 3] },
        { dMax: 9, nights: [2, 3, 3, 4] },
        { dMax: 12, nights: [2, 3, 4, 5] },
      ],
    },
  },
};
