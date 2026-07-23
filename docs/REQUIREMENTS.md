# Pururum 요구 기능 전체 목록

> 2026-07-23 기준, 대화에서 확정된 요구사항 정리.
> **Milkdown 전환 결정** — 아래 1~7은 현재 앱에서 동작하(거나 거의 되)는 기준선으로,
> 전환 후에도 전부 보존해야 한다.

---

## 1. 기본 골격

- **.qmd/.md 라이브 프리뷰 편집** — Typora/Obsidian처럼 커서 밖=렌더, 커서 안=원문
  (백엔드 없는 macOS 앱)
- **Tauri(Rust) 데스크톱 + 웹 버전이 프론트엔드 하나 공유**
- 파일: 새 문서 ⌘N / 열기 ⌘O / 저장 ⌘S / **자동저장**
  (이미지 붙일 때 "먼저 저장하세요" 토스트가 뜨지 않게) / 외부 변경 감지·리로드
- **소스 보기 토글** (⌘E, 원형 토글 버튼)
- 도움말 문서 (내용 충실히, 제목 중복 없이)

## 2. 통합 오브젝트 모델 (현재 구현 기준 상세)

> *"삽입·삭제는 같은 로직, 타입별 팝업만 다르게"*
> 대상: **표 · 콜아웃 · 탭셋 · 이미지 · 프론트매터** 5종.
> (코드블록은 오브젝트화했다가 **철회** — 커서 밖=hljs 하이라이팅 패널,
> 커서 안=원문을 CM 구문강조로 직접 편집. 삽입은 언어 하드코딩 없는 빈 ``` 페어.)

### 2.1 공유 인프라 (editor.js)

모든 오브젝트가 아래 공용 함수를 그대로 쓴다. 타입별 코드는 "팝업 열기"뿐.

- **`findObjRange(view, dom, src)`** — 오브젝트의 원문 위치 탐색.
  ① 위젯 DOM 위치(`posAtDOM`) 우선, ±3자 슬라이딩으로 보정(중복 블록 구분)
  ② DOM이 끊겼으면(팝업 포커스 핸드오프로 위젯 재렌더 — WKWebView 실기 이슈)
  **문서 전체에서 유일 매치**로 폴백. 이 폴백 덕에 팝업 수정이 항상 반영됨.
- **`removeObjRange`** — 범위 삭제 + **뒤따르는 빈 줄 1개 흡수**(빈 공백 안 남게).
- **`widgetDocOps(view, el, src)`** — `{replace(text), remove()}` 페어.
  `used` 플래그로 이중 적용 방지. replace 후 캐럿은 새 텍스트 끝
  (`settleCaret` 훅으로 모달 포커스 핸드오프에도 캐럿 안정화).
- **`imageDocOps`** — 이미지 전용 ops: `apply(patch)`(width/align/caption 부분수정),
  `rewrite({src,width,align,caption})`(토큰 전체 교체 — 낙서 저장 시),
  `remove()`. 캡션=alt 텍스트(Quarto figure 규약).
- **`addDeleteBadge(el, onDelete)`** — 호버 시 우상단 **빨간 × 배지**.
  mousedown에서 preventDefault+stopPropagation 후 삭제(클릭이 팝업으로 새지 않게).
  표는 위젯 박스가 아닌 **table 요소 모서리**에 붙임(× 위치 어긋남 버그 수정됨).
- **`placeCursor(view, el)`** — 오브젝트 클릭 시 캐럿을 위젯 **바로 뒤**에 배치
  (클릭 직후 Backspace 한 번으로 그 오브젝트가 지워지게).
- **`deleteAtomicAt(view, forward)`** — Backspace/Delete 키맵.
  캐럿이 atomic 위젯 경계에 인접하면 위젯 전체 삭제 + **인접 빈 줄 1개 흡수**.
- **atomic 규칙** (실기에서 얻은 교훈):
  - 인라인 치환(숨긴 문법마커, 인라인 수식/이미지) = atomic (커서가 건너뜀)
  - reveal-on-cursor 블록(코드블록) = atomic 금지 (화살표로 들어가 원문 편집)
  - **fixed 위젯(표·이미지·콜아웃·탭셋·프론트매터) = 블록이어도 atomic**
    (캐럿이 안으로 못 들어감, 건너뛰고, Delete는 통째 삭제)

### 2.2 공유 삽입 (index.html `insertBlockText`)

- 삽입 메뉴(＋)의 모든 블록이 한 함수로 삽입: **위아래 빈 줄로 격리**
  (붙어 있으면 pandoc이 병합/오파싱 — 이를 원천 차단)
  - 커서 줄에 내용 있으면 `\n\n`으로 분리, 줄 시작이면 위 빈 줄만 보강
  - 삽입 후 캐럿은 블록 **아래 빈 줄**
- ⚠️ 역사적 사고: 같은 이름의 함수를 새로 만들어 삽입 메뉴 전체가 깨졌던 적 있음
  → 전역 함수 추가 전 grep으로 동명 확인 (`insertBlock` → `insertBlockText` 개명)

### 2.3 편집 흐름 (클릭 → 팝업)

위젯 클릭 → `HOST.editX(모델, ops.replace, ops.remove)` → index.html 팝업.
팝업 "적용" = 마크다운 재직렬화 후 `replace`, "삭제" = `remove`.
**인플레이스 편집은 의도적으로 배제** — 모달이 CM/WKWebView와 포커스 다툼을
안 하는 것이 안정성의 핵심 (인플레이스 셀 편집은 실기에서 취약해 폐기).

### 2.4 타입별 상세

**표** (`enhanceTableWidget` + `openTableEditor`)
- 원문 파싱: GFM 파이프 표 ⇄ `{header[], aligns[], rows[][]}` 왕복
  (`parseTable`/`serializeTable`, 이스케이프 `\|` 처리, 열 폭 패딩 정렬)
- 팝업: 스프레드시트 그리드(각 셀 input), 행/열 추가·삭제,
  **열 정렬 left/center/right**(헤더 포함 가운데 정렬 지원),
  **표 가운데 배치** 체크(`::: {.center}` 래퍼 절대 보존),
  **캡션 필드**(pandoc `: Caption` 줄을 위젯이 흡수·`<caption>` 렌더),
  **실시간 렌더 미리보기**(입력마다 갱신)
- 직렬화는 항상 `[.center 래퍼] 표 [": 캡션"]` 형태만 방출

**콜아웃** (`enhanceCalloutWidget` + `openCalloutEditor`)
- 문법: `::: {.callout-note|tip|warning|caution|important}` + 선택적 `## 제목`
- 삽입은 **"콜아웃" 하나** — 종류는 팝업에서 선택(노트/팁/경고/주의/중요)
- 팝업: 종류 라디오 + 제목 + 본문 textarea + **실시간 렌더 미리보기**
  (Quarto cosmo 실측 색: note #2780e3 / tip #3fb618 / warning #ff7518 /
  caution #f0ad4e / important #ff0039)

**탭셋** (`enhanceTabsetWidget` + `openTabsetEditor`)
- 문법: `::: {.panel-tabset}` + `## 탭제목` 단위 분해 ⇄ `{tabs:[{title,body}]}`
- 팝업: 탭 추가/삭제/이름변경(인라인 input), 본문 textarea,
  **미리보기 탭 ↔ 편집 중 탭 양방향 동기화**
- 에디터 위젯에서 탭 클릭 = **재렌더 없이 active 클래스만 토글**
  (재렌더하면 클릭이 씹혀 두 번 눌러야 했던 버그의 해결책 — 유지 필수)

**이미지** (`ImageWidget` + `openImageEditor`)
- 토큰: `![캡션](경로){width=N fig-align="left|center|right"}` — 캡션=alt
- 위젯: 비동기 asset 해석(첨부 디렉토리), 로드 실패 시 placeholder,
  **모서리 그립 드래그로 리사이즈**(라이브, `{width=N}`으로 저장) —
  팝업의 크기 슬라이더는 제거됨(중복이라)
- 위젯 루트 DOM은 **항상 안정**해야 함 (replaceWith 금지 — CM observer가
  placeholder 텍스트를 문서로 역동기화하는 사고 방지)
- 팝업: 정렬 3버튼 / **낙서(캔버스 드로잉) — 이 앱의 핵심 기능** / 캡션 / 삭제
- 낙서 캔버스: **표시 크기 × devicePixelRatio**로 캔버스 생성, CSS px로 드로잉
  (자연해상도 방식은 Retina에서 포인터가 어긋나 사각지대 발생 — 실측 수정)
  저장 시 그린 영역만 크롭 후 첨부로 저장, 토큰 rewrite
- 캡션은 이미지 **바로 아래** `.qv-imgcap`, 단독 이미지는 `<figure><figcaption>`

**프론트매터** (`enhanceFrontmatterWidget` + `openFrontmatterEditor`)
- 문서 최상단 `--- … ---` YAML → **Quarto 제목 블록** 위젯
  (title 크게 + AUTHOR/PUBLISHED 컬럼, 날짜는 "July 23, 2026" 포맷)
- **삽입 메뉴에 없음** — 문서에 있으면 자동 오브젝트화
- 팝업: title/subtitle/author/date 필드 + **기타 YAML 원문 textarea**
  (`parseFmSrc`/`serializeFm` — 알려진 4필드만 구조화, 나머지는 원문 보존)
- 새 문서 기본값: `title: "제목 없음"`
- (다음 단계: Obsidian **Properties** 스타일로 교체 예정 — §8)

### 2.5 Milkdown 전환 시 보존해야 할 불변식

1. 오브젝트 5종의 **왕복 직렬화 무손실** (열고 저장해도 원문 훼손 없음)
2. 삽입 시 빈 줄 격리, 삭제 시 빈 줄 흡수 (문서에 빈 껍데기 안 남게)
3. 클릭→팝업(모달) 편집 패턴 유지 — 인플레이스보다 안정적임이 검증됨
4. × 배지 / Backspace 삭제 / 클릭 후 캐럿 위치 규약
5. 탭셋 no-rebuild 탭 전환, 이미지 위젯 루트 DOM 안정성 같은
   "실기에서 얻은" 세부 동작

## 3. 수식

- 인라인 `$…$` / 블록 `$$…$$` — MathJax CHTML, 로컬 woff 폰트
- **크기가 본문과 어울리게** (튀지 않게) — 출력/export에서도 정상
- 수식 뒤 **커서 튐 없음**, 수식이 선택 영역 위로 삐져나오지 않게
  ← *CodeMirror 구조로는 미해결 → Milkdown 전환 이유*

## 4. 타이포그래피 — *"신록예찬 블로그와 똑같이"*

- 한글 **나눔명조**, 영문·숫자·기호 **Noto Serif**
  (둘 다 base64 임베드 — WKWebView 에셋 폰트 로드 실패 대응)
- 산호색 제목(#ff6f61), 크림 배경(#fcfcf7), 보라 인라인코드(#7d12ba) — 블로그 실측값
- **리스트 들여쓰기 Quarto cosmo 실측**(레벨당 정확히 2em) — "임의로 줄이지 말고 실측"

## 5. 줌 (가독성)

- **문서 전체가 커져야 함** — 글자만이 아니라 **표·콜아웃·이미지·수식까지**
- 툴바 `−`/퍼센트/`+` + ⌘+/⌘−/⌘0, localStorage 유지
- **좌측 시작선 고정** (확대해도 안 흔들리게), 수식 폭주 없이
  (CSS `zoom`은 수식 제곱 폭주 + 좌측선 이동 → 사용 금지, font-size 배율 방식)
- **export에도 현재 배율 반영**
- 확대 상태에서 **커서·선택 정확**
  ← *CodeMirror 구조로는 미해결 → Milkdown 전환 이유*

## 6. 선택/커서 품질

- 선택색은 테마 **복숭아색** (#ffd5ce 계열; 시스템 라벤더 금지)
- 선택 하이라이트가 텍스트에 정확히 붙기 (바텀라인 맞게, 위로 삐짐 금지)
- 클릭한 곳에 커서가 정확히 (수식 뒤 포함), 수식 근처 클릭 무반응 금지

## 7. 출력 (export)

- 네이티브 인쇄 **폐기** (탭셋 렌더 불가) → **자체완결 단일 HTML export** (⌘P)
  - 폰트·CSS·수식 woff 전부 base64 인라인, 이미지 data/attachment URI
  - **탭셋은 작은 인라인 스크립트로 인터랙티브 유지**
  - 데스크톱=OS 저장 대화상자, 웹=Blob 다운로드
  - 저장 경로 토스트 **NFC 정규화** (macOS 한글 파일명 NFD 문제)

## 8. 레이아웃 (Obsidian 스타일 — 다음 작업)

- **왼쪽 세로 사이드바 + 상단 가로탭 공존** (Obsidian 기본 구조)
- 사이드바: 컴팩트 아이콘 툴바(새문서/새폴더/정렬/접기) +
  **여러 프로젝트 폴더** 트리(multi-root) + 파일 확장자 배지(QMD/YML)
- **Properties 프론트매터 블록** — Obsidian처럼 아이콘 + key/value 행
  (title/author/date…, date는 달력 아이콘)
- 미결: 문서 탭 제목이 프론트매터 title과 자동 연동될지 여부
- 웹 버전: 사이드바 자동 숨김 (파일이 없으므로)

## 9. 배포

- **github.com/guebin/pururum** 공식 / miruetoto/verdure 개발·웹
- README는 ink 스타일(https://github.com/guebin/ink#install-macos),
  **설치 3방식**: Homebrew tap / curl 원커맨드 / 수동 dmg (+quarantine 해제 안내)
- dmg 갱신 시 `Casks/pururum.rb` version·sha256 갱신 + 릴리즈 재업로드
- 웹 Pages 활성화는 guebin 어드민 필요 (보류; 동작 웹 = miruetoto.github.io/verdure)

---

## Milkdown 전환 시 유의 (전환 이유와 리스크)

**전환 이유**: CodeMirror 데코레이션 방식은 "원문 텍스트 좌표 vs 렌더된 위젯"이
구조적으로 어긋나, 실기 WKWebView에서 커서 튐·선택 드리프트·수식 삐짐·클릭 무반응이
반복됨(두 줌 방식 모두 실패, drawSelection 제거 실험도 실패). Milkdown(ProseMirror)은
커서가 렌더된 콘텐츠 안에서 움직여 이 문제 계열이 애초에 없음. MIT.

**어려운 부분**:
1. Quarto 문법 왕복 직렬화 — 콜아웃 `::: {.callout-*}`, 탭셋 `{.panel-tabset}`,
   이미지 `{width= fig-align=}`, 표 캡션 `: Caption`, YAML 프론트매터.
   문서를 열고 저장했을 때 원문이 훼손되지 않아야 함
2. 낙서 캔버스 (이미지 위 드로잉) 이식
3. 신록예찬 테마(폰트·색·들여쓰기 실측값) 이식
4. 한글 IME 안정성 (조합 중 끊김 없이)
5. 수식은 KaTeX 플러그인이 기본 — MathJax CHTML과 렌더 차이 확인 필요

**재사용 가능**: Tauri 백엔드(파일 I/O·저장 대화상자·자동저장·export_html),
fonts.css(base64), doc.css(테마 값), export 파이프라인, 사이드바/탭 UI 골격.
