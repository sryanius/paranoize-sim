모바일 게임 **패러노이즈**의 전투를 JS로 옮긴 엔진과, 그걸로 유적 출동 순서·투기장 덱을 고르는 도구 모음입니다.
엔진은 서버가 돌린 실제 전투 기록 69판(유적 21 + 투기장 48)을 승패·처치·체력·버프까지 **전부 똑같이** 재현합니다.

- 만든 사람의 기록으로 돌아가는 공개 페이지: https://sryanius.github.io/paranoize-codex/
- 이 저장소는 그걸 **자기 계정으로** 돌리고 싶은 사람(길드원)을 위한 것입니다. Claude Code 로 이 폴더를 열고 쓰는 것을 전제로 합니다 — Claude 가 지킬 규칙은 `CLAUDE.md` 에 있습니다.

## ⚠️ 먼저 읽기

- **비공식 방법으로 게임 서버를 부릅니다**(`tools/api.py`). 게임 약관 위반 소지가 있고, **계정 제재 위험은 쓰는 사람 몫**입니다.
- **연동 코드는 누구에게도 주지 마세요**(만든 사람 포함). 연동 코드 = 그 계정을 통째로 가져갈 수 있는 열쇠입니다. 이 폴더의 `raw/` 에만 두고, `raw/` 는 git 이 올리지 않습니다(`.gitignore`).
- **복원(restore)하면 폰의 게임이 로그아웃**됩니다. 다시 폰으로 들어가면 이번엔 이쪽 접속이 끊깁니다.
- **자동 반복 도전·밤새 돌리기는 하지 마세요.** 도전은 사람이 «도전해» 라고 할 때 한 번씩만 — 요청 간격도 4~8초로 사람처럼 둡니다(api.py 가 지킵니다).

## 준비

- Node.js 20 이상 · Python 3.10 이상 (추가 설치할 라이브러리 없음)
- `git clone https://github.com/sryanius/paranoize-sim.git` → 그 폴더에서 Claude Code 실행

## 처음 한 번 — 내 계정 연결

1. 게임에서 연동 코드를 발급받습니다.
2. 복원: `python tools/api.py restore <연동 코드> 260`
   - `260` 은 서버 **K-2** 의 번호(shard)입니다. 다른 서버면 숫자가 다릅니다.
   - 성공하면 `raw/api_creds.json` 이 생깁니다(내 Uid·접속 정보 — git 밖).
3. (선택) 다음에 Claude 가 다시 복원할 수 있게 `raw/link_codes.json` 에 적어 둡니다:
   ```json
   { "me": { "uid": "<내 Uid>", "code": "<연동 코드>", "shard": 260 } }
   ```
4. `python tools/api.py login` → `python tools/api.py events` (현재 층·다음 보스·권장 통솔이 나오면 성공)

## 유적

```bash
python tools/api.py challenge          # ★ 실제 도전 1회(게임 행동)
python tools/save_conquest.py latest   # 도전 기록 → data/replays/floor<층>_me_<win|lose>.json
node tools/vcheck.mjs                  # 엔진이 내 기록도 똑같이 재현하는지(전부 ✓ 면 정상)
node tools/formation.mjs floor201_me_lose      # 출동 순서 제안 → data/formation_<이름>.json
node tools/compare_orders.mjs floor201_me_lose # 알려진 순서들을 2만 판씩 비교(승률이 0.1% 대일 때)
```

- 층 번호: 서버가 주는 값은 **깬 층**이고 도전은 그다음 층입니다(파일 이름은 도전한 층).
- 도전 기록이 있어야 그 층의 적 편성·배율을 압니다. 처음 보는 층은 한 번 도전해 봐야 계산할 수 있습니다.
- 바꾸는 것은 **출동 24명의 순서**입니다. 다른 캐릭터로 바꿔 넣는 건 아직 자료가 없어 못 합니다.

## 페이지(내 컴퓨터에서)

```bash
python tools/serve.py     # → http://localhost:6102/site/ruins.html (유적 시뮬) · arena.html (투기장 덱)
```

층을 고르면 그 기록의 적·내 24명으로 브라우저에서 1000판을 1초쯤에 굴립니다. 순서를 직접 바꿔 볼 수도 있습니다.

## 투기장·야망

- `python tools/api.py arena_replays` → 최근 투기장 기록 15판이 `raw/api/…_ArenaRequest.json` 에 저장됩니다.
  `data/replays/arena_*.json` 으로 옮기는 도구는 아직 없습니다 — Claude 에게 부탁하세요.
- `tools/arena_opt.mjs` 의 상대 목록(MATCH)은 만든 사람의 상대들입니다. 내 기록으로 바꿔 써야 합니다.

### 랭킹에서 남의 덱 읽기

```bash
python tools/api.py ranking 2        # 전투력 랭킹 50명(Uid · 이름 · 점수)
python tools/api.py ranking 4        # 통솔 랭킹 — 점수는 누적 경험치(레벨은 data/tables.json 의 heroXp 로 바꾼다)
python tools/api.py deck <Uid>       # 그 사람의 지금 덱(랭킹에서 이름을 누르면 보이는 것) → raw/api/…_GetPlatoonsRequest.json
node tools/arena_opt.mjs --deck=<내 GetPlatoons 파일> --opp=<그 사람 GetPlatoons 파일> --opprank=<그 사람 통솔>
```

- `--opp` 는 그 사람의 지금 덱으로 «그 사람이 공격해 옴 · 내가 공격» 두 대전만 놓고 내 순서를 찾습니다.
- 투귀공명·캠퍼스 보너스는 랭킹에 없어서 **투기장 기록**에서 가져옵니다 — 그 사람이 나온 기록과 내가 나온 기록이 `data/replays/arena_*.json` 에 있어야 합니다(없으면 멈춥니다).

## 들어 있는 기록

`data/replays` 의 «본계정·부계정» 기록은 **만든 사람의 것**입니다 — 엔진 검증용 정답지로 넣어 두었습니다.
내 기록은 «내 계정»(`_me_`)으로 저장되어 목록 맨 위에 옵니다.

## 게임 자료 갱신

게임이 업데이트되면 `python tools/fetch_cdn.py` 가 공개 CDN 에서 설정 파일을 `raw/cdn/` 에 받고, 지금 것과 다른 파일을 알려 줍니다.
엔진이 읽는 14개(`raw/files/`)를 그걸로 바꾼 뒤 `node tools/vcheck.mjs` 로 확인하세요.

자세한 게임 규칙(배율 공식·레벨 상한 등)은 `docs/NOTES.md`.
