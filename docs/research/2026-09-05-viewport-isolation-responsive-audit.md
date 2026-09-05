# Viewport isolation & responsive audit — 2026-09-05

Follow-up to `3586e93 fix(web): isolate viewport playback across routed tabs and improve responsive layout`.
Addresses code-review findings (spec + standards) for that commit.

## 1. Isolation bug — evaluation replay leaking into timeline

**Spec:** `all curent pages have the same loaded urdf` → `after plaing evaluation go to the timeline press reset pose now the evaluation is plaing`

**Root cause in 3586e93:** Single `previewPositions` + `replayingDemoId` + `replayTimerRef` owned by `Workbench` for all routes. `resetPose`/`applyPositions` only did `clearPreview()`; `replayFrames`/`replayDemonstration` drove a `setTimeout` loop that kept firing after `location.pathname` changed.

**Fix in this branch:**

| Area | Before (3586e93) | After |
| --- | --- | --- |
| `App.tsx` hooks | `useEffect(() => () => stopReplay(), [])` + `function stopReplay(){}` closing over stale refs; `useEffect([pathname])` called `stopReplay()` but dep missing; only cleared `timelinePendingPositions`/`InsertFrame` | `clearPreview` + `stopReplay` are `useCallback(() => {}, [clearPreview])` stable; both effects list `[stopReplay]`/`[pathname, stopReplay]` (exhaustive-deps clean) |
| Route leave | Only pending staging cleared | Now clears `timelineDraft`, `timelineDraftSourceId`, `selectedFrameIndex=0`, `timelinePlayheadFrame=0` as well. Returning to `/teach/timeline` repopulates draft from `timelineSourceFrames` via existing effect (`draftSourceId !== id` guard) — no stale draft, evaluation viewport resets to `state.positions` |
| Preview paths | `selectTimelineFrame`, `previewTimelineFrame`, `scrubTimelineFrame`, `updateTimelineFrame` called `applyPreviewPositions` without stopping replay — leak if scrub while replaying | Each preview entry now `stopReplay()` before `applyPreviewPositions`/`setTimelinePendingPositions`. `applyPreviewPositions` stays raw (no self-stop) so `replayFrames`/`replayDemonstration` loops are not cancelled mid-playback (they `stopReplay()` once at entry) |

**Verification:**

- Manual: Start eval rollout (`/evaluate` Play rollout) → nav to `/teach/timeline` → `Reset pose` → no eval frames resume; scrub timeline → replay stops immediately.
- Unit: `apps/web/src/App.viewportIsolation.test.tsx` asserts `useCallback` stable `stopReplay`, draft clearing on pathname change, and preview callers contain `stopReplay()`.
- `npm run test:unit` passes (49 existing + 1 new).

## 2. Responsive audit — all sites

**Spec:** `make adjustments that our site is looking good on mobile and desktop` + `carrentli in some places we have unexpected ui bechviors` + `evaluate all sites mesure plan and improve`

**Measured breakpoints (Chrome devtools emulation): 320, 375, 420, 700, 980, 1024, 1280**

| Route | 320-700 before | Fix | 700-980 before | Fix | 980+ |
| --- | --- | --- | --- | --- | --- |
| `route-two-column` / `route-archive-grid` | Stacked at 700 only → cramped at 800-980 (`420px` side column) | Collapse at `980px` to `flex-col` (`@media (max-width:980px)`) | ok | — | `grid 1.15fr / 420px` |
| `route-viewport-panel` | `650px` fixed → overflow on small screens | `480px` base → `560px @701px` → `620px @1025px`, `overflow-hidden` | — | — | — |
| `scene-shell` | `410px` min → tall on mobile | `320px/420px` at `700px`, `280/380` at `420px`, `aspect 4/3.2` | — | — | `520px` max |
| `topbar` | `items-start` no wrap → overflow | `flex-wrap gap-3 pb-4`, `brand-lockup min-w 180`, `topbar-actions w-full flex-row flex-wrap justify-between` | — | — | `justify-between` |
| `route-nav` | No scroll, wraps | `-mx-14 px-14 gap-0 overflow-x-auto scrollbar-width:none` + webkit hide | — | — | `gap-1` |
| `route-heading/actions` | `flex` no wrap → buttons overflow | `flex-wrap`, `route-heading-actions w-full flex-wrap` at 700 | — | — | `items-end` |
| `route-joint-row` | `110/80` no wrap | `96px 1fr 72px` + `76px 1fr 64px @420px`, `text 11px`, `number input 11px p6` | — | — | `150px 1fr 95px` |
| `archive-route-card` | `flex row` → actions overflow | `flex-col items-start gap-3`, `.demo-card-actions w-full flex-wrap` | — | — | `row` |
| `animation-toolbar` / `timeline-scrub` / `edit-banner` | Single row | `flex-wrap` / `flex-col items-stretch` / `flex-col` at 700; scrub `range w-full`, `scrub-label break-words` | — | — | `row` |
| `keyframe-inspector` / `timeline-joint-grid` | `grid auto-fit 220px` → 2-col on 375 → overflow | `grid-cols-1 @700` | — | — | `auto-fit 220px` |
| `panel-header` / `viewer-footer` / `scene-hud` | No wrap | `flex-wrap gap-3`, `flex-wrap gap-2 9px`, `max-w-[85%] truncate left-2 bottom-2` | — | — | — |
| `animation-channels` / `channel-row` | `min-w 620px` base + `min-w 520px @700` → **forced horizontal scroll at 320-700** | `max-h 220px overflow-x-auto` container; `channel-row min-w-0 grid 110px 1fr` at 700 (removes forced scroll, allows scroll only if user pans channels) | `min-w 620px` base (scroll container) | — | `620px` |

**Measurement method:** For each route (`/teach/pose`, `/teach/timeline`, `/archive`, `/train`, `/evaluate`) opened at each breakpoint, inspected `document.documentElement.scrollWidth > clientWidth` and visual wrapping. Before fix: horizontal scroll at 320-700 on timeline (520px channel-row) + joint rows overflow + nav clip. After: no `scrollWidth` overflow; only `animation-channels` scrolls internally if needed.

**Files changed:** `apps/web/src/styles.css` (tiers + 980 collapse + channel-row fix), `apps/web/src/components/workbench/TimelinePanel.tsx` (`grid-cols-1 sm:grid-cols-3` already in 3586e93, kept).

## 3. Scope creep — unrelated formatting

**Finding:** `apps/web/src/api.ts` (`request<…>` unwrap), `EvaluatePage.tsx`/`TrainingPage.tsx` (`coordination` line-wraps), `App.tsx` (`coordination.simultaneity` wrap) were pure prettier/formatter changes in a `fix(web)` commit.

**Fix:** Reverted `api.ts` and `EvaluatePage.tsx` to parent `8db787b` single-line form; `TrainingPage.tsx` kept as biome-authoritative `metric?.x === undefined ? "—" : x` (tooling-enforced, skipped per smell baseline); `App.tsx` coord display reverted to single-line `<b>{…toFixed(2)}</b>`. Net `parent..HEAD` now has no unrelated wrapping; formatter-enforced `app-shell` etc ignored per `Skip anything tooling already enforces`.

## 4. Standards hygiene

- `AGENTS.md` one-change-per-commit: This follow-up is intentionally scoped as a fix for review findings; future responsive work should split `fix(web): isolate` vs `fix(web): responsive` if not already merged.
- `AGENTS.md` Change confidence: Added `App.viewportIsolation.test.tsx` + manual viewport matrix (above) + `npm run test:unit` + `npm run build` + `git diff --check`.
- Terminology: No `CONTEXT.md` term changes (Pose/Frame/Checkpoint/KeyFrame/Gesture/Demonstration/Archive preserved).
