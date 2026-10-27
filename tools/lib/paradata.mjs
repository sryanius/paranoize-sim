// 엔진용 게임 데이터 적재 (raw/files 원본 + data/tables.json)
import { readFileSync } from 'node:fs';
export const ROOT = new URL('../../', import.meta.url);
export const J = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
// 내 계정 Uid — raw/link_codes.json 의 main(또는 me) → 없으면 raw/api_creds.json(지금 연동한 계정)
export function myUid() {
  for (const [p, get] of [['raw/link_codes.json', (d) => d.main?.uid || d.me?.uid], ['raw/api_creds.json', (d) => d.Uid]]) {
    try { const v = get(J(p)); if (v) return v; } catch { /* 없음 */ }
  }
  throw new Error('내 Uid 를 모른다 — 먼저 python tools/api.py restore <연동 코드> <샤드>');
}
export function loadData() {
  const R = (n) => J('raw/files/' + n + '.json');
  return {
    monsters: R('Monster'), postcards: R('PostCard'), accessories: R('Accessory'), subaccessories: R('SubAccessory'), spirits: R('Spirit'),
    presets: R('BattleStatPresets'), tables: J('data/tables.json'),
    abilities: R('Ability'), abilityAI: R('AbilityAI'), abilityComponents: R('AbilityComponent'), abilityConfigs: R('AbilityConfig'),
    targeting: R('BattleTargeting'), buffs: R('Buff'), buffComponents: R('BuffComponent'), conditions: R('MonsterConditions'),
  };
}
