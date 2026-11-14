// Acceptance tests (SPEC §7) — run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from '../js/vendor/luxon.js';
import {
  computeAll, restPlan, standbyImpact, fmtHM, fmtDT, toMinutes,
  basicFdpMax, unknownFdpMax, method1TableMax, method1SectorLimit,
  method2RestFor, method2FdpFor, acclimState, localNightsFor,
  tzOffsetHours, tzDiffHours, searchAirports, getAirport, restReferenceTable,
  dutyLines, summaryText,
} from '../js/engine.js';

const hm = (s) => toMinutes(s);

const T1_SECTOR = {
  flightNo: 'TG916', from: 'BKK', to: 'LHR', dateDep: '2026-11-14',
  std: '13:20', sta: '19:35', staDayOffset: 0, restClass: 1, positioning: false, newDuty: true,
};
const T2_SECTOR = {
  flightNo: 'TG917', from: 'LHR', to: 'BKK', dateDep: '2026-11-15',
  std: '21:35', sta: '16:00', staDayOffset: 1, restClass: 1, positioning: false, newDuty: true,
};

const run = (sectors, extra = {}) => {
  const r = computeAll({ sectors, reportOverrides: {}, delayMode: false, ...extra });
  assert.deepEqual(r.errors, [], 'no validation errors');
  return r;
};

// ---------------------------------------------------------------- T1
test('T1 — BKK–LHR TG916', () => {
  const [d] = run([T1_SECTOR]).duties;
  assert.equal(fmtDT(d.report, d.startTz), '14/11 11:20');
  assert.equal(d.acclimState, 'D');
  assert.equal(d.refTz, 'Asia/Bangkok');
  assert.equal(fmtHM(d.fdpMin), '15:15');
  assert.equal(fmtHM(d.maxBasic), '13:00');
  assert.equal(d.sectorCount, 1);
  assert.equal(fmtHM(d.woclEncroach), '0:35');
  assert.equal(d.method1.sectorLimit, 4);
  assert.equal(fmtHM(d.method1.max), '14:00');
  assert.equal(d.verdict, 'needM2');
  assert.equal(fmtHM(d.method2.restPerClass[1]), '2:00');
  assert.equal(fmtHM(d.method2.requiredRest), '2:00');
  assert.equal(fmtHM(d.dpMin), '15:45');
  assert.equal(d.tzCrossing, 7);
  assert.equal(fmtHM(d.restAfterMin), '15:45');
  assert.equal(fmtDT(d.nextReportEarliest), '15/11 11:50');
  assert.equal(d.nextReportEarliest.zoneName, 'Europe/London');
  assert.equal(d.homeBaseLocalNights, null);
  assert.equal(d.restBefore, null);
});

// ---------------------------------------------------------------- T2
test('T2 — LHR–BKK TG917 (second duty of rotation)', () => {
  const { duties } = run([T1_SECTOR, T2_SECTOR]);
  const d = duties[1];
  assert.equal(fmtDT(d.report, d.startTz), '15/11 20:20');
  assert.equal(d.acclimState, 'B');
  assert.ok(d.acclim.t < 48);
  assert.equal(d.refTz, 'Asia/Bangkok');
  assert.equal(d.reportInRefTz.toFormat('HH:mm'), '03:20');
  assert.equal(fmtHM(d.fdpMin), '12:40');
  assert.equal(fmtHM(d.maxBasic), '11:00');
  assert.equal(fmtHM(d.woclEncroach), '2:40');
  assert.equal(d.method1.sectorLimit, 2);
  assert.equal(d.method1.tableMax, null); // band 1900–0614 = NA
  assert.equal(d.method1.allowed, false);
  assert.equal(d.verdict, 'needM2');
  assert.equal(fmtHM(d.method2.requiredRest), '1:30');
  assert.equal(fmtHM(d.restBefore.actual), '24:15');
  assert.equal(fmtHM(d.restBefore.required), '15:45');
  assert.equal(d.restBefore.ok, true);
  assert.equal(fmtHM(d.restAfterMin), '14:00');
  assert.equal(d.homeBaseLocalNights.nights, 3);
  assert.equal(d.homeBaseLocalNights.maxTzDiff, 7);
  assert.ok(d.homeBaseLocalNights.elapsedMin >= 48 * 60 && d.homeBaseLocalNights.elapsedMin < 72 * 60);
  assert.equal(fmtDT(d.nextReportEarliest), '17/11 06:30');
  assert.equal(d.nextReportEarliest.zoneName, 'Asia/Bangkok');
});

// ---------------------------------------------------------------- T3
test('T3 — rest/FDP planner from T1: Class 1, rest 2:00', () => {
  const [d] = run([T1_SECTOR]).duties;
  const p = restPlan(d, 1, hm('2:00'));
  assert.equal(fmtHM(p.maxFdp), '15:30');
  assert.equal(fmtDT(p.latestOnBlocks), '14/11 19:50');
  assert.equal(p.latestOnBlocks.zoneName, 'Europe/London');
  assert.equal(fmtDT(d.fdpEnd, d.fdpEndTz), '14/11 19:35');
  assert.equal(fmtHM(p.margin), '0:15');
  assert.equal(p.ok, true);
});

// ---------------------------------------------------------------- T4
test('T4 — home standby 9:00 + duty T1', () => {
  const [d] = run([T1_SECTOR]).duties;
  const s = standbyImpact(d, { type: 'other', hours: 9 }, { cls: 1, restMin: hm('2:00') });
  assert.equal(fmtHM(s.reductionNormal), '3:00');
  assert.equal(fmtHM(s.reductionWithRest), '1:00');
  assert.equal(fmtHM(s.plan.maxFdp), '14:30');
  assert.equal(fmtDT(s.plan.latestOnBlocks), '14/11 18:50');
  assert.equal(fmtHM(s.plan.margin), '−0:45');
  assert.equal(s.plan.ok, false);
  assert.equal(fmtHM(s.targetFdp), '16:15');
  assert.equal(fmtHM(s.requiredRest), '2:35');
  assert.ok(s.warnings.some((w) => w.includes('awake')));
});

test('T4b — standby night-window exclusion & airport standby', () => {
  const [d] = run([T1_SECTOR]).duties;
  const night = standbyImpact(d, { type: 'other', hours: 9, nightUncontacted: true, nightUncontactedHours: 3 });
  assert.equal(fmtHM(night.reductionNormal), '0:00');
  const ap = standbyImpact(d, { type: 'airport', hours: 6 });
  assert.equal(fmtHM(ap.reductionNormal), '2:00');
  assert.equal(fmtHM(ap.reductionWithRest), '2:00');
  assert.ok(ap.warnings.some((w) => w.includes('16:00')));
  const small = standbyImpact(d, { type: 'other', hours: 5 });
  assert.equal(small.reductionNormal, 0);
});

// ---------------------------------------------------------------- T5
test('T5 — Table 1.7.3', () => {
  assert.equal(fmtHM(basicFdpMax(hm('17:30'), 3)), '10:30');
  assert.equal(fmtHM(basicFdpMax(hm('5:50'), 2)), '12:45');
  assert.equal(fmtHM(basicFdpMax(hm('8:00'), 10)), '9:00');
  // band edges
  assert.equal(fmtHM(basicFdpMax(hm('13:29'), 1)), '13:00');
  assert.equal(fmtHM(basicFdpMax(hm('13:30'), 1)), '12:45');
  assert.equal(fmtHM(basicFdpMax(hm('4:59'), 1)), '11:00');
  assert.equal(fmtHM(basicFdpMax(hm('0:00'), 1)), '11:00');
  assert.equal(fmtHM(basicFdpMax(hm('5:00'), 1)), '12:00');
  assert.equal(basicFdpMax(hm('8:00'), 11), null);
});

// ---------------------------------------------------------------- T6
test('T6 — unknown state (Table 1.7.4)', () => {
  assert.equal(fmtHM(unknownFdpMax(4)), '10:00');
  assert.equal(fmtHM(unknownFdpMax(1)), '11:00');
  assert.equal(fmtHM(unknownFdpMax(8)), '9:00');
  assert.equal(acclimState(5, 50), 'X');
  assert.equal(acclimState(7, 33), 'B');
  assert.equal(acclimState(2, 10), 'D');
  assert.equal(acclimState(3, 48), 'D');
  assert.equal(acclimState(10, 119.9), 'X');
  assert.equal(acclimState(10, 120), 'D');
});

test('T6b — duty in state X uses Table 1.7.4', () => {
  // BKK→DXB (d=3), stay ~2.5 days, DXB→BKK: d=3, t≈60 → D ; use LHR (d=7) with t 48–95 → X
  const out = { flightNo: 'TG910', from: 'BKK', to: 'LHR', dateDep: '2026-11-10', std: '13:20', sta: '19:35', staDayOffset: 0, restClass: 1, newDuty: true };
  const back = { flightNo: 'TG911', from: 'LHR', to: 'BKK', dateDep: '2026-11-13', std: '21:35', sta: '16:00', staDayOffset: 1, restClass: 1, newDuty: true };
  const d = run([out, back]).duties[1];
  assert.equal(d.acclimState, 'X');
  assert.equal(fmtHM(d.maxBasic), '11:00');
  assert.equal(d.method1.allowed, false);
});

// ---------------------------------------------------------------- T7
test('T7 — Method 1 (Table 1.7.6)', () => {
  assert.equal(method1SectorLimit(0), 5);
  assert.equal(fmtHM(method1TableMax(hm('7:30'), 5)), '12:30');
  assert.equal(method1SectorLimit(hm('3:00')), 2);
  assert.equal(method1SectorLimit(hm('2:00')), 4);
  assert.equal(method1SectorLimit(hm('0:35')), 4);
  assert.equal(method1TableMax(hm('20:00'), 1), null);
  assert.equal(method1TableMax(hm('6:10'), 1), null);
  assert.equal(fmtHM(method1TableMax(hm('6:20'), 3)), '12:45');
  assert.equal(method1TableMax(hm('13:45'), 5), null);
});

test('T7b — duty that needs Method 1', () => {
  // BKK 07:00 report (STD 09:00) → 13:30 FDP, 1 sector, no WOCL: basic 13:00, M1 14:00
  const s = { flightNo: 'TG1', from: 'BKK', to: 'NRT', dateDep: '2026-11-14', std: '09:00', sta: '22:30', staDayOffset: 0, restClass: 0, newDuty: true };
  const [d] = run([s]).duties;
  assert.equal(fmtHM(d.fdpMin), '13:30'); // 07:00 ICT → 22:30 JST(=20:30 ICT)
  assert.equal(d.verdict, 'needM1');
  assert.equal(d.method2.applicable, false);
});

// ---------------------------------------------------------------- T8
test('T8 — DST: LHR in BST is UTC+1', () => {
  const july = DateTime.fromISO('2026-07-15T12:00', { zone: 'Europe/London' });
  const nov = DateTime.fromISO('2026-11-15T12:00', { zone: 'Europe/London' });
  assert.equal(tzOffsetHours('Europe/London', july), 1);
  assert.equal(tzOffsetHours('Europe/London', nov), 0);
  assert.equal(tzDiffHours('Asia/Bangkok', 'Europe/London', july), 6);

  const s = { flightNo: 'TG917', from: 'LHR', to: 'BKK', dateDep: '2026-07-15', std: '21:35', sta: '15:00', staDayOffset: 1, restClass: 1, newDuty: true };
  const [d] = computeAll({ sectors: [s] }).duties;
  assert.equal(d.report.offset, 60);
  assert.equal(d.report.toUTC().toFormat('HH:mm'), '19:20');
  assert.equal(fmtHM(d.fdpMin), '12:40'); // 19:20Z → 08:00Z
});

// ---------------------------------------------------------------- T9
test('T9 — positioning before operating', () => {
  const pos = { flightNo: 'TG100', from: 'BKK', to: 'CNX', dateDep: '2026-11-14', std: '08:00', sta: '09:10', staDayOffset: 0, restClass: 0, positioning: true, newDuty: true };
  const op = { flightNo: 'TG101', from: 'CNX', to: 'BKK', dateDep: '2026-11-14', std: '10:30', sta: '11:40', staDayOffset: 0, restClass: 0, positioning: false, newDuty: false };
  const [d] = run([pos, op]).duties;
  assert.equal(d.sectorCount, 1);
  assert.equal(d.reportBasis, 'positioning');
  assert.equal(fmtDT(d.report, d.startTz), '14/11 06:45'); // STD − 1:15
  assert.equal(+d.fdpStart, +d.report);
  assert.equal(fmtHM(d.fdpMin), '4:55');
});

test('T9 — positioning after operating', () => {
  const op = { flightNo: 'TG101', from: 'BKK', to: 'CNX', dateDep: '2026-11-14', std: '08:00', sta: '09:10', staDayOffset: 0, restClass: 0, newDuty: true };
  const pos = { flightNo: 'TG102', from: 'CNX', to: 'BKK', dateDep: '2026-11-14', std: '10:30', sta: '11:40', staDayOffset: 0, restClass: 0, positioning: true, newDuty: false };
  const [d] = run([op, pos]).duties;
  assert.equal(d.sectorCount, 1);
  assert.equal(fmtDT(d.fdpEnd, d.fdpEndTz), '14/11 09:10');
  assert.equal(fmtHM(d.fdpMin), '3:10'); // 06:00 → 09:10
  assert.equal(fmtDT(d.dutyEnd, d.endTz), '14/11 12:10'); // 11:40 + 0:30
  assert.equal(fmtHM(d.dpMin), '6:10');
});

// ---------------------------------------------------------------- Method 2 table both ways
test('Table 1.7.7 both directions', () => {
  assert.deepEqual(method2RestFor(hm('15:15')), { 1: hm('2:00'), 2: hm('2:20'), 3: hm('2:40') });
  assert.deepEqual(method2RestFor(hm('16:15')), { 1: hm('2:35'), 2: hm('3:00'), 3: null });
  assert.deepEqual(method2RestFor(hm('18:01')), { 1: null, 2: null, 3: null });
  assert.equal(fmtHM(method2FdpFor(hm('2:00'), 1)), '15:30');
  assert.equal(fmtHM(method2FdpFor(hm('2:10'), 1)), '15:30');
  assert.equal(fmtHM(method2FdpFor(hm('1:30'), 3)), '14:30');
  assert.equal(fmtHM(method2FdpFor(hm('4:00'), 1)), '18:00');
  assert.equal(fmtHM(method2FdpFor(hm('4:00'), 3)), '16:00');
  assert.equal(method2FdpFor(hm('1:15'), 1), null);
  const ref = restReferenceTable();
  assert.equal(ref.length, 11);
  assert.equal(fmtHM(ref[0].rest), '1:30');
  assert.equal(fmtHM(ref.at(-1).rest), '4:00');
});

test('Table 1.7.10 local nights', () => {
  assert.equal(localNightsFor(7, 53), 3);
  assert.equal(localNightsFor(5, 30), 2);
  assert.equal(localNightsFor(11, 100), 5);
});

// ---------------------------------------------------------------- Validation & misc
test('validation: STA before STD without +1, unknown airport', () => {
  const bad = { ...T2_SECTOR, staDayOffset: 0 };
  const r = computeAll({ sectors: [bad] });
  assert.ok(r.errors.some((e) => e.field === 'sta'));
  const r2 = computeAll({ sectors: [{ ...T1_SECTOR, to: 'ZZZ' }] });
  assert.ok(r2.errors.some((e) => e.field === 'to'));
});

test('validation: more than 10 sectors in a duty', () => {
  const s = Array.from({ length: 11 }, (_, i) => ({
    flightNo: `TG${i}`, from: i % 2 ? 'CNX' : 'BKK', to: i % 2 ? 'BKK' : 'CNX', dateDep: '2026-11-14',
    std: `${String(i + 6).padStart(2, '0')}:00`, sta: `${String(i + 6).padStart(2, '0')}:50`, staDayOffset: 0, restClass: 0, newDuty: i === 0,
  }));
  const r = computeAll({ sectors: s });
  assert.ok(r.errors.some((e) => e.message.includes('เกิน 10')));
});

test('exceed verdict', () => {
  // 3 sectors, no facility, long day → exceed
  const s = [
    { flightNo: 'A', from: 'BKK', to: 'SIN', dateDep: '2026-11-14', std: '08:00', sta: '11:25', restClass: 0, newDuty: true },
    { flightNo: 'B', from: 'SIN', to: 'BKK', dateDep: '2026-11-14', std: '12:30', sta: '14:00', restClass: 0 },
    { flightNo: 'C', from: 'BKK', to: 'NRT', dateDep: '2026-11-14', std: '15:00', sta: '23:00', restClass: 0 },
  ];
  const [d] = run(s).duties;
  assert.equal(d.verdict, 'exceed');
  assert.equal(fmtHM(d.fdpMin), '15:00'); // 06:00 → 21:00 ICT
  assert.equal(fmtHM(d.exceedBy), '2:30'); // basic 3 sectors = 12:30, M1 band 0600–0614 = NA, no facility
});

test('report override and delay mode', () => {
  const r = run([T1_SECTOR], { reportOverrides: { 0: '2026-11-14T11:00' } });
  assert.equal(fmtDT(r.duties[0].report, 'Asia/Bangkok'), '14/11 11:00');
  assert.equal(r.duties[0].reportOverridden, true);

  const dl = run([T1_SECTOR], { delayMode: true, delays: { 0: { newReport: '2026-11-14T13:00' } } });
  const d = dl.duties[0];
  assert.equal(d.delay.delayedReport.basis, 'original');
  assert.equal(fmtHM(d.maxBasic), '13:00'); // looked up from 11:20
  assert.equal(fmtHM(d.fdpMin), '13:35');
  assert.equal(fmtHM(d.delay.picMax), fmtHM(d.effectiveMax + 120));

  const dl2 = run([T1_SECTOR], { delayMode: true, delays: { 0: { newReport: '2026-11-14T16:20' } } });
  assert.equal(dl2.duties[0].delay.delayedReport.basis, 'moreLimiting');
  assert.equal(fmtHM(dl2.duties[0].maxBasic), '11:30'); // 16:20 band more limiting than 11:20
});

test('airport search', () => {
  assert.equal(getAirport('lhr').tz, 'Europe/London');
  assert.equal(searchAirports('BKK')[0].iata, 'BKK');
  assert.equal(searchAirports('ลอนดอน')[0].iata, 'LHR');
  assert.ok(searchAirports('Bangkok').some((a) => a.iata === 'BKK'));
});

test('dutyLines / summary text matches the mock-up', () => {
  const r = run([T1_SECTOR, T2_SECTOR]);
  const t = dutyLines(r.duties[0]).map((l) => l.text);
  assert.deepEqual(t.slice(0, 8), [
    'Duty 1 · BKK–LHR · 1 sector · Class 1',
    'Report  14/11 11:20 BKK',
    'On-blocks  14/11 19:35 LHR',
    'สถานะ D · ใช้เวลาท้องถิ่น BKK',
    '🌙 คร่อม WOCL 0:35 · Method 1 ได้ไม่เกิน 4 sector',
    'FDP 15:15 / max 13:00',
    '🟠 ต้องใช้ Method 2 — จัดพักอย่างน้อย 2:00 ต่อคน',
    'Method 1 max 14:00',
  ]);
  assert.ok(t.includes('🛏 Rest ขั้นต่ำหลัง duty นี้ 15:45'));
  assert.ok(t.includes('report ครั้งถัดไปได้เร็วสุด 15/11 11:50 LHR'));
  const t2 = dutyLines(r.duties[1]).map((l) => l.text);
  assert.ok(t2.includes('Rest ก่อน duty นี้ 24:15 / ต้องการ 15:45 ✅'));
  assert.ok(t2.includes('สถานะ B · ร่างกายยังอยู่เวลา BKK (report = 03:20)'));
  assert.ok(summaryText(r).includes('CCM Issue 02 Rev 03'));
});
