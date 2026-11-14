// =====================================================================
//  ui.js — DOM layer. All rule logic lives in engine.js.
// =====================================================================

import { DateTime } from './vendor/luxon.js';
import {
  RULES, computeAll, dutyLines, summaryText, restPlan, standbyImpact,
  restReferenceTable, searchAirports, getAirport, fmtHM, fmtDT, toMinutes,
} from './engine.js';

const STORE_KEY = 'fdp-draft-v1';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------

const today = () => DateTime.local().toISODate();

function blankSector(prev) {
  return {
    flightNo: '', from: prev?.to || 'BKK', to: '', dateDep: prev?.dateDep || today(),
    std: '', sta: '', staDayOffset: 0, restClass: 1, positioning: false, newDuty: !prev,
  };
}

const freshState = () => ({
  sectors: [blankSector(null)],
  reportOverrides: {},
  delayMode: false,
  delays: {},
  standbys: [],
  planner: { duty: 0, cls: '', rest: '2:00' },
  calculated: false,
  view: 'input',
});

const EXAMPLE = {
  sectors: [
    { flightNo: 'TG916', from: 'BKK', to: 'LHR', dateDep: '2026-11-14', std: '13:20', sta: '19:35', staDayOffset: 0, restClass: 1, positioning: false, newDuty: true },
    { flightNo: 'TG917', from: 'LHR', to: 'BKK', dateDep: '2026-11-15', std: '21:35', sta: '16:00', staDayOffset: 1, restClass: 1, positioning: false, newDuty: true },
  ],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    if (!Array.isArray(s.sectors) || !s.sectors.length) return freshState();
    return { ...freshState(), ...s, planner: { ...freshState().planner, ...(s.planner || {}) } };
  } catch {
    return freshState();
  }
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

let state = loadState();
let result = { duties: [], errors: [], warnings: [] };

function engineInput() {
  return {
    sectors: state.sectors,
    reportOverrides: state.reportOverrides,
    delayMode: state.delayMode,
    delays: state.delays,
  };
}

// ---------------------------------------------------------------------
//  Views
// ---------------------------------------------------------------------

function showView(v) {
  state.view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  saveState();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------
//  Sector list (3.1)
// ---------------------------------------------------------------------

function renderSectors() {
  const list = $('#sectorList');
  list.textContent = '';
  const tpl = $('#sectorTpl');
  state.sectors.forEach((s, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.i = i;
    $('.sector-no', node).textContent = `Sector ${i + 1}`;
    for (const el of $$('[data-k]', node)) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!s[k];
      else el.value = s[k] ?? '';
      el.id = `s${i}-${k}`;
    }
    const nd = $('[data-k=newDuty]', node);
    if (i === 0) { nd.checked = true; nd.disabled = true; nd.parentElement.classList.add('disabled'); }
    $('.del', node).disabled = state.sectors.length === 1;
    list.appendChild(node);
    updateAirportLabel(node, 'from');
    updateAirportLabel(node, 'to');
  });
  refreshSectorMeta();
}

function refreshSectorMeta() {
  let duty = 0;
  $$('#sectorList .sector').forEach((node, i) => {
    const s = state.sectors[i];
    if (i === 0 || s.newDuty) duty++;
    const starts = i === 0 || s.newDuty;
    node.classList.toggle('duty-start', starts);
    $('.duty-badge', node).textContent = starts ? `เริ่ม Duty ${duty}` : '';
  });
}

function updateAirportLabel(node, k) {
  const v = $(`[data-k=${k}]`, node).value;
  const a = getAirport(v);
  $(`[data-label=${k}]`, node).textContent = a ? `${a.iata} · ${a.city}${a.th ? ` (${a.th})` : ''}` : '';
}

function onSectorInput(e) {
  const el = e.target.closest('[data-k]');
  const node = e.target.closest('.sector');
  if (!el || !node) return;
  const i = Number(node.dataset.i);
  const k = el.dataset.k;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'flightNo') v = String(v).toUpperCase();
  if (k === 'staDayOffset' || k === 'restClass') v = Number(v);
  state.sectors[i][k] = v;
  if (k === 'from' || k === 'to') updateAirportLabel(node, k);
  if (k === 'newDuty' || k === 'positioning') refreshSectorMeta();
  if (k === 'newDuty') { state.reportOverrides = {}; state.delays = {}; }
  update();
}

// ---------------------------------------------------------------------
//  Airport autocomplete
// ---------------------------------------------------------------------

function acOpen(input) {
  const list = input.parentElement.querySelector('.ac-list');
  const items = searchAirports(input.value, 8);
  list.textContent = '';
  if (!items.length || (items.length === 1 && items[0].iata === input.value.toUpperCase())) {
    list.hidden = true; input.setAttribute('aria-expanded', 'false'); return;
  }
  items.forEach((a, idx) => {
    const li = document.createElement('li');
    li.dataset.iata = a.iata;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
    li.innerHTML = `<b>${esc(a.iata)}</b> · ${esc(a.city)}${a.th ? ` · ${esc(a.th)}` : ''}<small>${esc(a.name)}, ${esc(a.country)}</small>`;
    list.appendChild(li);
  });
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function acClose(input) {
  const list = input.parentElement.querySelector('.ac-list');
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
}

function acPick(input, iata) {
  input.value = iata;
  acClose(input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function bindAutocomplete(root) {
  root.addEventListener('input', (e) => { if (e.target.matches('[data-ac]')) acOpen(e.target); });
  root.addEventListener('focusin', (e) => { if (e.target.matches('[data-ac]') && e.target.value && !getAirport(e.target.value)) acOpen(e.target); });
  root.addEventListener('focusout', (e) => {
    if (!e.target.matches('[data-ac]')) return;
    const input = e.target;
    setTimeout(() => {
      // auto-pick when the typed text clearly names one place (e.g. "ลอนดอน")
      if (input.value && !getAirport(input.value)) {
        const top = searchAirports(input.value, 2);
        if (top.length === 1 || (top[0] && (top[0].th === input.value.trim() || top[0].city.toLowerCase() === input.value.trim().toLowerCase()))) {
          acPick(input, top[0].iata);
          return;
        }
      }
      acClose(input);
    }, 150);
  });
  root.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.ac-list li');
    if (!li) return;
    e.preventDefault();
    acPick(li.closest('.field').querySelector('[data-ac]'), li.dataset.iata);
  });
  root.addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-ac]')) return;
    const list = e.target.parentElement.querySelector('.ac-list');
    if (list.hidden) return;
    const items = $$('li', list);
    let idx = items.findIndex((li) => li.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, j) => li.setAttribute('aria-selected', j === idx ? 'true' : 'false'));
    } else if (e.key === 'Enter' && items[idx]) {
      e.preventDefault();
      acPick(e.target, items[idx].dataset.iata);
    } else if (e.key === 'Escape') {
      acClose(e.target);
    }
  });
}

// ---------------------------------------------------------------------
//  Report overrides & delay inputs
// ---------------------------------------------------------------------

function dutyStarts() {
  const starts = [];
  state.sectors.forEach((s, i) => { if (i === 0 || s.newDuty) starts.push(i); });
  return starts;
}

const toLocalInput = (dt, tz) => (dt ? dt.setZone(tz).toFormat("yyyy-LL-dd'T'HH:mm") : '');

function dutyLabel(di, si) {
  const s = state.sectors[si];
  return `Duty ${di + 1} · ${s.from || '?'}${s.flightNo ? ` (${s.flightNo})` : ''}`;
}

function syncRows(container, count, build) {
  if (container.children.length !== count) {
    container.textContent = '';
    for (let i = 0; i < count; i++) container.appendChild(build(i));
  }
}

function renderReports() {
  const starts = dutyStarts();
  const list = $('#reportList');
  syncRows(list, starts.length, (di) => {
    const row = document.createElement('div');
    row.className = 'report-row';
    row.innerHTML = `<label class="field"><span></span><input type="datetime-local" data-report="${di}"></label>
      <button type="button" class="btn" data-reset="${di}">ค่าอัตโนมัติ</button>`;
    return row;
  });
  starts.forEach((si, di) => {
    const row = list.children[di];
    const duty = result.duties[di];
    const tz = getAirport(state.sectors[si].from)?.tz;
    const auto = duty ? `อัตโนมัติ ${fmtDT(duty.defaultReport)}` : '';
    $('span', row).textContent = `${dutyLabel(di, si)}${auto ? ` — ${auto}` : ''}${state.reportOverrides[di] ? ' · แก้เอง' : ''}`;
    const input = $('input', row);
    if (document.activeElement !== input) {
      input.value = state.reportOverrides[di] || (duty && tz ? toLocalInput(duty.defaultReport, tz) : '');
    }
    $('button', row).hidden = !state.reportOverrides[di];
  });
}

function renderDelays() {
  const box = $('#delayList');
  box.hidden = !state.delayMode;
  if (!state.delayMode) return;
  const starts = dutyStarts();
  syncRows(box, starts.length, (di) => {
    const row = document.createElement('div');
    row.className = 'sb';
    row.innerHTML = `<p class="muted-t" data-title></p>
      <div class="grid2">
        <label class="field"><span>Report ใหม่ (เลื่อน)</span><input type="datetime-local" data-delay="${di}" data-dk="newReport"></label>
        <label class="field"><span>แจ้งครั้งที่ 2 (ถ้ามี)</span><input type="datetime-local" data-delay="${di}" data-dk="secondNotice"></label>
      </div>`;
    return row;
  });
  starts.forEach((si, di) => {
    const row = box.children[di];
    $('[data-title]', row).textContent = `${dutyLabel(di, si)} · เวลาท้องถิ่นสถานีที่ report`;
    for (const input of $$('input', row)) {
      if (document.activeElement !== input) input.value = state.delays[di]?.[input.dataset.dk] || '';
    }
  });
}

// ---------------------------------------------------------------------
//  Validation display
// ---------------------------------------------------------------------

function showValidation() {
  $$('#sectorList .err').forEach((el) => { el.textContent = ''; });
  $$('#sectorList .invalid').forEach((el) => el.classList.remove('invalid'));
  $$('#sectorList [data-warn]').forEach((el) => { el.textContent = ''; });
  const global = [];
  const nodes = $$('#sectorList .sector');
  for (const e of result.errors) {
    if (e.required && !state.calculated) continue;
    const node = e.sector !== null ? nodes[e.sector] : null;
    if (node && e.field) {
      const slot = $(`[data-err=${e.field}]`, node);
      if (slot && !slot.textContent) slot.textContent = e.message;
      $(`[data-k=${e.field}]`, node)?.classList.add('invalid');
    } else {
      global.push(`<p class="e">${esc(e.message)}</p>`);
    }
  }
  for (const w of result.warnings) {
    const node = nodes[w.sector];
    if (node) $('[data-warn]', node).textContent = `⚠️ ${w.message}`;
  }
  if (state.sectors.length > RULES.maxSectors) {
    global.push(`<p class="w">มี ${state.sectors.length} sector — จำกัด ${RULES.maxSectors} sector ต่อ duty</p>`);
  }
  $('#globalMsgs').innerHTML = global.join('');
}

// ---------------------------------------------------------------------
//  Results (3.2)
// ---------------------------------------------------------------------

function renderResults() {
  const box = $('#resultList');
  if (!state.calculated) {
    box.innerHTML = '<p class="empty">กรอก sector แล้วกด “คำนวณ”</p>';
    return;
  }
  if (result.errors.length) {
    box.innerHTML = `<div class="card"><p class="tone-bad" style="padding:8px;border-radius:8px;margin:0">ข้อมูลยังไม่ครบหรือไม่ถูกต้อง (${result.errors.length} จุด) — แก้ในหน้ากรอกก่อน</p>
      <ul>${result.errors.map((e) => `<li>${e.sector !== null ? `Sector ${e.sector + 1}: ` : ''}${esc(e.message)}</li>`).join('')}</ul></div>`;
    return;
  }
  box.innerHTML = result.duties.map((d) => `<article class="card">${dutyLines(d).map((l) => `
    <div class="line ${l.kind}${l.tone ? ` tone-${l.tone}` : ''}">
      <span class="t">${esc(l.text)}</span>${l.ref && l.kind !== 'title' ? `<span class="ref">${esc(l.ref)}</span>` : ''}
    </div>`).join('')}</article>`).join('');
}

// ---------------------------------------------------------------------
//  Planner + standby (3.3)
// ---------------------------------------------------------------------

function plannerDuty() {
  const d = result.duties[state.planner.duty] || result.duties[0];
  return d && d.fdpMin !== null ? d : null;
}

function renderPlanner() {
  const sel = $('#plDuty');
  const opts = result.duties.map((d) => `<option value="${d.index}">Duty ${d.index + 1} · ${esc(d.route)}${d.fdpMin !== null ? ` · FDP ${fmtHM(d.fdpMin)}` : ''}</option>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  if (state.planner.duty >= result.duties.length) state.planner.duty = 0;
  sel.value = String(state.planner.duty);

  const duty = plannerDuty();
  if (duty && !state.planner.cls) state.planner.cls = String(duty.method2.dutyClass || 1);
  $('#plClass').value = state.planner.cls || '1';
  if (document.activeElement !== $('#plRest')) $('#plRest').value = state.planner.rest;

  const out = $('#plOut');
  const restMin = toMinutes(state.planner.rest);
  let highlight = null;
  if (!state.calculated || result.errors.length) {
    out.innerHTML = '<p class="muted-t">กรอกข้อมูลให้ครบแล้วกด “คำนวณ” ในหน้ากรอก</p>';
  } else if (!duty) {
    out.innerHTML = '<p class="muted-t">Duty นี้ไม่มี FDP (positioning ล้วน)</p>';
  } else if (restMin === null) {
    out.innerHTML = '<p class="bad-t">กรอกเวลาพักเป็น H:MM เช่น 2:00</p>';
  } else {
    const p = restPlan(duty, state.planner.cls, restMin);
    const cls = state.planner.cls;
    if (p.maxFdp === null) {
      out.innerHTML = `<p class="big">พัก ${fmtHM(restMin)} · Class ${esc(cls)} → ใช้ Method 2 ไม่ได้</p>${p.notes.map((n) => `<p class="bad-t">${esc(n)}</p>`).join('')}`;
    } else {
      highlight = p.maxFdp;
      const fdpEndStation = duty.sectors.filter((s) => !s.positioning).at(-1).to;
      out.innerHTML = `
        <p class="big">พัก ${fmtHM(restMin)} · Class ${esc(cls)} → FDP ได้ถึง ${fmtHM(p.maxFdp)}</p>
        <p>🛬 On-blocks ช้าสุด ${fmtDT(p.latestOnBlocks)} เวลา ${esc(fdpEndStation)}</p>
        <p class="${p.margin >= 0 ? 'ok-t' : 'bad-t'}">ตามตาราง ${fmtDT(duty.fdpEnd, duty.fdpEndTz)} → ${p.margin >= 0 ? `เผื่อได้อีก ${fmtHM(p.margin)} ✅` : `เกิน ${fmtHM(-p.margin)} ❌`}</p>
        ${p.notes.map((n) => `<p class="warn-t">⚠️ ${esc(n)}</p>`).join('')}
        <p class="muted-t">FDP ตามแผน ${fmtHM(duty.fdpMin)} · ${RULES.method2.ref}</p>`;
    }
  }
  renderRefTable(highlight);
  renderStandbyOutputs(duty, restMin);
}

function renderRefTable(highlightFdp) {
  const rows = restReferenceTable();
  const cell = (v) => (v === null ? '<td class="na">NA</td>' : `<td>${fmtHM(v)}</td>`);
  const restMin = toMinutes(state.planner.rest);
  $('#refTable').innerHTML = `<thead><tr><th>พักต่อคน</th><th>Class 1</th><th>Class 2</th><th>Class 3</th></tr></thead><tbody>${
    rows.map((r) => `<tr class="${highlightFdp !== null && r.rest === restMin ? 'hl' : ''}"><td>${fmtHM(r.rest)}</td>${cell(r.byClass[1])}${cell(r.byClass[2])}${cell(r.byClass[3])}</tr>`).join('')
  }</tbody>`;
}

function renderStandbyRows() {
  const list = $('#sbList');
  list.innerHTML = state.standbys.map((sb, i) => `
    <div class="sb" data-sb="${i}">
      <div class="sb-head">
        <label class="field"><span>คนที่ ${i + 1} · ประเภท</span>
          <select data-sk="type">
            <option value="other"${sb.type === 'other' ? ' selected' : ''}>ที่บ้าน/ที่พัก</option>
            <option value="airport"${sb.type === 'airport' ? ' selected' : ''}>Airport</option>
          </select></label>
        <label class="field"><span>ชั่วโมง</span><input data-sk="hours" inputmode="numeric" placeholder="9:00" value="${esc(sb.hours)}"></label>
        <button type="button" class="icon-btn" data-sbdel="${i}" aria-label="ลบคนนี้">🗑</button>
      </div>
      <div ${sb.type === 'airport' ? 'hidden' : ''}>
        <label class="check"><input type="checkbox" data-sk="night"${sb.night ? ' checked' : ''}> เริ่มช่วง 23:00–07:00 และยังไม่ถูกติดต่อ</label>
        <label class="field" ${sb.night ? '' : 'hidden'}><span>ชั่วโมงในช่วงนั้นก่อน OP-1 ติดต่อ (ไม่นับลด)</span><input data-sk="nightHours" inputmode="numeric" placeholder="3:00" value="${esc(sb.nightHours)}"></label>
      </div>
      <div class="out" data-sbout></div>
    </div>`).join('');
}

function renderStandbyOutputs(duty, restMin) {
  $$('#sbList .sb').forEach((row, i) => {
    const sb = state.standbys[i];
    const out = $('[data-sbout]', row);
    if (!duty || !state.calculated || result.errors.length) { out.innerHTML = ''; return; }
    if (toMinutes(sb.hours) === null) { out.innerHTML = '<p class="muted-t">กรอกชั่วโมง standby เช่น 9:00</p>'; return; }
    const plan = restMin !== null ? { cls: state.planner.cls, restMin } : null;
    const r = standbyImpact(duty, { type: sb.type, hours: sb.hours, nightUncontacted: sb.night, nightUncontactedHours: sb.nightHours }, plan);
    const cls = state.planner.cls;
    const lines = [];
    lines.push(`<p>max ลดลง: ปกติ <b>${fmtHM(r.reductionNormal)}</b> · มี in-flight rest <b>${fmtHM(r.reductionWithRest)}</b></p>`);
    if (r.need === 'none') {
      lines.push(`<p class="ok-t">🟢 ไม่ต้องพัก — max ปกติหลังหัก ${fmtHM(r.maxBasicReduced)} ≥ FDP ${fmtHM(duty.fdpMin)}</p>`);
    } else if (r.need === 'm1') {
      lines.push(`<p class="warn-t">🟠 Method 1 เอาอยู่ — max หลังหัก ${fmtHM(r.method1Reduced)} ≥ FDP ${fmtHM(duty.fdpMin)}</p>`);
    } else if (r.need === 'm2') {
      lines.push(`<p class="big">🛏 คนนี้ต้องพักอย่างน้อย ${fmtHM(r.requiredRest)} (Class ${esc(cls)})</p>`);
      lines.push(`<p class="muted-t">ต้องได้ max ≥ ${fmtHM(duty.fdpMin)} + ${fmtHM(r.reductionWithRest)} = ${fmtHM(r.targetFdp)}</p>`);
    } else {
      const alt = r.requiredRestByClass ? [1, 2, 3].filter((c) => r.requiredRestByClass[c] !== null).map((c) => `Class ${c} ${fmtHM(r.requiredRestByClass[c])}`).join(' · ') : '';
      lines.push(`<p class="bad-t">🔴 Class ${esc(cls)} ไปไม่ถึง max ${fmtHM(r.targetFdp)} — ต้องเปลี่ยนแผน${alt ? ` (ถ้าเปลี่ยน class: ${alt})` : ''}</p>`);
    }
    if (r.plan && r.plan.maxFdp !== null) {
      const p = r.plan;
      lines.push(`<p class="${p.margin >= 0 ? 'ok-t' : 'bad-t'}">ถ้าพัก ${fmtHM(restMin)}: max ${fmtHM(p.reachableFdp)}−${fmtHM(r.reductionWithRest)} = ${fmtHM(p.maxFdp)} → on-blocks ช้าสุด ${fmtDT(p.latestOnBlocks)} → ${p.margin >= 0 ? `เผื่อ ${fmtHM(p.margin)} ✅` : `เกิน ${fmtHM(-p.margin)} ❌`}</p>`);
    }
    r.warnings.forEach((w) => lines.push(`<p class="warn-t">⚠️ ${esc(w)}</p>`));
    lines.push(`<p class="muted-t">${RULES.standby.ref}</p>`);
    out.innerHTML = lines.join('');
  });
}

// ---------------------------------------------------------------------
//  Update loop
// ---------------------------------------------------------------------

function update() {
  result = computeAll(engineInput());
  showValidation();
  renderReports();
  renderDelays();
  renderResults();
  renderPlanner();
  saveState();
}

function calculate(view) {
  state.calculated = true;
  update();
  if (!result.errors.length) showView(view);
  else {
    showView('input');
    const first = $('#sectorList .invalid') || $('#globalMsgs p');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function resetAll(next) {
  state = { ...freshState(), ...next };
  renderSectors();
  renderStandbyRows();
  $('#delayMode').checked = state.delayMode;
  update();
}

// ---------------------------------------------------------------------
//  Wiring
// ---------------------------------------------------------------------

function init() {
  $('#revLabel').textContent = RULES.revisionLabel;
  $('#bannerClose').addEventListener('click', () => $('#banner').classList.add('hidden'));
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.view !== 'input' && !state.calculated) calculate(t.dataset.view);
    else showView(t.dataset.view);
  }));

  const list = $('#sectorList');
  list.addEventListener('input', onSectorInput);
  list.addEventListener('change', onSectorInput);
  list.addEventListener('click', (e) => {
    const del = e.target.closest('.del');
    if (!del) return;
    const i = Number(del.closest('.sector').dataset.i);
    state.sectors.splice(i, 1);
    if (state.sectors.length) state.sectors[0].newDuty = true;
    state.reportOverrides = {};
    state.delays = {};
    renderSectors();
    update();
  });
  bindAutocomplete(list);

  $('#addSector').addEventListener('click', () => {
    state.sectors.push(blankSector(state.sectors[state.sectors.length - 1]));
    renderSectors();
    update();
    const last = $$('#sectorList .sector').at(-1);
    last.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('[data-k=flightNo]', last).focus({ preventScroll: true });
  });
  $('#clearAll').addEventListener('click', () => {
    if (confirm('ล้าง sector ทั้งหมด?')) resetAll({});
  });
  $('#loadExample').addEventListener('click', () => resetAll(structuredClone(EXAMPLE)));
  $('#clearDraft').addEventListener('click', () => {
    if (!confirm('ล้าง draft ที่บันทึกไว้ในเครื่องนี้?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    resetAll({});
    showView('input');
  });

  $('#reportList').addEventListener('change', (e) => {
    const di = e.target.dataset.report;
    if (di === undefined) return;
    if (e.target.value) state.reportOverrides[di] = e.target.value;
    else delete state.reportOverrides[di];
    update();
  });
  $('#reportList').addEventListener('click', (e) => {
    const di = e.target.dataset.reset;
    if (di === undefined) return;
    delete state.reportOverrides[di];
    $(`[data-report="${di}"]`).value = '';
    update();
  });

  $('#delayMode').checked = state.delayMode;
  $('#delayMode').addEventListener('change', (e) => { state.delayMode = e.target.checked; update(); });
  $('#delayList').addEventListener('change', (e) => {
    const { delay: di, dk } = e.target.dataset;
    if (di === undefined) return;
    state.delays[di] = { ...(state.delays[di] || {}), [dk]: e.target.value };
    update();
  });

  $('#calcBtn').addEventListener('click', () => calculate('result'));
  $('#plannerBtn').addEventListener('click', () => calculate('planner'));

  $('#copyBtn').addEventListener('click', async () => {
    if (!result.duties.length) return;
    const text = summaryText(result);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    $('#copyStatus').textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
    setTimeout(() => { $('#copyStatus').textContent = ''; }, 2500);
  });

  $('#plDuty').addEventListener('change', (e) => {
    state.planner.duty = Number(e.target.value);
    const d = plannerDuty();
    state.planner.cls = String(d?.method2.dutyClass || 1);
    update();
  });
  $('#plClass').addEventListener('change', (e) => { state.planner.cls = e.target.value; update(); });
  $('#plRest').addEventListener('input', (e) => { state.planner.rest = e.target.value; update(); });

  $('#addStandby').addEventListener('click', () => {
    state.standbys.push({ type: 'other', hours: '', night: false, nightHours: '' });
    renderStandbyRows();
    update();
    $$('#sbList [data-sk=hours]').at(-1)?.focus();
  });
  const sbList = $('#sbList');
  const onSb = (e) => {
    const k = e.target.dataset.sk;
    if (!k) return;
    const i = Number(e.target.closest('[data-sb]').dataset.sb);
    state.standbys[i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'type' || k === 'night') renderStandbyRows();
    update();
  };
  sbList.addEventListener('input', (e) => { if (e.target.matches('input[data-sk]:not([type=checkbox])')) onSb(e); });
  sbList.addEventListener('change', (e) => { if (e.target.matches('select, [type=checkbox]')) onSb(e); });
  sbList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sbdel]');
    if (!b) return;
    state.standbys.splice(Number(b.dataset.sbdel), 1);
    renderStandbyRows();
    update();
  });

  renderSectors();
  renderStandbyRows();
  update();
  showView(state.calculated ? state.view || 'input' : 'input');
}

init();
