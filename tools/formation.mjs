// 유적 편성(출동 순서) 최적화 — 같은 시드 묶음으로 후보를 비교하는 언덕 오르기.
//   node tools/formation.mjs <리플레이 이름> [시드 수] [검증 시드 수] [--win | --progress] [--threads=N] [--plan(정하기만 하고 끝)]
// ★ 목표는 승리다(제작자: «승리하는 게 중요하지 처치 수는 중요하지 않다»). 기본(자동): 지금 순서를 2000판 굴려
//   이긴 판이 3번 이상이면 승률 기준 — 후보당 1000판(제작자: «조합당 1만 판은 과하다, 천 판 정도에서 멈추자»), 검증 3000판.
//   승률이 0.5% 아래면 1000판에 승리가 5번도 안 돼 운을 쫓을 수 있다 → 검증에서 지금 순서보다 낫지 않으면 «지금 순서 유지»(winWorse).
//   한 번도 못 이기면 승리로는 비교가 안 되니 처치(진척) 기준으로 찾고 결과에 «참고용»(objective: progress)을 남긴다.
// 기본은 코어 수−1 개 일꾼으로 시드를 나눠 굴린다(tools/lib/simpool.mjs — 결과는 한 코어와 같다). --threads=1 이면 한 코어.
// 순서 = 증원 순서(1반 6명 → 2반 → …). 바꾸는 것은 출동 24명의 순서뿐(보유 전체는 아직 자료 없음).
import { makeEngine } from '../site/engine/battle.js';
import { simulate, seedsFor } from '../site/engine/ruins.js';
import { J, loadData } from './lib/paradata.mjs';
import { writeFileSync } from 'node:fs';
import { makePool } from './lib/simpool.mjs';
const name = process.argv[2] || 'floor137_sub_lose';
const pos = process.argv.slice(3).filter((a) => !a.startsWith('--'));
let N = +pos[0] || 200, NV = +pos[1] || 2000;
const D = loadData(); const E = makeEngine(D);
const cfg = J('data/replays/' + name + '.json').Replay.Config;
const base = cfg.P1Mobs;
let seeds, vseeds;
// 기본 점수는 진척(평균 처치에 가까움) — 승률이 0.1% 대인 층에서는 승리가 거의 안 나와 이것밖에 못 쓴다.
// --win: 승률만 본다(동점이면 진척). «깰 때까지 반복» 용. 승률이 1% 이상인 층에서 시드 1000 이상으로 쓸 것.
let WIN = process.argv.includes('--win');
const FORCE_PROGRESS = process.argv.includes('--progress');
const score = (r) => (WIN ? r.winRate + 1e-4 * r.meanProg : r.meanProg + 3 * r.winRate);
const tArg = process.argv.find((a) => a.startsWith('--threads=')); const THREADS = tArg ? +tArg.slice(10) : undefined;
const pool = THREADS === 1 ? null : await makePool(cfg, THREADS ? { threads: THREADS } : {});
const evalOrder = async (ord, sd = seeds) => (pool ? pool.simulate(ord.map((i) => base[i]), sd) : simulate(E, cfg, ord.map((i) => base[i]), { seeds: sd }));
if (!WIN && !FORCE_PROGRESS) {
  const probe = await evalOrder(base.map((_, i) => i), seedsFor(2000, 31337));
  if (probe.wins >= 3) {
    WIN = true;
    N = +pos[0] || 1000;
    NV = Math.max(+pos[1] || 0, 3000);
    console.log(`자동: 지금 순서 2000판 중 ${probe.wins}승 → 승률 기준 · 후보당 ${N}판 · 검증 ${NV}판${probe.winRate < 0.005 ? ' (승률 0.5% 미만 — 검증에서 지금보다 낫지 않으면 지금 순서 유지)' : ''}`);
  } else console.log(`자동: 지금 순서 2000판 중 ${probe.wins}승 — 승리로는 비교가 안 돼 처치 기준으로 찾는다(참고용)`);
}
if (process.argv.includes('--plan')) { if (pool) await pool.close(); process.exit(0); }
seeds = seedsFor(N, 777); vseeds = seedsFor(NV, 4242);
let cur = base.map((_, i) => i); let curR = await evalOrder(cur); let curS = score(curR);
if (pool) console.log(`일꾼 ${pool.threads}개`);
console.log(`현재 순서: 진척 ${curR.meanProg.toFixed(3)} · 처치 ${curR.meanKills.toFixed(2)} · 승률 ${(100 * curR.winRate).toFixed(1)}%`);
const t0 = Date.now();
for (let sweep = 0; sweep < 4; sweep++) {
  let improved = false;
  // 끼워 넣기(한 명을 다른 자리로) — 앞 12자리 위주(앞쪽이 먼저 싸운다)
  for (let i = 0; i < cur.length; i++) for (let j = 0; j < Math.min(cur.length, 12); j++) {
    if (i === j) continue;
    const ord = cur.slice(); const [x] = ord.splice(i, 1); ord.splice(j, 0, x);
    const r = await evalOrder(ord); const s = score(r);
    if (s > curS + 1e-9) { cur = ord; curR = r; curS = s; improved = true; }
  }
  console.log(`  ${sweep + 1}회차: 진척 ${curR.meanProg.toFixed(3)} · 처치 ${curR.meanKills.toFixed(2)} · 승률 ${(100 * curR.winRate).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (!improved) break;
}
// 과적합 확인: 다른 시드 묶음으로 현재 vs 제안
const v0 = await evalOrder(base.map((_, i) => i), vseeds), v1 = await evalOrder(cur, vseeds);
if (pool) await pool.close();
const nm = (i) => base[i].ModelType;
console.log(`검증(시드 ${NV}개, 탐색에 안 쓴 묶음): 현재 진척 ${v0.meanProg.toFixed(3)} 처치 ${v0.meanKills.toFixed(2)} 승률 ${(100 * v0.winRate).toFixed(2)}% → 제안 진척 ${v1.meanProg.toFixed(3)} 처치 ${v1.meanKills.toFixed(2)} 승률 ${(100 * v1.winRate).toFixed(2)}%`);
console.log('현재:', base.map((m) => m.ModelType).join(' '));
console.log('제안:', cur.map(nm).join(' '));
if (v1.winRate <= v0.winRate && WIN) console.log(`★ 승률 기준으로도 지금 순서보다 낫지 않다(${(100 * v1.winRate).toFixed(2)}% ≤ ${(100 * v0.winRate).toFixed(2)}%) — 지금 순서 유지.`);
else if (v1.winRate < v0.winRate) console.log(`★ 제안 순서의 승률이 지금 순서보다 낮다(${(100 * v1.winRate).toFixed(2)}% < ${(100 * v0.winRate).toFixed(2)}%) — 깰 때까지 반복할 거면 지금 순서가 낫다. --win 으로 다시 찾아 볼 것.`);
writeFileSync(new URL('../data/formation_' + name + '.json', import.meta.url), JSON.stringify({ name, objective: WIN ? 'win' : 'progress', winWorse: WIN ? v1.winRate <= v0.winRate : v1.winRate < v0.winRate, current: base.map((m) => m.ModelType), proposed: cur.map(nm), search: { seeds: N, prog: curR.meanProg }, verify: { seeds: NV, current: { prog: v0.meanProg, kills: v0.meanKills, win: v0.winRate, hist: v0.hist }, proposed: { prog: v1.meanProg, kills: v1.meanKills, win: v1.winRate, hist: v1.hist } } }, null, 1));
