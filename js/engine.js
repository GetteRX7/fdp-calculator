// =====================================================================
//  engine.js — FDP rules engine (pure functions, ไม่แตะ DOM)
//  ใช้ได้ทั้งในเบราว์เซอร์และ `node --test`
//  เวลาเป็นนาที (integer) · จุดเวลาเป็น Luxon DateTime
// =====================================================================

import { DateTime } from './vendor/luxon.js';
import { RULES } from './data/rules.js';
import { AIRPORTS } from './data/airports.js';

export { RULES };

// ---------------------------------------------------------------------
//  Utilities
// ---------------------------------------------------------------------

/** "15:15" | "1:30" | 9 (hours) | 9.5 → minutes. Returns null if invalid. */
export function toMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 60) : null;
  const s = String(v).trim();
  const m = /^(\d{1,3})(?::|\.)?(\d{2})?$/.exec(s);
  if (!m) return null;
  if (m[2] === undefined) return Number(m[1]) * 60;
  const mins = Number(m[2]);
  return mins < 60 ? Number(m[1]) * 60 + mins : null;
}

/** minutes → "H:MM" (negative gets "−") */
export function fmtHM(min) {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const sign = min < 0 ? '−' : '';
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/** DateTime → "14/11 11:20" in given zone */
export function fmtDT(dt, zone) {
  if (!dt) return '—';
  return (zone ? dt.setZone(zone) : dt).toFormat('dd/LL HH:mm');
}

const diffMin = (a, b) => Math.round(a.diff(b, 'minutes').minutes); // a − b
const minuteOfDay = (dt) => dt.hour * 60 + dt.minute;
const inBand = (m, from, to) => (from <= to ? m >= from && m <= to : m >= from || m <= to);

// ---------------------------------------------------------------------
//  Airports
// ---------------------------------------------------------------------

let airportIndex = null;
function index() {
  if (!airportIndex) {
    airportIndex = new Map();
    for (const [iata, city, name, country, tz, th] of AIRPORTS) {
      airportIndex.set(iata, { iata, city, name, country, tz, th });
    }
  }
  return airportIndex;
}

export function getAirport(iata) {
  if (!iata) return null;
  return index().get(String(iata).trim().toUpperCase()) || null;
}

/** autocomplete: IATA exact > IATA prefix > city/Thai prefix > contains */
export function searchAirports(query, limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  const qu = q.toUpperCase();
  const ql = q.toLowerCase();
  const scored = [];
  for (const a of index().values()) {
    let score = 0;
    if (a.iata === qu) score = 100;
    else if (a.iata.startsWith(qu)) score = 80;
    else if (a.th && a.th.startsWith(q)) score = 70;
    else if (a.city.toLowerCase().startsWith(ql)) score = 60;
    else if (a.th && a.th.includes(q)) score = 50;
    else if (q.length >= 3 && a.city.toLowerCase().includes(ql)) score = 40;
    else if (q.length >= 3 && a.name.toLowerCase().includes(ql)) score = 30;
    if (score) scored.push([score, a]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].iata.localeCompare(y[1].iata));
  return scored.slice(0, limit).map((s) => s[1]);
}

// ---------------------------------------------------------------------
//  Time-zone helpers (IANA via Luxon — DST-aware, ห้ามใช้ offset แบบ fix)
// ---------------------------------------------------------------------

/** UTC offset of a zone at instant `at`, in hours (DST-aware) */
export function tzOffsetHours(tz, at) {
  return at.setZone(tz).offset / 60;
}

/** |time-zone difference| in hours between two zones at instant `at` (shortest way round, ≤ 12) */
export function tzDiffHours(tzA, tzB, at) {
  let d = Math.abs(tzOffsetHours(tzA, at) - tzOffsetHours(tzB, at));
  if (d > 12) d = 24 - d;
  return d;
}

// ---------------------------------------------------------------------
//  Table lookups (rules.js)
// ---------------------------------------------------------------------

/** Table 1.7.1 → 'B' | 'D' | 'X' */
export function acclimState(dHours, tHours) {
  const { rows, tBands } = RULES.acclimatisation;
  const row = rows.find((r) => (r.inclusive ? dHours <= r.dMax : dHours < r.dMax)) || rows[rows.length - 1];
  let col = 0;
  while (col < tBands.length && tHours >= tBands[col]) col++;
  return row.states[col];
}

/** Table 1.7.3 — start = minute-of-day in refTz */
export function basicFdpMax(startMin, sectors) {
  const t = RULES.basicFdp;
  if (sectors > t.maxSectors) return null;
  const band = t.bands.find((b) => inBand(startMin, b.from, b.to));
  const extra = Math.max(0, Math.max(1, sectors) - t.baseSectors);
  return Math.max(t.floor, band.max - extra * t.reductionPerSector);
}

/** Table 1.7.4 */
export function unknownFdpMax(sectors) {
  return RULES.unknownFdp.bySectors[Math.max(1, sectors)] ?? null;
}

/** Table 1.7.6 value (null = NA) */
export function method1TableMax(startMin, sectors) {
  const t = RULES.method1;
  if (sectors > t.maxSectors) return null;
  const band = t.bands.find((b) => inBand(startMin, b.from, b.to));
  const col = Math.max(0, Math.max(1, sectors) - 2); // 1–2 → 0, 3 → 1, 4 → 2, 5 → 3
  return band.max[col];
}

/** Method 1 sector limit by WOCL encroachment (minutes) */
export function method1SectorLimit(woclMin) {
  return RULES.method1.woclSectorLimits.find((r) => woclMin <= r.encroachMax).limit;
}

/** Table 1.7.7 (ก): FDP ที่ต้องการ → rest ขั้นต่ำต่อ class ({1,2,3}, null = NA) */
export function method2RestFor(fdpMin) {
  const row = RULES.method2.rows.find((r) => fdpMin <= r.upTo);
  if (!row) return { 1: null, 2: null, 3: null };
  return { ...row.rest };
}

/** Table 1.7.7 (ข): rest ที่จัดได้ + class → Max Extended FDP (ขอบบนของแถว), null ถ้าไม่ถึง 1:30 */
export function method2FdpFor(restMin, cls) {
  if (restMin === null || restMin < RULES.method2.minRestBlock) return null;
  let best = null;
  for (const r of RULES.method2.rows) {
    const need = r.rest[cls];
    if (need !== null && need !== undefined && need <= restMin) best = r.upTo;
  }
  return best;
}

/** Highest FDP each class can reach under Method 2 */
export function method2MaxByClass() {
  const out = {};
  for (const c of [1, 2, 3]) out[c] = method2FdpFor(Infinity, c);
  return out;
}

/** Table 1.7.10 local nights */
export function localNightsFor(dHours, tHours) {
  const { rows, tBands } = RULES.rest.localNights;
  const row = rows.find((r) => dHours <= r.dMax) || rows[rows.length - 1];
  let col = 0;
  while (col < tBands.length && tHours >= tBands[col]) col++;
  return row.nights[col];
}

/** minutes of [start,end] that fall inside daily window [wStart, wEnd) of zone tz */
export function windowOverlap(start, end, tz, wStart, wEnd) {
  if (!start || !end || end <= start) return 0;
  let day = start.setZone(tz).startOf('day').minus({ days: 1 });
  const last = end.setZone(tz).startOf('day').plus({ days: 1 });
  let total = 0;
  while (day <= last) {
    const ws = day.set({ hour: Math.floor(wStart / 60), minute: wStart % 60 });
    const we = day.set({ hour: Math.floor(wEnd / 60), minute: wEnd % 60 });
    const s = start > ws ? start : ws;
    const e = end < we ? end : we;
    if (e > s) total += diffMin(e, s);
    day = day.plus({ days: 1 });
  }
  return total;
}

export function woclEncroachment(start, end, tz) {
  return windowOverlap(start, end, tz, RULES.wocl.start, RULES.wocl.end);
}

/** Reference table for screen 3: rest 1:30→4:00 step 0:15 × Class 1/2/3 */
export function restReferenceTable() {
  const { from, to, step } = RULES.method2.referenceRestSteps;
  const rows = [];
  for (let r = from; r <= to; r += step) {
    rows.push({ rest: r, byClass: { 1: method2FdpFor(r, 1), 2: method2FdpFor(r, 2), 3: method2FdpFor(r, 3) } });
  }
  return rows;
}

// ---------------------------------------------------------------------
//  Input normalisation & validation
// ---------------------------------------------------------------------

function normClass(c) {
  const n = Number(c);
  return n === 1 || n === 2 || n === 3 ? n : 0; // 0 = ไม่มี rest facility
}

function parseLocal(date, time, tz) {
  if (!date || !/^\d{1,2}:\d{2}$/.test(String(time || '').trim())) return null;
  const dt = DateTime.fromISO(`${date}T${String(time).trim().padStart(5, '0')}`, { zone: tz });
  return dt.isValid ? dt : null;
}

function parseOverride(iso, tz) {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: tz });
  return dt.isValid ? dt : null;
}

/** Normalise + validate sectors. Returns { sectors, errors } */
export function prepareSectors(rawSectors = []) {
  const errors = [];
  const sectors = rawSectors.map((s, i) => {
    const from = getAirport(s.from);
    const to = getAirport(s.to);
    const err = (field, message, required = false) => errors.push({ sector: i, field, message, required });
    if (!s.from) err('from', 'กรอกสนามบินต้นทาง', true);
    else if (!from) err('from', `ไม่พบสนามบิน "${s.from}"`);
    if (!s.to) err('to', 'กรอกสนามบินปลายทาง', true);
    else if (!to) err('to', `ไม่พบสนามบิน "${s.to}"`);
    if (!s.dateDep) err('dateDep', 'กรอกวันที่', true);
    const off = Number(s.staDayOffset) || 0;
    const dep = from ? parseLocal(s.dateDep, s.std, from.tz) : null;
    let arr = null;
    if (to && s.dateDep) {
      const arrDate = DateTime.fromISO(s.dateDep, { zone: 'utc' }).plus({ days: off }).toISODate();
      arr = parseLocal(arrDate, s.sta, to.tz);
    }
    if (s.dateDep && from && !dep) err('std', 'กรอก STD (HH:MM)', true);
    if (s.dateDep && to && !arr) err('sta', 'กรอก STA (HH:MM)', true);
    if (dep && arr && arr <= dep) {
      err('sta', off === 0 ? 'STA ก่อน STD — ถ้าถึงวันถัดไปให้เลือก +1' : 'STA ก่อน STD');
    }
    return {
      index: i,
      flightNo: String(s.flightNo || '').trim().toUpperCase(),
      from: from?.iata ?? String(s.from || '').toUpperCase(),
      to: to?.iata ?? String(s.to || '').toUpperCase(),
      fromTz: from?.tz,
      toTz: to?.tz,
      dep,
      arr,
      restClass: normClass(s.restClass),
      positioning: !!s.positioning,
      newDuty: i === 0 ? true : !!s.newDuty,
    };
  });

  if (sectors.length === 0) errors.push({ sector: null, field: null, message: 'ยังไม่มี sector', required: true });

  // ลำดับเวลา: STD ของ sector ถัดไปต้องไม่ก่อน STA ของ sector ก่อนหน้า
  for (let i = 1; i < sectors.length; i++) {
    const p = sectors[i - 1];
    const c = sectors[i];
    if (p.arr && c.dep && c.dep < p.arr) {
      errors.push({ sector: i, field: 'std', message: `STD ก่อน STA ของ sector ${i}` });
    }
  }
  return { sectors, errors };
}

/** Group sectors into duties by `newDuty` */
export function groupDuties(sectors) {
  const duties = [];
  for (const s of sectors) {
    if (s.newDuty || duties.length === 0) duties.push([]);
    duties[duties.length - 1].push(s);
  }
  return duties;
}

// ---------------------------------------------------------------------
//  Main calculation
// ---------------------------------------------------------------------

/**
 * @param {object} input { sectors, reportOverrides, delayMode, delays }
 *   delays: { [dutyIndex]: { newReport: ISO, secondNotice?: ISO } } (ใช้เมื่อ delayMode)
 * @returns {{ duties: object[], errors: object[], warnings: object[] }}
 */
export function computeAll(input = {}) {
  const { sectors, errors } = prepareSectors(input.sectors || []);
  const warnings = [];
  const groups = groupDuties(sectors);

  groups.forEach((g, di) => {
    const ops = g.filter((s) => !s.positioning).length;
    if (ops > RULES.maxSectors) {
      errors.push({ sector: g[0].index, field: null, message: `Duty ${di + 1} มี ${ops} sector เกิน ${RULES.maxSectors}` });
    }
  });
  for (let i = 1; i < sectors.length; i++) {
    if (sectors[i - 1].to && sectors[i].from && sectors[i - 1].to !== sectors[i].from) {
      warnings.push({ sector: i, message: `ต้นทาง ${sectors[i].from} ไม่ตรงกับปลายทางก่อนหน้า ${sectors[i - 1].to}` });
    }
  }
  if (errors.length) return { duties: [], errors, warnings };

  const home = RULES.homeBase;
  const duties = [];
  let rot = null; // { startReport, refTz, refStation, refOrigin, maxTzDiff }

  groups.forEach((g, di) => {
    const first = g[0];
    const last = g[g.length - 1];
    const startTz = first.fromTz;
    const endTz = last.toTz;
    const operating = g.filter((s) => !s.positioning);
    const sectorCount = operating.length;
    const lastOp = operating[operating.length - 1] || null;
    const notes = [];
    const dutyWarnings = [];

    // ---- 5.1 report ----
    let reportOffset;
    let reportBasis;
    if (first.positioning) { reportOffset = RULES.report.positioning; reportBasis = 'positioning'; }
    else if (first.from === home.iata) { reportOffset = RULES.report.homeBase; reportBasis = 'homeBase'; }
    else { reportOffset = RULES.report.lineStation; reportBasis = 'lineStation'; }
    const defaultReport = first.dep.minus({ minutes: reportOffset });
    const override = parseOverride(input.reportOverrides?.[di], startTz);
    let report = (override || defaultReport).setZone(startTz);
    const reportOverridden = !!override;

    // ---- 5.9 delayed reporting ----
    let lookupStartCandidates = [report];
    let fdpStart = report;
    let delayInfo = null;
    const d = input.delayMode ? input.delays?.[di] : null;
    const newReport = d ? parseOverride(d.newReport, startTz) : null;
    if (newReport && newReport > report) {
      const delayMin = diffMin(newReport, report);
      const secondNotice = parseOverride(d.secondNotice, startTz);
      let start = newReport;
      if (secondNotice) {
        const s2 = secondNotice.plus({ minutes: RULES.delay.secondNoticeOffset });
        start = s2 < newReport ? s2 : newReport;
      }
      const lt4 = delayMin < RULES.delay.delayedReportThreshold;
      lookupStartCandidates = lt4 ? [report] : [report, newReport];
      delayInfo = {
        originalReport: report,
        newReport,
        delayMin,
        basis: lt4 ? 'original' : 'moreLimiting',
        secondNotice: secondNotice || null,
        countsAsRest: delayMin >= RULES.delay.delayCountsAsRest,
      };
      fdpStart = start.setZone(startTz);
      report = newReport.setZone(startTz);
    }

    const fdpEnd = lastOp ? lastOp.arr : null;
    const onBlocks = last.arr;
    const dutyEnd = onBlocks.plus({ minutes: RULES.postFlightDuty });
    const fdpMin = fdpEnd ? diffMin(fdpEnd, fdpStart) : null;
    const dpMin = diffMin(dutyEnd, report);
    if (!lastOp) notes.push({ text: 'Duty นี้มีแต่ positioning — ไม่มี FDP ให้ตรวจ', ref: '1.7' });

    // ---- 5.3 acclimatisation ----
    const startsRotation = !rot;
    if (!rot) {
      rot = {
        startReport: report,
        refTz: home.tz,
        refStation: home.iata,
        refOrigin: report,
        maxTzDiff: 0,
      };
      if (first.from !== home.iata) {
        notes.push({ text: `Rotation ไม่ได้เริ่มที่ ${home.iata} — สมมติว่าลูกเรือปรับตัวตามเวลา ${home.iata} ตรวจกับ OP-1`, ref: '1.7.1' });
      }
    }
    const dAcc = tzDiffHours(rot.refTz, startTz, report);
    const tAcc = diffMin(report, rot.refOrigin) / 60;
    let state = startsRotation && first.from === home.iata ? 'D' : acclimState(dAcc, tAcc);
    if (state === 'D') {
      rot.refTz = startTz;
      rot.refStation = first.from;
      rot.refOrigin = report;
    }
    const refTz = rot.refTz;
    const refStation = rot.refStation;
    for (const s of g) {
      rot.maxTzDiff = Math.max(rot.maxTzDiff, tzDiffHours(home.tz, s.fromTz, s.dep), tzDiffHours(home.tz, s.toTz, s.arr));
    }

    // ---- WOCL ----
    const woclMin = fdpEnd ? woclEncroachment(fdpStart, fdpEnd, refTz) : 0;

    // ---- 5.4 / 5.5 max basic ----
    const lookupStartMin = (dt) => minuteOfDay(dt.setZone(refTz));
    const nSec = Math.max(1, sectorCount);
    const basicFor = (dt) => (state === 'X' ? unknownFdpMax(nSec) : basicFdpMax(lookupStartMin(dt), nSec));
    let lookupStart = lookupStartCandidates[0];
    for (const c of lookupStartCandidates) if (basicFor(c) < basicFor(lookupStart)) lookupStart = c;
    const maxBasic = basicFor(lookupStart);
    if (maxBasic === null) notes.push({ text: `ไม่มีค่าในตารางสำหรับ ${sectorCount} sector (TODO: ตรวจกับ OP-1)`, ref: state === 'X' ? '1.7.4' : '1.7.3' });

    // ---- 5.6 Method 1 ----
    const sectorLimit = Math.min(RULES.method1.maxSectors, method1SectorLimit(woclMin));
    const m1Table = state === 'X' ? null : method1TableMax(lookupStartMin(lookupStart), nSec);
    let m1Reason = null;
    if (state === 'X') m1Reason = 'สถานะ X — ตาราง 1.7.6 อิงเวลาเริ่มแบบ acclimatised (TODO: ตรวจกับ OP-1)';
    else if (sectorCount > sectorLimit) m1Reason = `${sectorCount} sector เกินที่อนุญาต (${sectorLimit})`;
    else if (m1Table === null) m1Reason = 'ช่วงเวลาเริ่ม FDP นี้ = NA';
    const method1 = { allowed: !m1Reason && sectorCount > 0, max: m1Reason ? null : m1Table, tableMax: m1Table, sectorLimit, reason: m1Reason };

    // ---- 5.7 Method 2 ----
    const dutyClass = operating.reduce((best, s) => (s.restClass && (!best || s.restClass < best) ? s.restClass : best), 0);
    const maxByClass = method2MaxByClass();
    let m2Reason = null;
    if (sectorCount > RULES.method2.maxSectors) m2Reason = `${sectorCount} sector เกิน ${RULES.method2.maxSectors}`;
    else if (!dutyClass) m2Reason = 'ไม่มี rest facility';
    const restPerClass = fdpMin !== null ? method2RestFor(fdpMin) : { 1: null, 2: null, 3: null };
    const method2 = {
      applicable: !m2Reason && sectorCount > 0,
      reason: m2Reason,
      dutyClass,
      restPerClass,
      maxByClass,
      requiredRest: !m2Reason && dutyClass ? restPerClass[dutyClass] : null,
    };

    // ---- verdict ----
    let verdict;
    let effectiveMax;
    let exceedBy = 0;
    if (fdpMin === null) { verdict = 'ok'; effectiveMax = maxBasic; }
    else if (maxBasic !== null && fdpMin <= maxBasic) { verdict = 'ok'; effectiveMax = maxBasic; }
    else if (method1.allowed && fdpMin <= method1.max) { verdict = 'needM1'; effectiveMax = method1.max; }
    else if (method2.applicable && method2.requiredRest !== null) {
      verdict = 'needM2';
      effectiveMax = method2FdpFor(method2.requiredRest, dutyClass);
    } else {
      verdict = 'exceed';
      const options = [maxBasic ?? 0];
      if (method1.allowed) options.push(method1.max);
      if (method2.applicable) options.push(maxByClass[dutyClass]);
      effectiveMax = Math.max(...options);
      exceedBy = fdpMin - effectiveMax;
    }
    if (verdict === 'needM1') {
      dutyWarnings.push({ text: `Method 1 ใช้ได้ไม่เกิน ${RULES.method1.maxUsesPer7Days} ครั้ง/7 วัน — ตรวจประวัติเอง`, ref: '1.7.6' });
    }

    // ---- 5.10 rest after ----
    const endsAtHome = last.to === home.iata;
    const tzCrossing = tzDiffHours(startTz, endTz, dutyEnd);
    const restBasis = [{ label: 'DP', min: dpMin }];
    restBasis.push(endsAtHome
      ? { label: 'home base', min: RULES.rest.homeBase }
      : { label: 'นอก home base', min: RULES.rest.awayFromBase });
    if (!endsAtHome && tzCrossing >= RULES.rest.timeZoneCrossingThreshold) {
      restBasis.push({ label: `ข้ามเขตเวลา ${tzCrossing} ชม.`, min: RULES.rest.afterTimeZoneCrossing });
    }
    if (verdict === 'needM2') restBasis.push({ label: 'หลัง Method 2', min: RULES.method2.restAfterMin });
    const restAfterMin = Math.max(...restBasis.map((b) => b.min));
    const nextReportEarliest = dutyEnd.plus({ minutes: restAfterMin }).setZone(endTz);
    if (!endsAtHome) notes.push({ text: 'Rest นอก home base ต้องมีโอกาสนอน 8 ชม.', ref: RULES.rest.ref });

    // ---- 5.10 local nights at home base ----
    let homeBaseLocalNights = null;
    if (endsAtHome && rot.maxTzDiff >= RULES.rest.timeZoneCrossingThreshold) {
      const tRot = diffMin(dutyEnd, rot.startReport) / 60;
      homeBaseLocalNights = {
        nights: localNightsFor(rot.maxTzDiff, tRot),
        maxTzDiff: rot.maxTzDiff,
        elapsedMin: Math.round(tRot * 60),
        ref: RULES.rest.localNights.ref,
      };
    }

    // ---- night duty (02:00–04:59 refTz) ----
    const nightMin = fdpEnd ? windowOverlap(fdpStart, dutyEnd, refTz, RULES.nightDutyWindow.start, RULES.nightDutyWindow.end) : 0;
    const prev = duties[duties.length - 1];
    if (nightMin > 0 && prev && prev.nightDutyMin > 0) {
      dutyWarnings.push({ text: `night duty ติดต่อกัน จำกัด ${RULES.nightDutyConsecutiveSectorLimit} sectors/duty`, ref: RULES.rest.ref });
      if (sectorCount > RULES.nightDutyConsecutiveSectorLimit) {
        dutyWarnings.push({ text: `Duty นี้มี ${sectorCount} sector เกิน ${RULES.nightDutyConsecutiveSectorLimit}`, ref: RULES.rest.ref });
      }
    }

    // ---- rest before ----
    let restBefore = null;
    if (prev) {
      const actual = diffMin(report, prev.dutyEnd);
      restBefore = { actual, required: prev.restAfterMin, ok: actual >= prev.restAfterMin };
    }

    // ---- 5.9 PIC discretion ----
    let delay = null;
    if (input.delayMode) {
      delay = {
        picMax: effectiveMax !== null ? effectiveMax + RULES.delay.picDiscretion : null,
        picMaxAugmented: effectiveMax !== null ? effectiveMax + RULES.delay.picDiscretionAugmented : null,
        picMinRestAfter: RULES.delay.picMinRestAfter,
        delayedReport: delayInfo,
      };
    }

    duties.push({
      index: di,
      sectors: g,
      route: [g[0].from, ...g.map((s) => s.to)].join('–'),
      sectorCount,
      startStation: first.from,
      endStation: last.to,
      startTz,
      endTz,
      fdpEndTz: lastOp ? lastOp.toTz : endTz,
      report,
      reportBasis,
      reportOverridden,
      defaultReport: defaultReport.setZone(startTz),
      fdpStart,
      fdpEnd,
      fdpMin,
      fdpHours: fdpMin !== null ? fdpMin / 60 : null,
      onBlocks,
      dutyEnd,
      dpMin,
      acclimState: state,
      acclim: { d: dAcc, t: tAcc },
      refTz,
      refStation,
      reportInRefTz: report.setZone(refTz),
      woclEncroach: woclMin,
      nightDutyMin: nightMin,
      maxBasic,
      method1,
      method2,
      verdict,
      effectiveMax,
      exceedBy,
      tzCrossing,
      endsAtHome,
      restBasis,
      restBefore,
      restAfterMin,
      nextReportEarliest,
      homeBaseLocalNights,
      delay,
      notes,
      warnings: dutyWarnings,
    });

    if (endsAtHome) rot = null; // rotation จบเมื่อกลับ home base
  });

  return { duties, errors, warnings };
}

// ---------------------------------------------------------------------
//  Screen 3 — rest plan & standby
// ---------------------------------------------------------------------

/**
 * Rest plan (T3): class + rest per person → reachable FDP, latest on-blocks, margin.
 * reduction = minutes ที่ max ลดลง (เช่น จาก standby)
 */
export function restPlan(duty, cls, restMin, reduction = 0) {
  const c = normClass(cls);
  const reach = c ? method2FdpFor(restMin, c) : null;
  const notes = [];
  if (duty.sectorCount > RULES.method2.maxSectors) notes.push(`Method 2 ใช้ไม่ได้: ${duty.sectorCount} sector เกิน ${RULES.method2.maxSectors}`);
  if (!c) notes.push('ไม่มี rest facility');
  if (restMin !== null && restMin < RULES.method2.minRestBlock) notes.push('พักต่อคนต้องติดกันอย่างน้อย 1:30');
  if (reach === null || !duty.fdpEnd) {
    return { maxFdp: null, latestOnBlocks: null, margin: null, ok: false, notes };
  }
  const maxFdp = reach - reduction;
  const latestOnBlocks = duty.fdpStart.plus({ minutes: maxFdp }).setZone(duty.fdpEndTz);
  const margin = diffMin(latestOnBlocks, duty.fdpEnd);
  return { maxFdp, reachableFdp: reach, latestOnBlocks, margin, ok: margin >= 0 && notes.length === 0, notes };
}

/**
 * Standby impact per person (5.8)
 * sb = { type: 'other'|'airport', hours, nightUncontacted?: boolean, nightUncontactedHours? }
 * plan = { cls, restMin } (optional) — rest ที่จัดให้คนนี้
 */
export function standbyImpact(duty, sb, plan = null) {
  const R = RULES.standby;
  const total = toMinutes(sb.hours) ?? 0;
  const warnings = [];
  let reductionNormal;
  let reductionWithRest;
  if (sb.type === 'airport') {
    if (total > R.airport.maxHours) warnings.push(`Airport standby เกินสูงสุด ${fmtHM(R.airport.maxHours)}`);
    reductionNormal = Math.max(0, total - R.airport.threshold);
    reductionWithRest = reductionNormal;
    if (duty.fdpMin !== null && total + duty.fdpMin > R.airport.combinedLimit) {
      warnings.push(`Airport standby + FDP = ${fmtHM(total + duty.fdpMin)} เกิน ${fmtHM(R.airport.combinedLimit)}`);
    }
  } else {
    if (total > R.other.maxHours) warnings.push(`Standby เกินสูงสุด ${fmtHM(R.other.maxHours)}`);
    const excluded = sb.nightUncontacted ? Math.min(total, toMinutes(sb.nightUncontactedHours) ?? 0) : 0;
    const counted = total - excluded;
    reductionNormal = Math.max(0, counted - R.other.threshold);
    reductionWithRest = Math.max(0, counted - R.other.thresholdInflightRest);
    if (duty.fdpMin !== null && total + duty.fdpMin > R.other.awakeLimit) {
      warnings.push(`Standby + FDP = ${fmtHM(total + duty.fdpMin)} เกิน ${fmtHM(R.other.awakeLimit)} (awake time)`);
    }
  }

  const fdp = duty.fdpMin;
  const maxBasicReduced = duty.maxBasic !== null ? duty.maxBasic - reductionNormal : null;
  const method1Reduced = duty.method1.allowed ? duty.method1.max - reductionNormal : null;

  // ต้องพักอย่างน้อยเท่าไร: หา rest ที่ทำให้ max(หลังหัก) ≥ FDP ตามแผน
  let need = 'm2';
  let requiredRest = null;
  let requiredRestByClass = null;
  if (fdp === null) need = 'none';
  else if (maxBasicReduced !== null && fdp <= maxBasicReduced) need = 'none';
  else if (method1Reduced !== null && fdp <= method1Reduced) need = 'm1';
  else {
    requiredRestByClass = method2RestFor(fdp + reductionWithRest);
    const cls = normClass(plan?.cls) || duty.method2.dutyClass;
    requiredRest = duty.method2.applicable && cls ? requiredRestByClass[cls] : null;
    if (requiredRest === null) need = 'exceed';
  }

  const planResult = plan ? restPlan(duty, plan.cls, plan.restMin, reductionWithRest) : null;
  return {
    type: sb.type,
    totalMin: total,
    reductionNormal,
    reductionWithRest,
    maxBasicReduced,
    method1Reduced,
    need,
    requiredRest,
    requiredRestByClass,
    targetFdp: fdp !== null ? fdp + reductionWithRest : null,
    plan: planResult,
    warnings,
  };
}

// ---------------------------------------------------------------------
//  Presentation lines (shared by result cards and "copy summary")
// ---------------------------------------------------------------------

const STATE_TEXT = {
  D: (d) => `สถานะ D · ใช้เวลาท้องถิ่น ${d.refStation}`,
  B: (d) => `สถานะ B · ร่างกายยังอยู่เวลา ${d.refStation} (report = ${d.reportInRefTz.toFormat('HH:mm')})`,
  X: (d) => `สถานะ X (unknown) · ใช้ Table 1.7.4 · WOCL ตามเวลา ${d.refStation}`,
};

/** Lines describing one duty: [{ kind, text, ref?, tone? }] */
export function dutyLines(duty) {
  const L = [];
  const add = (kind, text, ref, tone) => L.push({ kind, text, ref, tone });
  const cls = duty.method2.dutyClass ? `Class ${duty.method2.dutyClass}` : 'ไม่มี rest facility';
  add('title', `Duty ${duty.index + 1} · ${duty.route} · ${duty.sectorCount} sector · ${cls}`);

  if (duty.restBefore) {
    const r = duty.restBefore;
    add('restBefore', `Rest ก่อน duty นี้ ${fmtHM(r.actual)} / ต้องการ ${fmtHM(r.required)} ${r.ok ? '✅' : '❌'}`, RULES.rest.ref, r.ok ? 'ok' : 'bad');
  }
  add('time', `Report  ${fmtDT(duty.report, duty.startTz)} ${duty.startStation}${duty.reportOverridden ? ' (แก้เอง)' : ''}`, RULES.report.ref);
  if (duty.fdpEnd && +duty.fdpEnd !== +duty.onBlocks) {
    const fdpEndStation = duty.sectors.filter((s) => !s.positioning).at(-1).to;
    add('time', `FDP สิ้นสุด  ${fmtDT(duty.fdpEnd, duty.fdpEndTz)} ${fdpEndStation} (positioning ต่อ)`);
  }
  add('time', `On-blocks  ${fmtDT(duty.onBlocks, duty.endTz)} ${duty.endStation}`);
  add('state', STATE_TEXT[duty.acclimState](duty), RULES.acclimatisation.ref);

  if (duty.fdpMin === null) {
    duty.notes.forEach((n) => add('note', n.text, n.ref));
    return L;
  }

  const woclText = duty.woclEncroach > 0 ? `🌙 คร่อม WOCL ${fmtHM(duty.woclEncroach)}` : 'ไม่คร่อม WOCL';
  add('wocl', `${woclText} · Method 1 ได้ไม่เกิน ${duty.method1.sectorLimit} sector`, RULES.method1.ref);
  add('fdp', `FDP ${fmtHM(duty.fdpMin)} / max ${fmtHM(duty.maxBasic)}`, duty.acclimState === 'X' ? RULES.unknownFdp.ref : RULES.basicFdp.ref);

  switch (duty.verdict) {
    case 'ok':
      add('verdict', `🟢 อยู่ใน max ปกติ (เหลือ ${fmtHM(duty.maxBasic - duty.fdpMin)})`, RULES.basicFdp.ref, 'ok');
      break;
    case 'needM1':
      add('verdict', `🟠 ต้องใช้ Method 1 — max ${fmtHM(duty.method1.max)} ไม่มี in-flight rest`, RULES.method1.ref, 'warn');
      break;
    case 'needM2':
      add('verdict', `🟠 ต้องใช้ Method 2 — จัดพักอย่างน้อย ${fmtHM(duty.method2.requiredRest)} ต่อคน`, RULES.method2.ref, 'warn');
      break;
    default:
      add('verdict', `🔴 เกิน ${fmtHM(duty.exceedBy)} — ต้องเปลี่ยนแผน ยึดคำตัดสิน OP-1/PIC`, RULES.method2.ref, 'bad');
  }
  if (duty.verdict !== 'ok') {
    const m1 = duty.method1.allowed ? `Method 1 max ${fmtHM(duty.method1.max)}` : `Method 1 ใช้ไม่ได้ (${duty.method1.reason})`;
    add('detail', m1, RULES.method1.ref);
    if (duty.method2.applicable) {
      const r = duty.method2.restPerClass;
      add('detail', `Method 2 พักต่อคน: Class 1 ${fmtHM(r[1])} · Class 2 ${fmtHM(r[2])} · Class 3 ${fmtHM(r[3])}`, RULES.method2.ref);
    } else {
      add('detail', `Method 2 ใช้ไม่ได้ (${duty.method2.reason})`, RULES.method2.ref);
    }
  }

  if (duty.delay) {
    const dl = duty.delay;
    add('delay', `PIC's discretion: max ${fmtHM(dl.picMax)} (+2:00) · rest หลัง FDP ลดได้แต่ ≥ ${fmtHM(dl.picMinRestAfter)}`, RULES.delay.ref);
    add('note', `ถ้า augmented flight crew: +3:00 → ${fmtHM(dl.picMaxAugmented)}`, RULES.delay.ref);
    if (dl.delayedReport) {
      const r = dl.delayedReport;
      add('delay', `Delayed reporting ${fmtHM(r.delayMin)} · max คิดจาก${r.basis === 'original' ? 'เวลา report เดิม' : 'เวลาที่จำกัดกว่า'} · FDP เริ่ม ${fmtDT(duty.fdpStart, duty.startTz)}`, RULES.delay.ref);
      if (r.countsAsRest) add('note', 'เลื่อน ≥ 10 ชม. และไม่ถูกรบกวน = นับเป็น rest', RULES.delay.ref);
    }
  }

  add('rest', `🛏 Rest ขั้นต่ำหลัง duty นี้ ${fmtHM(duty.restAfterMin)}`, RULES.rest.ref);
  add('rest2', `report ครั้งถัดไปได้เร็วสุด ${fmtDT(duty.nextReportEarliest, duty.endTz)} ${duty.endStation}`, RULES.rest.ref);
  if (duty.homeBaseLocalNights) {
    const n = duty.homeBaseLocalNights;
    add('nights', `🏠 กลับ home base หลังข้ามเขตเวลา ${n.maxTzDiff} ชม. (${fmtHM(n.elapsedMin)} นับจาก report แรก) → ${n.nights} local nights · ตรวจกับ OP-1`, n.ref, 'warn');
  }
  duty.warnings.forEach((w) => add('warning', `⚠️ ${w.text}`, w.ref, 'warn'));
  duty.notes.forEach((n) => add('note', n.text, n.ref));
  return L;
}

/** Plain-text summary of all duties */
export function summaryText(result) {
  const out = [];
  for (const d of result.duties) {
    out.push(dutyLines(d).map((l) => (l.kind === 'title' ? l.text : `  ${l.text}${l.ref ? ` [CCM ${l.ref}]` : ''}`)).join('\n'));
  }
  out.push(`— ${RULES.revisionLabel} · เครื่องมือช่วยประมาณการ ใช้ตรวจทานเท่านั้น`);
  return out.join('\n\n');
}
