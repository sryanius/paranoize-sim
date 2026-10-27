// 시뮬 병렬 풀 — 같은 편성 하나를 시드 묶음으로 나눠 여러 코어에서 굴리고 합친다(결과는 한 코어로 돌린 것과 같다).
//   const pool = await makePool(cfg);           // cfg = 리플레이 Config(유적: 아군 P1)
//   const r = await pool.simulate(mobs1, seeds); // ruins.simulate 와 같은 모양 { n, wins, prog, kills, hist, winRate, meanProg, meanKills }
//   pool.close();
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export async function makePool(cfg, { threads = Math.max(1, availableParallelism() - 1) } = {}) {
  const workers = [];
  for (let i = 0; i < threads; i++) {
    const w = new Worker(new URL('./simworker.mjs', import.meta.url), { workerData: { cfg } });
    await new Promise((res, rej) => { w.once('message', (m) => (m === 'ready' ? res() : rej(new Error(String(m))))); w.once('error', rej); });
    workers.push(w);
  }
  let jobId = 0;
  const run = (w, mobs1, seeds) => new Promise((res, rej) => {
    const id = ++jobId;
    const onErr = (e) => { w.off('message', on); rej(e); };
    const on = (m) => { if (m && m.id === id) { w.off('message', on); w.off('error', onErr); res(m); } };
    w.on('message', on); w.once('error', onErr);
    w.postMessage({ id, mobs1, seeds });
  });
  async function simulate(mobs1, seeds) {
    const k = Math.min(workers.length, seeds.length); const size = Math.ceil(seeds.length / k);
    const parts = await Promise.all(workers.slice(0, k).map((w, i) => run(w, mobs1, seeds.slice(i * size, (i + 1) * size))));
    const res = { n: 0, wins: 0, prog: 0, kills: 0, hist: {} };
    for (const p of parts) { res.n += p.n; res.wins += p.wins; res.prog += p.prog; res.kills += p.kills; for (const [h, c] of Object.entries(p.hist)) res.hist[h] = (res.hist[h] || 0) + c; }
    res.winRate = res.wins / res.n; res.meanProg = res.prog / res.n; res.meanKills = res.kills / res.n;
    return res;
  }
  return { simulate, threads, close: () => Promise.all(workers.map((w) => w.terminate())) };
}
