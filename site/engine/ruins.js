// 유적(정체불명의 유적) 시뮬 도우미 — 브라우저·노드 공용.
// simulate(E, mobs1, base, opts): 같은 층(적 편성·배율)을 시드 N개로 돌려 승률·진척도 분포를 낸다.
//   진척도 = Σ_적 min(1, 깎은 체력 / 최대 체력)  (처치 1명 = 1, 승리면 적 수와 같다)
import { NetRandom } from './random.js';

export function seedsFor(n, base = 20261015) {
  const r = new NetRandom(base); const out = [];
  for (let i = 0; i < n; i++) out.push(r.next());
  return out;
}

export function progressOf(b) {
  const t2 = b.teams[1]; let p = t2.dead.length;
  for (const m of t2.active) if (m) p += Math.min(1, Math.max(0, (m.maxHp - Math.max(0, m.hp)) / m.maxHp));
  return p;
}

// cfg: 리플레이 Config(적 편성·배율·팀 버프). mobs1: 아군 MonsterInstance 배열(순서 = 증원 순서)
export function simulate(E, cfg, mobs1, { seeds, keepRuns = false } = {}) {
  const l2 = E.lineupFromConfig(cfg, 2);
  const res = { n: seeds.length, wins: 0, prog: 0, kills: 0, hist: {}, runs: keepRuns ? [] : null };
  for (const seed of seeds) {
    const l1 = E.lineupFromConfig(cfg, 1); l1.mobs = mobs1; l1.id = 'P1';
    const b = E.run(seed, l1, { ...l2, mobs: l2.mobs });
    const k = b.teams[1].dead.length, p = progressOf(b);
    if (b.winner === 'P1') res.wins++;
    res.prog += p; res.kills += k; res.hist[k] = (res.hist[k] || 0) + 1;
    if (keepRuns) res.runs.push({ seed, kills: k, prog: p, win: b.winner === 'P1', t: b.timePassed });
  }
  res.winRate = res.wins / res.n; res.meanProg = res.prog / res.n; res.meanKills = res.kills / res.n;
  return res;
}
