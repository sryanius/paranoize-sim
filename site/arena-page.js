// 투기장 덱 페이지 — 게임 원본 표(PARA_RAW)와 투기장 기록·arena_formation_main.json(PARA_SIM)을 읽는다(위치는 src.js).
// 상대 덱 = 투기장 기록의 것 그대로 · 내 덱 = 기록의 24명을 최근 유적 도전 수치로 바꿔 넣은 것(tools/arena_formation.mjs 와 같은 규칙).
function portraitAlts(key) { const a = []; if (/AltSR$/.test(key)) a.push(key.replace(/AltSR$/, 'AltR'), key.replace(/AltSR$/, 'R')); if (/SR$/.test(key)) a.push(key.replace(/SR$/, '')); if (/SR\d$/.test(key)) a.push(key.replace(/SR\d$/, 'R'), key.replace(/AltSR\d$/, 'R')); return [...new Set(a.filter((x) => x && x !== key))]; }
window.portraitErr = (img) => { const alts = (img.dataset.alt || '').split(',').filter(Boolean); if (alts.length) { img.dataset.alt = alts.slice(1).join(','); img.src = PARA_IMG + alts[0] + '.jpg'; } else img.style.visibility = 'hidden'; };
import { makeEngine } from './engine/battle.js';
import { seedsFor } from './engine/ruins.js';

const RAW = PARA_RAW, SIM = PARA_SIM, DATA = PARA_DATA; // src.js
const $ = (id) => document.getElementById(id);
const getJ = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (100 * x).toFixed(1) + '%';

let E, D, CH, AF, fresh;
const records = {};
let M = null; // 고른 상대: { key, file, cfg, side, mine, opp }
let view = 'cur', edited = null, sel = -1, results = [], running = false;

async function boot() {
  $('status').textContent = '자료 읽는 중…';
  const names = ['Monster', 'PostCard', 'Accessory', 'SubAccessory', 'Spirit', 'BattleStatPresets', 'Ability', 'AbilityAI', 'AbilityComponent', 'AbilityConfig', 'BattleTargeting', 'Buff', 'BuffComponent', 'MonsterConditions'];
  let raw;
  try { raw = await Promise.all(names.map((n) => getJ(RAW + n + '.json'))); }
  catch (e) { $('status').textContent = '게임 원본 자료를 못 읽었습니다.'; return; }
  const [monsters, postcards, accessories, subaccessories, spirits, presets, abilities, abilityAI, abilityComponents, abilityConfigs, targeting, buffs, buffComponents, conditions] = raw;
  const tables = await getJ(SIM + 'tables.json');
  D = { monsters, postcards, accessories, subaccessories, spirits, presets, tables, abilities, abilityAI, abilityComponents, abilityConfigs, targeting, buffs, buffComponents, conditions };
  E = makeEngine(D);
  try { [CH, AF] = await Promise.all([getJ(DATA + 'characters.json'), getJ(SIM + 'arena_formation_main.json')]); }
  catch (e) { $('status').textContent = '추천 덱 자료(data/arena_formation_main.json)가 아직 없습니다. node tools/arena_formation.mjs search 를 먼저 돌리세요.'; return; }
  fresh = (await getJ(SIM + (AF.deckPath || 'replays/' + AF.deckFrom))).Replay.Config.P1Mobs; // arena_opt: deckPath(읽어 온 최신 덱) · 옛 arena_formation: deckFrom(유적 리플레이)
  await loadRecords();
  $('match').innerHTML = AF.verify.matches.map((m, i) => `<option value="${i}">${esc(m.key)}</option>`).join('');
  $('match').onchange = () => load(+$('match').value);
  $('b-cur').onclick = () => setView('cur');
  $('b-pro').onclick = () => setView('pro');
  $('b-run').onclick = () => runAll();
  if (AF.fixed) $('fixnote').textContent = `야망용으로 ${AF.fixed.platoon}반(${AF.fixed.members.map((t) => CH[t]?.name || t).join('·')})은 멤버·순서를 고정하고 나머지 18자리만 바꿨습니다.`;
  renderTable(0);
  await load(0);
}

// 실제 기록: 같은 상대·같은 쪽(공격/방어)의 승패 — arena_main_NN 을 없는 번호가 나올 때까지 읽는다
async function loadRecords() {
  for (let i = 0; i < 100; i++) {
    let r; try { r = (await getJ(SIM + 'replays/arena_main_' + String(i).padStart(2, '0') + '.json')).Replay; } catch { break; }
    const c = r.Config, side = sideOf(c), op = c[`P${3 - side}`];
    const k = op + '|' + side; records[k] = records[k] || { w: 0, n: 0 }; records[k].n++;
    if (r.Winner === c[`P${side}`]) records[k].w++;
  }
  // 표에 미리 붙여 둔다
  for (const m of AF.verify.matches) {
    try { const c = (await getJ(cfgUrl(m))).Replay.Config; const s = sideOf(c); m.rec = m.path ? null : records[c[`P${3 - s}`] + '|' + s]; } catch { /* 없음 */ }
  }
}
// 상대 설정: 실제 기록(m.file = replays/arena_main_NN) 또는 합성 설정(m.path — 예: 내가 더그를 공격하는 기록이 없어 만든 것)
const cfgUrl = (m) => (m.path ? SIM + m.path : SIM + 'replays/' + m.file + '.json');
function sideOf(c) { const s = new Set(AF.current); return c.P1Mobs.every((m) => s.has(m.ModelType)) ? 1 : 2; }

function renderTable(on) {
  const rows = AF.verify.matches.map((m, i) => {
    const d = m.proposed - m.current; const cls = d > 0.01 ? 'up' : d < -0.01 ? 'down' : '';
    const rec = m.rec ? `${m.rec.w}승 ${m.rec.n - m.rec.w}패` : '';
    return `<tr data-i="${i}" class="${i === on ? 'on' : ''}"><td>${esc(m.key)}</td><td class="num">${pct(m.current)}</td><td class="num"><b>${pct(m.proposed)}</b></td><td class="num ${cls}">${d >= 0 ? '+' : ''}${(100 * d).toFixed(1)}%p</td><td class="num">${rec}</td></tr>`;
  }).join('');
  $('mt').innerHTML = `<tr><th>상대</th><th style="text-align:right">현재 덱</th><th style="text-align:right">추천 덱</th><th style="text-align:right">차이</th><th style="text-align:right">실제 기록</th></tr>` + rows;
  for (const tr of $('mt').querySelectorAll('tr[data-i]')) tr.onclick = () => { $('match').value = tr.dataset.i; load(+tr.dataset.i); };
}

async function load(i) {
  const m = AF.verify.matches[i];
  const cfg = (await getJ(cfgUrl(m))).Replay.Config;
  const side = sideOf(cfg);
  const mine = cfg[`P${side}Mobs`].map((x) => fresh.find((y) => y.ModelType === x.ModelType) || x);
  M = { ...m, i, cfg, side, mine, opp: cfg[`P${3 - side}Mobs`] };
  const op = 3 - side; const rk = m.rec;
  renderTable(i);
  $('opp-head').innerHTML = `<b>${esc(cfg[`P${op}Name`] || '')}</b><span>길드 ${esc(cfg[`P${op}GuildName`] || '-')}</span><span>통솔 ${cfg[`Team${op}Rank`]}</span><span>총 전력 ${(cfg[`P${op}TPower`] || 0).toLocaleString()}</span><span>${side === 1 ? '내가 공격' : '상대가 공격해 옴'}</span>${rk ? `<span>실제 ${rk.w}승 ${rk.n - rk.w}패</span>` : ''}`;
  edited = null; results = []; sel = -1;
  renderOpp(); setView(view === 'edit' ? 'cur' : view); renderResults();
  $('status').textContent = '';
}

const lvCache = new Map();
function levelOf(mi, side) {
  const key = JSON.stringify(mi) + side; if (lvCache.has(key)) return lvCache.get(key);
  const b = new E.Battle(1); const l = E.lineupFromConfig(M.cfg, side); const t = b.setup({ ...l, mobs: [mi] });
  const lv = t.reinf[0].level; lvCache.set(key, lv); return lv;
}
// 우리 캐릭터 목록에 없는 새 캐릭터(예: RosaSwim)·그림 없는 변형은 같은 계열(이름 첫 단어가 같은 것)의 이름·그림을 빌린다
const fam = (k) => (k.match(/^[A-Z][a-z]+/) || [k])[0];
const kin = (k) => Object.keys(CH).filter((x) => x !== k && fam(x) === fam(k)).sort((a, b) => (/Reg$/.test(b) - /Reg$/.test(a)) || a.length - b.length);
function card(mi, side, { pos = -1, moved = '', clickable = false } = {}) {
  const c = CH[mi.ModelType] || { name: (CH[kin(mi.ModelType)[0]] || {}).name }; const rar = c.rarity || D.monsters[mi.ModelType]?.Rarity || ''; const el = c.element || D.monsters[mi.ModelType]?.Element || '';
  const stars = '★'.repeat(mi.Awakening || 0); const lv = levelOf(mi, side);
  const tag = clickable ? 'button' : 'div';
  return `<${tag} class="card ${rar} ${el} ${pos === sel && clickable ? 'sel' : ''} ${moved ? 'moved' : ''}" ${clickable ? `data-pos="${pos}"` : ''} title="${esc(c.name || mi.ModelType)}${c.title ? ' · ' + esc(c.title) : ''} · ${rar} Lv${lv}">
    <img src="${PARA_IMG}${mi.ModelType}.jpg" alt="" loading="lazy" data-alt="${[...new Set([...portraitAlts(mi.ModelType), ...kin(mi.ModelType)])].join(',')}" onerror="portraitErr(this)">
    <span class="rar">${rar}</span><span class="el"></span><span class="n">${esc(c.name || mi.ModelType)}</span>
    ${stars ? `<span class="st">${stars}</span>` : ''}<span class="lv">Lv.${lv}${moved}</span></${tag}>`;
}
const rowsOf = (cells) => { const out = []; for (let p = 0; p < Math.ceil(cells.length / 6); p++) out.push(`<div class="plt-row"><b>${p + 1}반</b>${cells.slice(p * 6, p * 6 + 6).join('')}</div>`); return out.join(''); };

const orderOf = (v) => (v === 'pro' ? AF.proposed : v === 'edit' ? edited : AF.current);
function setView(v) {
  view = v; sel = -1;
  $('b-cur').classList.toggle('on', v === 'cur'); $('b-pro').classList.toggle('on', v === 'pro');
  $('my-h').textContent = { cur: '내 덱 — 현재', pro: '내 덱 — 추천', edit: '내 덱 — 직접 바꾼 것' }[v];
  renderMine();
}
function renderMine() {
  const ord = orderOf(view);
  const cells = ord.map((t, pos) => {
    const mi = M.mine.find((x) => x.ModelType === t); const was = AF.current.indexOf(t);
    return card(mi, M.side, { pos, clickable: true, moved: was !== pos ? ' ←' + (was + 1) : '' });
  });
  $('plt').innerHTML = rowsOf(cells);
  for (const el of $('plt').querySelectorAll('.card')) el.onclick = () => pick(+el.dataset.pos);
}
function renderOpp() { $('opp').innerHTML = rowsOf(M.opp.map((mi) => card(mi, 3 - M.side))); }
function pick(pos) {
  if (sel < 0) { sel = pos; renderMine(); return; }
  if (sel === pos) { sel = -1; renderMine(); return; }
  const ord = orderOf(view).slice(); [ord[sel], ord[pos]] = [ord[pos], ord[sel]];
  edited = ord; sel = -1; setView('edit');
}

const LABEL = { cur: '현재 덱', pro: '추천 덱', edit: '직접 바꾼 덱' };
async function runAll() {
  if (running) return; running = true; $('b-run').disabled = true;
  const N = +$('nsim').value; const seeds = seedsFor(N, 4242);
  const which = ['cur', 'pro']; if (edited) which.push('edit');
  results = []; const total = which.length * N; let done = 0; const t0 = performance.now();
  const opIdx = M.side === 1 ? 1 : 0, meIdx = 1 - opIdx;
  for (const v of which) {
    const mobs = orderOf(v).map((t) => M.mine.find((x) => x.ModelType === t));
    const r = { v, n: 0, wins: 0, killed: 0, lost: 0 };
    for (let i = 0; i < N; i++) {
      const a = { ...E.lineupFromConfig(M.cfg, M.side), mobs, id: 'ME' }, o = { ...E.lineupFromConfig(M.cfg, 3 - M.side), id: 'OP' };
      const b = M.side === 1 ? E.run(seeds[i], a, o) : E.run(seeds[i], o, a);
      r.n++; r.wins += b.winner === 'ME'; r.killed += b.teams[opIdx].dead.length; r.lost += b.teams[meIdx].dead.length;
      if (++done % 50 === 0) { $('pbar').style.width = (100 * done / total).toFixed(1) + '%'; $('status').textContent = `${done}/${total}판`; await new Promise((res) => setTimeout(res)); }
    }
    results.push(r); renderResults();
  }
  $('pbar').style.width = '100%'; $('status').textContent = `${total}판 · ${((performance.now() - t0) / 1000).toFixed(1)}초`;
  running = false; $('b-run').disabled = false;
}
function renderResults() {
  if (!results.length) { $('res').innerHTML = '<p class="note">«굴리기» 를 누르면 고른 상대에게 현재·추천(·직접 바꾼) 덱을 같은 시드로 굴립니다.</p>'; return; }
  $('res').innerHTML = results.map((r) => `<div class="rc"><h3>${LABEL[r.v]}</h3><div class="figs">
    <div class="fig"><b>${pct(r.wins / r.n)}</b><span>승률 · ${r.n.toLocaleString()}판 중 ${r.wins}승</span></div>
    <div class="fig"><b>${(r.killed / r.n).toFixed(1)}</b><span>평균 처치 / 24</span></div>
    <div class="fig"><b>${(r.lost / r.n).toFixed(1)}</b><span>평균 잃음 / 24</span></div></div></div>`).join('');
}

boot();
