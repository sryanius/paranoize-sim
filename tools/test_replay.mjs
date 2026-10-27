// 전투 엔진 대조: 리플레이 Seed·편성으로 돌려 FinalPacketData(정답)와 비교한다.
//   node tools/test_replay.mjs [--trace 파일이름] [--events N]
import { writeFileSync } from 'node:fs';
import { makeEngine } from '../site/engine/battle.js';
import { J, loadData } from './lib/paradata.mjs';
const args = process.argv.slice(2);
const trace = args.includes('--trace') ? args[args.indexOf('--trace') + 1] : null;
const E = makeEngine(loadData());
const rest = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--trace' && args[i - 1] !== '--events');
const FILES = rest.length ? rest : trace ? [trace] : ['floor143_sub_lose', 'floor136_sub_lose', 'floor137_sub_lose', 'floor191_main_lose'];
let allOk = true;
for (const fn of FILES) {
  const r = J('data/replays/' + fn + '.json').Replay; const c = r.Config; const fp = r.FinalPacketData;
  const l1 = E.lineupFromConfig(c, 1), l2 = E.lineupFromConfig(c, 2);
  l1.id = c.P1 || 'P1'; l2.id = c.P2 || 'AI2';
  let b;
  try { b = E.run(c.Seed, l1, l2, { trace: trace === fn }); }
  catch (e) { console.log('✗', fn, '예외:', e.message); console.log(e.stack.split('\n').slice(1, 4).join('\n')); allOk = false; continue; }
  const s = b.snapshot();
  const out = [];
  const cmp = (what, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) out.push(`  ✗ ${what}: 엔진 ${JSON.stringify(got)} / 정답 ${JSON.stringify(exp)}`); };
  cmp('승자', s.winner, r.Winner);
  const exp = fp.WinnerActiveMonsters.map((w) => w && { id: w.Id ?? 0, mt: w.Mi.ModelType, hp: w.Hp ?? 0, tib: w.TimeInBattle ?? 0, kills: w.Kills ?? 0, spirit: w.Spirit ?? 0,
    buffs: (w.Buffs || []).map((x) => [x.ModelType, x.DurationLeft ?? 0, x.TimeInBattle ?? 0, x.TurnsInBattle ?? 0]) });
  for (let i = 0; i < Math.max(exp.length, s.active.length); i++) {
    const g = s.active[i], e = exp[i];
    if (!g || !e) { cmp(`칸${i}`, g && g.mt, e && e.mt); continue; }
    for (const k of ['id', 'mt', 'hp', 'tib', 'kills', 'spirit']) cmp(`칸${i} ${e.mt} ${k}`, g[k], e[k]);
    cmp(`칸${i} ${e.mt} 버프`, g.buffs, e.buffs);
  }
  cmp('후열 수', s.reinf, fp.WinnerReinforcementCount ?? 0);
  cmp('다음 후열', s.next, fp.WinnerNextReinforcement ?? null);
  cmp('큐', s.queue, Object.fromEntries(Object.entries(fp.Queue || {}).map(([k, v]) => [k, v])));
  const ok = out.length === 0; allOk &&= ok;
  console.log(`${ok ? '✓' : '✗'} ${fn} — 스텝 ${s.steps} · 턴 ${s.turns} · 난수 ${s.rngCalls} · 경과 ${b.timePassed}${b.errors.length ? ' · 오류 ' + [...new Set(b.errors)].join(' / ') : ''}`);
  if (!ok) console.log(out.join('\n'));
  if (trace === fn) { writeFileSync(new URL('../data/trace_' + fn + '.json', import.meta.url), JSON.stringify(b.events, null, 0).replace(/\},\{/g, '},\n{')); console.log('  추적 기록 → data/trace_' + fn + '.json (' + b.events.length + '건)'); }
}
process.exit(allOk ? 0 : 1);
