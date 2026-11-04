// 투기장 덱 순서 최적화(병렬) — 내 24명 순서 하나로 여러 상대(공격·방어)를 함께 본다. 야망용으로 한 반을 통째로 고정할 수 있다.
//   node tools/arena_opt.mjs --deck=raw/api/<시각>_GetPlatoonsRequest.json [--fix=2] [--n=1000] [--nv=4000]
//   --deck: 도전 없이 읽어 온 부대 정보 — 내 캐릭터 수치와 지금 순서(페이지 0 의 1~4반)를 여기서 가져온다.
//   --fix=N: N반 6명을 멤버·순서 그대로 고정(야망은 반 단위로 싸우고 반 안 순서가 승패를 크게 바꾼다 — 2026-10-20 war_duel).
//   --fixset=N: N반 6명(멤버)은 그 반에 묶되 반 안 순서는 바꿔 본다(반 안끼리 · 반 밖끼리만 맞바꿈).
//   --start=<JSON>: 그 파일의 proposed 순서에서 탐색을 시작(«current» 는 여전히 지금 부대 순서) · --out=<data 안 파일 이름>.
//   --opp=raw/api/<시각>_GetPlatoonsRequest.json: 랭킹에서 읽은 그 사람의 지금 덱(python tools/api.py deck <Uid>)으로 «그 사람이 공격해 옴 · 내가 공격» 두 대전만 본다.
//     투귀공명·캠퍼스는 랭킹에 없어서 그 사람이 나온 가장 최근 투기장 기록 값을 쓴다(추정) · 내 팀 값 = 내가 나온 가장 최근 기록 · --opprank=N 으로 그 사람 통솔(랭킹 경험치 → heroXp)을 덮는다.
//   --me=<Uid>: 내 대신 그 사람 입장에서 짠다(--deck 도 그 사람 덱 · --opp 필수). 팀 값은 그 사람이 나온 가장 최근 기록 · --merank=N 으로 통솔을 덮는다.
//   --oppteam=/--meteam=data/teamfit_<Uid>.json: 투기장 기록 대신 tools/teamfit.mjs 가 전력에서 역산한 팀 값(기록이 없는 사람도 된다 · 2026-10-29 검증: 정답 대비 승률 차 0.2%p 안).
//   --wdef=W: --opp 에서 «그 사람이 공격해 옴» 무게(기본 1 · 0 이면 공격 승률만 본다 — 공격할 때만 덱을 바꿔 쓰는 경우).
//     결과는 data/arena_formation_<Uid>.json · arena_deck_<Uid>.json(내 투기장 덱 페이지 파일은 안 건드린다).
//   --eval: 탐색 없이 지금 순서와 시작 순서(--start)만 검증(팀 값 가정을 바꿔 다시 잴 때 · 2026-11-02).
//   탐색은 고정 반 밖 자리끼리 맞바꾸기. 결과는 data/arena_formation_main.json(투기장 덱 페이지가 읽는다).
// 상대 목록(MATCH)은 기록이 늘면 손으로 고친다. w = 점수 무게, n = 탐색 판 수 배율(검증은 모두 같은 판 수).
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, readdirSync } from 'node:fs';
import { J, myUid } from './lib/paradata.mjs';
import { seedsFor } from '../site/engine/ruins.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const AS = arg('me', null); const ME = AS || myUid(); const MERANK = arg('merank', null); const WDEF = +arg('wdef', 1); const OPPTEAM = arg('oppteam', null), METEAM = arg('meteam', null); let TEAMS = null;
if (AS && !arg('opp', null)) { console.error('--me 는 --opp 와 같이 쓴다(기본 상대 목록은 내 기록이다)'); process.exit(1); }
const deckFile = arg('deck'); if (!deckFile) { console.error('--deck=<GetPlatoons 응답> 이 필요하다'); process.exit(1); }
const FIX = +arg('fix', 0); const FIXSET = +arg('fixset', 0); const N = +arg('n', 1000); const NV = +arg('nv', 4000);
const OUT = arg('out', AS ? `arena_formation_${AS}.json` : 'arena_formation_main.json'); const DECKOUT = AS ? `arena_deck_${AS}.json` : 'arena_deck_main.json'; const START = arg('start', null); const OPP = arg('opp', null); const OPPRANK = arg('opprank', null);
const pr = J(deckFile).res; const mine = pr.Incidentals.Mobs[ME];
const pl = (pr.PlatoonPages['0'] || Object.values(pr.PlatoonPages)[0]).Platoons; const cur0 = Object.keys(pl).sort((a, b) => a - b).slice(0, 4).flatMap((i) => pl[i].Mobs.filter(Boolean)); // 남의 덱은 그 사람이 쓰는 페이지 하나만 온다
for (const t of cur0) mine[t] = { ...mine[t], ModelType: t };

// 내가 더그를 공격하는 기록이 없어서 만든다: 내 쪽 = 최근 내 공격 기록의 팀 값 · 더그 쪽 = 더그가 공격해 온 기록의 덱·팀 값(방어 덱 = 공격 덱 가정 — 10-20 기록에선 같았다)
const T = (c, s) => Object.fromEntries(['Rank', 'StatBuffs', 'CampusStatBonus', 'FinalBaseStatScalar', 'PassiveBuffs'].map((k) => [k, c[`Team${s}${k}`]]));
const put = (cfg, s, t) => { for (const [k, v] of Object.entries(t)) cfg[`Team${s}${k}`] = v; };
if (!OPP) { const myAtk = J('data/replays/arena_main_29.json').Replay.Config; const d24 = J('data/replays/arena_main_24.json').Replay.Config;
const synth = { Seed: 1, P1: ME, P2: d24.P1, P1Name: myAtk.P1Name, P2Name: d24.P1Name, P2GuildName: d24.P1GuildName, P2TPower: d24.P1TPower, P1Mobs: cur0.map((t) => mine[t]), P2Mobs: d24.P1Mobs };
put(synth, 1, T(myAtk, 1)); put(synth, 2, T(d24, 1));
writeFileSync(new URL('../data/arena_synth_main_vs_dough.json', import.meta.url), JSON.stringify({ note: '합성 설정 — 내가 더그를 공격하는 기록이 없어 arena_main_29(내 팀 값)와 arena_main_24(더그 덱·팀 값)로 만든 것. 더그 방어 덱 = 공격 덱 가정.', Replay: { Config: synth } }, null, 1)); }

let MATCH = [
  { key: '더그가 공격해 옴', file: 'arena_main_24', w: 1, n: 1 },
  { key: '내가 더그 공격(가정)', path: 'arena_synth_main_vs_dough.json', w: 1, n: 1 },
  { key: '리세가 공격해 옴', file: 'arena_main_20', w: 0.3, n: 0.15 },
  { key: 'FullFerry 가 공격해 옴', file: 'arena_main_19', w: 0.3, n: 0.15 },
  { key: '짜냥해야 공격', file: 'arena_main_29', w: 0.1, n: 0.15 },
  { key: '짜냥해야가 공격해 옴', file: 'arena_main_25', w: 0.1, n: 0.15 },
  { key: '마리 공격', file: 'arena_main_28', w: 0, n: 0.15 },
];
if (OPP) {
  const op = J(OPP).res; const ou = Object.keys(op.Incidentals.Mobs)[0]; const opl = Object.values(op.PlatoonPages)[0].Platoons; // 남의 덱은 그 사람이 쓰는 페이지 하나만 온다(번호는 사람마다)
  const omobs = [0, 1, 2, 3].flatMap((i) => (opl[i]?.Mobs || []).filter(Boolean)).map((t) => ({ ...op.Incidentals.Mobs[ou][t], ModelType: t }));
  const nn = (f) => +f.match(/\d+/)[0];
  const recs = readdirSync(new URL('../data/replays/', import.meta.url)).filter((f) => /^arena_main_\d+\.json$/.test(f)).sort((a, b) => nn(b) - nn(a)).map((f) => ({ f: f.replace(/\.json$/, ''), c: J('data/replays/' + f).Replay.Config }));
  // 팀 값: --oppteam/--meteam(tools/teamfit.mjs 역산 파일)이 있으면 그것 · 없으면 그 사람이 나온 가장 최근 투기장 기록
  const pick = (uid, file, opt) => {
    if (file) { const t = J(file); return { team: { ...t.team }, name: t.name || uid, src: `역산 ${file.split('/').pop()}` }; }
    const r = recs.find(({ c }) => c.P1 === uid || c.P2 === uid);
    if (!r) { console.error(`${uid} 가 나온 투기장 기록이 없다 — 투귀공명·캠퍼스 값을 모른다(tools/teamfit.mjs 로 역산해 --${opt}team= 으로 주면 된다)`); process.exit(1); }
    const s = r.c.P1 === uid ? 1 : 2; return { team: T(r.c, s), name: r.c[`P${s}Name`], src: `기록 ${r.f}` };
  };
  const O = pick(ou, OPPTEAM, 'opp'), M = pick(ME, METEAM, 'me');
  const oT = O.team; if (OPPRANK) oT.Rank = +OPPRANK; const mT = M.team; if (MERANK) mT.Rank = +MERANK;
  const name = O.name, myName = M.name, mm = cur0.map((t) => mine[t]);
  TEAMS = { me: `${M.src} · 통솔 ${mT.Rank}`, opp: `${O.src} · 통솔 ${oT.Rank}` };
  MATCH = [];
  for (const [atk, tag, key] of [[false, 'def', `${name} 공격해 옴(지금 덱)`], [true, 'atk', `${name} 공격(지금 덱)`]]) {
    const c = { Seed: 1, P1: atk ? ME : ou, P2: atk ? ou : ME, P1Name: atk ? myName : name, P2Name: atk ? name : myName, P1Mobs: atk ? mm : omobs, P2Mobs: atk ? omobs : mm };
    put(c, atk ? 1 : 2, mT); put(c, atk ? 2 : 1, oT);
    const path = `arena_now_${ou}_${tag}.json`;
    writeFileSync(new URL('../data/' + path, import.meta.url), JSON.stringify({ note: `합성 설정 — ${name} 의 지금 덱(${OPP} · 랭킹에서 읽음) · ${name} 팀 값 ${TEAMS.opp} · ${myName} 팀 값 ${TEAMS.me}. ${atk ? myName + ' 공격' : name + ' 공격'}.`, Replay: { Config: c } }, null, 1));
    MATCH.push({ key, path, w: atk ? 1 : WDEF, n: 1 });
  }
}
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
for (let sweep = 0; sweep < (process.argv.includes('--eval') ? 0 : 3); sweep++) {
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
writeFileSync(new URL('../data/' + DECKOUT, import.meta.url), JSON.stringify({ from: deckFile, Replay: { Config: { P1Mobs: cur0.map((t) => mine[t]) } } }, null, 1));
writeFileSync(new URL('../data/' + OUT, import.meta.url), JSON.stringify({
  deckPath: DECKOUT, fixed: FIX ? { platoon: FIX, members: cur.slice((FIX - 1) * 6, FIX * 6) } : null, fixedSet: FIXSET ? { platoon: FIXSET } : null, start: START, current: cur0, proposed: cur, teams: TEAMS,
  verify: { seeds: NV, matches: MATCH.map((m, i) => ({ key: m.key, file: m.file, path: m.path, weight: m.w, current: v0[i], proposed: v1[i] })) },
}, null, 1));
