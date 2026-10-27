// 초상이 없는 변형(…SR·AltSR)은 같은 캐릭터의 다른 변형 그림으로 대신한다(진SR → 진, 스파이크AltSR → 스파이크AltR). 폰 캐시에 그 그림이 들어오면 build_portraits 가 채운다.
function portraitAlts(key) { const a = []; if (/AltSR$/.test(key)) a.push(key.replace(/AltSR$/, 'AltR'), key.replace(/AltSR$/, 'R')); if (/SR$/.test(key)) a.push(key.replace(/SR$/, '')); if (/SR\d$/.test(key)) a.push(key.replace(/SR\d$/, 'R'), key.replace(/AltSR\d$/, 'R')); return [...new Set(a.filter((x) => x && x !== key))]; }
window.portraitErr = (img) => { const alts = (img.dataset.alt || '').split(',').filter(Boolean); if (alts.length) { img.dataset.alt = alts.slice(1).join(','); img.src = PARA_IMG + alts[0] + '.jpg'; } else img.style.visibility = 'hidden'; };
// 유적 시뮬 페이지 — 게임 원본 표(PARA_RAW)와 리플레이·편성(PARA_SIM)을 읽는다(위치는 src.js)
import { makeEngine } from './engine/battle.js';
import { progressOf, seedsFor } from './engine/ruins.js';

const RAW = PARA_RAW, SIM = PARA_SIM, DATA = PARA_DATA; // src.js
const $ = (id) => document.getElementById(id);
const getJ = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const fmtPct = (x) => (100 * x).toFixed(x < 0.01 && x > 0 ? 2 : 1) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let E, D, CH, EN, EP, idx;
let cfg = null, fp = null, curOrder = [], proposed = null, view = 'cur', edited = null, sel = -1, results = [], running = false;

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
  [CH, EN, EP, idx] = await Promise.all([getJ(DATA + 'characters.json'), getJ(DATA + 'enemies.json'), getJ(DATA + 'enemy_portrait.json'), getJ(SIM + 'replays/index.json')]);
  $('floor').innerHTML = idx.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');
  $('floor').onchange = () => load(+$('floor').value);
  $('b-cur').onclick = () => setView('cur');
  $('b-pro').onclick = () => setView('pro');
  $('b-run').onclick = () => runAll();
  await load(0);
}

async function load(i) {
  const r = idx[i];
  const rep = (await getJ(SIM + 'replays/' + r.file + '.json')).Replay; cfg = rep.Config; fp = rep.FinalPacketData;
  curOrder = cfg.P1Mobs.map((_, k) => k);
  let warn = '';
  try {
    const f = await getJ(SIM + 'formation_' + r.file + '.json'); proposed = mapProposal(f.proposed);
    const v = f.verify; if (v && v.proposed.win < v.current.win) warn = ` ★ 제안 편성은 평균 처치는 늘지만 승률은 지금 편성이 더 높습니다(${fmtPct(v.current.win)} > ${fmtPct(v.proposed.win)}) — 깰 때까지 반복한다면 지금 편성 유지.`;
    else if (f.objective === 'win') warn = ' · 제안 편성은 승률 기준으로 찾은 것입니다.';
  } catch { proposed = null; }
  $('b-pro').disabled = !proposed;
  $('b-pro').textContent = warn.includes('★') ? '처치 기준 편성(참고)' : '제안 편성';
  LABEL.pro = $('b-pro').textContent;
  edited = null; results = []; sel = -1; view = 'cur';
  renderEnemies(); setView('cur'); renderResults();
  $('status').textContent = '';
  $('fmeta').textContent = floorMeta(r, cfg) + warn;
}
// 유적 적 배율 = 층 기본값 × 0.925^max(0, 통솔 − 권장 − 5) (2026-10-20 · 차 4·5·6·8 관측 · 차 4 는 할인·불이익 없음)
function floorMeta(r, c) {
  if (r.rank == null || r.recRank == null) return '';
  const d = r.rank - r.recRank, sc = c.Team2FinalBaseStatScalar;
  const disc = d > 5 ? `통솔 할인 적 능력치 −${((1 - 0.925 ** (d - 5)) * 100).toFixed(1)}%` : d === 5 ? '통솔 할인 없음 (통솔 1 더 오르면 −7.5%)' : `통솔 할인 없음 (권장 +5 까지 ${5 - d} 모자람 · 불이익은 없음)`;
  return `통솔 ${r.rank} · 권장 ${r.recRank} · 차 +${d} → ${disc} · 적 배율 ${+sc.toFixed(2)} (층 기본값 ${+(sc / 0.925 ** Math.max(0, d - 5)).toFixed(2)})`;
}
// 제안(ModelType 목록)을 인덱스 순서로 — 같은 종류가 둘이면 앞에서부터
function mapProposal(list) {
  const used = new Set(); const out = [];
  for (const mt of list) { const k = cfg.P1Mobs.findIndex((m, j) => m.ModelType === mt && !used.has(j)); if (k < 0) return null; used.add(k); out.push(k); }
  return out.length === cfg.P1Mobs.length ? out : null;
}
const orderOf = (v) => (v === 'pro' ? proposed : v === 'edit' ? edited : curOrder);
function setView(v) { view = v; sel = -1; $('b-cur').classList.toggle('on', v === 'cur'); $('b-pro').classList.toggle('on', v === 'pro'); renderPlatoons(); }

function unitInfo(mi) {
  const c = CH[mi.ModelType] || {};
  const st = E.Battle && levelOf(mi);
  return { name: c.name || mi.ModelType, title: c.title || '', el: c.element || D.monsters[mi.ModelType]?.Element, rar: c.rarity || D.monsters[mi.ModelType]?.Rarity, lv: st };
}
function levelOf(mi) { const b = new E.Battle(1); const l = E.lineupFromConfig(cfg, 1); const t = b.setup({ ...l, mobs: [mi] }); return t.reinf[0].level; }
function renderPlatoons() {
  const ord = orderOf(view); const base = curOrder;
  const rows = [];
  for (let p = 0; p < Math.ceil(ord.length / 6); p++) {
    const cells = ord.slice(p * 6, p * 6 + 6).map((k, j) => {
      const pos = p * 6 + j; const mi = cfg.P1Mobs[k]; const u = unitInfo(mi);
      const moved = base[pos] !== k;
      const stars = '★'.repeat(mi.Awakening || 0);
      return `<button class="card ${u.rar} ${u.el} ${pos === sel ? 'sel' : ''} ${moved ? 'moved' : ''}" data-pos="${pos}" title="${esc(u.name)}${u.title ? ' · ' + esc(u.title) : ''} · ${u.rar} Lv${u.lv}${moved ? ' · 원래 ' + (base.indexOf(k) + 1) + '번' : ''}">
        <img src="${PARA_IMG}${mi.ModelType}.jpg" alt="" loading="lazy" data-alt="${portraitAlts(mi.ModelType).join(',')}" onerror="portraitErr(this)">
        <span class="rar">${u.rar}</span><span class="el"></span><span class="n">${esc(u.name)}</span>
        ${stars ? `<span class="st">${stars}</span>` : ''}<span class="lv">Lv.${u.lv}${moved ? ' ←' + (base.indexOf(k) + 1) : ''}</span></button>`;
    }).join('');
    rows.push(`<div class="plt-row"><b>${p + 1}반</b>${cells}</div>`);
  }
  $('plt').innerHTML = rows.join('');
  for (const el of $('plt').querySelectorAll('.card')) el.onclick = () => pick(+el.dataset.pos);
}
function pick(pos) {
  if (sel < 0) { sel = pos; renderPlatoons(); return; }
  if (sel === pos) { sel = -1; renderPlatoons(); return; }
  const ord = orderOf(view).slice(); [ord[sel], ord[pos]] = [ord[pos], ord[sel]];
  edited = ord; view = 'edit'; sel = -1;
  $('b-cur').classList.remove('on'); $('b-pro').classList.remove('on');
  renderPlatoons();
}

// 적 패시브 한국어 표기 — 게임 HUD 문구(아이콘 + 복수/스킨/유언) 그대로, 없으면 이름에서
const ICON_KO = { Poison: '독', Sleep: '수면', Stun: '스턴', Turn: '턴' };
const PAS_KO = { OnHitPoisonChanceBoss: '공격 시 독', OnHitSleepChanceBoss: '공격 시 수면', OnHitStunChanceBoss: '공격 시 스턴', PoisonEntry: '등장 시 독', SleepEntryBoss: '등장 시 수면', StunEntryBoss: '등장 시 스턴' };
function passiveKo(key) {
  for (const e of Object.values(EN)) for (const p of e.passives || []) if (p.key === key && p.hud) {
    const ic = (p.hud.match(/Icon_([A-Za-z]+)_/) || [])[1]; return (ICON_KO[ic] ? ICON_KO[ic] + ' ' : '') + p.hud.replace(/<[^>]+>/g, '');
  }
  return PAS_KO[key] || key;
}
function renderEnemies() {
  const b = new E.Battle(1); const t = b.setup(E.lineupFromConfig(cfg, 2));
  $('en').innerHTML = t.reinf.map((m, i) => {
    b.applyPassives(m); b.runBSA();
    const e = EN[m.mi.ModelType] || {}; const img = EP[m.mi.ModelType];
    const pas = (m.buffs || []).map((x) => x.buff._name).filter((n) => !/BossBulk|DeathTrap/.test(n)).map(passiveKo);
    return `<div class="u ${m.mon.Element}"><img src="${PARA_IMG}${img}.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="t"><span class="n">${i + 1}. ${esc(e.name || m.mi.ModelType)} <span style="color:var(--faint);font-weight:400">${m.mi.ModelType.slice(-1)}</span></span>
      <span class="s">HP ${(m.maxHp / 1e6).toFixed(2)}M · 공 ${(m.atk / 1e3).toFixed(0)}K${pas.length ? ' · ' + esc(pas.join(', ')) : ''}</span></span></div>`;
  }).join('');
}

let LABEL = { cur: '현재 편성', pro: '제안 편성', edit: '직접 바꾼 편성' };
async function runAll() {
  if (running) return; running = true; $('b-run').disabled = true;
  const N = +$('nsim').value; const seeds = seedsFor(N, 4242);
  const which = ['cur']; if (proposed) which.push('pro'); if (edited) which.push('edit');
  results = [];
  const total = which.length * N; let done = 0; const t0 = performance.now();
  for (const v of which) {
    const mobs = orderOf(v).map((k) => cfg.P1Mobs[k]);
    const r = { v, n: 0, wins: 0, prog: 0, kills: 0, hist: {} };
    for (let i = 0; i < N; i++) {
      const l1 = E.lineupFromConfig(cfg, 1); l1.mobs = mobs; l1.id = 'P1';
      const b = E.run(seeds[i], l1, E.lineupFromConfig(cfg, 2));
      const k = b.teams[1].dead.length, w = b.winner === 'P1';
      r.n++; r.wins += w; r.prog += progressOf(b); r.kills += k; const key = w ? 'W' : k; r.hist[key] = (r.hist[key] || 0) + 1;
      if (++done % 50 === 0) { $('pbar').style.width = (100 * done / total).toFixed(1) + '%'; $('status').textContent = `${done}/${total}판`; await new Promise((res) => setTimeout(res)); }
    }
    results.push(r); renderResults();
  }
  $('pbar').style.width = '100%';
  $('status').textContent = `${total}판 · ${((performance.now() - t0) / 1000).toFixed(1)}초`;
  running = false; $('b-run').disabled = false;
}
function renderResults() {
  if (!results.length) { $('res').innerHTML = '<p class="note">«굴리기» 를 누르면 현재·제안(·직접 바꾼) 편성을 같은 시드로 굴립니다.</p>'; return; }
  const n2 = cfg.P2Mobs.length;
  const realK = n2 - (fp.WinnerReinforcementCount ?? 0) - fp.WinnerActiveMonsters.filter(Boolean).length;
  const maxH = Math.max(...results.flatMap((r) => Object.values(r.hist)));
  $('res').innerHTML = results.map((r) => {
    const keys = [...Array(n2).keys(), 'W'];
    const bars = keys.map((k) => `<i class="${k === 'W' ? 'win' : ''}" style="height:${(100 * (r.hist[k] || 0) / maxH).toFixed(1)}%" title="${k === 'W' ? '승리' : k + '명 처치'} ${r.hist[k] || 0}판"></i>`).join('');
    const labs = keys.map((k) => `<span>${k === 'W' ? '승' : k}</span>`).join('');
    return `<div class="rc"><h3>${LABEL[r.v]}</h3><div class="figs">
      <div class="fig"><b>${fmtPct(r.wins / r.n)}</b><span>승률 · ${r.n.toLocaleString()}판 중 ${r.wins}승</span></div>
      <div class="fig"><b>${(r.kills / r.n).toFixed(2)}</b><span>평균 처치 / ${n2}</span></div>
      <div class="fig"><b>${(r.prog / r.n).toFixed(2)}</b><span>진척도</span></div></div>
      <div class="hist">${bars}</div><div class="hlab">${labs}</div>
      ${r.wins === 0 ? `<p class="note" style="margin-top:8px">${r.n.toLocaleString()}판 동안 한 번도 못 이겼습니다. 불가능하다는 뜻은 아니고, 실제 승률이 대략 ${(300 / r.n).toFixed(r.n >= 1000 ? 2 : 1)}% 보다 낮다는 뜻입니다(판 수를 늘리면 더 정확).</p>` : ''}
      ${r.v === 'cur' ? `<p class="note" style="margin-top:8px">실제 도전 결과: ${realK}명 처치 후 패배</p>` : ''}</div>`;
  }).join('');
}

boot();
