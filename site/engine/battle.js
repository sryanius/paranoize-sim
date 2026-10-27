// 패러노이즈 전투 엔진 — libil2cpp 1.2.0 ZigZa.Battle 을 연산·난수 소비 순서까지 옮긴 것.
// 근거와 주소는 docs/ENGINE.md. 검증: tools/test_replay.mjs (리플레이 Seed 로 돌려 FinalPacketData 와 대조).
import { NetRandom } from './random.js';
import { makeStats, STATS, S } from './stats.js';
const f = Math.fround;
const ACTIVE = 4, START_SPIRIT = 6, START_TEAM_SPIRIT = 4, MAX_SPIRIT = 6;
const ELEMENT = { Fire: 0, Water: 1, Earth: 2 };
const RARITY = { R: 0, SR: 1, SSR: 2 };
const STAT_IDX = S;

function flatten(groups) {
  const out = {};
  for (const [type, items] of Object.entries(groups)) for (const [k, v] of Object.entries(items)) out[k] = Object.assign({ _type: type, _name: k }, v);
  return out;
}
const DEFAULTS = {
  ApplyBuffAbilityComponent: { ChanceToApply: 1 }, DamageAbilityComponent: { BaseDamageScalar: 1 },
  BuffOnAllyDeathBuffComponent: { ChanceToTrigger: 1 }, BuffOnBattleStartBuffComponent: { ChanceToTrigger: 1 }, BuffOnDeathBuffComponent: { ChanceToTrigger: 1 },
  BuffOnEnemyDeathBuffComponent: { ChanceToTrigger: 1 }, BuffOnHitBuffComponent: { ChanceToTrigger: 1 }, BuffOnHurtBuffComponent: { ChanceToTrigger: 1 },
  BuffOnTurnBuffComponent: { ChanceToTrigger: 1 }, BuffOnTurnEndBuffComponent: { ChanceToTrigger: 1 }, BuffOnTurnStartBuffComponent: { ChanceToTrigger: 1 },
  DamageBuffComponent: { BaseDamageScalar: 1 }, DamageScalorBuffComponent: { DamageScalar: 1 }, EnterBattleBuffComponent: { ChanceToTrigger: 1 },
  HoldGroundBuffComponent: { ChanceToTrigger: 1 }, IncomingCritAdjustBuffComponent: { ChanceAdjust: 1 }, ModifyDamageBuffComponent: { DamageModifier: 1 },
  ModifyTuBuffComponent: { Scalar: 1 }, OthersEnterBuffComponent: { ChanceToTrigger: 1 }, OutgoingCritAdjustBuffComponent: { ChanceAdjust: 1 },
  RevengeBuffComponent: { ChanceToTrigger: 1 }, SendToReinforcementsBuffComponent: { Position: -1 }, SummonMonsterBuffComponent: { LineupPosition: -1 },
};
const withDefaults = (c) => Object.assign({}, DEFAULTS[c._type] || {}, c);

export const COV = { on: false, hits: new Map(), t: 0 };
const cov = (k) => { if (globalThis.__COVLOG) globalThis.__COVLOG.push(k); if (!COV.on) return; const h = COV.hits.get(k); if (h) h.n++; else COV.hits.set(k, { n: 1, first: COV.t }); };
export function makeEngine(D) {
  const AC = Object.fromEntries(Object.entries(flatten(D.abilityComponents)).map(([k, v]) => [k, withDefaults(v)]));
  const BC = Object.fromEntries(Object.entries(flatten(D.buffComponents)).map(([k, v]) => [k, withDefaults(v)]));
  const BUFF = Object.fromEntries(Object.entries(D.buffs).map(([k, v]) => [k, Object.assign({ Duration: -1, AttackWeightScalar: 0, _name: k }, v)]));
  const ST = makeStats(D);
  // 스탯 캐시: 같은 MonsterInstance·같은 팀 인자면 결과가 같다(전투마다 다시 계산하지 않는다)
  const statCache = new WeakMap();
  function cachedStats(mi, a) {
    const key = a._key || (a._key = `${a.rank}|${a.scalar}|${a.warWins}|${JSON.stringify(a.buffs)}|${JSON.stringify(a.campus)}`);
    let m = statCache.get(mi); if (!m) statCache.set(mi, (m = new Map()));
    let st = m.get(key); if (!st) m.set(key, (st = ST.battleStats(mi, a)));
    return st;
  }

  // ───────────────────────── 큐 (SortedList<int, BMI>)
  class Queue {
    constructor() { this.k = []; this.v = []; this.jumpers = []; }
    idx(tu) { let lo = 0, hi = this.k.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (this.k[m] === tu) return m; if (this.k[m] < tu) lo = m + 1; else hi = m - 1; } return -1; }
    has(tu) { return this.idx(tu) >= 0; }
    get(tu) { return this.v[this.idx(tu)]; }
    rawAdd(tu, m) { if (this.has(tu)) throw new Error('큐 키 중복 ' + tu); let i = 0; while (i < this.k.length && this.k[i] < tu) i++; this.k.splice(i, 0, tu); this.v.splice(i, 0, m); }
    rawRemoveKey(tu) { const i = this.idx(tu); if (i >= 0) { this.k.splice(i, 1); this.v.splice(i, 1); } }
    timeFor(m) { const i = this.v.indexOf(m); return i < 0 ? -1 : this.k[i]; }
    add(tu, m, rnd) {
      while (this.has(tu)) {
        cov('q:tie'); if (globalThis.__TIE ? globalThis.__TIE(rnd) : (rnd.next() & 1) === 0) { tu++; continue; }
        this.setWithPriority(this.get(tu), tu + 1); break;
      }
      this.rawAdd(tu, m);
    }
    setWithPriority(m, tu) {
      if (this.has(tu)) { cov('q:prio-push'); this.setWithPriority(this.get(tu), tu + 1); }
      this.rawRemoveKey(this.timeFor(m));
      this.rawAdd(tu, m);
    }
    setTu(m, tu) {
      while (this.has(tu)) { if (this.get(tu) === m) return; tu++; }
      this.rawRemoveKey(this.timeFor(m));
      this.rawAdd(tu, m);
    }
    remove(m) { const i = this.v.indexOf(m); if (i >= 0) { this.k.splice(i, 1); this.v.splice(i, 1); } }
    front() { return this.v.length ? this.v[0] : null; }
    tuAtFront() { return this.k.length ? this.k[0] : 0; }
    advanceToFront() { const t = this.tuAtFront(); if (t !== 0) this.passTu(t); return t; }
    passTu(t) { for (let i = 0; i < this.k.length; i++) { const key = this.k[i]; this.setTu(this.v[i], key - t); } }
    addTu(m, tu, priority) {
      const cur = this.timeFor(m);
      if (cur === -1) return;
      const n = Math.max(0, cur + tu);
      if (priority) this.setWithPriority(m, n); else this.setTu(m, n);
      this.jumpers.push(m.id);
    }
  }

  // ───────────────────────── 버프 인스턴스
  class BuffInst {
    constructor(buff) { this.buff = buff; this.comps = []; this.props = {}; this.removed = false; this.parent = null; this.source = null; this.isPassive = false; this.durationLeft = buff.Duration; this.timeInBattle = 0; this.turnsInBattle = 0; }
    incProp(k) { this.props[k] = (this.props[k] || 0) + 1; return this.props[k]; }
  }

  // ───────────────────────── 전투 몬스터
  class BMI {
    constructor(battle, mi, team, statArgs) {
      this.battle = battle; this.mi = mi; this.mon = D.monsters[mi.ModelType]; this.team = team;
      if (!this.mon) throw new Error('몬스터 없음 ' + mi.ModelType);
      this.id = battle.idCounter++;
      const st = cachedStats(mi, statArgs);
      this.level = st.level;
      this.starting = STATS.map((k) => st.stats[k]); this.cached = this.starting.slice();
      this.hp = this.starting[4]; this.buffs = []; this.timeInBattle = 0; this.kills = 0; this.spirit = START_SPIRIT; this.summoned = false;
      this.sourceOfDeath = null; this.usages = {}; this.props = {};
      this.element = ELEMENT[this.mon.Element]; this.rarity = RARITY[this.mon.Rarity];
    }
    get maxHp() { return this.cached[4]; }
    get atk() { return this.cached[5]; }
    stat(i) { return this.cached[i]; }
    scalarFor(st) {
      let s = 1;
      for (const bi of this.buffs) s = f(s + biScalarForStat(bi, st));
      return Math.max(0, s);
    }
    recalc() {
      // = 스탯마다 max(1, trunc(f(ScalarForStat × starting))). 스탯 배율 버프가 하나도 없으면 배율 1 → starting 그대로.
      let any = false;
      for (const bi of this.buffs) if (!bi.removed && bi.hasStat) { any = true; break; }
      if (!any) { for (let st = 4; st <= 9; st++) this.cached[st] = Math.max(1, Math.trunc(f(this.starting[st]))); return; } // f(1×f(x)) = f(x)
      for (const st of [5, 6, 7, 8, 9, 4]) {
        const v = f(this.scalarFor(st) * f(this.starting[st]));
        this.cached[st] = Math.max(1, Math.trunc(v));
      }
    }
    isActiveSkillUnlocked(name) { return skillUnlocked(this, name, this.mon.ActiveSkillLevels); }
  }
  function skillUnlocked(bmi, name, levels) {
    if (globalThis.__NO_SPIKE_STUN && name === 'OnHitStunChanceBoss') return false; // 실험 훅
    if (globalThis.__IGNORE_SKILL_LEVELS) return true; // 실험 훅: 해금 레벨 무시
    if (globalThis.__IGNORE_SKILL_LEVELS_FOR && globalThis.__IGNORE_SKILL_LEVELS_FOR(bmi, name)) return true; // 실험 훅
    const need = levels ? levels[name] : undefined;
    if (need == null) return true;
    return bmi.level >= need;
  }

  // ───────────────────────── 팀
  class Team {
    constructor(lineup, isAi) {
      this.id = lineup.id; this.ai = isAi; this.reinf = []; this.active = []; this.dead = [];
      this.spirit = START_TEAM_SPIRIT; this.rank = lineup.rank || 0; this.warWins = lineup.warWins || 0; this.extra = lineup.passiveBuffs || [];
    }
    hasEmptySlot() { return this.active.length < ACTIVE || this.active.some((m) => m == null); }
    addToActive() {
      const m = this.reinf.shift();
      const i = this.active.indexOf(null);
      cov('slot:' + (i >= 0 ? 'hole' + i : 'append'));
      if (globalThis.__COMPACT) this.active.push(m); else if (i >= 0) this.active[i] = m; else this.active.push(m);
      return m;
    }
    removeDead(m) { const i = this.active.indexOf(m); if (i >= 0) { if (globalThis.__COMPACT) this.active.splice(i, 1); else this.active[i] = null; this.dead.push(m); } }
    isEmpty() { return this.reinf.length === 0 && this.active.every((m) => m == null); }
    alive() { return this.active.filter((m) => m != null); }
  }

  // ───────────────────────── 조건 (MonsterConditions)
  function cond(b, name) { const c = D.conditions[name]; if (!c) throw new Error('조건 없음 ' + name); return c; }
  function condMet(b, name, m) { return isConditionMet(b, cond(b, name), m); }
  function isConditionMet(b, c, m) {
    if (c.OrConditions && c.OrConditions.length) return c.OrConditions.some((n) => condMet(b, n, m));
    for (const n of c.AndConditions || []) if (!condMet(b, n, m)) return false;
    for (const n of c.NotConditions || []) if (condMet(b, n, m)) return false;
    const T = (k) => { const v = c[k] != null; if (v) cov('cond:' + k); return v; };
    if (T('AllyReinforcementCountBattleCondition') && !(m.team.reinf.length >= c.AllyReinforcementCountBattleCondition.Count)) return false;
    if (T('AllyReinforcementCountLessThanBattleCondition') && !(m.team.reinf.length < c.AllyReinforcementCountLessThanBattleCondition.Count)) return false;
    if (T('EnemyReinforcementCountBattleCondition') && !(b.enemyOf(m).reinf.length >= c.EnemyReinforcementCountBattleCondition.Count)) return false;
    if (T('EnemyReinforcementCountLessThanBattleCondition') && !(b.enemyOf(m).reinf.length < c.EnemyReinforcementCountLessThanBattleCondition.Count)) return false;
    if (T('MyTeamLastMonsterCondition') && !lastCond(b, m.team, c.MyTeamLastMonsterCondition)) return false;
    if (T('EnemyTeamLastMonsterCondition') && !lastCond(b, b.enemyOf(m), c.EnemyTeamLastMonsterCondition)) return false;
    if (T('MonsterElementBattleCondition') && !(c.MonsterElementBattleCondition.Elements || []).includes(m.mon.Element)) return false;
    if (T('BuffStackNameBattleCondition') && !m.buffs.some((bi) => bi.buff.StackName === c.BuffStackNameBattleCondition.StackName)) return false;
    if (T('BuffTagBattleCondition') && !m.buffs.some((bi) => (bi.buff.Tags || []).includes(c.BuffTagBattleCondition.Tag))) return false;
    if (T('AbilityFlagBattleCondition') && !(m.mon.ActiveSkills || []).some((a) => (D.abilities[a].Flags || []).includes(c.AbilityFlagBattleCondition.Flag))) return false;
    if (T('MonsterSummonedBattleCondition') && !m.summoned) return false;
    if (T('TeamSpiritLessThanBattleCondition') && !(m.team.spirit < c.TeamSpiritLessThanBattleCondition.Spirit)) return false;
    if (T('TeamSpiritEqualToBattleCondition') && !(m.team.spirit === c.TeamSpiritEqualToBattleCondition.Spirit)) return false;
    if (T('TeamSpiritGreaterThanBattleCondition') && !(m.team.spirit > c.TeamSpiritGreaterThanBattleCondition.Spirit)) return false;
    if (T('EnemyTeamSpiritLessThanBattleCondition') && !(b.enemyOf(m).spirit < c.EnemyTeamSpiritLessThanBattleCondition.Spirit)) return false;
    if (T('EnemyTeamSpiritEqualToBattleCondition') && !(b.enemyOf(m).spirit === c.EnemyTeamSpiritEqualToBattleCondition.Spirit)) return false;
    if (T('EnemyTeamSpiritGreaterThanBattleCondition') && !(b.enemyOf(m).spirit > c.EnemyTeamSpiritGreaterThanBattleCondition.Spirit)) return false;
    if (T('SpiritLessThanBattleCondition') && !(m.spirit < c.SpiritLessThanBattleCondition.Spirit)) return false;
    if (T('SpiritEqualToBattleCondition') && !(m.spirit === c.SpiritEqualToBattleCondition.Spirit)) return false;
    if (T('SpiritGreaterThanBattleCondition') && !(m.spirit > c.SpiritGreaterThanBattleCondition.Spirit)) return false;
    if (T('HpPercentLessThanBattleCondition') && !(f(f(m.hp) / f(m.maxHp)) < f(c.HpPercentLessThanBattleCondition.HpPercent))) return false;
    if (T('HpPercentGreaterThanBattleCondition') && !(f(f(m.hp) / f(m.maxHp)) > f(c.HpPercentGreaterThanBattleCondition.HpPercent))) return false;
    if (T('HpValueLessThanBattleCondition') && !(m.hp < c.HpValueLessThanBattleCondition.HpValue)) return false;
    if (T('HpValueGreaterThanBattleCondition') && !(m.hp > c.HpValueGreaterThanBattleCondition.HpValue)) return false;
    if (T('KillsMadeBattleCondition') && !(m.kills >= c.KillsMadeBattleCondition.RequiredKills)) return false;
    if (T('TimeInBattleBattleCondition') && !(m.timeInBattle >= c.TimeInBattleBattleCondition.RequiredTime)) return false;
    if (T('BattleTimeBattleCondition') && !(b.timePassed >= c.BattleTimeBattleCondition.RequiredTime)) return false;
    if (T('CurrentTuGreaterThanBattleCondition') && !(b.queue.timeFor(m) > c.CurrentTuGreaterThanBattleCondition.Tu)) return false;
    if (T('CurrentTuLessThanBattleCondition') && !(b.queue.timeFor(m) < c.CurrentTuLessThanBattleCondition.Tu)) return false;
    if (T('TeamMonsterBattleCondition') && !teamMatch(b, m.team, c.TeamMonsterBattleCondition)) return false;
    if (T('EnemyTeamMonsterBattleCondition') && !teamMatch(b, b.enemyOf(m), c.EnemyTeamMonsterBattleCondition)) return false;
    if (T('InBattleMonsterBattleCondition') && !(b.teams.reduce((n, t) => n + t.alive().filter((x) => condMet(b, c.InBattleMonsterBattleCondition.Condition, x)).length, 0) >= c.InBattleMonsterBattleCondition.MatchesNeeded)) return false;
    return true;
  }
  function teamMatch(b, team, c) { let n = 0; for (const x of team.active) { if (x && condMet(b, c.Condition, x)) { n++; if (n >= c.MatchesNeeded) return true; } } return n >= c.MatchesNeeded; }
  function lastCond(b, team, c) { if (team.reinf.length === 0) return true; return c.Condition ? condMet(b, c.Condition, team.reinf[team.reinf.length - 1]) : false; }

  // ───────────────────────── 대상 지정 (BattleTargeting)
  const TG = (name) => { const t = D.targeting[name]; if (!t) throw new Error('대상 지정 없음 ' + name); return t; };
  function showTargeting(t) {
    if (t.TargetAll) return false;
    const fr = (t.FriendlyTargets || 0) >= 1 && !t.FriendlyRandom && !t.TargetAllFriendly;
    const en = (t.EnemyTargets || 0) >= 1 && !t.EnemyRandom && !t.TargetAllEnemy;
    if (!fr && !en) return false;
    return !t.MonsterRanker;
  }
  function isTargetable(b, t, x, user, exclude) {
    if (t.TargetingCondition && !condMet(b, t.TargetingCondition, x)) return false;
    if (exclude && exclude.includes(x)) return false;
    if (x.hp < 1) return false;
    return !(x === user && t.ExcludeSelf);
  }
  function possibleTargets(b, t, user) {
    const list = []; const ok = (x) => x != null && isTargetable(b, t, x, user, null);
    cov('pt:' + (t.TargetAll ? 'all' : t.TargetAllEnemy ? 'allEnemy' : t.TargetAllFriendly ? 'allFriendly' : 'pick') + (t.TargetingCondition ? ':cond' : '') + (t.ExcludeSelf ? ':exSelf' : ''));
    if (t.TargetAll) for (const tm of b.teams) list.push(...tm.active.filter(ok));
    else if (t.TargetAllEnemy) list.push(...b.enemyOf(user).active.filter(ok));
    else if (t.TargetAllFriendly) list.push(...user.team.active.filter(ok));
    else {
      if (t.Self) list.push(user);
      if ((t.FriendlyTargets || 0) >= 1) list.push(...user.team.active.filter(ok));
      if ((t.EnemyTargets || 0) >= 1) list.push(...b.enemyOf(user).active.filter(ok));
    }
    if (t.ExcludeSelf) { const i = list.indexOf(user); if (i >= 0) list.splice(i, 1); }
    if (globalThis.__ORD) return globalThis.__ORD(b, list, user);
    return list;
  }
  // LINQ OrderBy(키) — 키를 원소 순서대로 한 번씩 계산한 뒤 안정 정렬
  const orderBy = (arr, key, desc = false) => arr.map((x, i) => [key(x), i, x]).sort((p, q) => (desc ? (q[0] - p[0]) : (p[0] - q[0])) || (p[1] - q[1])).map((e) => e[2]);
  function rankTargets(b, t, list) {
    const r = t.MonsterRanker, d = !!t.RankDescending;
    if (r === 'CurrentTU') return orderBy(list, (x) => b.queue.timeFor(x), d);
    if (r === 'CurrentHP') return orderBy(list, (x) => x.hp, d);
    if (r === 'RelativeHP') return orderBy(list, (x) => f(f(x.hp) / f(x.maxHp)), d);
    if (r === 'Rarity') return orderBy(list, (x) => x.rarity, d);
    return list;
  }
  function resolveTargets(b, t, user, exclude) {
    let list = [];
    const ok = (x) => x != null && isTargetable(b, t, x, user, exclude);
    cov('rt:' + (t.TargetAll ? 'all' : t.TargetAllEnemy ? 'allEnemy' : t.TargetAllFriendly ? 'allFriendly' : 'pick') + (exclude && exclude.length ? '+excl' : '') + (t.TargetingCondition ? ':cond' : ''));
    if (t.TargetAll) for (const tm of b.teams) list.push(...tm.active.filter(ok));
    else if (t.TargetAllEnemy) list.push(...b.enemyOf(user).active.filter(ok));
    else if (t.TargetAllFriendly) list.push(...user.team.active.filter(ok));
    else {
      if (t.Self && isTargetable(b, t, user, user, exclude)) { cov('rt:self'); list.push(user); }
      if ((t.FriendlyTargets || 0) >= 1) {
        const c = user.team.active.filter(ok);
        if (t.FriendlyRandom) { cov('rt:frRandom'); list.push(...orderBy(c, () => b.rnd.next()).slice(0, t.FriendlyTargets)); }
        else if (t.MonsterRanker) { cov('rt:frRank:' + t.MonsterRanker); list.push(...rankTargets(b, t, c).slice(0, t.FriendlyTargets)); }
        else b.logError('ResolveTargets: 아군 대상이 무작위·순위 없이 지정됨');
      }
      if ((t.EnemyTargets || 0) >= 1) {
        const c = b.enemyOf(user).active.filter(ok);
        if (t.EnemyRandom) { cov('rt:enRandom'); list.push(...orderBy(c, () => b.rnd.next()).slice(0, t.EnemyTargets)); }
        else if (t.MonsterRanker) { cov('rt:enRank:' + t.MonsterRanker); list.push(...rankTargets(b, t, c).slice(0, t.EnemyTargets)); }
        else b.logError('ResolveTargets: 적 대상이 무작위·순위 없이 지정됨');
      }
    }
    if (t.ExcludeSelf) { const i = list.indexOf(user); if (i >= 0) list.splice(i, 1); }
    if ((t.ChancePerTarget ?? 1) < 1) cov('rt:chance');
    if ((t.ChancePerTarget ?? 1) < 1) list = list.filter(() => b.rnd.nextDouble() < f(t.ChancePerTarget));
    return list;
  }
  function assignRandomTargets(b, t, user) {
    cov('art:' + ((t.FriendlyTargets || 0) >= 1 ? 'fr' : '') + ((t.EnemyTargets || 0) > 0 ? 'en' : ''));
    const ids = [];
    if ((t.FriendlyTargets || 0) >= 1) for (const x of orderBy(user.team.active.filter((x) => x != null && isTargetable(b, t, x, user, null)), () => b.rnd.next()).slice(0, t.FriendlyTargets)) ids.push(x.id);
    if ((t.EnemyTargets || 0) > 0) for (const x of orderBy(b.enemyOf(user).active.filter((x) => x != null && isTargetable(b, t, x, user, null)), () => b.rnd.next()).slice(0, t.EnemyTargets)) ids.push(x.id);
    return ids;
  }
  // 가중 셔플 (WeightedRandomBattleTargetList)
  function weightedShuffle(b, list) {
    if (list.length < 2) return list.slice();
    let values = [], weights = [], end = 0;
    for (const x of list) { const w = Math.max(1, Math.trunc(f(modifyTargetingWeight(x) * f(1000)))); end += w; weights.push(end); values.push(x); }
    const out = [];
    while (values.length > 0) {
      if (values.length === 1) { if (globalThis.__WS_FULL) b.rnd.nextMax(end); out.push(values[0]); values = []; break; }
      const r = b.rnd.nextMax(end);
      const nv = [], nw = []; let removedW = 0, last = 0, sel = null;
      for (let i = 0; i < values.length; i++) {
        const cum = weights[i];
        if (cum >= r && removedW === 0 && sel === null) { removedW = cum - last; sel = values[i]; continue; }
        nv.push(values[i]); last = cum - removedW; nw.push(last);
      }
      end = last; values = nv; weights = nw; out.push(sel);
    }
    return out;
  }
  function damageScalarOnTarget(b, user, target, comps) {
    let s = 0;
    for (const c of comps) if (c._type === 'DamageAbilityComponent') s = f(s + totalScalorOnTarget(b, c, user, target));
    return s;
  }
  function totalScalorOnTarget(b, c, user, target) {
    let s = f(c.BaseDamageScalar);
    const ts = c.TargetDamageScalars || [], tc = c.TargetDamageScalarConditions || [];
    for (let i = 0; i < ts.length; i++) { const cn = i < tc.length ? tc[i] : null; if (!cn || condMet(b, cn, target)) s = f(s + f(ts[i])); }
    const ss = c.SourceDamageScalars || [], sc = c.SourceDamageScalarConditions || [];
    for (let i = 0; i < ss.length; i++) { const cn = i < sc.length ? sc[i] : null; if (!cn || condMet(b, cn, user)) s = f(s + f(ss[i])); }
    if ((c.TimeStrikeTargetTu || 0) >= 1) {
      const k = f(c.TimeStrikeScalar || 0);
      s = f(s + Math.min(k, f(k * f(f(b.queue.timeFor(target)) / f(c.TimeStrikeTargetTu)))));
    }
    return s;
  }
  function assignTargetsForAI(b, t, user, comps, ai, protectors, redirectable) {
    let usable = false;
    const possible = possibleTargets(b, t, user);
    if (showTargeting(t)) {
      if ((t.EnemyTargets || 0) >= 1 && possible.length < t.EnemyTargets && b.enemyOf(user).active.filter((m) => m != null).length > possible.length) { cov('ata:hiddenEnemy'); return { ids: [], usable }; }
      if ((t.FriendlyTargets || 0) >= 1 && possible.length < t.FriendlyTargets && user.team.active.filter((m) => m != null).length > possible.length) { cov('ata:hiddenFriend'); return { ids: [], usable }; }
    }
    usable = true;
    const bad = ai ? (ai.BadTargetConditions || []) : [], good = ai ? (ai.GoodTargetConditions || []) : [];
    if (t.EnemyRandom || t.FriendlyRandom) {
      const cand = possible.filter((p) => bad.every((cn) => !condMet(b, cn, p)));
      if (cand.length === 0) { cov('ata:randomAllBad'); return { ids: [], usable }; }
      cov('ata:random');
    }
    let cands; const badTargets = [];
    if (ai) {
      cands = [];
      for (const p of possible) for (const cn of good) if (condMet(b, cn, p)) { cands.push(p); break; }
      if (cands.length === 0) { cov('ata:noGood'); cands.push(...possible); } else cov('ata:good');
      for (const p of possible) for (const cn of bad) if (condMet(b, cn, p)) { cov('ata:bad'); const i = cands.indexOf(p); if (i >= 0) cands.splice(i, 1); badTargets.push(p); break; }
    } else cands = possible.slice();
    if ((t.EnemyTargets || 0) >= 1 && redirectable && protectors.length >= 1) {
      const protIn = possible.filter((x) => protectors.includes(x));
      const n = protIn.filter((x) => badTargets.includes(x)).length;
      if (n === protIn.length && n >= t.EnemyTargets) return { ids: [], usable };
    }
    if (globalThis.__HOOK_CANDS) cands = globalThis.__HOOK_CANDS(b, user, t, cands); // 실험 훅
    const shuffled = weightedShuffle(b, cands);
    const ordered = orderBy(shuffled, (x) => damageScalarOnTarget(b, user, x, comps), true);
    if (ordered.length === 0) { cov('ata:emptyAfterBad'); return { ids: [], usable }; }
    if (ordered.length >= 2 && damageScalarOnTarget(b, user, ordered[0], comps) !== damageScalarOnTarget(b, user, ordered[ordered.length - 1], comps)) cov('ata:scalarOrder');
    const forced = [];
    // ★ 원문(AssignTargetsForAI 디컴파일): 보호자 강제는 ai 가 있고 ai.BadTargetConditions 가 있을 때만 — 없으면 실행 단계의 가드 굴림에 맡긴다 (2026-10-19 투기장 영상으로 확인)
    if ((t.EnemyTargets || 0) >= 1 && redirectable && protectors.length >= 1 && ai && ai.BadTargetConditions) {
      if (protectors.length < t.EnemyTargets) forced.push(...protectors);
      else if (protectors.some((p) => badTargets.includes(p))) {
        let got = null;
        for (const x of ordered) if (protectors.includes(x)) { got = x; break; }
        if (!got) for (const x of possible) if (protectors.includes(x) && !badTargets.includes(x)) { got = x; break; }
        if (got) forced.push(got);
      }
    }
    if (!showTargeting(t)) { cov('ata:noShow'); return { ids: ordered.map((x) => x.id), usable }; }
    cov('ata:show:' + (t.EnemyTargets ? 'en' + t.EnemyTargets : 'fr' + t.FriendlyTargets));
    const extra = weightedShuffle(b, globalThis.__HOOK_EXTRA ? globalThis.__HOOK_EXTRA(b, user, t, possible) : possible); // 실험 훅
    const ids = [];
    for (const x of forced) ids.push(x.id);
    for (const x of ordered) if (!ids.includes(x.id)) ids.push(x.id);
    for (const x of extra) if (!ids.includes(x.id)) ids.push(x.id);
    const n = (t.EnemyTargets || 0) >= 1 ? t.EnemyTargets : (t.FriendlyTargets || 0);
    return { ids: ids.slice(0, n), usable };
  }

  // ───────────────────────── 버프 인스턴스 위임 (BuffInstance.* → 컴포넌트)
  function biScalarForStat(bi, st) {
    if (bi.removed) return 0;
    let s = 0;
    for (const c of bi.comps) if (c._type === 'BattleStatScalarBuffComponent') {
      if (c.Condition && !condMet(bi.parent.battle, c.Condition, bi.parent)) continue;
      if (STAT_IDX[c.Stat] === st) s = f(s + f(c.Scalar));
    }
    return s;
  }
  function modifyTargetingWeight(m) {
    let w = 1;
    for (const bi of m.buffs) { if (bi.removed) continue; let x = 1; for (const c of bi.comps) { if (c._type === 'AdjustTargetingWeightBuffComponent') x = f(x * f(c.Weight)); else if (globalThis.__TU_WEIGHT && c._type === 'ModifyTuBuffComponent') x = f(x * f(c.Scalar)); } w = f(w * x); }
    return w;
  }
  function isProtector(m) { return m.buffs.some((bi) => bi.comps.some((c) => c._type === 'GuardBuffComponent')); } // ★ GuardBuffComponent 만 IsProtector 를 오버라이드
  function modifyTuAmount(m, tu) {
    for (const bi of m.buffs) { if (bi.removed) continue; for (const c of bi.comps) if (c._type === 'ModifyTuBuffComponent') tu = tu === 0 ? 0 : Math.trunc(Math.max(1, f(f(c.Scalar) * f(tu)))); }
    return tu;
  }
  function isDisabled(m) {
    for (const bi of m.buffs) { if (bi.removed) continue; for (const c of bi.comps) {
      if (c._type === 'LoseTurnBuffComponent') return { on: true, delay: c.DelayTime || 0 };
      if (c._type === 'LifeFlipBuffComponent') { /* LifeFlip.IsDisabled △ — 데이터 LifeFlip 은 즉발형이라 생략 */ }
    } }
    return { on: false, delay: 0 };
  }
  function allowDeath(b, m, startHp, flags, force) {
    for (const bi of m.buffs) {
      if (bi.removed) continue;
      for (const c of bi.comps) if (c._type === 'HoldGroundBuffComponent') { if (!holdGroundAllow(b, bi, c, startHp, flags, force)) return false; }
    }
    return true;
  }
  function holdGroundAllow(b, bi, c, startHp, flags, force) {
    if (force) return true;
    if (startHp <= 1 && !c.TriggerAtOneHp) { cov('hg:at1'); return true; }
    if (b.rnd.nextDouble() >= f(c.ChanceToTrigger)) { cov('hg:miss'); return true; }
    cov('hg:roll');
    if (flags && c.CancelFromDamageFlags && c.CancelFromDamageFlags.some((x) => flags.includes(x))) return true;
    cov('hg:save' + ((c.TriggersAllowed || 0) >= 1 ? ':limited' : '')); b.ev('근성', bi.parent);
    if ((c.TriggersAllowed || 0) >= 1) { if (bi.incProp('hg:' + c._name) >= c.TriggersAllowed) b.queueRemoveBuff(bi); }
    return false;
  }
  function modifyDamageAmount(b, m, src, tgt, dmg, flags) {
    for (const bi of m.buffs) {
      if (bi.removed) continue;
      for (const c of bi.comps) {
        const cancel = c.CancelFromDamageFlags && flags && c.CancelFromDamageFlags.some((x) => flags.includes(x));
        if (c._type === 'DamageScalorBuffComponent') {
          if (c.SourceCondition && !condMet(b, c.SourceCondition, src)) continue;
          if (c.TargetCondition && !condMet(b, c.TargetCondition, tgt)) continue;
          if (bi.parent !== src || cancel) continue;
          dmg = f(f(c.DamageScalar) * dmg);
        } else if (c._type === 'ModifyDamageBuffComponent') {
          if (c.SourceCondition && !condMet(b, c.SourceCondition, src)) continue;
          if (c.TargetCondition && !condMet(b, c.TargetCondition, tgt)) continue;
          if (bi.parent !== tgt || cancel) continue;
          if ((c.TriggersAllowed || 0) >= 1 && bi.incProp('md:' + c._name) >= c.TriggersAllowed) b.queueRemoveBuff(bi);
          dmg = f(f(c.DamageModifier) * dmg);
        }
      }
    }
    return dmg;
  }
  function critParams(m, flags, chance, mult, incoming) {
    const type = incoming ? 'IncomingCritAdjustBuffComponent' : 'OutgoingCritAdjustBuffComponent';
    for (const bi of m.buffs) { if (bi.removed) continue; for (const c of bi.comps) if (c._type === type) {
      if (c.OnlyForDamageFlags && c.OnlyForDamageFlags.length && !c.OnlyForDamageFlags.some((x) => (flags || []).includes(x))) continue;
      if (c.CancelForDamageFlags && c.CancelForDamageFlags.some((x) => (flags || []).includes(x))) continue;
      chance = f(chance * f(c.ChanceAdjust)); mult = f(mult + f(c.MultiplierAdjust || 0));
    } }
    return [chance, mult];
  }

  // ───────────────────────── 전투
  class Battle {
    constructor(seed, opts = {}) {
      this.rnd = new NetRandom(seed); this.queue = new Queue(); this.idCounter = 0; this.timePassed = 0; this.bsa = []; this.byId = new Map();
      this.teams = []; this.winner = null; this.errors = []; this.events = opts.trace ? [] : null; this.steps = 0; this.turns = 0;
    }
    ev(kind, m, extra) { if (this.events) this.events.push({ t: this.timePassed, kind, id: m ? m.id : null, mt: m ? m.mi.ModelType : null, ...extra }); }
    logError(msg) { this.errors.push(msg); }
    enemyOf(m) { return m.team === this.teams[0] ? this.teams[1] : this.teams[0]; }
    gen(mi, team, statArgs) { const m = new BMI(this, mi, team, statArgs); this.byId.set(m.id, m); m.spirit = START_SPIRIT; return m; }
    setup(l) {
      const t = new Team(l, true);
      const args = { rank: l.rank || 0, buffs: l.statBuffs || null, warWins: l.warWins || 0, campus: l.campus || null, scalar: l.scalar ?? 1 };
      for (const mi of l.mobs) { const m = this.gen(mi, t, args); t.reinf.push(m); }
      return t;
    }
    // ── 버프
    applyBuff(name, target, source, isPassive) {
      const buff = BUFF[name]; if (!buff) { this.logError('버프 없음 ' + name); return; }
      const comps = (buff.Components || []).map((n) => { const c = BC[n]; if (!c) throw new Error('버프 컴포넌트 없음 ' + n); return c; });
      if (!isPassive && target.team !== source.team) {
        for (const m of target.team.active) if (m && modifyBuffTarget(this, m, buff, comps, target)) { target = m; break; }
      }
      this.bmiApplyBuff(target, buff, comps, source, isPassive);
    }
    bmiApplyBuff(m, buff, comps, source, isPassive) {
      if (m.hp === 0) { cov('buff:onDead'); return; }
      for (const bi of m.buffs) if (!allowBuffApply(this, bi, buff, source)) { cov('buff:immune'); return; }
      if (buff.StackName != null) {
        for (const bi of m.buffs) {
          if (bi.buff.StackName !== buff.StackName) continue;
          if (f(buff.AttackWeightScalar) > 0 || f(bi.buff.AttackWeightScalar) > 0) {
            const old = f(f(bi.buff.AttackWeightScalar) * f(bi.source.atk));
            const nw = f(f(buff.AttackWeightScalar) * f(source.atk));
            const __sm = globalThis.__STACK_MODE || 'base'; // 실험 훅: base·always(항상 교체)·reverse(약한 쪽 거부 반대)·keepOld(항상 유지)
            if (__sm === 'base' ? old > nw : __sm === 'reverse' ? old < nw : __sm === 'keepOld') { cov('buff:stackWeaker'); return; }
          }
          cov('buff:stackReplace' + (bi.buff.AttackWeightScalar ? ':aws' : '')); this.queueRemoveBuff(bi);
        }
      }
      const bi = new BuffInst(buff); m.buffs.push(bi); bi.parent = m; bi.source = source; bi.isPassive = isPassive;
      bi.comps = comps; bi.hasStat = comps.some((c) => c._type === 'BattleStatScalarBuffComponent');
      this.ev('버프', m, { buff: buff._name, src: source.id });
      for (const c of comps) { cov('ba:' + c._type + (isPassive ? ':p' : '')); onBuffApplied(this, bi, c); }
      // ModifyBuffDuration (ReduceBuffDuration 등) — 쓰이는 데이터 없음
      if (bi.durationLeft < 1 && buff.Duration >= 0) this.queueRemoveBuff(bi);
    }
    queueRemoveBuff(bi) { bi.removed = true; this.bsa.push({ k: 'remove', bi }); }
    removeBuff(bi) { const m = bi.parent; const i = m.buffs.indexOf(bi); if (i >= 0) { m.buffs.splice(i, 1); for (const c of bi.comps) onBuffRemoved(this, bi, c); } }
    queueBuffs(buffs, targets, source) { for (const t of targets) for (const n of buffs) this.bsa.push({ k: 'apply', n, t, s: source }); }
    queueDeferred(buffs, targeting, user) { for (const n of buffs) this.bsa.push({ k: 'deferred', n, targeting, user }); }
    resolveTargeting(user, name, exclude) { return resolveTargets(this, TG(name), user, exclude || null); }
    runBSA() {
      while (this.bsa.length) {
        const a = this.bsa.shift();
        if (a.k === 'apply') this.applyBuff(a.n, a.t, a.s, false);
        else if (a.k === 'remove') this.removeBuff(a.bi);
        else if (a.k === 'deferred') { for (const t of this.resolveTargeting(a.user, a.targeting)) this.applyBuff(a.n, t, a.user, false); }
        else if (a.k === 'addTu') this.queue.addTu(a.m, a.tu, false);
        else if (a.k === 'front') this.queue.setWithPriority(a.m, 0);
        else if (a.k === 'clearBanish') { const m = a.m; for (let i = m.buffs.length - 1; i >= 0; i--) { const bi = m.buffs[i]; if (!bi.buff.IsPersistent && !bi.isPassive) this.removeBuff(bi); } }
        else if (a.k === 'clear') {
          const m = a.m;
          for (let i = m.buffs.length - 1; i >= 0; i--) { const bi = m.buffs[i]; if (!bi.buff.IsPersistent) this.removeBuff(bi); }
        }
      }
    }
    // ── 알림
    notifyTimePassed(dt) {
      const before = Math.trunc(this.timePassed / 100); this.timePassed += dt; const n = Math.trunc(this.timePassed / 100) - before;
      if (n > 0) { this.adjustTeamSpirit(n, this.teams[0]); this.adjustTeamSpirit(n, this.teams[1]); }
      for (const t of this.teams) for (const m of t.active) { if (!m) continue; m.timeInBattle += dt; for (const bi of m.buffs.slice()) biTimePassed(this, bi, dt); }
    }
    forActiveBuffs(fn) { for (const t of this.teams) for (const m of t.active) { if (!m) continue; for (const bi of m.buffs.slice()) fn(bi, m); } }
    notifyTurnStart(active) { this.forActiveBuffs((bi) => { if (bi.removed) return; for (const c of bi.comps) turnTrigger(this, bi, c, active, 'BuffOnTurnStartBuffComponent'); }); }
    notifyOnTurn(active) { this.forActiveBuffs((bi) => { if (bi.removed) return; for (const c of bi.comps) turnTrigger(this, bi, c, active, 'BuffOnTurnBuffComponent'); }); }
    notifyTurnEnd(active) {
      this.forActiveBuffs((bi) => {
        if (bi.removed) return;
        if (active === bi.parent) bi.turnsInBattle++;
        for (const c of bi.comps) {
          turnTrigger(this, bi, c, active, 'BuffOnTurnEndBuffComponent');
          if (c._type === 'RemoveAfterTurnsBuffComponent' && bi.turnsInBattle >= c.Turns) this.queueRemoveBuff(bi);
        }
      });
    }
    notifyBattleStarted() { this.forActiveBuffs((bi) => { for (const c of bi.comps) if (c._type === 'BuffOnBattleStartBuffComponent') { if (this.rnd.nextDouble() < f(c.ChanceToTrigger)) this.queueBuffs(c.Buffs, this.resolveTargeting(bi.parent, c.Targeting), bi.parent); } }); }
    notifyMonstersEntered(list) { for (const e of list) this.forActiveBuffs((bi) => { if (bi.removed) return; for (const c of bi.comps) enterTrigger(this, bi, c, e); }); }
    notifyMonsterDeath(killer, dead) { this.forActiveBuffs((bi) => { if (bi.removed) return; for (const c of bi.comps) deathTrigger(this, bi, c, killer, dead); }); }
    adjustSpirit(n, m) { m.spirit = Math.min(MAX_SPIRIT, m.spirit + n); }
    adjustTeamSpirit(n, t) { t.spirit = Math.min(MAX_SPIRIT, t.spirit + n); }
    // ── 피해
    doDamageList(dmgs) {
      const amts = dmgs.map((d) => { const a = calcDamage(this, d); applyDamage(this, d, a); return a; });
      dmgs.forEach((d, i) => { if (d.notifyHit && d.attacker) notifyDealt(this, d.attacker, d.attacker, d.defender, amts[i], d.flags); });
      dmgs.forEach((d, i) => { if (d.notifyHurt && d.defender) notifyTook(this, d.defender, d.attacker, d.defender, amts[i], d.flags); });
      dmgs.forEach((d) => notifyDied(this, d));
      return amts;
    }
    doDamage(d) { return this.doDamageList([d])[0]; }
    // ── 큐·증원
    addReinf(start, pen) {
      const list = [];
      const forTeam = (t, tu) => {
        if (t.reinf.length >= 1 && t.hasEmptySlot()) {
          const m = t.addToActive(); for (let i = 0; i < (globalThis.__ENTER_RNG || 0); i++) this.rnd.next(); this.queue.add(tu, m, this.rnd); if (!m.enteredBefore) this.applyPassives(m); if (!m.enteredBefore || globalThis.__REENTRY_HEALS) m.hp = m.maxHp; m.enteredBefore = true; // ★ 2026-10-20 어썸(08): 후퇴했다 다시 들어오면 체력은 나갈 때 그대로(정답 체력 차 381,764 = 후퇴 때 잃은 체력)
          this.ev('입장', m, { tu }); return m;
        }
        return null;
      };
      const [t1, t2] = this.teams;
      if (pen !== 0) {
        let e = start, m; while ((m = forTeam(t1, e))) { list.push(m); e += 10; }
        e = pen + 30; while ((m = forTeam(t2, e))) { list.push(m); e += 10; }
        return list;
      }
      for (;;) {
        if (!((t1.reinf.length >= 1 && t1.hasEmptySlot()) || (t2.reinf.length >= 1 && t2.hasEmptySlot()))) break;
        const m1 = forTeam(t1, start + 10 * list.length); if (m1) list.push(m1);
        const m2 = forTeam(t2, start + 10 * list.length); if (m2) list.push(m2);
        cov('reinf:' + (m1 ? 'A' : '-') + (m2 ? 'B' : '-'));
      }
      return list;
    }
    applyPassives(m) {
      for (const p of m.mon.PassiveSkills || []) if (skillUnlocked(m, p, m.mon.PassiveSkillLevels)) this.applyBuff(p, m, m, true);
      const u = m.mon.UniqueSkills; if (u && u.length) { const n = u[m.mi.Awakening || 0]; if (n) this.applyBuff(n, m, m, true); }
      for (const x of m.team.extra) this.applyBuff(x, m, m, true);
    }
    pendingDeaths() { const out = []; for (const t of this.teams) for (const m of t.active) if (m && m.hp <= 0) out.push(m); return out; }
    hasPendingDeaths() { return this.pendingDeaths().length > 0; }
    doDeaths() {
      const dead = this.pendingDeaths();
      for (let i = 0; i < (globalThis.__DEATHSTEP_RNG || 0) && dead.length; i++) this.rnd.next();
      for (const m of dead) {
        for (let i = 0; i < (globalThis.__DEATH_RNG || 0); i++) this.rnd.next();
        m.team.removeDead(m); this.queue.remove(m); this.bsa.push({ k: 'clear', m });
        this.ev('사망', m, { killer: m.sourceOfDeath ? m.sourceOfDeath.id : null });
        this.notifyMonsterDeath(m.sourceOfDeath, m);
        if (m.sourceOfDeath) m.sourceOfDeath.kills++;
      }
      // NotifyMonstersLeft — 쓰이는 컴포넌트(RemoveOnSourceLeave 등) 없음
    }
    finished() { return this.teams.some((t) => t.isEmpty()); }
    tuForSkip() {
      const front = this.queue.front(); let w = 0, first = true;
      for (const m of this.enemyOf(front).active) { if (!m) continue; const v = this.queue.timeFor(m) + 1; w = first ? v : Math.min(w, v); first = false; }
      return w;
    }
    refreshCached() { for (const t of this.teams) for (const m of t.active) if (m) m.recalc(); }
    // ── 스텝
    changeStep(step) {
      COV.t = this.timePassed;
      this.refreshCached();
      const next = this.doStep(step);
      this.runBSA();
      if (step.k === 'Death' && this.hasPendingDeaths()) { cov('step:chainDeath'); return { k: 'Death', interrupt: true, skip: false }; }
      return next;
    }
    doStep(s) {
      switch (s.k) {
        case 'Start': {
          this.addReinf(0, s.pen || 0); this.queue.advanceToFront(); this.notifyBattleStarted(); return { k: 'AdvanceTU' };
        }
        case 'AdvanceTU': { const dt = this.queue.advanceToFront(); this.notifyTimePassed(dt); return { k: 'Reinf', skip: false }; }
        case 'Reinf': { const e = this.addReinf(50, 0); this.notifyMonstersEntered(e); return s.skip ? { k: 'Turn' } : { k: 'TurnStart' }; }
        case 'TurnStart': { this.notifyTurnStart(this.queue.front()); return { k: 'Turn' }; }
        case 'Turn': {
          const a = this.queue.front(); this.turns++;
          const dis = isDisabled(a);
          if (dis.on) { cov('step:disabled'); this.ev('행동불가', a, { delay: dis.delay }); return { k: 'Skip', delay: dis.delay, pass: false }; }
          const pk = resolveAi(this, a);
          if (pk.ability === 'Pass') { this.ev('패스', a); return { k: 'Skip', delay: this.tuForSkip(), pass: true }; }
          this.notifyOnTurn(a);
          return { k: 'Exec', pk };
        }
        case 'Skip': { this.notifyOnTurn(this.queue.front()); return { k: 'ExecSkip', delay: s.delay, pass: s.pass }; }
        case 'ExecSkip': { const a = this.queue.front(); this.queue.addTu(a, s.delay, s.pass); return { k: 'TurnEnd', a }; }
        case 'Exec': {
          const a = this.queue.front();
          if (globalThis.__RETARGET && globalThis.__RETARGET[this.timePassed + ':' + a.id]) s.pk.ids = globalThis.__RETARGET[this.timePassed + ':' + a.id]; // 실험 훅
          const targets = s.pk.ids ? s.pk.ids.map((id) => this.byId.get(id)) : null;
          executeAbility(this, s.pk.ability, targets);
          return { k: 'TurnEnd', a };
        }
        case 'TurnEnd': { this.notifyTurnEnd(s.a); return this.hasPendingDeaths() ? { k: 'Death', interrupt: false, skip: false } : { k: 'AdvanceTU' }; }
        case 'Death': {
          this.doDeaths();
          if (this.finished()) return { k: 'End' };
          if (this.queue.tuAtFront() === 0 && s.interrupt) { cov('step:deathReinf' + (s.skip ? ':skip' : '')); return { k: 'Reinf', skip: s.skip }; }
          cov('step:deathAdvance' + (s.interrupt ? ':int' : ''));
          return { k: 'AdvanceTU' };
        }
        case 'End': { this.finish(); return null; }
      }
      throw new Error('스텝 ' + s.k);
    }
    finish() { this.winner = this.teams[0].isEmpty() ? (this.teams[1].isEmpty() ? null : this.teams[1].id) : this.teams[0].id; }
    run(l1, l2, maxSteps = 30000) {
      this.teams = [this.setup(l1), this.setup(l2)];
      let step = this.changeStep({ k: 'Start', pen: l2.timePenalty || 0 });
      while (step && this.steps < maxSteps) {
        this.steps++;
        if (step.k === 'TurnStart' && this.hasPendingDeaths()) { cov('step:deathBeforeTurnStart'); step = { k: 'Death', interrupt: true, skip: false }; }
        else if (step.k === 'Turn' && this.hasPendingDeaths()) { cov('step:deathBeforeTurn'); step = { k: 'Death', interrupt: true, skip: true }; }
        else if (step.k === 'TurnStart' && this.queue.tuAtFront() !== 0) step = { k: 'AdvanceTU' };
        step = this.changeStep(step);
      }
      return this;
    }
    snapshot() {
      const w = this.winner === this.teams[0].id ? this.teams[0] : this.winner === this.teams[1].id ? this.teams[1] : null;
      const q = {}; this.queue.k.forEach((k, i) => { q[k] = this.queue.v[i].id; });
      return {
        winner: this.winner, steps: this.steps, turns: this.turns, rngCalls: this.rnd.calls,
        active: w ? w.active.map((m) => m && { id: m.id, mt: m.mi.ModelType, hp: m.hp, tib: m.timeInBattle, kills: m.kills, spirit: m.spirit,
          buffs: m.buffs.map((bi) => [bi.buff._name, bi.durationLeft, bi.timeInBattle, bi.turnsInBattle]) }) : [],
        reinf: w ? w.reinf.length : null, next: w && w.reinf[0] ? w.reinf[0].mi.ModelType : null, queue: q,
      };
    }
  }

  // ───────────────────────── 컴포넌트: 버프
  function allowBuffApply(b, bi, buff, source) {
    if (bi.removed) return true;
    for (const c of bi.comps) if (c._type === 'ImmunityBuffComponent') {
      if (buff.StackName != null && (c.StackNames || []).includes(buff.StackName)) {
        if ((c.TriggersAllowed || 0) >= 1 && bi.incProp('im:' + c._name) >= c.TriggersAllowed) b.queueRemoveBuff(bi);
        return false;
      }
    }
    return true;
  }
  function modifyBuffTarget(b, m, buff, comps, target) {
    for (const bi of m.buffs) { if (bi.removed) continue; for (const c of bi.comps) if (c._type === 'StunAbsorbBuffComponent') {
      if (target.team === bi.parent.team && target !== bi.parent && comps.some((x) => x._type === 'StunBuffComponent')) {
        if ((c.TriggersAllowed || 0) >= 1 && bi.incProp('sa:' + c._name) >= c.TriggersAllowed) b.queueRemoveBuff(bi);
        return true;
      }
    } }
    return false;
  }
  function onBuffApplied(b, bi, c) {
    const m = bi.parent;
    switch (c._type) {
      case 'BattleStatScalarBuffComponent': m.recalc(); break;
      case 'StunBuffComponent': {
        let amt = c.Amount || 0;
        for (const x of m.buffs) { if (x.removed) continue; for (const k of x.comps) if (k._type === 'StunModifyBuffComponent') amt = amt + (k.Amount || 0); }
        if (amt >= 0) b.queue.addTu(m, amt, false); else b.bsa.push({ k: 'addTu', m, tu: amt });
        b.ev('스턴', m, { amt });
        break;
      }
      case 'GetTurnBuffComponent': b.bsa.push({ k: 'front', m }); b.ev('턴획득', m); break;
      case 'DamageBuffComponent': {
        const [amt] = damageAbilityDoDamage(b, c.DamageType || 'NoType', bi.source, [m], c, (c.Flags || []), 0, 0, !!c.AssignKiller, false); // 독 틱: 기본 치명 없음
        if (f(c.ReflectDamagePercent || 0) > 0) {
          const d = mkDamage(Math.trunc(f(f(c.ReflectDamagePercent) * f(Math.max(0, amt[0])))), bi.source, bi.source, null); d.ignoreScalars = true; b.doDamage(d);
        }
        break;
      }
      case 'DamageOverTimeBuffComponent': bi.props.dotAtk = bi.source.atk; break;
      case 'HealOverTimeBuffComponent': bi.props.hotAtk = bi.source.atk; break;
      case 'PercentAdjustHpBuffComponent': {
        const p = f(c.Percent);
        if (p > 0) { const d = mkDamage(Math.trunc(f(p * f(m.maxHp))), bi.source, m, c.DamageFlags || null); d.ignoreScalars = d.notifyHit = d.notifyHurt = d.assignKiller = true; b.doDamage(d); }
        else { const heal = Math.trunc(f(f(-p) * f(m.maxHp))); m.hp = Math.min(m.maxHp, m.hp + heal); b.ev('회복', m, { heal }); }
        break;
      }
      case 'FlatAdjustHpBuffComponent': {
        const a = c.Amount || 0;
        if (a > 0) { const d = mkDamage(a, bi.source, m, c.DamageFlags || null); d.ignoreScalars = d.notifyHit = d.notifyHurt = d.assignKiller = true; b.doDamage(d); }
        else m.hp = Math.min(m.maxHp, m.hp - a);
        break;
      }
      case 'InstantDeathBuffComponent': { const d = mkDamage(m.hp, bi.source, m, null); d.ignoreScalars = true; d.forceAllowDeath = !c.AllowBlockDeath; d.notifyHit = d.notifyHurt = d.assignKiller = true; b.doDamage(d); break; }
      case 'LifeFlipBuffComponent': {
        const pct = f(f(m.hp) / f(m.maxHp)); const nh = Math.max(1, Math.trunc(f(f(1 - pct) * f(m.maxHp))));
        const diff = m.hp - nh;
        if (diff >= 1) b.doDamage(mkDamage(diff, bi.source, m, c.DamageFlags || null)); // ★ @0xb5ed394: new Damage(...) 뿐 — IgnoreScalars·알림·처치자 모두 false
        else if (diff < 0) m.hp = nh;
        break;
      }
      case 'RemoveBuffsBuffComponent': {
        for (let i = m.buffs.length - 1; i >= 0; i--) { const x = m.buffs[i]; if (x !== bi && (c.StackNames || []).includes(x.buff.StackName)) b.queueRemoveBuff(x); }
        break;
      }
      case 'SendToReinforcementsBuffComponent': {
        const t = m.team; const i = t.active.indexOf(m);
        if (i >= 0) { t.active[i] = null; b.queue.remove(m); if (c.Position === -1 || c.Position >= t.reinf.length) t.reinf.push(m); else t.reinf.splice(c.Position, 0, m); }
        if (!globalThis.__BANISH_KEEPS) b.bsa.push({ k: 'clearBanish', m }); // ★ 2026-10-20 어썸(08) 영상: 후퇴(StepToBack)하면 비영속·비패시브 버프가 지워진다(안나 독이 사라지고 재입장 뒤 스파이크 독 148 틱) · 패시브(StunEntryDoubleLv2)는 남아 재입장 때 다시 안 붙는다(정답 버프 TimeInBattle 1800) — 훅 __BANISH_KEEPS 로 옛 동작
        break;
      }
      case 'AddSpiritBuffComponent': b.adjustSpirit(c.Spirit || 0, m); break;
      default: break;
    }
  }
  function onBuffRemoved(b, bi, c) { if (c._type === 'BattleStatScalarBuffComponent') bi.parent.recalc(); }
  function biTimePassed(b, bi, tu) {
    if (bi.removed) return;
    bi.durationLeft -= tu; bi.timeInBattle += tu;
    for (const c of bi.comps) {
      if (c._type === 'DamageOverTimeBuffComponent') dotTick(b, bi, c, tu);
      else if (c._type === 'HealOverTimeBuffComponent') {
        let heal = 0; const m = bi.parent;
        if (f(c.PercentOfAttack || 0) > 0) heal = Math.trunc(f(f(f(f(c.PercentOfAttack) / f(100)) * f(bi.props.hotAtk || 0)) * f(tu)));
        else if (f(c.PercentOfHp || 0) > 0) heal = Math.trunc(f(f(f(f(c.PercentOfHp) / f(100)) * f(m.maxHp)) * f(tu)));
        m.hp = Math.min(m.maxHp, m.hp + heal);
      } else if (c._type === 'BuffAfterTimeBuffComponent') {
        if (bi.timeInBattle >= c.Time) b.queueBuffs(c.Buffs, b.resolveTargeting(bi.parent, c.Targeting), bi.parent);
      }
    }
    if (bi.durationLeft < 1 && bi.buff.Duration >= 0) b.queueRemoveBuff(bi);
  }
  function dotTick(b, bi, c, tu) {
    const m = bi.parent; let dmg;
    if (f(c.PercentOfAttack || 0) > 0) dmg = Math.trunc(f(f(f(f(c.PercentOfAttack) / f(100)) * f(bi.props.dotAtk || 0)) * f(tu)));
    else if (f(c.PercentOfHp || 0) > 0) dmg = Math.trunc(f(f(f(f(c.PercentOfHp) / f(100)) * f(m.maxHp)) * f(tu)));
    else dmg = 0;
    dmg = Math.max(1, dmg);
    const d = mkDamage(dmg, bi.source, m, c.DamageFlags || null);
    if (f(c.PercentOfHp || 0) > 0) d.ignoreScalars = true;
    if (c.DoesNotKill) { if (m.hp === 1) return; d.minHp = 1; }
    if (f(c.DamageThreshold || 0) > 0) { const cap = Math.trunc(f(f(c.DamageThreshold) * f(m.maxHp))); if (m.hp <= cap) return; d.minHp = cap; }
    b.doDamage(d);
  }
  function turnTrigger(b, bi, c, active, type) {
    if (c._type !== type) return;
    cov('turnTrig:' + type + ':' + c._name);
    if (c.OnEnemyTurnOnly && active.team === bi.parent.team) return;
    if (c.OnAllyTurnOnly && active.team !== bi.parent.team) return;
    if (c.ActiveMonsterCondition) { if (!condMet(b, c.ActiveMonsterCondition, active)) return; }
    else if (bi.parent !== active) return;
    if ((globalThis.__TRIG_ROLL_LT1 && f(c.ChanceToTrigger) >= 1) || b.rnd.nextDouble() < f(c.ChanceToTrigger)) {
      const targets = b.resolveTargeting(bi.parent, c.Targeting);
      b.queueBuffs(c.Buffs, targets, c.ForwardSource ? bi.source : bi.parent);
      incTrig(b, bi, c);
    } else if (c.IncrementTriggersOnFail) incTrig(b, bi, c);
  }
  function incTrig(b, bi, c) { if ((c.TriggersAllowed || 0) >= 1 && bi.incProp('tr:' + c._name) >= c.TriggersAllowed) b.queueRemoveBuff(bi); }
  function enterTrigger(b, bi, c, entered) {
    if (c._type === 'EnterBattleBuffComponent') {
      if (entered !== bi.parent) return;
      cov('enter:' + c._name);
      if (b.rnd.nextDouble() < f(c.ChanceToTrigger)) { b.queueBuffs(c.Buffs, b.resolveTargeting(bi.parent, c.Targeting), bi.parent); incTrig(b, bi, c); }
      else if (c.IncrementTriggersOnFail) incTrig(b, bi, c);
    } else if (c._type === 'OthersEnterBuffComponent') {
      if (entered === bi.parent) return;
      if (c.OnEnemyEnterOnly && entered.team === bi.parent.team) return;
      if (c.OnAllyEnterOnly && entered.team !== bi.parent.team) return;
      if (globalThis.__ENTER_COND_FIRST && c.EntreeIsTarget && c.KeepTargetingCondition) { const tc = TG(c.Targeting).TargetingCondition; if (tc && !condMet(b, tc, entered)) return; } // 실험 훅
      if ((globalThis.__TRIG_ROLL_LT1 && f(c.ChanceToTrigger) >= 1) || b.rnd.nextDouble() < f(c.ChanceToTrigger)) {
        let targets;
        if (c.EntreeIsTarget) { if (c.KeepTargetingCondition) { const tc = TG(c.Targeting).TargetingCondition; if (tc && !condMet(b, tc, entered)) { if (c.IncrementTriggersOnFail) incTrig(b, bi, c); return; } } targets = [entered]; }
        else targets = b.resolveTargeting(bi.parent, c.Targeting);
        b.queueBuffs(c.Buffs, targets, bi.parent); incTrig(b, bi, c);
      } else if (c.IncrementTriggersOnFail) incTrig(b, bi, c);
    }
  }
  function deathTrigger(b, bi, c, killer, dead) {
    const enemy = c._type === 'BuffOnEnemyDeathBuffComponent', ally = c._type === 'BuffOnAllyDeathBuffComponent';
    if (!enemy && !ally) return;
    const same = dead.team === bi.parent.team;
    if (enemy && same) return; if (ally && !same) return;
    cov('death:' + c._name);
    if (b.rnd.nextDouble() < f(c.ChanceToTrigger)) { b.queueBuffs(c.Buffs, b.resolveTargeting(bi.parent, c.Targeting), bi.parent); incTrig(b, bi, c); }
    else if (c.IncrementTriggersOnFail) incTrig(b, bi, c);
  }
  function hitTrigger(b, bi, c, src, tgt, amount, flags, hurt) {
    const type = hurt ? 'BuffOnHurtBuffComponent' : 'BuffOnHitBuffComponent';
    if (c._type !== type) return;
    if (amount < 1) { cov('hit:zero'); return; }
    if (hurt ? bi.parent !== tgt : bi.parent !== src) return;
    cov((hurt ? 'hurt:' : 'hit:') + c._name);
    const r = (globalThis.__HIT_ROLL_LT1 && f(c.ChanceToTrigger) >= 1) ? 0 : b.rnd.nextDouble(); // 실험 훅
    const ok = r < f(c.ChanceToTrigger);
    if (ok && c.CancelFromDamageFlags && flags && c.CancelFromDamageFlags.some((x) => flags.includes(x))) { cov('hit:cancel'); return; }
    if (ok) cov((hurt ? 'hurtOK:' : 'hitOK:') + c._name);
    if (!ok) { if (c.IncrementTriggersOnFail) incTrig(b, bi, c); return; }
    const other = hurt ? src : tgt;
    const isT = hurt ? c.SourceIsTarget : c.TargetIsTarget, isTT = hurt ? c.SourceIsTargetAndTargeting : c.TargetIsTargetAndTargeting;
    let targets = [];
    if (isTT) {
      if (c.KeepTargetingCondition) { const tc = TG(c.Targeting).TargetingCondition; if (!tc || condMet(b, tc, other)) targets.push(other); } else targets.push(other);
      if (c.DeferTargetingResolve) { b.queueDeferred(c.Buffs, c.Targeting, bi.parent); }
      else targets.push(...b.resolveTargeting(bi.parent, c.Targeting, targets));
    } else if (isT) {
      if (c.KeepTargetingCondition) { const tc = TG(c.Targeting).TargetingCondition; if (tc && !condMet(b, tc, other)) return; }
      targets.push(other);
    } else {
      if (c.DeferTargetingResolve) { b.queueDeferred(c.Buffs, c.Targeting, bi.parent); incTrig(b, bi, c); return; }
      targets = b.resolveTargeting(bi.parent, c.Targeting);
    }
    b.queueBuffs(c.Buffs, targets, bi.parent);
    incTrig(b, bi, c);
  }
  function revengeTrigger(b, bi, c, killer, flags) {
    if (c._type !== 'RevengeBuffComponent') return;
    cov('rev:' + c._name + (killer ? '' : ':noKiller'));
    if (!(b.rnd.nextDouble() < f(c.ChanceToTrigger))) return;
    if (c.CancelFromDamageFlags && flags && c.CancelFromDamageFlags.some((x) => flags.includes(x))) return;
    const targets = [];
    if (c.TargetKillerAndTargeting) {
      if (killer) {
        let add = true;
        if (c.KeepTargetingChance) { const ch = f(TG(c.Targeting).ChancePerTarget ?? 1); add = b.rnd.nextDouble() < ch; }
        if (add) targets.push(killer);
      }
    } else if (c.TargetKiller) {
      if (!killer) return;
      if (c.KeepTargetingChance) { const ch = f(TG(c.Targeting).ChancePerTarget ?? 1); if (!(b.rnd.nextDouble() < ch)) return; }
      targets.push(killer);
      b.queueBuffs(c.Buffs, targets, bi.parent); return;
    }
    if (c.DeferTargetingResolve) { b.queueDeferred(c.Buffs, c.Targeting, bi.parent); return; }
    targets.push(...b.resolveTargeting(bi.parent, c.Targeting, c.TargetKillerAndTargeting ? targets.slice() : null));
    b.queueBuffs(c.Buffs, targets, bi.parent);
  }

  // ───────────────────────── 피해
  function mkDamage(base, attacker, defender, flags) {
    return { base, attacker, defender, flags: flags ? flags.slice() : null, ignoreScalars: false, notifyHit: false, notifyHurt: false, assignKiller: false, minHp: 0, forceAllowDeath: false, crit: 1 };
  }
  function calcDamage(b, d) {
    if (f(d.crit) > 1) { d.flags = d.flags || []; d.flags.push('Crit'); }
    let s8 = f(d.base);
    if (!d.ignoreScalars) {
      const a = d.attacker.element, t = d.defender.element;
      let e = 1;
      // (폐기 2026-10-20) 포이즌 이터 속성 불리 무시 경험칙 — 191·137 의 어긋남은 기본 치명 4% 였다(가나 영상 90TU 400,324 = 500,405×0.8 로 확인)
      const __pe = d.flags && d.flags.includes('PoisonEat');
      if (a === 1) e = t === 2 ? f(0.8) : t === 0 ? 1.25 : 1;
      else if (a === 2) e = t === 0 ? f(0.8) : t === 1 ? 1.25 : 1;
      else if (a === 0) e = t === 1 ? f(0.8) : t === 2 ? 1.25 : 1;
      const __pm = globalThis.__PE_MODE || 'none'; // 실험 훅: none(기본 — 2026-10-20 기본 치명으로 대체돼 폐기)·all·mag·phys
      if (__pe && e < 1 && (__pm === 'all' || (__pm === 'mag' && d.flags.includes('Mag')) || (__pm === 'phys' && d.flags.includes('Phys')))) e = 1;
      s8 = f(e * s8);
      s8 = modifyDamageAmount(b, d.defender, d.attacker, d.defender, s8, d.flags);
      s8 = modifyDamageAmount(b, d.attacker, d.attacker, d.defender, s8, d.flags);
    }
    const x = Math.max(1, f(s8 * Math.max(1, f(d.crit))));
    if (b.events) d._pre = x;
    return Math.ceil(x);
  }
  function applyDamage(b, d, amt) {
    const m = d.defender; const start = m.hp;
    m.hp = Math.max(d.minHp, m.hp - amt);
    if (m.hp <= 0 && !allowDeath(b, m, start, d.flags, d.forceAllowDeath)) m.hp = 1;
    if (m.hp <= 0) cov('dmg:kill' + (d.assignKiller ? '' : ':noKiller'));
    if (d.minHp > 0) cov('dmg:minHp');
    b.ev('피해', m, { amt, hp: m.hp, by: d.attacker ? d.attacker.id : null, crit: f(d.crit) > 1, pre: d._pre, base: d.base });
  }
  function notifyDealt(b, m, src, tgt, amt, flags) { for (const bi of m.buffs.slice()) { if (bi.removed) continue; for (const c of bi.comps) hitTrigger(b, bi, c, src, tgt, amt, flags, false); } }
  function notifyTook(b, m, src, tgt, amt, flags) {
    for (const bi of m.buffs.slice()) {
      if (bi.removed) continue;
      for (const c of bi.comps) {
        hitTrigger(b, bi, c, src, tgt, amt, flags, true);
        if (c._type === 'RemoveOnHurtBuffComponent' && bi.parent === tgt && !(src === tgt && c.IgnoreSelfDamage)) b.queueRemoveBuff(bi);
      }
    }
  }
  function notifyDied(b, d) {
    const m = d.defender; if (!m || m.hp > 0) return;
    if (d.assignKiller) m.sourceOfDeath = d.attacker;
    for (const bi of m.buffs.slice()) { if (bi.removed) continue; for (const c of bi.comps) revengeTrigger(b, bi, c, m.sourceOfDeath, d.flags); }
  }
  // DamageAbilityComponent.CalculateDamage (정적: 속성·버프·치명 없음)
  function staticCalc(b, type, user, target, c) {
    const scalar = totalScalorOnTarget(b, c, user, target);
    const atk = user.stat(5);
    if (type === 'NoType' || type === 0 || type == null) return Math.ceil(f(scalar * f(f(atk) * f(0.2)))); // ★ e4574: scalar × (atk × 0.2f)
    const phys = type === 'Physical';
    const ta = phys ? user.stat(6) : user.stat(8), td = phys ? target.stat(7) : target.stat(9);
    return scaledDamage(ta, td, atk, f(scalar * f(0.2)));
  }
  // ★ CalculateScaledDamage @0xb5e45f4: a>d ? (a−d+b) : b − b×(d−a)/d  (float32, 순서 그대로) → × scalar → ceil
  function scaledDamage(a, d, b, sc) {
    const v = a > d ? f(a - d + b) : f(f(b) - f(f(f(d - a) / f(d)) * f(b)));
    return Math.ceil(f(v * sc));
  }
  // static DoDamage(battle, type, user, targets, comp-fields…) → [[amount, crit], …]
  // ★ 기본 치명(2026-10-20 · 투기장 영상 «가나» + 21판 대조로 확정): 능력의 피해 컴포넌트는 CritChance 를 안 적어도 4% 확률·2배 치명이 있다
  //   (0.038~0.040 사이 어느 값이든 19/21 일치 · 독 틱(DamageBuffComponent)에는 없음 — 01·16번 독 틱 치명이 실제와 어긋남). 원문의 기본값 위치는 미확인.
  const BASE_CRIT_CHANCE = 0.05, BASE_CRIT_MULT = 2;
  function damageAbilityDoDamage(b, type, user, targets, c, flags, critChance, critMult, assignKiller, isAbility = true) {
    const dmgs = [], crits = [];
    for (const t of targets) {
      const base = staticCalc(b, type, user, t, c);
      const d = mkDamage(base, user, t, flags); d.notifyHit = d.notifyHurt = true; d.assignKiller = assignKiller;
      let ch0 = f(critChance), mu0 = f(critMult);
      if (isAbility && !globalThis.__NO_BASE_CRIT) { const bc = globalThis.__BASE_CRIT || { chance: BASE_CRIT_CHANCE, mult: BASE_CRIT_MULT }; if (globalThis.__CRIT_ADD) ch0 = f(ch0 + bc.chance); else if (ch0 < bc.chance) ch0 = bc.chance; if (!(mu0 > 1)) mu0 = bc.mult; }
      let [ch, mu] = critParams(user, flags, ch0, mu0, false);
      [ch, mu] = critParams(t, flags, ch, mu, true);
      const r = (globalThis.__CRIT_ONLY_IF_CHANCE && !(ch > 0)) ? 1 : b.rnd.nextDouble();
      if (r < ch) { cov('crit'); d.crit = mu; }
      if (ch > 0) cov('critChance');
      dmgs.push(d); crits.push(r < ch);
    }
    const amts = b.doDamageList(dmgs);
    return [amts, crits];
  }

  // ───────────────────────── 능력 실행 (Battle.ExecuteAbility)
  function executeAbility(b, name, targets) {
    const user = b.queue.front();
    const ab = D.abilities[name]; if (!ab) throw new Error('능력 없음 ' + name);
    const cfg = D.abilityConfigs[ab.Config]; const t = TG(ab.Targeting);
    if (!showTargeting(t)) { cov('ex:resolve'); targets = resolveTargets(b, t, user, null); } else cov('ex:given');
    targets = targets || [];
    const protectors = [], protectees = [];
    for (const e of b.enemyOf(user).active) {
      if (!e) continue;
      if (isProtector(e)) { if (!targets.includes(e)) protectors.push(e); }
      else if (targets.includes(e)) protectees.push(e);
    }
    if (protectors.length) cov('ex:protectors');
    for (const p of orderBy(protectors, () => b.rnd.next())) if (protectees.length !== 0) modifyTargeting(b, p, user, ab, cfg, targets, protectees);
    const hit = targets.filter((x) => allowHitTarget(b, x, user, targets, ab.Flags));
    const tu = modifyTuAmount(user, ab.TUCost);
    b.ev('행동', user, { ab: name, tgt: hit.map((x) => x.id) });
    user.usages[name] = (user.usages[name] || 0) + 1;
    for (const cn of cfg.Components) {
      const c = AC[cn]; if (!c) throw new Error('능력 컴포넌트 없음 ' + cn);
      abilityComponent(b, c, user, ab, hit);
    }
    b.queue.addTu(user, tu, false);
    b.adjustSpirit(-(ab.SpiritCost || 0), user);
    b.adjustTeamSpirit(-(ab.TeamSpiritCost || 0), user.team);
  }
  function allowHitTarget(b, x, user, targets, flags) { return true; } // 은신(Stealth) 데이터 미사용
  function modifyTargeting(b, p, user, ab, cfg, targets, protectees) {
    for (const bi of p.buffs) { if (bi.removed) continue; for (const c of bi.comps) if (c._type === 'GuardBuffComponent') {
      // ★ 원문(GuardBuffComponent.ModifyTargeting 디컴파일 2026-10-19): 비었는지·몇 명인지·누구를 고르는지 전부 protectees(적 활성 칸 순서) 기준
      if (protectees.length === 0) continue;
      if (b.rnd.nextDouble() > f(c.Chance)) continue;
      const comps = cfg.Components.map((n) => AC[n]._type);
      if (!comps.includes('DamageAbilityComponent') && !comps.includes('BossSalvoAbilityComponent')) continue;
      const idx = protectees.length >= 2 ? b.rnd.nextMax(protectees.length) : 0;
      const picked = protectees[idx]; protectees.splice(idx, 1); const j = targets.indexOf(picked); if (j >= 0) targets.splice(j, 1);
      targets.push(bi.parent); b.ev('가드', bi.parent, { for: picked.id });
      return true;
    } }
    return false;
  }
  function abilityComponent(b, c, user, ab, targets) {
    switch (c._type) {
      case 'DamageAbilityComponent': {
        cov('dmgAb:n' + targets.length + (c.TargetDamageScalars ? ':tScal' : '') + (c.SourceDamageScalars ? ':sScal' : '') + (c.TimeStrikeTargetTu ? ':ts' : ''));
        const before = new Map(targets.map((x) => [x, x.hp]));
        damageAbilityDoDamage(b, ab.DamageType, user, targets, c, [...(c.Flags || []), ...(ab.Flags || [])], c.CritChance || 0, c.CritMultiplier || 0, true); // 피해 플래그 = 컴포넌트 + 능력 플래그
        if (f(c.ReflectDamagePercent || 0) > 0 && targets.length) {
          let sum = 0; for (const [x, h] of before) sum += h - Math.max(x.hp, 0);
          const d = mkDamage(Math.trunc(f(f(c.ReflectDamagePercent) * f(sum))), user, user, null); d.ignoreScalars = true; b.doDamage(d);
        }
        break;
      }
      case 'ApplyBuffAbilityComponent': {
        const ts = c.OverrideTargetToSelf ? [user] : targets;
        if (c.OverrideTargetToSelf) cov('ab:applySelf');
        for (const t of ts) {
          if (!(globalThis.__APPLY_ROLL_LT1 && f(c.ChanceToApply) >= 1) && b.rnd.nextDouble() >= f(c.ChanceToApply)) { cov('ab:applyMiss'); continue; } // 실험 훅
          if (c.ApplyCondition && !condMet(b, c.ApplyCondition, t)) { cov('ab:applyCondFail'); continue; }
          for (const n of c.Buffs || []) b.applyBuff(n, t, user, false);
        }
        break;
      }
      case 'HealAbilityComponent': {
        for (const t of targets) { const heal = Math.trunc(f(f(user.stat(STAT_IDX[c.StatToUse])) * f(c.HealScalar))); t.hp = Math.min(t.hp + heal, t.maxHp); b.ev('회복', t, { heal }); }
        break;
      }
      case 'AddSpiritAbilityComponent': for (const t of targets) if (!c.TargetCondition || condMet(b, c.TargetCondition, t)) b.adjustSpirit(c.Spirit || 0, t); break;
      case 'ChanceToDieAbilityComponent': if (b.rnd.nextDouble() < f(c.Chance)) { user.hp = 0; b.ev('자폭', user); } break;
      default: b.logError('미구현 능력 컴포넌트 ' + c._type);
    }
  }

  // ───────────────────────── AI (Battle.ResolveAiForActive)
  function isAbilityUsable(b, user, ab) {
    if ((ab.UseLimit || 0) > 0 && (user.usages[ab._name] || 0) >= ab.UseLimit) return false;
    if ((ab.SpiritCost || 0) > user.spirit) return false;
    if ((ab.TeamSpiritCost || 0) > user.team.spirit) return false;
    if (ab.UseCondition && !condMet(b, ab.UseCondition, user)) return false;
    return true;
  }
  function resolveAi(b, user) {
    COV.t = b.timePassed;
    let abs = (user.mon.ActiveSkills || []).filter((n) => user.isActiveSkillUnlocked(n)).map((n) => Object.assign({ _name: n }, D.abilities[n]));
    if (globalThis.__USABLE_FIRST) abs = abs.filter((a) => isAbilityUsable(b, user, a)); // 실험 훅: 쓸 수 있는 능력만 섞는다
    if (globalThis.__COND_FIRST) abs = abs.filter((a) => !a.UseCondition || condMet(b, a.UseCondition, user)); // 실험 훅: 사용 조건만 먼저 거른다
    if (globalThis.__LIMIT_FIRST) abs = abs.filter((a) => !((a.UseLimit || 0) > 0 && (user.usages[a._name] || 0) >= a.UseLimit)); // 실험 훅: 횟수 제한만 먼저
    if (globalThis.__SPIRIT_FIRST) abs = abs.filter((a) => !((a.SpiritCost || 0) > user.spirit)); // 실험 훅: 기력만 먼저
    if (globalThis.__HOOK_AI_ABS) abs = globalThis.__HOOK_AI_ABS(b, user, abs); // 실험 훅
    // ShuffleBattleList
    if (!globalThis.__NO_AI_SHUFFLE) for (let n = abs.length; n >= (globalThis.__AI_SHUFFLE_FULL ? 1 : 2); n--) { const k = b.rnd.nextRange(0, n); const tmp = abs[n - 1]; abs[n - 1] = abs[k]; abs[k] = tmp; } // 실험 훅 둘
    abs = orderBy(abs, (a) => a.AIPriority || 0).filter((a) => isAbilityUsable(b, user, a));
    const enemies = b.enemyOf(user).active.filter((m) => m != null);
    // 1차 — 한 번에 전원 처치
    for (const a of abs) {
      const t = TG(a.Targeting);
      if (!t.TargetAllEnemy && !((t.EnemyTargets || 0) >= enemies.length)) continue;
      const dmg = new Map();
      for (const cn of D.abilityConfigs[a.Config].Components) {
        const c = AC[cn]; if (c._type !== 'DamageAbilityComponent') continue;
        for (const e of enemies) dmg.set(e, (dmg.get(e) || 0) + staticCalc(b, a.DamageType, user, e, c));
      }
      if (enemies.every((e) => e.hp - (dmg.get(e) || 0) < 2)) {
        cov('ai:killAll'); return { ability: a._name, ids: showTargeting(t) ? assignRandomTargets(b, t, user) : null };
      }
    }
    // 2차
    let fb = null, fbIds = null;
    for (const a of abs) {
      const comps = D.abilityConfigs[a.Config].Components.map((n) => AC[n]);
      const redirectable = comps.some((c) => c._type === 'DamageAbilityComponent' || c._type === 'BossSalvoAbilityComponent');
      const protectors = redirectable ? b.enemyOf(user).active.filter((m) => m && isProtector(m)) : [];
      const ai = a.AbilityAI ? D.abilityAI[a.AbilityAI] : null;
      const t = TG(a.Targeting);
      const r = assignTargetsForAI(b, t, user, comps, ai, protectors, redirectable);
      if (r.ids.length > 0) { cov(fb ? 'ai:pickAfterFallback' : 'ai:pick'); return { ability: a._name, ids: showTargeting(t) ? r.ids : null }; }
      if (fb) cov('ai:fbOverwritten');
      fbIds = r.ids;
      if (r.usable && !fb) { cov('ai:fallbackSet'); fb = a; fbIds = assignRandomTargets(b, t, user); } // ★ 즉시 뽑기 — 지연 변형은 137층을 깨뜨려 반박됨
    }
    if (fb) cov('ai:fallbackUsed');
    if (fb) return { ability: fb._name, ids: showTargeting(TG(fb.Targeting)) ? fbIds : fbIds };
    cov('ai:pass'); b.logError('AI: 쓸 능력 없음 — Pass');
    return { ability: 'Pass', ids: null };
  }

  return {
    Battle,
    run(seed, l1, l2, opts = {}) { const b = new Battle(seed, opts); b.run(l1, l2, opts.maxSteps); return b; },
    lineupFromConfig(c, side) {
      const p = side === 1 ? 'Team1' : 'Team2';
      return { id: side === 1 ? c.P1 : c.P2, mobs: side === 1 ? c.P1Mobs : c.P2Mobs, rank: c[p + 'Rank'] || 0, statBuffs: c[p + 'StatBuffs'] || null, warWins: c[p + 'WarWins'] || 0,
        campus: c[p + 'CampusStatBonus'] || null, scalar: c[p + 'FinalBaseStatScalar'] ?? 1, passiveBuffs: c[p + 'PassiveBuffs'] || [], timePenalty: side === 2 ? (c.Team2TimePenalty || 0) : 0 };
    },
  };
}
