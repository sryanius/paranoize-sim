// 투기장 덱 순서 최적화 — 내 24명의 순서 하나로 여러 상대(공격·방어 양쪽)를 함께 본다.
//   node tools/arena_formation.mjs base [시드=1000]            지금 순서의 상대별 승률
//   node tools/arena_formation.mjs search [시드=200] [검증=2000]  언덕 오르기(끼워 넣기) → data/arena_formation_main.json
// 상대 덱은 기록(data/replays/arena_main_*.json)의 것을 그대로, 내 덱은 가장 최근 유적 도전(본계정)의 수치로 바꿔 넣는다(성장 반영).
import { makeEngine } from '../site/engine/battle.js';
import { seedsFor } from '../site/engine/ruins.js';
import { J, myUid, loadData } from './lib/paradata.mjs';
import { readdirSync, writeFileSync } from 'node:fs';
const ME = myUid();
const D = loadData(); const E = makeEngine(D);
// 상대별 대표 기록 하나(같은 상대·같은 쪽이면 덱이 같다 — 확인함)
const MATCH = [
  // w = 점수 무게(더그가 목표 · 나머지는 지키기용) · n = 탐색 시드 배율(검증은 모두 같은 수)
  { key: '더그 · 내가 공격', file: 'arena_main_03', w: 1, n: 1.5 },
  { key: '더그 · 더그가 공격', file: 'arena_main_00', w: 1, n: 1.5 },
  { key: '짜냥해야 · 내가 공격', file: 'arena_main_04', w: 0.3, n: 1 },
  { key: '리세 · 리세가 공격', file: 'arena_main_10', w: 0.3, n: 0.25 },
  { key: '차차 · 차차가 공격', file: 'arena_main_12', w: 0.3, n: 0.25 },
  { key: 'FullFerry · 공격해 옴', file: 'arena_main_01', w: 0.3, n: 0.25 },
  { key: '너의친한친구 · 공격해 옴', file: 'arena_main_02', w: 0.3, n: 0.25 },
];
const latest = readdirSync(new URL('../data/replays/', import.meta.url)).filter((f) => /^floor\d+_main_/.test(f)).sort().pop();
const fresh = J('data/replays/' + latest).Replay.Config.P1Mobs;
for (const m of MATCH) {
  const c = J('data/replays/' + m.file + '.json').Replay.Config;
  m.side = c.P1 === ME ? 1 : 2; m.cfg = c;
  m.mine = c[`P${m.side}Mobs`].map((x) => fresh.find((y) => y.ModelType === x.ModelType) || x);
}
const base = MATCH[0].mine; // 순서의 기준(공격 기록의 순서 = 방어와 같음)
const names = base.map((m) => m.ModelType);
function evalOne(m, ord, seeds) {
  const mobs = ord.map((i) => m.mine.find((x) => x.ModelType === names[i]));
  const lMe = E.lineupFromConfig(m.cfg, m.side), lOp = E.lineupFromConfig(m.cfg, 3 - m.side);
  let w = 0;
  for (const s of seeds) {
    const a = { ...lMe, mobs, id: 'ME' }, o = { ...lOp, mobs: lOp.mobs, id: 'OP' };
    const b = m.side === 1 ? E.run(s, a, o) : E.run(s, o, a);
    if (b.winner === 'ME') w++;
  }
  return w / seeds.length;
}
const evalAll = (ord, seeds, scaled = false) => MATCH.map((m) => evalOne(m, ord, scaled ? seeds.slice(0, Math.max(30, Math.round(seeds.length * m.n / 1.5))) : seeds));
const score = (rs) => rs.reduce((t, r, i) => t + MATCH[i].w * r, 0);
const fmt = (rs) => rs.map((r, i) => `${MATCH[i].key} ${(100 * r).toFixed(1)}%`).join(' · ');
const cmd = process.argv[2] || 'base';
const keepArg = process.argv.find((a) => a.startsWith('--keep='));
const KEEP = keepArg ? { p: +keepArg.slice(7).split(':')[0] - 1, set: new Set(keepArg.split(':')[1].split(',')) } : null;
const okKeep = (ord) => !KEEP || ord.slice(KEEP.p * 6, KEEP.p * 6 + 6).every((i) => KEEP.set.has(names[i]));
const OUT = KEEP ? 'arena_formation_main_keep.json' : 'arena_formation_main.json';
const cur0 = names.map((_, i) => i);
if (cmd === 'eval') {
  // node tools/arena_formation.mjs eval <ModelType,…24명 순서> [시드=2000] — 그 순서와 지금·추천 순서를 같은 시드로 비교
  const want = process.argv[3].split(','); const ord = want.map((t) => names.indexOf(t));
  if (ord.some((i) => i < 0) || new Set(ord).size !== 24) { console.error('24명이 지금 덱과 같아야 한다'); process.exit(1); }
  const vs = seedsFor(+process.argv[4] || 2000, 4242);
  let rec = null; try { rec = J('data/arena_formation_main.json').proposed.map((t) => names.indexOf(t)); } catch { /* 없음 */ }
  const rows = [['지금', cur0], ...(rec ? [['추천', rec]] : []), ['평가할 순서', ord]].map(([l, o]) => [l, evalAll(o, vs)]);
  console.log('상대'.padEnd(24), rows.map(([l]) => l.padStart(10)).join(''));
  MATCH.forEach((m, i) => console.log(m.key.padEnd(24), rows.map(([, r]) => ((100 * r[i]).toFixed(2) + '%').padStart(10)).join('')));
} else if (cmd === 'base') {
  const t0 = Date.now(); const rs = evalAll(cur0, seedsFor(+process.argv[3] || 1000, 4242));
  console.log('지금 순서(내 덱 = ' + latest + ' 수치):'); rs.forEach((r, i) => console.log('  ', MATCH[i].key.padEnd(22), (100 * r).toFixed(2) + '%'));
  console.log('  걸린 시간', ((Date.now() - t0) / 1000).toFixed(0) + 's');
} else {
  const N = +process.argv[3] || 200, NV = +process.argv[4] || 2000;
  const seeds = seedsFor(N, 777), vseeds = seedsFor(NV, 4242); // 탐색: 더그 N개 · 짜냥 N/1.5 · 나머지 N/6
  if (!okKeep(cur0)) { console.error('지금 순서가 --keep 조건(그 반에 그 6명)을 만족하지 않는다'); process.exit(1); }
  let cur = cur0.slice(), curR = evalAll(cur, seeds, true), curS = score(curR); const t0 = Date.now();
  console.log('시작:', fmt(curR));
  for (let sweep = 0; sweep < 3; sweep++) {
    let improved = false;
    for (let i = 0; i < 24; i++) for (let j = 0; j < 12; j++) {
      if (i === j) continue;
      const ord = cur.slice(); const [x] = ord.splice(i, 1); ord.splice(j, 0, x);
      if (!okKeep(ord)) continue;
      const r = evalAll(ord, seeds, true), s = score(r);
      if (s > curS + 1e-9) { cur = ord; curR = r; curS = s; improved = true; }
    }
    if (KEEP) for (let a = KEEP.p * 6; a < KEEP.p * 6 + 6; a++) for (let b2 = a + 1; b2 < KEEP.p * 6 + 6; b2++) {
      const ord = cur.slice(); [ord[a], ord[b2]] = [ord[b2], ord[a]];
      const r = evalAll(ord, seeds, true), s = score(r);
      if (s > curS + 1e-9) { cur = ord; curR = r; curS = s; improved = true; }
    }
    console.log(`  ${sweep + 1}회차 (${((Date.now() - t0) / 1000).toFixed(0)}s):`, fmt(curR));
    if (!improved) break;
  }
  const v0 = evalAll(cur0, vseeds), v1 = evalAll(cur, vseeds);
  console.log(`검증(시드 ${NV}):`); MATCH.forEach((m, i) => console.log('  ', m.key.padEnd(22), (100 * v0[i]).toFixed(2) + '% →', (100 * v1[i]).toFixed(2) + '%'));
  console.log('제안:', cur.map((i) => names[i]).join(' '));
  writeFileSync(new URL('../data/' + OUT, import.meta.url), JSON.stringify({ deckFrom: latest, keep: KEEP ? { platoon: KEEP.p + 1, members: [...KEEP.set] } : null, current: names, proposed: cur.map((i) => names[i]), verify: { seeds: NV, matches: MATCH.map((m, i) => ({ key: m.key, file: m.file, current: v0[i], proposed: v1[i] })) } }, null, 1));
}
