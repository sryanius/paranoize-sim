// arena_opt 의 일꾼 — 상대 기록들과 내 캐릭터 수치를 한 번 올려 두고, (상대 번호 · 순서 · 시드 조각)을 받아 이긴 판 수를 돌려준다.
import { parentPort, workerData } from 'node:worker_threads';
import { makeEngine } from '../../site/engine/battle.js';
import { loadData } from './paradata.mjs';

const E = makeEngine(loadData());
const { matches, mine } = workerData; // matches: [{ cfg, side }] · mine: { ModelType: MonsterInstance }
parentPort.on('message', ({ id, mi, ord, seeds }) => {
  const m = matches[mi]; const mobs = ord.map((t) => mine[t]);
  let wins = 0;
  for (const s of seeds) {
    const me = { ...E.lineupFromConfig(m.cfg, m.side), mobs, id: 'ME' }, op = { ...E.lineupFromConfig(m.cfg, 3 - m.side), id: 'OP' };
    const b = m.side === 1 ? E.run(s, me, op) : E.run(s, op, me);
    if (b.winner === 'ME') wins++;
  }
  parentPort.postMessage({ id, wins, n: seeds.length });
});
parentPort.postMessage('ready');
