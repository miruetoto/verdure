# 옆 프로젝트(Ink)에서 건진 것들

> Ink(guebin/ink)를 만들면서 실제로 부딪혀 고친 것만 적었습니다.
> Pururum도 **하나의 웹 프론트엔드 + 네이티브 껍데기** 구조라 대부분 그대로 적용됩니다.

---

## 1. 비활성 버튼은 툴팁도 클릭도 안 받는다

웹 버전에서만 못 쓰는 기능(파일 열기·저장 등)을 `disabled` 버튼으로 두고
`title`로 설명을 달았는데, **아무것도 안 뜹니다.** 비활성 요소는 포인터 이벤트를
받지 않아서 브라우저가 툴팁을 띄우지 않습니다. 사용자 입장에서는 "눌러도 반응
없는 버튼"이 됩니다.

그리고 `title` 툴팁은 **뜨는 데 1초쯤 걸립니다.** CSS로 못 줄입니다.

**해법** — 버튼을 링크로 감싸고, 툴팁은 직접 그립니다.

```html
<a class="locked" data-tip="이 기능은 맥 앱에서 됩니다 — 받으러 가기"
   href="https://github.com/guebin/pururum" target="_blank" rel="noopener">
  <button id="saveBtn" disabled>저장</button>
</a>
```

```css
.locked { position: relative; display: inline-flex;
          cursor: pointer; text-decoration: none; }
.locked::after {
  content: attr(data-tip);
  position: absolute; top: calc(100% + 10px); right: 0;
  padding: 7px 11px; background: #0d0e10; color: #f2f3f5;
  border: 1px solid #3a3d42; border-radius: 8px;
  font-size: 12px; white-space: nowrap;
  opacity: 0; pointer-events: none; transition: opacity .12s; z-index: 30;
}
.locked:hover::after { opacity: 1; }
.locked:hover button[disabled] { opacity: .7; }   /* 눌리는 것임을 알림 */
button[disabled] { opacity: .38; pointer-events: none; }
```

핵심 세 가지: **바로 뜬다 · 갈 곳이 있다 · 왜 안 되는지 말해준다.**
`right: 0`으로 붙여야 툴바 오른쪽 끝에서 화면 밖으로 안 나갑니다.

---

## 2. 스크립트로 값을 바꾸면 `input` 이벤트가 안 난다

서식 버튼(굵게, 표, 수식 삽입…)으로 `textarea.value`를 채웠더니,
`input`을 듣고 있던 "삽입" 버튼이 계속 **비활성**이었습니다. 내용은 분명히 있는데
버튼이 죽어 있으니 버그로 보입니다.

**스크립트로 `.value`를 건드린 자리마다 상태 갱신을 직접 불러줘야 합니다.**
미리보기만 갱신하고 버튼 상태를 빠뜨리기 쉽습니다.

---

## 3. iOS/사파리에서만 나는 것들

- **글씨가 저 혼자 커진다** — 화면 밖 측정용 컨테이너를 넓게(예: 4000px) 잡으면
  iOS가 "본문이 작다"고 판단해 글씨를 키웁니다.
  `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }` 로 고정하고,
  측정용 블록도 실제 필요한 폭까지만 잡습니다.
- **캔버스를 끌면 페이지 전체가 파랗게 선택된다** — 사파리의 텍스트 드래그 선택입니다.
  `body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }`
  로 막고, **입력창·미리보기만** `user-select: text`로 되돌립니다.

---

## 4. 재는 곳과 그리는 곳이 다르면 어긋난다

Ink은 카드를 **페이지에서 재고 SVG로 그렸는데**, 두 문서가 줄바꿈을 똑같이 하지
않아서 글씨가 상자 밖으로 나가거나 아래가 잘렸습니다. 원인 두 가지:

- `-apple-system`은 페이지에서는 잡히고 **SVG 안에서는 안 잡힙니다.** 양쪽 모두
  실제 이름이 있는 글꼴로 지정해야 합니다.
- 스타일시트를 카드 안에 넣으면 그 `<style>`이 `:first-child`가 되어,
  "첫 문단 위 여백 없애기" 같은 규칙이 엉뚱한 데 걸립니다.

**결론: 그려지는 그 환경에서 재라.** Ink은 결국 SVG에 자유 배치로 그려보고
그 결과에서 폭·높이를 읽어옵니다.

---

## 5. 화면 보고 짐작하지 말고 재라

가장 크게 아낀 것. 앱에 **스크립트를 실행하고 결과를 찍어주는 모드**를 넣었습니다.

```
Pururum --probe /절대경로/script.js [--shot /절대경로/out.png]
```

- 스크립트 본문은 async 함수 안이라 `return`·`await`가 그대로 됩니다.
- `--shot`은 웹뷰를 그대로 PNG로 떨궈서, 실제 화면을 눈으로 볼 수 있습니다.

"이상하다"는 말이 나오면 **코드를 고치기 전에 프로브부터** 짭니다.
카드가 상자 아래로 밀리던 버그는 구운 SVG를 PNG로 뽑아 보자마자 원인이 나왔습니다.
스크린샷만 보고 추측했을 때는 몇 번을 헛짚었습니다.

주의: 프로브는 **설치된 앱**을 돌리므로 먼저 설치 스크립트를 실행해야 합니다.

---

## 6. 웹에서 뭘 막았으면 문구도 같이 고쳐라

웹의 저장 기능을 앱 전용으로 옮기고 나서도, 푸터와 README에는
"웹에서 저장한 파일이 앱에서 열린다"가 남아 있었습니다. **기능을 옮기면 그걸
설명하는 문장이 어디에 있는지 같이 훑는 게 낫습니다.**

---

## 7. 배포 자잘한 것

- `git add -A`는 작업하다 흘린 임시 파일까지 같이 올립니다. 커밋 후
  `git ls-files`로 한 번 훑어보세요. (프로브 출력 `p6.json`이 올라가 있었습니다.)
- KaTeX 폰트는 `.woff2`만 있으면 됩니다. `.ttf`/`.woff` 사본은 아무도 안 받아갑니다.
- GitHub Pages는 푸시 직후 바로 안 바뀝니다. "아직 안 고쳐졌다"의 상당수가
  **브라우저 캐시이거나 빌드 대기**였습니다. `demo.js?v=<커밋해시>`처럼
  자산 주소에 해시를 붙이면 이 혼선이 사라집니다.
