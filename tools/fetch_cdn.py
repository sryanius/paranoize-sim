# CDN(content.prd.paranoize.com/Prd8) 에서 설정 JSON 을 전부 받는다 — 폰 없이 갱신 가능. raw/cdn/ 에 저장하고 폰 사본과 다른 파일을 알려 준다.
import json, os, sys, io, urllib.request, hashlib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = 'https://content.prd.paranoize.com/Prd8/'
out = 'raw/cdn'; os.makedirs(out, exist_ok=True)
def get(name):
    with urllib.request.urlopen(BASE + name, timeout=60) as r: return r.read()
lw = get('LastWrites.json'); open(os.path.join(out, 'LastWrites.json'), 'wb').write(lw)
names = sorted(json.loads(lw))
changed = []
for n in names:
    try: b = get(n)
    except Exception as e: print('실패', n, e); continue
    open(os.path.join(out, n), 'wb').write(b)
    p = os.path.join('raw/files', n)
    same = os.path.exists(p) and hashlib.sha256(open(p, 'rb').read()).hexdigest() == hashlib.sha256(b).hexdigest()
    if not same: changed.append(n)
print('받음', len(names), '· 폰 사본과 다른 것', changed)
