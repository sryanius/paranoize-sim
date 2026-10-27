# -*- coding: utf-8 -*-
# 유적 도전 응답(raw/api) → data/replays/floor<층>_<계정>_<win|lose>[n].json 저장 + 목록(index.json) 다시 쓰기.
#   python tools/save_conquest.py latest     가장 최근 도전 응답 하나를 저장
#   python tools/save_conquest.py backfill   이미 있는 floor*.json 에 통솔·권장 통솔·층 기본값을 채움
#   python tools/save_conquest.py index      목록만 다시 씀
# 리플레이마다 meta 를 붙인다: floor · account · rank(통솔) · recRank(권장 통솔, 도전 직전 상태 조회) · baseScalar(F) · result.
# 배율 공식(2026-10-20 확정): Team2FinalBaseStatScalar = F(층) × 0.925^max(0, 통솔 − 권장 − 5) — 차 4 에서 할인·불이익 없음(200층).
import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.join(os.path.dirname(__file__), '..')
P = lambda *a: os.path.join(ROOT, *a)
J = lambda p: json.load(open(p, encoding='utf-8'))
def W(p, d): json.dump(d, open(p, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
codes = J(P('raw', 'link_codes.json')) if os.path.exists(P('raw', 'link_codes.json')) else {}
ACCT = {v['uid']: k for k, v in codes.items() if isinstance(v, dict) and 'uid' in v}
KO = {'me': '내 계정', 'main': '본계정', 'sub': '부계정'}
ORD = {'me': 0, 'main': 1, 'sub': 2}  # 목록 순서 — 연동 코드 파일이 없으면 지금 연동한 계정은 me

def scan():
    """도전 응답마다 (응답, 직전 상태 조회의 권장 통솔·층) 을 시드로 찾을 수 있게."""
    out, last = {}, None
    for f in sorted(glob.glob(P('raw', 'api', '*EventsRequest.json')), key=os.path.getmtime):
        r = J(f)['res']
        if 'NextConquestRecommendedRank' in r: last = r
        if r.get('Replay'):
            out[r['Replay']['Config']['Seed']] = dict(res=r, pre=last, file=os.path.basename(f), mtime=os.path.getmtime(f))
    return out

def meta_for(rep, hit, fallback=None):
    c = rep['Config']; fb = fallback or {}
    acct = ACCT.get(c.get('P1')) or fb.get('account') or 'me'  # 식별자를 지운 옛 파일은 P1 이 없다 → 파일의 계정
    won = (rep.get('Winner') == c['P1']) if c.get('P1') else fb.get('result') == 'win'
    m = dict(account=acct, rank=c['Team1Rank'], result='win' if won else 'lose')
    if hit:
        if hit['res'].get('ConquestFloor') is not None: m['floor'] = hit['res']['ConquestFloor'] + 1  # 서버 값 = 깬 층
        if hit['pre'] is not None and hit['pre'].get('ConquestFloor') == hit['res'].get('ConquestFloor'):
            m['recRank'] = hit['pre']['NextConquestRecommendedRank']
    if 'recRank' in m:
        m['baseScalar'] = round(c['Team2FinalBaseStatScalar'] / 0.925 ** max(0, m['rank'] - m['recRank'] - 5), 4)  # 차 < 5 는 할인 없음(200층 차 4 로 확인)
    return m

def write_index():
    rows = []
    for f in glob.glob(P('data', 'replays', 'floor*.json')):
        d = J(f); m = d.get('meta', {})
        rows.append(dict(file=os.path.basename(f)[:-5], account=m.get('account') or d.get('account'), floor=m.get('floor') or d.get('floor'),
                         rank=m.get('rank'), recRank=m.get('recRank'), date=d.get('fetchedAt', '')))
    # 같은 층·계정이 둘 이상이면 날짜를 붙인다(최신이 위)
    from collections import Counter
    n = Counter((r['account'], r['floor']) for r in rows)
    rows.sort(key=lambda r: (r['date'], len(r['file']), r['file']), reverse=True)  # 최신 먼저 · 같은 날이면 나중 파일(…2)이 위
    rows.sort(key=lambda r: (ORD.get(r['account'], 9), -(r['floor'] or 0)))  # 안정 정렬: 계정 → 층
    for r in rows:
        lab = f"{r['floor']}층 · {KO.get(r['account'], r['account'])}"
        if r['rank'] is not None: lab += f" · 통솔 {r['rank']}" + (f" · 권장 {r['recRank']}" if r['recRank'] is not None else '')
        if n[(r['account'], r['floor'])] > 1: lab += f" ({r['date'][5:]})"
        r['label'] = lab
    W(P('data', 'replays', 'index.json'), [{k: r[k] for k in ('file', 'label', 'account', 'floor', 'rank', 'recRank')} for r in rows])
    for r in rows: print('  ', r['label'], '←', r['file'])

def backfill():
    hits = scan()
    for f in sorted(glob.glob(P('data', 'replays', 'floor*.json'))):
        d = J(f); rep = d['Replay']
        nm = os.path.basename(f)[:-5].split('_')
        m = meta_for(rep, hits.get(rep['Config']['Seed']), dict(account=d.get('account') or nm[1], result='win' if nm[2].startswith('win') else 'lose'))
        m.setdefault('floor', d.get('floor') or int(os.path.basename(f)[5:8]))
        d['meta'] = m; d['floor'] = m['floor']; d['account'] = m['account']
        hit = hits.get(rep['Config']['Seed'])
        if not d.get('fetchedAt') and hit:  # 옛 파일: 원본 응답 시각으로
            import datetime; d['fetchedAt'] = datetime.date.fromtimestamp(hit['mtime']).isoformat()
        W(f, d); print(os.path.basename(f), m)

def latest():
    hits = scan()
    if not hits: sys.exit('도전 응답이 없다')
    seed, hit = max(hits.items(), key=lambda kv: kv[1]['mtime'])
    rep = hit['res']['Replay']; m = meta_for(rep, hit)
    for f in glob.glob(P('data', 'replays', 'floor*.json')):
        if J(f)['Replay']['Config']['Seed'] == seed: sys.exit(f'이미 저장됨: {os.path.basename(f)}')
    import datetime
    base = f"floor{m['floor']}_{m['account']}_{m['result']}"; name = base; k = 2
    while os.path.exists(P('data', 'replays', name + '.json')): name = f'{base}{k}'; k += 1
    d = dict(Replay=rep, fetchedAt=datetime.date.today().isoformat(), account=m['account'], kind='conquest', floor=m['floor'], meta=m)
    W(P('data', 'replays', name + '.json'), d)
    print('저장', name, m, '←', hit['file'])

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'latest'
    if cmd == 'backfill': backfill()
    elif cmd == 'latest': latest()
    elif cmd != 'index': sys.exit(__doc__)
    write_index()
