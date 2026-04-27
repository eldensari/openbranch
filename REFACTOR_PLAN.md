# 🧱 Atomic Refactor Plan

App.jsx는 **1991줄**이라 너무 커요. 작은 레고 블록처럼 나눌 거예요.

## 🌳 가지 구조

```
main
 └─ atomic (베이스)
     ├─ atomic-theme    ← 1단계: 색깔 🎨
     ├─ atomic-graph    ← 2단계: 그래프/가지 🌲
     ├─ atomic-storage  ← 3단계: 저장 💾
     ├─ atomic-ui       ← 4단계: 화면 🖼️
     └─ atomic-app      ← 5단계: App.jsx 조립 🧩
```

## ⚠️ 규칙 (모든 session 공통)

1. **행동 변경 금지** — 순수 코드 분리만. 새 기능 추가 ❌
2. **CLAUDE.md 규칙 따르기** — 약칭 (t/cm/cv), 인라인 스타일, JSX (TypeScript ❌)
3. **매 branch마다**:
   - 이전 단계 완료된 `atomic`에서 새 가지 만들기 (`git checkout atomic && git checkout -b atomic-<step>`)
   - 작업 → 커밋 → 푸시
   - `atomic`으로 머지 → 푸시
4. **함수 쪼개기 기준**:
   - 5~10줄이 이상적
   - 이름이 억지스러워지면 (`doFirstPart` 같은) 그냥 두기
5. **순서 엄수** — 나중 단계는 이전 단계 파일을 import하므로

---

## 🎨 Session 1: `atomic-theme`

**목표**: 테마/색깔 상수를 별도 파일로 분리

### 새 파일
- `src/theme.js` (~25줄)

### App.jsx에서 이동할 것들
- `LIGHT` 객체 (line ~8-14)
- `DARK` 객체 (line ~15-21)
- `BC` 배열 (브랜치 색상 배열, grep으로 찾기)
- `bCol(names, b)` 헬퍼 함수

### App.jsx 변경
```jsx
import { LIGHT, DARK, BC, bCol } from "./theme";
```

### 검증
- `npm run build` 성공
- `npm run dev` → 라이트/다크 토글 정상, 브랜치 색깔 정상

### 끝나면
```bash
git add src/theme.js src/App.jsx
git commit -m "refactor: extract theme constants to src/theme.js"
git push -u origin atomic-theme
git checkout atomic && git merge atomic-theme && git push
```

---

## 🌲 Session 2: `atomic-graph`

**목표**: 커밋/브랜치/HEAD 그래프 로직을 순수 함수로 분리

### 새 파일
- `src/graph/model.js` (~70줄) — 데이터 모델
- `src/graph/branches.js` (~90줄) — 브랜치 트리 로직
- `src/graph/range.js` (~50줄) — 범위 선택 편집

### App.jsx → `src/graph/model.js`
- `cc` 카운터 + `mkId()` 래퍼 + `bumpIdCounter(n)` 세터
  - ⚠️ ES 모듈 export는 read-only. `cc` 직접 export ❌. getter/setter 사용
- `mkCommit(...)` 
- `buildMsgs(...)` (thread → LLM messages 변환)
- `getThread(...)` (HEAD부터 루트까지)
- `bNames(commits)` (브랜치 이름 set)
- `bHead(commits, branch)` (브랜치 HEAD 찾기)
- `shortModelName(model)` 

### App.jsx → `src/graph/branches.js`
- `getBranchLabel(...)`
- `buildBranchTree(...)`
- `commitBranch(...)`
- `branchPathToRoot(...)`
- `getBranchDescendantNames(...)` ← App 내부에 있음, 밖으로 꺼내기

### App.jsx → `src/graph/range.js`
- `cutRangeFromCommits(...)`
- `chooseHeadAfterCut(...)`
- `cloneRangeCommits(...)`
- `nextBranchName(...)`
- `rangeCommitsFor(source, range)` ← **순수하게 만들기** (selectRange/commits 기본값 제거)
  - 호출부에서 `rangeCommitsFor(commits, selectRange)` 로 변경

### ⚠️ 주의사항
- `load()` 함수에서 `cc = Math.max(cc, commits.length + 10)` → `bumpIdCounter(commits.length + 10)` 로 변경
- `rangeCommitsFor` 호출부 모두 수정

### 검증
- `npm run build` 성공
- 브랜치 생성/삭제/머지, 범위 선택 자르기/복사 모두 정상

### 끝나면
```bash
git add src/graph/ src/App.jsx
git commit -m "refactor: extract graph model/branches/range to src/graph/"
git push -u origin atomic-graph
git checkout atomic && git merge atomic-graph && git push
```

---

## 💾 Session 3: `atomic-storage`

**목표**: 영속/사이드바 헬퍼 분리

### 새 파일
- `src/storage/clusters.js` (~80줄) — 클러스터 로직
- `src/storage/sidebar.js` (~60줄) — 사이드바 레이아웃
- `src/storage/conv.js` (~90줄) — 대화 저장/삭제 헬퍼

### App.jsx → `src/storage/clusters.js`
- `pad2(n)`
- `formatClusterTitle(...)`
- `mkClusterId(...)`
- `getConvCreatedAt(...)`
- `findRootConvForCluster(...)`
- `normalizeClusters(...)`
- `buildClusterGroups(...)`

### App.jsx → `src/storage/sidebar.js`
- `sidebarBranchKey(...)`
- `orderSectionItems(...)`
- `buildSidebarLayout(...)`

### App.jsx → `src/storage/conv.js`
- `loadAllConvsAndClusters()` — seed-and-load 로직을 순수 함수로
- `persistConv(cv)` — `lib/storage` 래퍼
- `persistCluster(cluster)`
- `deleteConvCascade(convs, id)` → `{nextConvs, deletedIds}` 반환

### ⚠️ 주의사항
- `save()`는 App에 그대로 둠 (convs/parentRef/convId closure 사용)
- `storage/conv.js`는 순수 shape-building만
- `lib/storage.js` 건드리지 않기

### 검증
- 대화 생성/삭제, 클러스터 생성, 사이드바 순서 모두 정상
- 새로고침 시 상태 복원 정상

### 끝나면
```bash
git add src/storage/ src/App.jsx
git commit -m "refactor: extract cluster/sidebar/conv helpers to src/storage/"
git push -u origin atomic-storage
git checkout atomic && git merge atomic-storage && git push
```

---

## 🖼️ Session 4: `atomic-ui`

**목표**: 프레젠테이션 컴포넌트들을 개별 파일로 분리

### 새 파일
- `src/ui/icons.jsx` (~30줄)
- `src/ui/Markdown.jsx` (~110줄)
- `src/ui/IconBtn.jsx` (~12줄)
- `src/ui/ModelPicker.jsx` (~55줄)
- `src/ui/Graph.jsx` (~290줄)
- `src/ui/Sidebar.jsx` (~230줄)
- `src/ui/ChatPanel.jsx` (~150줄)
- `src/ui/ConfirmDialog.jsx` (~20줄)

### App.jsx → `src/ui/icons.jsx`
- `SunIcon`, `MoonIcon`, `GitHubIcon`, `FolderIcon`, `ChevronIcon`

### App.jsx → `src/ui/Markdown.jsx`
- `renderInline`, `CodeBlock`, `renderMd`, `ThinkingDots`

### App.jsx → `src/ui/IconBtn.jsx`
- `IconBtn` 컴포넌트

### App.jsx → `src/ui/ModelPicker.jsx`
- `ModelPicker` 컴포넌트

### App.jsx → `src/ui/Graph.jsx`
- `Graph` 컴포넌트 (setCtx/tagPicker 로컬 상태 포함)
- import: `bCol` from `../theme`, `getBranchLabel` from `../graph/branches`, `shortModelName` from `../graph/model`

### App.jsx → `src/ui/Sidebar.jsx`
- 왼쪽 컬럼 JSX (`<div style={{ width: 180, ...}}>` 서브트리)
- `renderConvItem`, `renderBranchNode`도 파일 내부에 유지
- ⚠️ props ~25개 (convs/clusters/state/setters/handlers/t) — 그냥 전부 전달

### App.jsx → `src/ui/ChatPanel.jsx`
- 중앙 컬럼 + 오른쪽 `<Graph>` 래퍼
- 헤더 바, 스레드 리스트, 입력창, 모드 배너, 레이트 리밋 배너

### App.jsx → `src/ui/ConfirmDialog.jsx`
- `{confirmDialog && ...}` 블록

### ⚠️ 주의사항
- 모든 UI 컴포넌트는 `t` (테마)를 prop으로 받기 — 이미 관례
- prop drilling 허용 (상태관리 라이브러리 금지 규칙)
- 이 단계에서 App.jsx는 아직 크다 — 핸들러/상태는 Session 5에서 정리

### 검증
- 모든 UI 인터랙션 (클릭, 입력, 토글, 모달) 정상
- 라이트/다크 토글
- 사이드바 리사이즈 (있다면)

### 끝나면
```bash
git add src/ui/ src/App.jsx
git commit -m "refactor: extract UI components to src/ui/"
git push -u origin atomic-ui
git checkout atomic && git merge atomic-ui && git push
```

---

## 🧩 Session 5: `atomic-app`

**목표**: App.jsx 내부 긴 함수들 쪼개기 + 최종 정리

### 쪼갤 함수들 (App.jsx 내부에 유지, 하지만 작게)

- **`send`** (~110줄) → 분해
  - `sendNewFromRef(msg)` — `newFromRef` 분기
  - `sendEditRoot(msg)` — root 편집 분기
  - `sendNormal(pid, br, msg)` — 일반 경로 (callLLM)
  - `applyCommitResult(nc, cm, br, title)` — 공통 꼬리 (setCommits/save)
  - 최상위 slash-command + setInput guard는 그대로

- **`save`** (~22줄) → 분해
  - `resolveExistingConv(id)`
  - `buildConvRecord(...)`
  - `save`는 5줄 래퍼

- **`deleteCommit`** → 분해
  - `collectDescendantIds(cid)`
  - `pickNextHead(nc, deletedSet, cid)`

- **`deleteBranchCascade`** → 분해
  - `computeBranchRemoval(cv, bName)` → `{newCommits, newHeadId, newBranch, titles}`
  - `deleteBranchCascade`는 state-writer

- **`rangeToNew`** → 분해
  - `buildNewConvFromRange(range, currentConv)` → `{originalUpdated, newConv}`
  - 핸들러는 setter

### 그대로 두기 (이미 탄탄함)
- `retryResponse`, `merge`, `rangeToBranch`, `deleteRange`
- `startNew`, `startEdit`, `startBranchFrom`
- `load`, `loadMain`, `loadBranch`
- `rememberUndo`, `restoreUndo`

### 최종 확인
- App.jsx가 ~350줄 되었는지
- 모든 기능 정상

### 끝나면
```bash
git add src/App.jsx
git commit -m "refactor: split large handlers in App.jsx into small named functions"
git push -u origin atomic-app
git checkout atomic && git merge atomic-app && git push
```

그리고 `atomic` → `main` 머지는 유저가 직접 (또는 PR로)

---

## 🚨 공통 위험 요소

1. **`cc` 카운터 (module-level mutable)**
   - ES 모듈 export는 read-only. getter/setter로 래핑
   - `load()` 함수에서 `cc = Math.max(...)` 호출부 수정 필수

2. **`cRef.current` 동기화**
   - `send`, `retryResponse`가 `setCommits(nc)` 직후 `cRef.current = nc` 할당
   - sub-함수 분리 시 `applyCommits(nc)` 헬퍼 통해 둘 다 처리

3. **`save` closure**
   - `convs`, `parentRef`, `convId` closure 의존 — 기존 코드가 "stale closure snapshot" 주석으로 의도 명시
   - 통째로 App.jsx에 유지

4. **`rangeCommitsFor` default args**
   - 현재 `selectRange`/`commits` closure 기본값 — 순수하게 고치고 호출부 수정

5. **Seed load useEffect 순서**
   - `load`가 useEffect 이전에 정의되어 있어야 함 (function const hoisting 없음)
   - 현재 코드는 이미 작동 — 건드릴 때 순서 유지

6. **Circular deps**
   - `graph/` → `storage/` 금지
   - `ui/` → `theme`, `graph/`, `storage/` OK
   - `App.jsx` → 모두 OK

---

## 📋 체크리스트 (각 session 끝나기 전)

- [ ] `npm run build` 성공
- [ ] `npm run dev` 실행해서 주요 기능 확인
- [ ] 앱 동작 차이 없음 (순수 refactor)
- [ ] 새 파일들이 계획된 폴더에 있음
- [ ] App.jsx import 경로 정상
- [ ] 커밋 메시지는 `refactor: ...` 형식
- [ ] `atomic-<step>` 푸시 → `atomic`에 머지 → `atomic` 푸시

---

## 🎯 최종 목표

- App.jsx: 1991줄 → ~350줄
- 13+ 새 파일 (각각 단일 책임)
- 행동 변경 0 (순수 refactor)
- 각 함수 5~10줄 (자연스러운 범위 내에서)
