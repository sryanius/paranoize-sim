// 전투 스탯 계산 — libil2cpp 1.2.0 MonsterInstance.CalculateBattleStatsNonAlloc 와 장비 함수들을 연산 순서까지 옮긴 것.
// ★ 게임은 float32 로 계산한다. 모든 중간값을 Math.fround 로 접는다(곱·합 한 번마다).
// 근거: docs/ENGINE.md §7 (주소 0xb5d8a8c · 0xb5d93b4 · 0xb5d96ec · 0xb5d9808 · 0xb5d9acc · PostCard/Accessory/SubAccessory/Spirit 함수들).
const f = Math.fround;
export const STATS = ['Strength', 'Vitality', 'WillPower', 'Intelligence', 'HP', 'Atk', 'PAtk', 'PDef', 'MAtk', 'MDef'];
export const S = Object.fromEntries(STATS.map((s, i) => [s, i]));
const RARITY = { R: 0, SR: 1, SSR: 2 };
const F0015 = f(0.015), F00075 = f(0.0075), F0005 = f(0.005), F016 = f(0.16), F01 = f(0.1), F004 = f(0.04), F13 = f(1.3), F00125 = f(0.0125), F099999 = f(0.99999);
const POW_BASE = 1.100000023841858; // 상수 풀에 double 로 들어 있는 값(= float 1.1 을 넓힌 것)

// Tables.Level: arr[i] ≤ xp 인 마지막 i + 1
export function levelFrom(xp, arr) {
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= xp) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans + 1;
}

export function makeStats(D) {
  // D: { monsters, postcards, accessories, subaccessories, spirits, presets(BattleStatPresets), tables }
  const P = D.presets, T = D.tables;
  const charLevel = (xp) => levelFrom(xp || 0, T.charXp);
  const pec = (r) => f(T.pecRankScalar[Math.min(r || 0, T.pecRankScalar.length - 1)]);
  function equipPreset(track, idx) {
    const list = P.EquipablePresets[track];
    if (!list) throw new Error('프리셋 트랙 없음: ' + track);
    return list[Math.min(list.length - 1, idx || 0)];
  }
  const gemSum = (gems, stat, acc) => {
    for (const g of gems || []) {
      if (!g) continue;
      const gp = P.GemPresets[g];
      if (gp && gp.Stat === STATS[stat]) acc = f(acc + f(gp.Amount));
    }
    return acc;
  };
  // ── 장비 기본 스탯
  function pcPreset(pc) { return equipPreset(D.postcards[pc.ModelType].PresetTrack, pc.BattleStatTrackIndex); }
  function accPreset(a) { return equipPreset(D.accessories[a.ModelType].PresetTrack, a.BattleStatTrackIndex); }
  function subPreset(s) { return equipPreset(D.subaccessories[s.ModelType].PresetTrack, s.BattleStatTrackIndex); }
  function pcBase(pc, mt, stat, rank) {
    const pr = pcPreset(pc); let s8 = f(pr.BaseStat);
    if (D.postcards[pc.ModelType].LinkTarget === mt) {
      const pw = f(Math.pow(POW_BASE, pc.Awakening || 0));
      const s1 = f(f(pr.LinkBaseStat || 0) * f(rank));
      s8 = f(s8 + f(s1 * pw));
    }
    return gemSum(pc.Gems, stat, s8);
  }
  const accBase = (a, stat) => gemSum(a.Gems, stat, f(accPreset(a).BaseStat));
  const subBase = (s, stat) => gemSum(s.Gems, stat, f(subPreset(s).BaseStat));
  // ── 장비 파생 덧셈
  function pcAdd(pc, stat) {
    let s8 = 0;
    if (stat === S.HP || stat === S.Atk) { const pr = pcPreset(pc); s8 = f(f(f(f(pr.StatOne) * pec(pc.PeculiarityRank)) * 0.5) + 0); }
    return gemSum(pc.Gems, stat, s8);
  }
  function accAdd(a, stat) {
    let s8 = 0;
    if (stat === S.HP || stat === S.Atk) { const pr = accPreset(a); s8 = f(f(f(f(pr.StatOne) * pec(a.PeculiarityRank)) * 0.5) + 0); }
    return gemSum(a.Gems, stat, s8);
  }
  function subAdd(s, stat) {
    const type = D.subaccessories[s.ModelType].Type === 'Shld' ? 1 : 0;
    let s8 = 0;
    const pair = stat & ~1;
    if ((pair === 6 && type === 0) || (pair === 8 && type === 1)) { const pr = subPreset(s); s8 = f(f(f(pr.StatTwo) * pec(s.PeculiarityRank)) + 0); }
    return gemSum(s.Gems, stat, s8);
  }
  function spiritAdd(sp, stat) {
    const m = D.spirits[sp.ModelType];
    if (S[m.Stat] !== stat) return 0;
    const pr = P.SpiritItemPresets[m.Rarity];
    const ri = Number(m.Rarity.slice(1)) - 1;
    const lvl = levelFrom(sp.Xp || 0, T.spiritXp[ri]);
    const sc = f(P.SpiritItemScalars[String(pr.LevelTrack)][String(lvl)]);
    return f(sc * f(pr.BaseStatAmount));
  }
  // ── 장비 파생 배율
  function pcScalar(pc, mt, stat) {
    const pr = pcPreset(pc); let s0 = 0;
    if (D.postcards[pc.ModelType].LinkTarget === mt) s0 = f(f(f(pr.LinkBoost || 0) * f((pc.Awakening || 0) + 1)) + 0);
    if (stat === S.HP) return f(s0 + f(pr.ExtraBoost || 0));
    if (stat === S.Atk) {
      const hist = f(f(pc.HistoryLevel || 0) * F00075), arc = f(f(pc.ArcaneLevel || 0) * F0015);
      const s1 = f(f(s0 + arc) + hist);
      return f(f(pr.ExtraBoost || 0) + s1);
    }
    return s0;
  }
  function accScalar(a, stat) { // AccessoryInstance 생성자가 ArcaneBattleStat = HistoryBattleStat = HP(4) 로 둔다
    let s8 = 0;
    if (stat === S.HP) s8 = f(f(f(a.ArcaneLevel || 0) * F0015) + 0);
    if (stat === S.HP) s8 = f(s8 + f(f(a.HistoryLevel || 0) * F00075));
    return s8;
  }
  function subScalar(s, stat) {
    const type = D.subaccessories[s.ModelType].Type === 'Shld' ? 1 : 0;
    if (stat === (type === 0 ? 7 : 9)) return f(f(f(s.ArcaneLevel || 0) * F0015) + 0);
    if (stat === (type === 0 ? 6 : 8)) return f(f(f(s.HistoryLevel || 0) * F0015) + 0);
    return 0;
  }
  function spiritScalar(sp, stat) {
    const m = D.spirits[sp.ModelType];
    return S[m.Stat] === stat ? f(P.SpiritItemPresets[m.Rarity].PercentStatAmount) : 0;
  }
  function setScalar(sets, stat) {
    let s8 = 0;
    for (const [name, cnt] of sets) {
      const sc = P.EquipableSetScalars[name]; if (!sc) continue;
      for (let i = 1; i <= cnt; i++) { const e = sc[String(i)]; if (e && e.Stat === STATS[stat]) s8 = f(s8 + f(e.Scalar)); }
    }
    return s8;
  }
  const subs = (mi) => (mi.SubAccessories || []).filter(Boolean);
  const sprs = (mi) => (mi.Spirit || []).filter(Boolean);
  // ── MonsterInstance
  function maxPotential(mon, rank) {
    const sum = mon.Strength + mon.Vitality + mon.WillPower + mon.Intelligence;
    const x9 = sum * Math.max(0, rank - 60);
    return Math.trunc(f(f(f(x9) * F13) + f(30 * sum)));
  }
  function baseStat(mi, stat, level, rank, rel, campus, scalar) {
    const mon = D.monsters[mi.ModelType];
    const B = f(mon[STATS[stat]]);
    let s0 = f(f(f(B * F004) * f(level)) + B);
    const s11 = f(s0 + f(18 * rank * (mi.LimitBreak || 0)));
    const ratio = f(f(mi.Potential || 0) / f(maxPotential(mon, rank)));
    const pot = Math.min(1, ratio);
    const m = Math.max(0, rank - 60);
    s0 = f(f(f(pot) * f(level)) / f(200));
    let s1 = f(f(B * f(m)) * F13);
    s1 = f(f(B * f(30)) + s1);
    let s9 = f(s11 + f(s0 * s1));
    if (mi.PostCard) s9 = f(s9 + pcBase(mi.PostCard, mi.ModelType, stat, rank));
    if (mi.MainAccessory) s9 = f(s9 + accBase(mi.MainAccessory, stat));
    for (const s of subs(mi)) s9 = f(s9 + subBase(s, stat));
    const name = STATS[stat];
    if (rel) {
      if (rel.FixedBonuses && rel.FixedBonuses[name] != null) s9 = f(s9 + f(rel.FixedBonuses[name]));
      if (rel.RankScaleBonuses && rel.RankScaleBonuses[name] != null) s9 = f(s9 + f(rel.RankScaleBonuses[name] * rank));
      if (rel.PercentBonuses && rel.PercentBonuses[name] != null) s9 = f(s9 * f(f(rel.PercentBonuses[name]) + 1));
    }
    if (campus && campus[name] && campus[name][mon.Element] != null) s9 = f(s9 * f(f(campus[name][mon.Element]) + 1));
    return f(s9 * f(scalar));
  }
  function derivedAdd(mi, stat) {
    let s8 = mi.PostCard ? f(pcAdd(mi.PostCard, stat) + 0) : 0;
    if (mi.MainAccessory) s8 = f(s8 + accAdd(mi.MainAccessory, stat));
    for (const s of subs(mi)) s8 = f(s8 + subAdd(s, stat));
    for (const sp of sprs(mi)) s8 = f(s8 + spiritAdd(sp, stat));
    return s8;
  }
  function derivedScalar(mi, stat) {
    const sets = new Map(); const add = (k) => sets.set(k, (sets.get(k) || 0) + 1);
    let s9 = 1;
    if (mi.PostCard) { s9 = f(pcScalar(mi.PostCard, mi.ModelType, stat) + 1); add(pcPreset(mi.PostCard).Set); }
    if (mi.MainAccessory) { s9 = f(s9 + accScalar(mi.MainAccessory, stat)); add(accPreset(mi.MainAccessory).Set); }
    for (const s of subs(mi)) { s9 = f(s9 + subScalar(s, stat)); add(subPreset(s).Set); }
    for (const sp of sprs(mi)) s9 = f(s9 + spiritScalar(sp, stat));
    return f(s9 + setScalar(sets, stat));
  }
  function charScalar(mi, stat, level, percent, campus) {
    const mon = D.monsters[mi.ModelType]; const ssr = RARITY[mon.Rarity] === 2;
    let s0 = f(f(f(level) * F0005) + 1);
    s0 = f(s0 + f(f(mi.LimitBreak || 0) * F016));
    let s8 = f(s0 + f((ssr ? 0.5 : F01) * f((mi.Awakening || 0) + (ssr ? 1 : 0))));
    const name = STATS[stat];
    if (campus && campus[name] && campus[name][mon.Element] != null) s8 = f(s8 + f(campus[name][mon.Element]));
    if (percent && percent[name] != null) s8 = f(s8 + f(percent[name]));
    return s8;
  }
  // CalculateBattleStatsNonAlloc(rank, presets, buffs, warWins, campus, finalBaseStatScalar)
  function battleStats(mi, { rank = 0, buffs = null, warWins = 0, campus = null, scalar = 1 } = {}) {
    const level = charLevel(mi.Xp);
    const b = [0, 1, 2, 3].map((st) => baseStat(mi, st, level, rank, buffs, campus, scalar));
    const v = new Array(10);
    v[4] = f(f(b[1] + b[2]) * 0.5); v[5] = f(f(b[0] + b[3]) * 0.5); v[6] = b[0]; v[7] = b[1]; v[8] = b[3]; v[9] = b[2];
    for (let st = 4; st <= 9; st++) v[st] = f(v[st] + derivedAdd(mi, st));
    for (let st = 4; st <= 9; st++) v[st] = f(v[st] * derivedScalar(mi, st));
    if (buffs) {
      for (let st = 4; st <= 9; st++) {
        const n = STATS[st];
        if (buffs.FixedBonuses && buffs.FixedBonuses[n] != null) v[st] = f(v[st] + f(buffs.FixedBonuses[n]));
        if (buffs.RankScaleBonuses && buffs.RankScaleBonuses[n] != null) v[st] = f(v[st] + f(buffs.RankScaleBonuses[n] * rank));
      }
    }
    const pct = buffs ? buffs.PercentBonuses : null;
    for (let st = 4; st <= 9; st++) v[st] = f(v[st] * charScalar(mi, st, level, pct, campus));
    const m = Math.min(F099999, f(f(warWins) * F00125));
    for (let st = 4; st <= 9; st++) v[st] = f(v[st] - f(v[st] * f(m)));
    const out = {};
    for (let st = 0; st < 4; st++) out[STATS[st]] = Math.ceil(b[st]);
    for (let st = 4; st <= 9; st++) out[STATS[st]] = Math.ceil(v[st]);
    return { level, stats: out };
  }
  return { battleStats, charLevel, maxPotential };
}
