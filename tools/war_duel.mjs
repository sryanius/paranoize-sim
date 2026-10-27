// 레이카의 야망 흉내 — 반(6명) 대 반. 이긴 반은 체력 회복 · 승리 1회마다 능력치 −1.25%(엔진 warWins).
//   node tools/war_duel.mjs "<이름표>=<ModelType,...6명>" ["<이름표>=…"] [--seeds=200]
// 상대 반 = 본계정 투기장 기록에 남은 상대 덱을 6명씩 자른 것(야망 덱은 모르므로 대용). 내 덱 수치 = 최근 유적 도전(본계정).
import { makeEngine } from '../site/engine/battle.js';
import { seedsFor } from '../site/engine/ruins.js';
import { J, myUid, loadData } from './lib/paradata.mjs';
import { readdirSync } from 'node:fs';
const D = loadData(); const E = makeEngine(D);
const ME = myUid();
const latest = readdirSync(new URL('../data/replays/', import.meta.url)).filter((f) => /^floor\d+_main_/.test(f)).sort().pop();
const fresh = J('data/replays/' + latest).Replay.Config.P1Mobs;
const team = (c, s) => { const p = 'Team' + s; return { Rank: c[p + 'Rank'], StatBuffs: c[p + 'StatBuffs'], CampusStatBonus: c[p + 'CampusStatBonus'], FinalBaseStatScalar: c[p + 'FinalBaseStatScalar'] }; };
const myTeam = team(J('data/replays/arena_main_03.json').Replay.Config, 1);
const OPP = [['더그', 'arena_main_03'], ['짜냥해야', 'arena_main_04'], ['리세', 'arena_main_10'], ['차차', 'arena_main_12'], ['FullFerry', 'arena_main_01'], ['너의친한친구', 'arena_main_02']].map(([n, f]) => {
  const c = J(`data/replays/${f}.json`).Replay.Config; const s = c.P1 === ME ? 2 : 1;
  const mobs = c[`P${s}Mobs`]; return { n, team: team(c, s), plats: [0, 1, 2, 3].map((p) => mobs.slice(p * 6, p * 6 + 6)) };
});
function duel(mine, wins, opp, oppPlat, seed, attack) {
  const cfg = { P1: 'A', P2: 'B' };
  const put = (side, t, mobs, ww) => { const p = 'Team' + side; cfg[`P${side}Mobs`] = mobs; cfg[p + 'Rank'] = t.Rank; cfg[p + 'StatBuffs'] = t.StatBuffs; cfg[p + 'CampusStatBonus'] = t.CampusStatBonus; cfg[p + 'FinalBaseStatScalar'] = t.FinalBaseStatScalar; cfg[p + 'WarWins'] = ww; };
  const ms = attack ? 1 : 2; put(ms, myTeam, mine, wins); put(3 - ms, opp.team, oppPlat, 0);
  const b = E.run(seed, E.lineupFromConfig(cfg, 1), E.lineupFromConfig(cfg, 2));
  return b.winner === (ms === 1 ? 'A' : 'B');
}
const sArg = process.argv.find((a) => a.startsWith('--seeds=')); const seeds = seedsFor(sArg ? +sArg.slice(8) : 200, 99);
for (const arg of process.argv.slice(2).filter((a) => a.includes('='))) {
  if (arg.startsWith('--')) continue;
  const [label, list] = arg.split('='); const mine = list.split(',').map((t) => fresh.find((m) => m.ModelType === t) || (() => { throw new Error('덱에 없음: ' + t); })());
  let atkW = 0, defW = 0, n = 0, beat = 0;
  for (const o of OPP) for (const pl of o.plats) {
    let a = 0, d = 0; for (const s of seeds) { a += duel(mine, 0, o, pl, s, true); d += duel(mine, 0, o, pl, s, false); }
    atkW += a; defW += d; n += seeds.length; if (a / seeds.length > 0.5) beat++;
  }
  const chains = OPP.map((o) => { let tot = 0; for (const s of seeds) { let w = 0; for (const pl of o.plats) { if (duel(mine, w, o, pl, s + w, true)) w++; else break; } tot += w; } return `${o.n} ${(tot / seeds.length).toFixed(2)}`; });
  console.log(`${label}\n   공격 ${(100 * atkW / n).toFixed(1)}% · 방어 ${(100 * defW / n).toFixed(1)}% · 상대 반 ${OPP.length * 4}개 중 이기는 반 ${beat}개\n   연승(상대 1→4반 차례로, 평균 꺾는 반 수): ${chains.join(' · ')}`);
}
