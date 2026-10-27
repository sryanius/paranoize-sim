// 투기장 덱 순서 최적화(병렬) — 내 24명 순서 하나로 여러 상대(공격·방어)를 함께 본다. 야망용으로 한 반을 통째로 고정할 수 있다.
//   node tools/arena_opt.mjs --deck=raw/api/<시각>_GetPlatoonsRequest.json [--fix=2] [--n=1000] [--nv=4000]
//   --deck: 도전 없이 읽어 온 부대 정보 — 내 캐릭터 수치와 지금 순서(페이지 0 의 1~4반)를 여기서 가져온다.
//   --fix=N: N반 6명을 멤버·순서 그대로 고정(야망은 반 단위로 싸우고 반 안 순서가 승패를 크게 바꾼다 — 2026-10-20 war_duel).
//   --fixset=N: N반 6명(멤버)은 그 반에 묶되 반 안 순서는 바꿔 본다(반 안끼리 · 반 밖끼리만 맞바꿈).
//   --start=<JSON>: 그 파일의 proposed 순서에서 탐색을 시작(«current» 는 여전히 지금 부대 순서) · --out=<data 안 파일 이름>.
//   탐색은 고정 반 밖 자리끼리 맞바꾸기. 결과는 data/arena_formation_main.json(투기장 덱 페이지가 읽는다).
// 상대 목록(MATCH)은 기록이 늘면 손으로 고친다. w = 점수 무게, n = 탐색 판 수 배율(검증은 모두 같은 판 수).
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { J, myUid } from './lib/paradata.mjs';
import { seedsFor } from '../site/engine/ruins.js';

const ME = myUid();
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const deckFile = arg('deck'); if (!deckFile) { console.error('--deck=<GetPlatoons 응답> 이 필요하다'); process.exit(1); }
const FIX = +arg('fix', 0); const FIXSET = +arg('fixset', 0); const N = +arg('n', 1000); const NV = +arg('nv', 4000);
const OUT = arg('out', 'arena_formation_main.json'); const START = arg('start', null);
const pr = J(deckFile).res; const mine = pr.Incidentals.Mobs[ME];
const pl = pr.PlatoonPages['0'].Platoons; const cur0 = Object.keys(pl).sort((a, b) => a - b).slice(0, 4).flatMap((i) => pl[i].Mobs.filter(Boolean));
for (const t of cur0) mine[t] = { ...mine[t], ModelType: t };

// 내가 더그를 공격하는 기록이 없어서 만든다: 내 쪽 = 최근 내 공격 기록의 팀 값 · 더그 쪽 = 더그가 공격해 온 기록의 덱·팀 값(방어 덱 = 공격 덱 가정 — 10-20 기록에선 같았다)
const T = (c, s) => Object.fromEntries(['Rank', 'StatBuffs', 'CampusStatBonus', 'FinalBaseStatScalar', 'PassiveBuffs'].map((k) => [k, c[`Team${s}${k}`]]));
const put = (cfg, s, t) => { for (const [k, v] of Object.entries(t)) cfg[`Team${s}${k}`] = v; };
const myAtk = J('data/replays/arena_main_29.json').Replay.Config; const d24 = J('data/replays/arena_main_24.json').Replay.Config;
const synth = { Seed: 1, P1: ME, P2: d24.P1, P1Name: myAtk.P1Name, P2Name: d24.P1Name, P2GuildName: d24.P1GuildName, P2TPower: d24.P1TPower, P1Mobs: cur0.map((t) => mine[t]), P2Mobs: d24.P1Mobs };
put(synth, 1, T(myAtk, 1)); put(synth, 2, T(d24, 1));
writeFileSync(new URL('../data/arena_synth_main_vs_dough.json', import.meta.url), JSON.stringify({ note: '합성 설정 — 내가 더그를 공격하는 기록이 없어 arena_main_29(내 팀 값)와 arena_main_24(더그 덱·팀 값)로 만든 것. 더그 방어 덱 = 공격 덱 가정.', Replay: { Config: synth } }, null, 1));

const MATCH = [
  { key: '더그가 공격해 옴', file: 'arena_main_24', w: 1, n: 1 },
  { key: '내가 더그 공격(가정)', path: 'arena_synth_main_vs_dough.json', w: 1, n: 1 },
  { key: '리세가 공격해 옴', file: 'arena_main_20', w: 0.3, n: 0.15 },
  { key: 'FullFerry 가 공격해 옴', file: 'arena_main_19', w: 0.3, n: 0.15 },
  { key: '짜냥해야 공격', file: 'arena_main_29', w: 0.1, n: 0.15 },
  { key: '짜냥해야가 공격해 옴', file: 'arena_main_25', w: 0.1, n: 0.15 },
  { key: '마리 공격', file: 'arena_main_28', w: 0, n: 0.15 },
];
for (const m of MATCH) { m.cfg = J(m.path ? 'data/' + m.path : `data/replays/${m.file}.json`).Replay.Config; m.side = m.cfg.P1 === ME ? 1 : 2; }

const threads = Math.max(1, availableParallelism() - 1); const workers = [];
for (let i = 0; i < threads; i++) {
  const w = new Worker(new URL('./lib/arenaworker.mjs', import.meta.url), { workerData: { matches: MATCH.map((m) => ({ cfg: m.cfg, side: m.side })), mine } });
  await new Promise((res, rej) => { w.once('message', (x) => (x === 'ready' ? res() : rej(new Error(String(x))))); w.once('error', rej); });
  workers.push(w);
}
let jid = 0;
const job = (w, mi, ord, seeds) => new Promise((res, rej) => {
  const id = ++jid; const onErr = (e) => { w.off('message', on); rej(e); };
  const on = (x) => { if (x && x.id === id) { w.off('message', on); w.off('error', onErr); res(x.wins); } };
  w.on('message', on); w.once('error', onErr); w.postMessage({ id, mi, ord, seeds });
});
async function winRate(mi, ord, seeds) {
  const k = Math.min(workers.length, seeds.length), size = Math.ceil(seeds.length / k);
  const parts = await Promise.all(workers.slice(0, k).map((w, i) => job(w, mi, ord, seeds.slice(i * size, (i + 1) * size))));
  return parts.reduce((a, b) => a + b, 0) / seeds.length;
}
const sSearch = MATCH.map((m) => seedsFor(Math.max(60, Math.round(N * m.n)), 777)), sVerify = seedsFor(NV, 4242);
const evalAll = async (ord, verify = false) => { const out = []; for (let i = 0; i < MATCH.length; i++) out.push(verify || MATCH[i].w > 0 ? await winRate(i, ord, verify ? sVerify : sSearch[i]) : null); return out; };
const score = (rs) => rs.reduce((t, r, i) => t + (r == null ? 0 : MATCH[i].w * r), 0);
const fmt = (rs) => rs.map((r, i) => (r == null ? null : `${MATCH[i].key} ${(100 * r).toFixed(1)}%`)).filter(Boolean).join(' · ');

const blockOf = (P) => new Set([...Array(6).keys()].map((k) => (P - 1) * 6 + k));
const fixed = FIX ? blockOf(FIX) : new Set(); const grp = FIXSET ? blockOf(FIXSET) : null;
const free = [...Array(24).keys()].filter((p) => !fixed.has(p));
const okPair = (p, q) => !grp || grp.has(p) === grp.has(q); // --fixset: 반 안끼리 · 반 밖끼리만
let cur = START ? J('data/' + START).proposed.slice() : cur0.slice();
let curR = await evalAll(cur), curS = score(curR); const t0 = Date.now();
console.log(`일꾼 ${threads}개 · 고정 ${FIX ? FIX + '반(' + cur0.slice((FIX - 1) * 6, FIX * 6).join(' ') + ')' : FIXSET ? FIXSET + '반 멤버(안 순서는 탐색)' : '없음'}${START ? ' · 시작 ' + START : ''}`);
console.log('시작:', fmt(curR));
for (let sweep = 0; sweep < 3; sweep++) {
  let improved = false;
  for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) {
    if (!okPair(free[a], free[b])) continue;
    const ord = cur.slice(); [ord[free[a]], ord[free[b]]] = [ord[free[b]], ord[free[a]]];
    const r = await evalAll(ord), s = score(r);
    if (s > curS + 1e-9) { cur = ord; curR = r; curS = s; improved = true; }
  }
  console.log(`  ${sweep + 1}회차 (${((Date.now() - t0) / 1000).toFixed(0)}s):`, fmt(curR));
  if (!improved) break;
}
const v0 = await evalAll(cur0, true), v1 = await evalAll(cur, true);
console.log(`검증(각 ${NV}판):`); MATCH.forEach((m, i) => console.log('  ', m.key.padEnd(22), (100 * v0[i]).toFixed(1) + '% →', (100 * v1[i]).toFixed(1) + '%'));
console.log('제안:', cur.join(' '));
await Promise.all(workers.map((w) => w.terminate()));
writeFileSync(new URL('../data/arena_deck_main.json', import.meta.url), JSON.stringify({ from: deckFile, Replay: { Config: { P1Mobs: cur0.map((t) => mine[t]) } } }, null, 1));
writeFileSync(new URL('../data/' + OUT, import.meta.url), JSON.stringify({
  deckPath: 'arena_deck_main.json', fixed: FIX ? { platoon: FIX, members: cur.slice((FIX - 1) * 6, FIX * 6) } : null, fixedSet: FIXSET ? { platoon: FIXSET } : null, start: START, current: cur0, proposed: cur,
  verify: { seeds: NV, matches: MATCH.map((m, i) => ({ key: m.key, file: m.file, path: m.path, weight: m.w, current: v0[i], proposed: v1[i] })) },
}, null, 1));
