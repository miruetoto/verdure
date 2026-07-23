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

## 3. 수식 (현재 구현 기준 상세)

### 3.1 엔진·설정 — *"신록예찬 블로그(Quarto)와 동일 렌더"가 원칙*

- **MathJax 3, CHTML 출력** (`vendor/tex-chtml-full.js`, 오프라인 번들)
  — 블로그가 CHTML이므로 KaTeX가 아닌 MathJax 유지가 사용자 결정
  (초기 SVG → CHTML 전환 이력 있음)
- TeX 폰트는 **로컬 woff** (`chtml.fontURL = "vendor/mathjax-woff"`)
- `startup.typeset: false` — 자동 typeset 금지, 앱이 직접 호출
- **`enableAssistiveMml: false` 필수** — WKWebView가 숨김 assistive-MathML을
  클리핑하지 못해 **모든 수식이 두 번 렌더**되던 실기 버그. CSS로도 이중 방어:
  `mjx-assistive-mml { display: none !important; }`
- **지연 로드** — MathJax(1.3MB)는 문서에 수식이 처음 나타날 때만 로드
  (`ensureMathJax()`), 수식 없는 문서는 시작이 빨라짐

### 3.2 파싱·위젯 (editor.js)

- 수식은 markdown 트리 밖에서 정규식으로 추출:
  - 블록: `$$…$$` (개행 포함 시 block 위젯)
  - 인라인: `(?<!\$)\$(?!\s)…(?<!\s)\$(?!\$)` — `$` 이스케이프, 공백 규칙 준수
  - 코드(인라인/펜스) 내부의 `$`는 제외 (`inCode` 체크)
- 렌더 span은 **블로그의 pandoc 클래스 그대로**: `math inline` / `math display`
  (블로그 CSS가 그대로 적용되도록) + 델리미터 `\(…\)` / `\[…\]`
- **커서/선택이 수식 범위에 닿으면(`spanActive`) 원문 `$…$` 노출** — 수식은
  위젯 안에서 편집하지 않고 원문 편집이 원칙
- 인라인 수식 위젯은 **atomic** (캐럿이 내부로 못 들어가고 건너뜀,
  Backspace로 통째 삭제)

### 3.3 동기 렌더 — "인라인 수식 뒤 큰 공백" 버그의 해법

- **`typesetSync`**: MathJax가 이미 로드돼 있으면 `tex2chtml`로 **동기** 변환
  → 위젯이 CM의 캐럿 측정 시점에 이미 **최종 폭**을 가짐.
  비동기 렌더면 placeholder(`\(x^2\)`) 폭으로 측정돼 캐럿이 그 자리에 남는
  "수식 뒤 큰 공백/캐럿 튐"이 발생했음
- 동기 변환 후 `MathJax.startup.document.updateDocument()`로 CHTML 글리프
  스타일시트 재방출 (안 하면 새 글리프가 빈 박스)
- 첫 수식(MathJax 미로드)만 비동기 폴백 + `requestMeasure` 재측정
- **`whenConnected` 가드**: detached 노드에 typeset 금지 — 폰트 메트릭을 못 재
  **NaN 치수의 거대한 수식**이 나오는 사고 방지 (위젯 toDOM이 attach 전에
  호출되므로 연결될 때까지 rAF 대기, 상한 120프레임)

### 3.4 크기·레이아웃 CSS (doc.css) — 실기에서 얻은 값

- **인라인 `1em`** — 본문과 동일 (원래 블로그 실측 1.15em이었으나
  "수식 크기가 튄다" 피드백으로 1em 확정). **디스플레이 `1.1em`** (1.2 → 1.1)
- **overflow 규칙**: `mjx-container[display="true"]`에만
  `max-width:100%; overflow-x:auto` — 인라인에 overflow를 주면 WKWebView가
  inline-block을 줄 전체 폭으로 부풀려 **수식 뒤 거대 공백**이 생김.
  반드시 디스플레이 수식에만 적용
- 줌은 font-size 배율로만 — **CSS `zoom`은 수식이 제곱으로 폭주**
  (MathJax가 zoom된 컨테이너를 측정한 결과에 zoom이 또 곱해짐). 실기 확인됨

### 3.5 export의 수식 처리

- export 전 `elementHasMath` 체크 → `MathJax.typesetPromise([exportDoc])`로
  **pre-render** (뷰어에 JS 수식 렌더 불필요)
- MathJax가 CSSOM으로 주입한 규칙(`id^=MJX` 스타일시트)을 **직렬화해 인라인**
  — 이걸 빼먹으면 export에서 수식이 깨짐
- CSS 내 `location.origin` 절대경로 제거 + **mjx woff를 base64 인라인**
  (`inlineFontUrls`) → `file://`로 열어도 수식 폰트 정상
- 인쇄(네이티브)에서 인라인 수식이 깨지던 문제는 인쇄 자체를 폐기하고
  export로 대체하면서 해소

### 3.6 미해결 (Milkdown 전환 이유)

- **수식 뒤 캐럿 튐 / 클릭 무시**: drawSelection이 CM 캐시 좌표로 캐럿을 그려
  렌더된 위젯 폭과 어긋남. docChanged 후 selection 재-assert라는 완화책이
  들어있으나 실기에서 불충분. drawSelection 제거(네이티브 선택) 실험은
  수식 근처 클릭 무반응을 일으켜 **롤백됨**
- **수식이 선택 하이라이트 위로 삐져나옴**: 같은 뿌리(선택 사각형이 stale 좌표)
- 이 계열은 CM 데코레이션 구조의 한계로 판단 → **Milkdown 전환**

### 3.7 Milkdown 전환 시 수식 요구사항

1. **MathJax CHTML 유지가 1순위** (블로그와 동일 렌더가 원칙).
   Milkdown 기본은 KaTeX 플러그인이므로 **MathJax로 교체 또는 커스텀 노드 필요**
   — KaTeX로 갈 경우 블로그와의 렌더 차이를 사용자에게 확인받을 것
2. `$…$` / `$$…$$` 문법 왕복 무손실 (pandoc 규약 그대로 저장)
3. 인라인 1em·디스플레이 1.1em, overflow 규칙(3.4) 이식
4. 지연 로드(수식 없는 문서 빠른 시작) 유지
5. WKWebView 함정 재확인: assistive-MathML 이중 렌더, detached-node NaN,
   인라인 overflow 부풀림 — 새 에디터에서도 같은 함정이 재현되는지 실기 검증
6. 수식 원문 편집 UX: 커서/클릭으로 원문 노출(현재 방식) 또는 팝업 편집 —
   Milkdown 관례(클릭→수식 입력창)로 바뀌어도 무방하나 사용자 확인 필요

## 4. 타이포그래피 (현재 구현 기준 상세) — *"신록예찬 블로그와 똑같이"*

> 원칙: 눈대중·임의값 금지. **블로그(위치: `~/Dropbox/01-rsch/999-Yechan`,
> quarto 프로젝트 포함)를 실제 렌더해 실측한 값**만 쓴다.
> ("임의로 줄이지 말고 신록예찬 블로그 보고 quarto로 비교하면서 해")

### 4.1 폰트

- 스택: `--serif: 'Noto Serif', 'NanumMyeongjo', 'Nanum Myeongjo', serif`
  — **라틴·숫자·기호 = Noto Serif**, **한글 = 나눔명조**
  (Noto Serif에 한글 글리프가 없어 스택 폴스루로 자동 분담.
  영문 폰트는 후보 비교 후 사용자가 Noto Serif 확정,
  "영어·특수문자·숫자 모두 Noto Serif, 한글만 나눔명조")
- **base64 data-URI 임베드** (`fonts.css`, 약 5.3MB):
  Noto Serif variable woff2 + NanumMyeongjo regular/bold otf.
  ⚠️ `url('fonts/*.otf')` 파일 참조는 **실기 Tauri/WKWebView에서 로드 실패**
  (에셋 프로토콜/MIME) — base64가 유일하게 확실한 방법. 이 파일은 export에도
  그대로 인라인되어 자체완결성을 보장
- 모노스페이스: `SFMono-Regular, Menlo, Monaco, Consolas, …` 시스템 스택

### 4.2 색상 팔레트 (블로그 styles.css + cosmo 실측)

- 배경 `#fcfcf7`(크림) / 본문 `#555` / 문단·strong `#333` / muted `#6c757d`
- **제목·링크 산호색 `#ff6f61`** (호버 `#d64b40`), 제목 weight 600,
  h1/h2는 `border-bottom` 룰(Quarto 섹션 스타일)
- 인라인 코드 **보라 `#7d12ba`** on `rgba(233,236,239,.65)` 칩
- 표·인용 테두리 bootstrap 회색 `#dee2e6`, 인용 텍스트 `hsl(210,10.3%,47.7%)`
- 콜아웃 액센트(cosmo): note `#2780e3` / tip `#3fb618` / warning `#ff7518` /
  caution `#f0ad4e` / important `#ff0039` +
  **헤더 틴트 = 액센트 10% + 흰색 90% (실측 rgb값 하드코딩)**
- 탭셋 비활성 탭 링크 `#2761e3`(cosmo 블루)
- 앱 크롬: 툴바 `#f7f5ec` / 호버 `#f0eddf` / 강한 테두리 `#dcd8c8`

### 4.3 본문 치수

- 기준 16px / line-height 1.5 (`.qdoc`), 에디터 컬럼 `max-width: 820px` 가운데,
  export 컬럼 760px
- 제목 스케일: h1·h2 = 2em, h3 = 1.45em, h4 = 1.15em, h5·h6 = 1em
- **리스트 들여쓰기 — Quarto cosmo 실측 = 레벨당 정확히 2em**:
  프리뷰/export는 `ul,ol { padding-left: 2rem }`(bootstrap 기본).
  에디터는 불릿이 in-flow이고 원문 선행공백이 레벨당 ~0.6em을 차지하므로
  **`padding-left = depth×1.4 − 0.66em`** 공식으로 텍스트가 depth×2em에
  떨어지게 보정 (레벨1=2.00em, 레벨2=4.00em). 눈대중값(1.6em, 0.6em)은
  전부 틀렸고 실측이 정답이었음
- 불릿 마커는 `•` 위젯으로 치환(순서 리스트 번호는 원문 유지),
  ul/ul/ul 마커: disc → circle → square

## 5. 줌 (가독성) — ★ 매우 중요

> 목표: **문서 전체가 커진다** — 글자만이 아니라 표·콜아웃·탭셋·이미지·수식·
> 캡션까지 전부 비례해서. 이 기능은 사용자에게 우선순위가 높다.

### 5.1 확정 UI/UX 스펙

- 툴바 우측 `−` / `퍼센트` / `+` 캡슐 컨트롤. **퍼센트 클릭 = 100% 리셋**
- 단축키 **⌘+ (⌘=) / ⌘− (⌘_) / ⌘0** — 에디터 포커스와 무관하게 동작
  (keydown 핸들러에서 hasFocus 가드보다 먼저 처리)
- 단계: `[0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]`
  (`nudgeZoom`은 현재값을 가장 가까운 단계에 스냅 후 한 칸 이동)
- **localStorage `qv-zoom`에 저장** — 재실행 시 유지 (0.6~3 범위 검증)
- 구동: `--qv-zoom` CSS 변수 하나로 통일.
  `.cm-scroller { font-size: calc(16px * var(--qv-zoom,1)) }` +
  `.qdoc { font-size: calc(16px * var(--qv-zoom,1)) }` (오브젝트·수식은
  em/relative라 연쇄 스케일)

### 5.2 반드시 지켜야 할 성질 (실기 검증으로 확정)

1. **좌측 시작선 고정** — 확대해도 본문 컬럼의 왼쪽 엣지가 흔들리면 안 됨.
   컬럼(820px)과 여백을 px 고정으로 유지하는 font-size 방식이 이를 보장
2. **수식 비례 스케일** — 확대 시 수식/본문 비율 일정(실측 1.10 유지),
   수식만 커지거나 폭주 금지
3. **표·콜아웃·이미지도 같이** — `.qdoc` 하드코딩 16px이 배율을 리셋하던
   버그 있었음. 모든 오브젝트 CSS는 em/relative + `--qv-zoom` 연쇄여야 함
4. **export 반영** — 내보낸 HTML도 현재 배율로 렌더
   (`:root{--qv-zoom:N}` 한 줄 주입, 같은 메커니즘)
5. **확대 상태에서 커서·선택 정확** ← 현재 유일한 미달 항목(5.4)

### 5.3 실패한 접근 (재시도 금지 목록)

- **CSS `zoom`**: ⓐ MathJax가 zoom된 컨테이너를 측정한 결과에 zoom이 또
  곱해져 **수식이 제곱으로 폭주** ⓑ 가운데정렬 컬럼의 **좌측선이 배율마다
  이동**. 둘 다 실기(WKWebView) 확인. 헤드리스에선 안 드러남 — 재시도 금지
- **transform: scale()**: CM 좌표계가 깨짐 (검토 단계에서 배제)
- font-size 방식 + CM 조합의 드리프트 완화책들 전부 실패:
  `requestMeasure`(효과 없음), no-op dispatch(효과 없음),
  ResizeObserver(폰트 변화에 발화 안 함), `view.setState`(헤드리스에선 유일하게
  동작했으나 실기 불충분), drawSelection 제거→네이티브 선택(수식 근처 클릭
  무반응 → 롤백)

### 5.4 미해결 → Milkdown 인수 조건

- 확대 상태에서 **선택 하이라이트가 텍스트에 정확히 붙고**(위/아래 삐짐,
  한 줄 짧아짐 금지), **클릭 캐럿이 정확**할 것.
  Milkdown(ProseMirror)은 커서·선택이 렌더된 DOM 그 자체이므로 font-size
  배율에서 이 문제가 구조적으로 없어야 함 — **전환 직후 1순위로 실기 검증**

## 6. 선택/커서 품질 — ★ 매우 중요

> 이 절의 항목들이 CodeMirror에서 끝내 못 잡은 것들이며 Milkdown 전환의
> 직접적 이유다. **전환 후 인수 테스트 목록으로 사용할 것.**

### 6.1 색상 스펙

- 선택 배경: 포커스 시 **복숭아 `#ffd5ce`**, 비포커스 `#ffe1dc`
- 캐럿: **코랄 `#ff6f61`** (`caret-color`)
- **시스템 기본 라벤더(#d7d4f0) 금지** — CM drawSelection 기본 테마가
  높은 특이성 셀렉터(0,5,0)로 라벤더를 칠해서, 같은 깊이의 셀렉터로 이겨야
  했음(특이성 낮은 override는 조용히 짐). 새 에디터에서도 기본 선택색이
  뭔지 먼저 확인할 것

### 6.2 기하 요구사항 (전부 실기 WKWebView 기준)

1. **선택 하이라이트가 텍스트에 정확히 붙는다** — 윗줄이 하이라이트 위로
   삐져나오거나, 바텀라인이 어긋나거나, 문단 사이 빈 영역이 칠해지면 안 됨
2. **줄 사이 어긋남 금지** — 특히 제목(2em)·수식·이미지처럼 줄 높이가
   다른 요소가 섞여도
3. **확대/리사이즈/비동기 수식 렌더 후에도** 1·2 유지 (높이가 나중에 바뀌는
   모든 경로: ⌘± 줌, 이미지 그립 드래그, MathJax 늦은 로드)
4. **클릭 위치 = 캐럿 위치** — 수식 바로 뒤 포함. 수식 근처 클릭이
   무시되면 안 됨
5. **타이핑 시 캐럿 튐 금지** — 인라인 수식 뒤에서 글자 입력 시 캐럿이
   placeholder 폭 위치로 점프하던 버그 (s 하나 입력에 캐럿이 멀리 튐)
6. **한글 IME 안전** — 조합 중(view.composing) 선택/캐럿 보정류 개입 금지
   (조합이 끊기면 한글 입력이 깨짐)

### 6.3 검증 방법 (교훈)

- **헤드리스(Playwright Chromium·WebKit 모두) ≠ 실기 WKWebView.**
  이 절의 버그들은 전부 헤드리스에서 재현 실패, 실기에서만 발생.
  선택/커서 검증은 반드시 빌드→설치→실기 스크린샷으로.
  (실기 자동조작: AppleScript System Events + screencapture -R 조합 가능,
  단 앱 창을 앞으로 고정하고 클릭 좌표 보정 필요)

## 7. 출력 (export) — 현재 스펙에 만족, 그대로 보존 ★

> 사용자 평가: **지금 동작에 어느 정도 만족.** Milkdown 전환에서 이 파이프라인은
> 산출 HTML 기준으로 **동일하게 유지**한다. (렌더 입력만 새 에디터에서 오면 됨)

### 7.1 진입점·이력

- 툴바 "출력" 버튼 + **⌘P** = `doExport()`.
  네이티브 인쇄는 **탭셋이 인쇄에서 동작 불가**라 1.1.0에서 전면 폐기,
  단일 HTML export로 대체 (사용자 결정)

### 7.2 산출물 스펙 — 자체완결 단일 .html

- 구조: `<!DOCTYPE html><html lang="ko">` + `<meta viewport>` + `<title>`(fm.title)
  + **인라인 `<style>` 하나** + `<body><article class="doc-export qdoc">…</article>`
  + 탭셋용 인라인 스크립트
- 스타일 = `fonts.css`(base64 폰트) + `github.min.css`(코드 하이라이트) +
  `doc.css`(테마) + 레이아웃 한 줄
  (`body{background:var(--bg);margin:0} .doc-export{max-width:760px;margin:0 auto;
  padding:40px 24px 64px}`) + **MathJax CSSOM 직렬화분** — 전부 한 `<style>`에
- **줌 배율 반영**: 100%가 아니면 `:root{--qv-zoom:N}` 주입 (§5.2-4)
- **수식**: export 전 `typesetPromise`로 pre-render + mjx woff **base64 인라인**
  (`inlineFontUrls`) + `location.origin` 절대경로 제거 → 뷰어 JS 없이 렌더
- **이미지**: data URI/attachment 경로 그대로 (렌더 파이프라인이 이미 해석)
- **탭셋 인터랙티브 유지**: 작은 인라인 스크립트 하나가 `.tab-btn` 클릭에
  `data-ts`/`data-idx`로 active 클래스 토글 — 정적 HTML인데 탭이 동작
- 검증 기록: 5.7MB 산출물이 `file://`에서 폰트·수식·탭셋까지 독립 렌더 확인

### 7.3 저장 흐름

- 파일명: `fm.title`(없으면 탭 제목) → 금지문자 `[\/\\:*?"<>|]` → `_`,
  80자 제한, `.html`
- **데스크톱**: Rust `export_html(html, name)` — OS 저장 대화상자 → 파일 쓰기
- **웹**: Blob + `<a download>` 다운로드
- 완료 토스트에 저장 경로 표시 — **NFC 정규화 필수**
  (macOS가 한글 파일명을 NFD로 반환해 "ㅈㅔㅁㅗㄱ" 식으로 깨져 보였음,
  `describePath()`에서 `.normalize("NFC")`)

### 7.4 전환 시 인수 조건

- 같은 .qmd에 대해 export 산출물이 현재와 **시각적으로 동일**
  (폰트·색·수식·표·콜아웃·탭셋·캡션·줌 배율)
- `file://` 오프라인 렌더, 탭 전환 동작, 한글 경로 토스트 정상

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
