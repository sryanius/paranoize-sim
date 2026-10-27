// System.Random(int seed) — .NET/Mono 레거시 Knuth 감산 생성기를 그대로 옮긴 것.
// BattleRandom 은 이것을 감싼다: RandomNext()=Next() · RandomNext(max)=Next(max) · RandomNext(a,b)=Next(a,b) · RandomNextDouble()=NextDouble().
const MBIG = 2147483647, MSEED = 161803398;
export class NetRandom {
  constructor(seed) {
    const a = new Int32Array(56);
    const sub = seed === -2147483648 ? 2147483647 : Math.abs(seed);
    let mj = (MSEED - sub) | 0;
    a[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      a[ii] = mk;
      mk = (mj - mk) | 0;
      if (mk < 0) mk = (mk + MBIG) | 0;
      mj = a[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        a[i] = (a[i] - a[1 + ((i + 30) % 55)]) | 0;
        if (a[i] < 0) a[i] = (a[i] + MBIG) | 0;
      }
    }
    this.a = a; this.inext = 0; this.inextp = 21; this.calls = 0;
  }
  internalSample() {
    let n = this.inext, p = this.inextp;
    if (++n >= 56) n = 1;
    if (++p >= 56) p = 1;
    let r = (this.a[n] - this.a[p]) | 0;
    if (r === MBIG) r--;
    if (r < 0) r = (r + MBIG) | 0;
    this.a[n] = r; this.inext = n; this.inextp = p; this.calls++;
    return r;
  }
  sample() { return this.internalSample() * (1.0 / MBIG); }
  next() { return this.internalSample(); }
  nextMax(max) { return Math.trunc(this.sample() * max); }
  nextRange(min, max) { const range = max - min; return Math.trunc(this.sample() * range) + min; }
  nextDouble() { return this.sample(); }
}
