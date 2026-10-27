// 알려진 순서 전부를 한 층에서 많은 판으로 비교 — 승률이 0.1% 대라 자동 탐색이 판정을 못 할 때 쓴다(병렬 · 순서 하나당 수 초).
//   node tools/compare_orders.mjs <리플레이 이름> [판 수=20000] [--deck=raw/api/<시각>_GetPlatoonsRequest.json]
//   --deck: 도전 없이 읽어 온 부대 정보(GetPlatoons)로 내 캐릭터 수치를 바꿔 넣고, 그 부대 순서(페이지 0 의 1~4반)도 후보에 넣는다(덱을 키운 뒤 «이제 되나» 볼 때).
// 후보: 그 리플레이의 지금 순서 + 같은 계정의 유적 도전에 쓰였던 순서 + 편성 제안(formation_*) + 투기장 추천. 24명이 같은 것만.
import { readdirSync } from 'node:fs';
import { J } from './lib/paradata.mjs';
import { seedsFor } from '../site/engine/ruins.js';
import { makePool } from './lib/simpool.mjs';
const name = process.argv[2]; const N = +process.argv[3] || 20000;
const cfg0 = J(`data/replays/${name}.json`).Replay.Config; const acct = name.split('_')[1];
const deckArg = process.argv.find((a) => a.startsWith('--deck=')); let pageOrder = null; let cfg = cfg0;
if (deckArg) {
  const r = J(deckArg.slice(7)).res; const uid = Object.keys(r.Incidentals.Mobs)[0]; const inc = r.Incidentals.Mobs[uid];
  const pl = r.PlatoonPages['0'].Platoons; pageOrder = Object.keys(pl).sort((a, b) => a - b).slice(0, 4).flatMap((i) => pl[i].Mobs.filter(Boolean));
  cfg = { ...cfg0, P1Mobs: cfg0.P1Mobs.map((m) => ({ ...(inc[m.ModelType] || m), ModelType: m.ModelType })) };
  console.log(`덱 수치: ${deckArg.slice(7)} (캐릭터 ${cfg.P1Mobs.filter((m) => inc[m.ModelType]).length}명 바꿔 넣음)`);
}
const key = (o) => o.join(','); const set = new Set(cfg.P1Mobs.map((m) => m.ModelType));
const cands = new Map(); const add = (label, o) => { if (o && o.length === 24 && o.every((t) => set.has(t)) && !cands.has(key(o))) cands.set(key(o), { label, o }); };
if (pageOrder) add('지금 부대 순서', pageOrder);
add('지금(이 도전)', cfg.P1Mobs.map((m) => m.ModelType));
const files = readdirSync(new URL('../data/replays/', import.meta.url)).filter((f) => new RegExp(String.raw`^floor\d+_${acct}_`).test(f)).sort();
for (const f of files) add(`${f.slice(5, 8)}층 도전 때 순서`, J('data/replays/' + f).Replay.Config.P1Mobs.map((m) => m.ModelType));
for (const f of readdirSync(new URL('../data/', import.meta.url)).filter((x) => new RegExp(String.raw`^formation_floor\d+_${acct}_`).test(x)).sort()) { const d = J('data/' + f); add(`${f.slice(15, 18)}층${(f.match(/_(?:lose|win)(\d+)\.json$/) || [])[1] ? '(' + f.match(/_(?:lose|win)(\d+)\.json$/)[1] + '번째)' : ''} ${d.objective === 'win' ? '승률' : '처치'} 기준 제안`, d.proposed); }
if (acct === 'main') { try { const a = J('data/arena_formation_main.json'); add('투기장 추천', a.proposed); } catch { /* 없음 */ } }
const by = (t) => cfg.P1Mobs.find((m) => m.ModelType === t);
const pool = await makePool(cfg); const seeds = seedsFor(N, 2024); const rows = [];
for (const { label, o } of cands.values()) { const r = await pool.simulate(o.map(by), seeds); rows.push({ label, o, r }); }
await pool.close();
rows.sort((a, b) => b.r.wins - a.r.wins || b.r.meanKills - a.r.meanKills);
console.log(`${name} · 후보 ${rows.length}개 · 각 ${N}판`);
for (const { label, r } of rows) console.log(`  ${label.padEnd(18)} ${String(r.wins).padStart(4)}승 = ${(100 * r.winRate).toFixed(3)}% · 처치 ${r.meanKills.toFixed(2)}`);
console.log('1위 순서:', rows[0].o.join(' '));
