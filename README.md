# 푸르름 (Verdure)

**`.md` · `.qmd` (Quarto/Markdown) 파일을 Obsidian처럼 같은 화면에서 바로 편집·미리보기**하는
맥 네이티브 앱입니다. 백엔드(`quarto render`) 없이 전부 클라이언트 렌더링으로 동작합니다.

> A native macOS live editor & viewer for **Markdown (`.md`) and Quarto (`.qmd`)** —
> Obsidian-style WYSIWYG live preview, fully backend-free & offline.

## 기능

- **라이브 프리뷰 에디터** (CodeMirror 6): 마크다운을 원본 그대로 유지한 채 서식을 인라인
  렌더하고, 커서를 올린 부분만 원문을 노출 (Obsidian 방식 — 파일이 깨지지 않음)
- **탭**: 여러 문서를 탭으로 열기, 탭마다 편집 상태(undo·커서) 유지, Finder에서 여러 파일을
  더블클릭하면 한 창에 탭으로 (단일 인스턴스)
- **새로 만들기 / 열기 / 저장 / 출력** 아이콘 툴바 (⌘N/⌘O/⌘S/⌘P)
- **이미지 붙여넣기**: ⌘⇧4로 캡처 후 ⌘V → 문서 옆 `attachments/`에 저장하고 삽입
- **테마**: 신록예찬 블로그의 실제 렌더 HTML에서 실측한 값으로 구성 (나눔명조, 살구색 제목,
  보라 인라인코드, 가로선 표, cosmo 콜아웃 색)
- Quarto 문법: 콜아웃 5종(`:::{.callout-*}`) · 탭셋(`{.panel-tabset}`) · 표 ·
  수식(MathJax CHTML, `\boldsymbol` 등 전체 확장) · 코드 강조 · YAML 제목 블록
- 로컬 이미지 상대경로, 외부 변경 자동 반영, 한글 NFC 파일명, 완전 오프라인

> 실제 `quarto render`가 필요한 것(코드 실행·cross-ref·참고문헌)은 렌더하지 않고 원문 그대로 둡니다.

## 설치 / 실행

> ⚠️ 현재는 **다운로드 후 바로 설치되는 배포판이 아닙니다.** 소스를 받아 직접 빌드하면
> 그 기기에서 동작하는 `푸르름.app`이 생성됩니다 (파이썬/노드 환경 필요).

```bash
# 1) 의존성
uv sync                                   # 파이썬 (pywebview, pyobjc)
cd editor-src && npm install && npm run build && cd ..   # CodeMirror 6 번들

# 2) 앱 번들 생성 → /Applications 설치
./build_app.sh
cp -R 푸르름.app /Applications/

# 또는 빌드 없이 바로 실행
uv run python -m quarto_viewer.app 파일.qmd
```

빌드 후에는 `.qmd`/`.md`를 **더블클릭**하면 열립니다.

## 단축키

| 키 | 동작 | | 키 | 동작 |
|----|------|-|----|------|
| ⌘N | 새로 만들기 | | ⌘S | 저장 |
| ⌘O | 열기 | | ⌘P | 출력 (인쇄/PDF) |
| ⌘W | 탭 닫기 | | ⌃Tab | 탭 순환 |

위젯(표·콜아웃·코드블록)을 **클릭하면 그 자리에서 원문 편집**, 벗어나면 다시 렌더됩니다.

## 구조

```
quarto_viewer/         # 파이썬: pywebview 창 + 파일 I/O + 단일 인스턴스 IPC
  static/index.html    # UI(탭·툴바) + 렌더 파이프라인 (marked+hljs+MathJax)
  static/doc.css       # 블로그 실측 테마 (프리뷰·PDF 공용)
  static/vendor/       # 오프라인 라이브러리 (CM6 번들·marked·highlight·MathJax·폰트)
editor-src/            # CodeMirror 6 라이브 프리뷰 소스 + 테스트
  src/editor.js        # 데코레이션/위젯/커서 로직
  npm run build        # → quarto_viewer/static/vendor/cm6/editor.bundle.js
build_app.sh           # 이중 번들(.app) 빌더 — 더블클릭 열기 + Dock 이름 "푸르름"
```

### 테스트 (headless Chrome)

```bash
cd editor-src
node tabs_test.cjs        # 탭 열기·전환·dirty·닫기·새로만들기·외부변경
node visual_test.cjs      # 렌더 회귀 (수식 크기·NaN·표·콜아웃·탭셋)
node interact_test.cjs    # 상호작용 (화살표 이동·클릭 편집)
node pdf_view_test.cjs    # 출력(내보내기)·타이핑 지연
```
