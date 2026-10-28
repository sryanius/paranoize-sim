# 패러노이즈 API 최소 클라이언트 — 요청 간격 4~8초, 순차. 화면에 찍는 응답에서는 세션·Clid·연동 코드를 가린다(파일 raw/api/ 에는 그대로).
import gzip, json, sys, os, random, time, urllib.request, urllib.error
BASE = 'https://game.prd.paranoize.com/'
CREDS = 'raw/api_creds.json'; OUT = 'raw/api'
_id = [0]; _last = [0.0]
os.makedirs(OUT, exist_ok=True)

def call(path, body):
    wait = 4 + random.uniform(0, 4) - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    _last[0] = time.time(); _id[0] += 1
    body = dict(body); body.setdefault('Id', _id[0])
    data = gzip.compress(json.dumps(body).encode('utf-8'))
    h = {'Content-Type': 'application/octet-stream', 'Accept-Encoding': 'gzip',
         'User-Agent': 'UnityPlayer/6000.3.8f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)'}
    req = urllib.request.Request(BASE + path, data=data, headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r: raw, code = r.read(), r.status
    except urllib.error.HTTPError as e: raw, code = e.read(), e.code
    try: txt = gzip.decompress(raw).decode('utf-8')
    except Exception: txt = raw.decode('utf-8', 'replace')
    try: res = json.loads(txt)
    except Exception: res = txt
    json.dump({'path': path, 'code': code, 'res': res}, open(f'{OUT}/{time.strftime("%H%M%S")}_{path}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return code, res

HIDE = ('Session', 'Clid', 'RestoreCode')
def masked(x):
    if isinstance(x, dict): return {k: ('***' if k in HIDE else masked(v)) for k, v in x.items()}
    if isinstance(x, list): return [masked(v) for v in x]
    return x

def creds(): return json.load(open(CREDS))
def auth(c): return {'Uid': c['Uid'], 'Session': c.get('Session')}

if __name__ == '__main__':
    cmd = sys.argv[1]
    c = creds() if os.path.exists(CREDS) else None
    if cmd == 'restore':
        code_, shard = sys.argv[2], int(sys.argv[3])
        st, res = call('RestoreRequest', {'Shard': shard, 'FromShard': shard, 'RestoreCode': code_, 'Unerase': False})
        print(st, str(masked(res))[:300])
        if isinstance(res, dict) and res.get('Uid'):
            json.dump({'Uid': res['Uid'], 'Clid': res['Clid'], 'Shard': shard}, open(CREDS, 'w')); print('저장')
        sys.exit()
    if cmd == 'login':
        st, res = call('LoginRequest', {'Clid': c['Clid'], 'Uid': c['Uid'], 'Adid': '', 'Lang': 'ko',
                                        'Bundle': 'com.zigzagame.paranoize', 'Version': '1.2.0'})
        print(st, str(masked(res))[:600])
        if isinstance(res, dict) and res.get('Session'):
            c['Session'] = res['Session']; json.dump(c, open(CREDS, 'w')); print('세션 저장')
    elif cmd == 'events':      # 유적 상태(현재 층·다음 적·부대 수·권장 통솔) — 읽기만
        st, res = call('EventsRequest', {**auth(c), 'ConquestDetails': True})
        print(st, str(masked(res))[:1500])
    elif cmd == 'platoons':    # 내 부대·보유 캐릭터(서버가 보는 덱) — 읽기만
        st, res = call('GetPlatoonsRequest', {**auth(c)})
        print(st, str(masked(res))[:1500])
    elif cmd == 'ranking':     # 랭킹 목록(랭킹 화면과 같은 읽기 요청) — 종류 2 전투력(기본) · 4 통솔(Score = 누적 경험치 → tables.heroXp 로 레벨) · 다른 번호(0 이벤트 1 부대 3 투기장 5 캐릭터 6 클러스터)는 안 써 봄
        st, res = call('LeaderboardRequest', {**auth(c), 'UserLeaderboard': int(sys.argv[2]) if len(sys.argv) > 2 else 2})
        rows = res.get('UserRows') or [] if isinstance(res, dict) else []
        print(st, f'{len(rows)}명' if rows else str(masked(res))[:300])
        for i, r in enumerate(rows): print(i + 1, r.get('Uid'), r.get('UserName'), r.get('Score'))
    elif cmd == 'deck':        # 남의 부대(랭킹에서 이름을 누르면 보이는 덱) — GetPlatoonsRequest 의 Uid 가 «볼 사람». 1~4반 인스턴스(전투 기록과 같은 형식)
        st, res = call('GetPlatoonsRequest', {**auth(c), 'Uid': sys.argv[2]})
        pl = next(iter((res.get('PlatoonPages') or {}).values()), {}).get('Platoons') or {} if isinstance(res, dict) else {}  # 서버는 그 사람이 쓰는 페이지 하나만 준다(0 이 아닐 수 있다)
        print(st, ' / '.join(' '.join(pl[k]['Mobs']) for k in ('0', '1', '2', '3') if k in pl) or str(masked(res))[:300])
    elif cmd == 'collection':  # 보유 캐릭터·장비 전체(캐릭터 목록 화면과 같은 읽기 요청)
        st, res = call('CollectionItemsRequest', {**auth(c), 'FetchAllOwn': True})
        print(st, str(masked(res))[:600])
    elif cmd == 'arena_replays':  # 투기장 최근 전투 기록(리플레이 목록) — 읽기만. 게임의 투기장 기록 화면과 같은 요청
        st, res = call('ArenaRequest', {**auth(c), 'Replays': True})
        print(st, str(masked(res))[:600])
    elif cmd == 'specials':    # 스페셜 목록(상점·경매 등 — 스페셜 화면을 열 때와 같은 읽기 요청). 경매 정의가 Extra 에 있는지 보려고
        st, res = call('SpecialsRequest', {**auth(c)})
        print(st, str(masked(res))[:1500])
    elif cmd == 'package':     # 무작위 패키지 구성·가중치 읽기(보상 확률 화면이 쓰는 요청) — 읽기만 · 모르는 이름은 500(경매 BaseEgg* 추측은 전부 500)
        st, res = call('PackageRequest', {**auth(c), 'RandomPkg': sys.argv[2], 'IncludeRandomPkgWeights': True})
        print(st, str(masked(res))[:1500])
    elif cmd == 'shop':        # 교환 상점 목록 읽기만 — Shop·Trade 를 넣지 않는다(Shop 만 넣으면 500 · Trade 를 넣으면 실제 교환). 인자는 출력 거르기용
        st, res = call('ExchangeShopRequest', {**auth(c)})
        shops = (res or {}).get('Shops', {}) if isinstance(res, dict) else {}
        print(st, json.dumps(shops.get(sys.argv[2], shops) if len(sys.argv) > 2 else list(shops), ensure_ascii=False)[:1500])
    elif cmd == 'pkgs':        # 고정 패키지 내용 읽기(교환 비용·결과물 등) — 모르는 이름이 하나라도 있으면 500
        st, res = call('PackageRequest', {**auth(c), 'Pkgs': sys.argv[2:]})
        print(st, json.dumps(masked(res), ensure_ascii=False)[:1500])
    elif cmd == 'challenge':   # ★ 실제로 유적 다음 층에 도전(게임 행동). 클라이언트와 같은 순서: 상태 조회 → 도전
        call('EventsRequest', {**auth(c), 'ConquestDetails': True})
        st, res = call('EventsRequest', {**auth(c), 'ChallengeConquest': True})
        print(st, str(masked(res))[:1500])