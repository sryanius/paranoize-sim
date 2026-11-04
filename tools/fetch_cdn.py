# CDN(content.prd.paranoize.com/Prd<N>) 에서 설정 JSON 을 전부 받아 raw/cdn/ 에 두고, 엔진이 읽는 표(raw/files/)도 새것으로 바꾼다 — 폰 없이 갱신.
#
#   python tools/fetch_cdn.py              # 가장 새 콘텐츠 경로를 찾아 받고 → 엔진 표가 다르면 raw/files 에 덮어씀
#   python tools/fetch_cdn.py --no-apply   # 받기만(raw/cdn) — 무엇이 다른지만 알려 줌
#   python tools/fetch_cdn.py --prd=9      # 경로 번호를 고정
#
# 콘텐츠 경로는 앱 버전마다 바뀐다(1.2.x Prd8 — 10-15 에 멈춤 · 1.3.x Prd9). 예전 경로나 예전 raw/files 를 쓰면 신규 캐릭터가 없어
# 엔진이 «몬스터 없음 ReikaMorning» 같은 오류로 멈춘다(2026-11-04 길드원 증상 — 예전엔 raw/cdn 에 받기만 하고 raw/files 는 안 바꿨다).
# 덮어쓰기 전 파일은 raw/files_before/<날짜>/ 에 남긴다. 바꾼 뒤엔 `node tools/vcheck.mjs` 로 전부 ✓ 인지 볼 것.
import json, os, sys, io, shutil, time, urllib.request, hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
HOST = 'https://content.prd.paranoize.com/'
ENGINE = ['Monster', 'PostCard', 'Accessory', 'SubAccessory', 'Spirit', 'BattleStatPresets', 'Ability', 'AbilityAI',
          'AbilityComponent', 'AbilityConfig', 'BattleTargeting', 'Buff', 'BuffComponent', 'MonsterConditions']  # 엔진(tools/lib/paradata.mjs)이 읽는 것
APPLY = '--no-apply' not in sys.argv
PRD = next((int(a[6:]) for a in sys.argv if a.startswith('--prd=')), None)


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r: return r.read()


def opens(n):
    try: get(f'{HOST}Prd{n}/LastWrites.json'); return True
    except Exception: return False


if PRD is None:  # 9(1.3.x)부터 위로 — LastWrites.json 이 열리는 가장 큰 번호
    PRD = 9
    while opens(PRD + 1): PRD += 1
BASE = f'{HOST}Prd{PRD}/'
out = 'raw/cdn'; os.makedirs(out, exist_ok=True)
lw = get(BASE + 'LastWrites.json'); open(os.path.join(out, 'LastWrites.json'), 'wb').write(lw)
names = sorted(json.loads(lw))
changed = []
for n in names:
    try: b = get(BASE + n)
    except Exception as e: print('실패', n, e); continue
    open(os.path.join(out, n), 'wb').write(b)
    p = os.path.join('raw/files', n)
    same = os.path.exists(p) and hashlib.sha256(open(p, 'rb').read()).digest() == hashlib.sha256(b).digest()
    if not same: changed.append(n)
eng = [n for n in changed if n[:-5] in ENGINE]
print(f'Prd{PRD} 에서 받음 {len(names)} · 엔진 표 중 raw/files 와 다른 것 {eng or "없음"}')
other = [n for n in changed if n not in eng]
if other: print('  (엔진이 안 읽는 것 중 다른 것', len(other), '— raw/cdn 에만 둠)')
missing = [n + '.json' for n in ENGINE if not os.path.exists(os.path.join(out, n + '.json'))]
if missing: print('★ CDN 에서 못 받은 엔진 표', missing, '— 그 표는 그대로 둔다')
if eng and APPLY:
    bak = os.path.join('raw/files_before', time.strftime('%Y%m%d_%H%M'))
    for n in eng:
        p = os.path.join('raw/files', n)
        if os.path.exists(p): os.makedirs(bak, exist_ok=True); shutil.copy(p, os.path.join(bak, n))
        os.makedirs('raw/files', exist_ok=True); shutil.copy(os.path.join(out, n), p)
    print(f'raw/files 갱신 {len(eng)}개' + (f' · 이전 것은 {bak}' if os.path.isdir(bak) else '') + ' → `node tools/vcheck.mjs` 로 전부 ✓ 인지 확인')
elif eng: print('--no-apply — raw/files 는 그대로. 엔진에 쓰려면 옵션 없이 다시 돌릴 것')
