# Pururum 개발 로그

> `.qmd` / `.md`(Quarto/Markdown)를 Obsidian/Typora처럼 **라이브 프리뷰**로 편집하는
> 백엔드 없는 macOS 앱. Tauri(Rust) 데스크톱 + 웹 버전이 **하나의 프론트엔드**를 공유.
> 최종 배포: **github.com/guebin/pururum** (릴리즈 v1.1.0).

---

## 1. 앱 구조 (핵심 파일)

| 경로 | 역할 |
|---|---|
| `quarto_viewer/static/index.html` | 공유 프론트엔드 — UI·툴바·모든 팝업 편집기·렌더 파이프라인(marked+hljs+MathJax)·Tauri/web 어댑터 |
| `quarto_viewer/static/doc.css` | 문서 테마 (신록예찬 블로그 실측값: 산호색 제목, 보라 인라인코드 등) |
| `quarto_viewer/static/fonts.css` | **base64 임베드 폰트** (Noto Serif + 나눔명조) |
| `editor-src/src/editor.js` | CodeMirror 6 라이브 프리뷰 — 데코레이션·위젯·커서·키맵. `npm run build`로 `vendor/cm6/editor.bundle.js` 생성 |
| `verdure-tauri/src-tauri/src/lib.rs` | Rust 백엔드 — 파일 I/O, 저장 대화상자, 자동저장, `export_html` 등 |
| `verdure-tauri/src-tauri/tauri.conf.json` | 앱명(Pururum)·식별자(`com.local.verdure`)·**버전** |
| `Casks/pururum.rb` | Homebrew cask |
| `.github/workflows/pages.yml` | GitHub Pages 배포(웹) |

**빌드**: `export PATH="$HOME/.cargo/bin:$PATH"` 후
`cd verdure-tauri && npm run tauri build -- --bundles app`(또는 `dmg`).
에디터 변경 시 `cd editor-src && npm run build` 선행.

---

## 2. 통합 오브젝트 모델 (이번 세션의 큰 축)

**표·콜아웃·탭셋·이미지·프론트매터**가 전부 같은 로직을 공유하고, **타입별 팝업만** 다름.

- **삽입**: 공용 `insertBlockText()` — 위아래 **빈 줄로 격리**(파싱 오류 방지).
  ⚠️ 초기에 `insertBlock`이라는 동명 함수를 만들어 삽입 메뉴 전체가 깨진 사고 →
  `insertBlockText`로 개명. **교훈: 전역 함수는 grep으로 동명 확인.**
- **삭제**: 호버 시 **빨간 × 배지**(`addDeleteBadge`) + 캐럿 인접 시 **Backspace/Delete**
  (`deleteAtomicAt` 키맵). placeCursor가 위젯 뒤에 캐럿을 둠.
- **편집(클릭→팝업)**:
  - **표** — 스프레드시트 그리드 + 열 정렬·가운데·캡션·삭제
  - **콜아웃** — 종류(노트/팁/경고/주의/중요) + 제목 + 본문 + 삭제
  - **탭셋** — 탭 추가/삭제/이름변경 + 본문 + 삭제
  - **이미지** — 정렬 + **낙서(캔버스)** + 캡션 + 삭제 (크기는 모서리 드래그)
  - **프론트매터** — 제목/부제/저자/날짜 + 기타 YAML (삽입 메뉴엔 없음)
- **위치 탐색 견고화**: 공용 `findObjRange` — DOM 위치 우선, 실패 시 **문서 전체 유일매치**로
  폴백. 팝업 포커스 핸드오프로 위젯이 재렌더/끊겨도 수정이 반영됨(실기 WKWebView 대응).
- **실시간 미리보기**: 표·콜아웃·탭셋 팝업에 편집 필드 아래 **실제 렌더 미리보기**.
  탭셋 미리보기는 편집 중인 탭과 동기화(양방향).

### 코드 블록은 오브젝트화 **안 함**
사용자 요청으로 되돌림 — 커서 밖=하이라이팅 패널, 커서 안=원문 편집(구문 강조 유지).
삽입은 언어 하드코딩 없이 빈 ```` ``` ````에 커서.

---

## 3. 타이포그래피 (신록예찬 블로그 정합)

- **폰트**: 라틴·숫자·기호=**Noto Serif**, 한글=**나눔명조**(Noto Serif에 한글 없어 폴백).
  둘 다 `fonts.css`에 **base64 data URI**로 임베드.
  ⚠️ `url('fonts/*.otf')` 방식은 실기 Tauri/WKWebView서 로드 실패(에셋 프로토콜/MIME) →
  base64로 확실히 로드.
- **리스트 들여쓰기**: **Quarto cosmo를 실제 렌더해 실측** → 본문 대비 레벨당 정확히 2em.
  에디터는 불릿 in-flow라 depth 계산해 `padding = depth·1.4 − 0.66em`로 맞춤(레벨1=2.00em,
  레벨2=4.00em). 눈대중값(1.6em·0.6em)은 다 틀렸고 **실측이 정답**.

---

## 4. 캡션

- **이미지/낙서**: 캡션 = **alt 텍스트**(Quarto figure). 팝업 입력, 에디터 위젯은 이미지 바로
  아래 `.qv-imgcap`, 프리뷰/출력은 단독 이미지를 `<figure><figcaption>`으로.
- **표**: pandoc **`: Caption` 줄**을 표 위젯이 흡수 → 팝업 캡션 필드 + `<caption>` 렌더.

---

## 5. 출력: 인쇄 폐기 → 단일 HTML export (1.1.0)

- 네이티브 인쇄는 **탭셋 때문에 안 됨** → 전면 제거.
- **출력 버튼(⌘P) = `doExport`**: 문서를 **자체완결 .html 한 파일**로 저장.
  - 폰트(base64)·CSS·MathJax woff(base64)·수식 pre-render 전부 인라인
  - 이미지 = data/attachment URI
  - **탭셋은 작은 인라인 스크립트로 인터랙티브 유지**
  - 저장: 데스크톱=OS 저장 대화상자(Rust `export_html`), 웹=Blob 다운로드
  - 검증: 5.7MB 파일이 `file://`에서 폰트·수식·탭셋까지 독립 렌더
- ⚠️ 저장 경로 토스트는 **NFC 정규화**(macOS가 한글 파일명을 NFD로 저장).

---

## 6. UI 정리

- **삽입 메뉴 아이콘**: 흐릿한 박스 문자 → 또렷한 **라인 SVG**(콜아웃·표·탭셋·`</>`·연필).
- **소스/도움말 버튼**: 원형 아웃라인 쌍(소스는 on 시 코랄+글로우). **소스 토글 ⌘E**(⌘/는 주석
  충돌로 이전).
- **웹 툴바**: 사이드바 없는 웹에서 아이콘이 탭과 겹치던 것 → flex 흐름으로 정리.
- 이미지 팝업의 크기 슬라이더 제거(모서리 드래그로), 캡션은 이미지 바로 아래로.

---

## 7. 주요 버그 & 근본 원인 (WKWebView divergence 교훈)

**헤드리스 WebKit ≠ 실기 macOS WKWebView.** 이번에 반복 확인:

1. **낙서 사각지대** — 캔버스를 자연해상도로 잡아 **Retina(DPR 2)**서 포인터 매핑이 어긋남.
   → 캔버스를 **표시 크기 × DPR**로, CSS 픽셀로 그림. (헤드리스 DPR 1이라 안 드러남)
2. **오브젝트 수정 반영 안 됨** — 팝업 포커스 핸드오프로 위젯 재렌더→`el.isConnected=false`
   → 문서 전체 유일매치 폴백으로 해결.
3. **탭 두 번 클릭** — 탭 바를 클릭 중 재렌더해 첫 클릭이 씹힘 → 재렌더 없이 활성 클래스만 토글.
4. **폰트 미적용** — 위 3번(에셋 프로토콜) → base64 임베드.
5. **재설치 함정** — 앱 실행 중 재설치하면 옛 인스턴스가 새 코드 반영 못 함 → **⌘Q 후 재실행**.
6. **폴더 rename 후 빌드 실패** — cargo 캐시에 옛 절대경로 → `cargo clean` 후 재빌드.

---

## 8. 배포 상태

- **원격 2개**: `origin`=miruetoto/verdure(개발·웹), `guebin`=github.com/guebin/pururum(공식).
- **릴리즈 v1.1.0** + `Pururum.dmg`(Apple Silicon, ad-hoc 서명). `releases/latest/download/Pururum.dmg`.
- **설치 3방식**(README): Homebrew tap / 원커맨드 curl / 수동 dmg. (`xattr -dr com.apple.quarantine` 필요)
- **Homebrew cask** `Casks/pururum.rb` (dmg 갱신 시 version·sha256 수정).

---

## 9. 남은 일 (TODO)

- [ ] **웹 Pages 활성화** — guebin 계정에서 Settings → Pages → Source "GitHub Actions" (1회).
      그전 동작 웹 = miruetoto.github.io/verdure.
- [ ] **zoom 기능** (⌘+/⌘− 문서 확대/축소) — 사용자 요청, 미구현.
- [ ] Intel(Universal) 빌드는 미제공(현재 aarch64만).
- [ ] 새 dmg 낼 때마다 `Casks/pururum.rb`의 version·sha256 갱신 + 릴리즈 재업로드.

---

## 10. 엔진 대전환 (2026-07-23 밤) — WKWebView 탈출

**결론: Vditor(IR) + Electron(Chromium).** 커밋 전 상태 (사용자 지시로 커밋 보류).

- **원인 규명**: CM에서 못 잡던 커서 튐·선택 드리프트·수식 빈칸·클릭 무반응은
  전부 **Tauri의 WKWebView 전용** — 헤드리스(Chromium/WebKit)에선 재현 불가.
  Obsidian/Typora가 안정적인 이유 = Chromium(Electron).
- **Milkdown(ProseMirror) 시도** → 커서 문제는 해결됐으나 **입력을 노드로 변환**
  ("지맘대로 바꾼다")이 사용자 철학과 충돌. 코드는 editor-milkdown/에 보존.
- **Vditor 3.11.2 채택**: Typora식 IR — 친 그대로 = 소스, 커서 벗어나면 마커만
  숨김. `vendor/vditor-adapter.js`가 QVEditor 파사드 제공(팝업·저장·export 재사용).
  프론트매터는 에디터 밖 타이틀바(부팅 캐럿/슬랩 계열 버그 원천 차단).
- **Electron 셸** (`electron-shell/`): Rust 브리지를 명령별로 미러링(main.js) +
  pywebview 형태 preload → index.html 무수정 동작.
- 테마: 신록예찬 이식(흰 카드/회색 슬랩 제거, 산호 제목, 코드패널은 code-block에만
  스코프 — math 소스 pre와 클래스를 공유해서 생긴 베이지 조각 버그 수정).
- 수식: KaTeX (vditor 번들 MathJax는 로더 충돌 — export는 기존 MathJax 파이프라인
  그대로라 최종 산출물은 블로그 정합).
- 남은 일: 사용자 실기 승인 → 아이콘·dmg(electron-builder) → Tauri 대체 결정,
  콜아웃/탭셋 fence 라인 시각 태깅(멀티라인 블록 케이스), MathJax 에디터 내 렌더.

### 재개 지점 (2026-07-23 23:20, 미커밋)

**현재 실행 조합 = 원래 CM 위즈윅 + Electron.** 사용자 요구 "수식 입력은 예전
방식 + 커서 위치만 조정" 충족: 수식 뒤 커서 버그를 Chromium에서 재현→수정
(editor-src: 동기 렌더 후 requestMeasure + fonts.ready 재측정) 후 실창 검증 그린
(수식 렌더 ✓ / 수식 뒤 X 정확 ✓ / ⌘A+줌 드리프트 −2 ✓ / 자동저장 ✓).

- dmg: `electron-shell/release/Pururum-2.0.0-arm64.dmg` (122MB, static 번들 확인)
- 대기: ①사용자 실기 승인 ②커밋/푸시 지시 (자동 커밋 금지 지시 있음)
- 승인 후 할 일: 릴리즈 v2.0.0 업로드 + cask 갱신, Tauri 셸 은퇴 결정,
  index-vditor.html·editor-milkdown/ 정리 여부 결정
- 워킹트리 주요 변경: index.html(CM 복원+MathJax 선로드), editor-src(커서 수정),
  vendor/cm6 재빌드, electron-shell/(신규), vendor/vditor*(보존), docs/DEVLOG.md

### 역대 버그의 진범 (23:30 규명)

"수식 뒤 큰 공백/캐럿 튐"의 진짜 원인 = **editor-src create()의 HOST 매핑에
`typesetSync` 누락 (한 줄)**. 동기 렌더 경로가 역사상 한 번도 실행되지 않았고,
모든 수식이 폴백 `\(..\)`(≈47px)로 측정된 뒤 비동기 렌더로 좁아지며(≈15px)
캐럿만 옛 폭에 남았다. WKWebView 탓으로 오인했던 이유: 헤드리스에선 테스트가
MathJax를 미리 로드해 폴백 경로가 달랐음. Chromium(Electron)에서 재현이 가능해져
위젯 내용 덤프(`mjxInWidget:false`)로 확정. 수정 후: 스페이스 즉시 렌더,
캐럿 갭 36px→4px. 교훈: **옵션 전달 체인은 grep으로 끝까지 확인할 것.**
