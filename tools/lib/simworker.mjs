// simpool 의 일꾼 — 엔진을 한 번 올려 두고, 받은 시드 조각을 ruins.simulate 로 굴려 합계를 돌려준다.
import { parentPort, workerData } from 'node:worker_threads';
import { makeEngine } from '../../site/engine/battle.js';
import { simulate } from '../../site/engine/ruins.js';
import { loadData } from './paradata.mjs';

const E = makeEngine(loadData());
const { cfg } = workerData;
parentPort.on('message', ({ id, mobs1, seeds }) => {
  const r = simulate(E, cfg, mobs1, { seeds });
  parentPort.postMessage({ id, n: r.n, wins: r.wins, prog: r.prog, kills: r.kills, hist: r.hist });
});
parentPort.postMessage('ready');
