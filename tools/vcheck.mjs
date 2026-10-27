// 전 판 비교(엄격: id·HP 정확·처치·큐·승자·증원). 실험 훅 플래그 이름을 인자로 켜서 돌린다.  node tools/vcheck.mjs [__FLAG …]   (VERBOSE=1 이면 판별 출력)
// 전 판 비교: 플래그 이름들을 인자로 받아 켜고 돌린다. 결과: 각 판의 일치 여부(엄격: id·HP 정확·처치·큐·승자·증원)
import { makeEngine } from '../site/engine/battle.js';
import { J, loadData } from './lib/paradata.mjs';
const E = makeEngine(loadData());
const files = (await import('node:fs')).readdirSync('data/replays').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((f) => { try { return !!J('data/replays/' + f + '.json').Replay; } catch { return false; } }).sort(); // data/replays 전부(Replay 가 있는 것만)
for (const f of process.argv.slice(2)) globalThis[f] = 1;
function check(fn) {
  const r = J('data/replays/' + fn + '.json').Replay; const c = r.Config; const fp = r.FinalPacketData;
  const l1 = E.lineupFromConfig(c, 1), l2 = E.lineupFromConfig(c, 2); l1.id = c.P1 || 'P1'; l2.id = c.P2 || 'AI2';
  let b; try { b = E.run(c.Seed, l1, l2); } catch (e) { return '예외'; }
  const s = b.snapshot();
  if (s.winner !== r.Winner) return '승자';
  const exp = fp.WinnerActiveMonsters.map((w) => w && [w.Id ?? 0, w.Hp ?? 0, w.TimeInBattle ?? 0, w.Kills ?? 0, w.Spirit ?? 0]);
  const got = s.active.map((m) => m && [m.id, m.hp, m.tib, m.kills, m.spirit]);
  let hpd = 0;
  for (let i = 0; i < 4; i++) { const g = got[i], e = exp[i]; if (!g !== !e) return '구성'; if (g && (g[0] !== e[0] || g[2] !== e[2] || g[3] !== e[3])) return '구성'; if (g) hpd += Math.abs(g[1] - e[1]); }
  if (s.reinf !== (fp.WinnerReinforcementCount ?? 0)) return '증원';
  if (JSON.stringify(s.queue) !== JSON.stringify(fp.Queue)) return '큐';
  return hpd === 0 ? '✓' : 'HP' + hpd;
}
const res = files.map((f) => [f, check(f)]);
const full = res.filter((x) => x[1] === '✓').length, hp = res.filter((x) => /^HP/.test(x[1])).length;
console.log((process.argv.slice(2).join('+') || 'base').padEnd(28), '정확', full, '· HP만', hp, '· 합', full + hp, '/', files.length, '  ', res.map((x) => x[1] === '✓' ? '✓' : /^HP/.test(x[1]) ? 'h' : '·').join(''));
if (process.env.VERBOSE) for (const [f, v] of res) console.log('  ', f.padEnd(20), v);
