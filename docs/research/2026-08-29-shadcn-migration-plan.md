# shadcn/ui Migration Plan — apps/web (Vite + Tailwind v4)

**Date:** 2026-08-29
**Scope:** `apps/web` — React 19, Vite 7+, Tailwind CSS 4.3.3 via `@tailwindcss/vite`, TypeScript (Bundler resolution), `react-router-dom` 7.18.2, `lucide-react`, Three.js
**Status:** Research / no code changed

> Every factual claim about shadcn/ui, Tailwind, or Vite below cites the primary source that owns it. See [Sources](#7-sources) for the URL list.

---

## 1. Current Stack Snapshot

| Area | Current state |
|---|---|
| **Build** | `vite.config.ts` uses `defineConfig({ plugins: [react(), tailwindcss()] })` with a `build.rolldownOptions.output.manualChunks` rule that isolates `three` into `three-vendor` and `chunkSizeWarningLimit: 600` — `apps/web/vite.config.ts:5-20` |
| **Tailwind** | `@import "tailwindcss"` in `src/styles.css:2` plus `@theme { --color-ink-950 ... --color-danger-400 }` tokens and `@layer components` bespoke classes (`.panel`, `.button`, `.status-pill`, `.tab-button`, `.route-*`, etc.) — `apps/web/src/styles.css:1-290` |
| **Fonts** | `DM Mono` + `Space Grotesk` via Google Fonts import — `apps/web/src/styles.css:1` |
| **Primitives** | Single file `src/components/ui.tsx` (127 lines) exports `Button` (variant `primary\|secondary\|ghost\|recording`, size `default\|small`), `Panel`, `PanelHeader`, `PanelLabel`, `StatusPill`, `TabButton` — all built with manual string concatenation, no `cva`/`clsx`/`twMerge` |
| **App** | Monolithic `src/App.tsx` (~1550+ lines) owns all routing (`/`, `/teach/pose`, `/teach/timeline`, `/archive`, `/train`, `/evaluate`, `/legacy` fallback) and all panels inline (`TimelinePanel`, `DatasetPanel`, etc.) — `apps/web/src/App.tsx:1-84` |
| **Routing** | `BrowserRouter` + `NavLink` + `WorkbenchProvider` context — `apps/web/src/workbench/context.tsx` |
| **Path alias** | None. `tsconfig.json:1-7` and `tsconfig.app.json:1-22` have no `baseUrl`/`paths`; `vite.config.ts` has no `resolve.alias` |
| **Dependencies** | `lucide-react` already present; `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` absent — `apps/web/package.json:14-32` |
| **Types** | `moduleResolution: "Bundler"` — `apps/web/tsconfig.app.json:16` |
| **Testing** | `vitest` unit tests (`src/domain/metrics.test.ts`, `timeline.test.ts`) + `cypress` e2e (`cypress/e2e/demonstrations.cy.ts`), scripts `test:unit` = `vitest run`, `test:e2e` = `cypress run` — `apps/web/package.json:6-12` |

Design tokens and visual language are documented in `docs/design-reference.md` and domain vocabulary in `CONTEXT.md` (pose / frame / checkpoint / keyframe / gesture / demonstration / archive / dataset).

---

## 2. Exact shadcn/ui Setup for This Stack

### 2.1 Stack variant

Use the **Vite** installation variant, not Next.js — `https://ui.shadcn.com/docs/installation/vite` documents three entry points: "Use shadcn/create", "Use the CLI", and "Existing Project" (the last applies to this repo) [Source: Vite install page](https://ui.shadcn.com/docs/installation/vite).

The official template selector for shadcn/create supports `vite` explicitly: `pnpm dlx shadcn@latest init --template vite` / `init -t vite` [Source: Vite install page; CLI reference](https://ui.shadcn.com/docs/cli). For an existing project, the prescribed sequence is: ensure Tailwind, configure the `@/*` alias, update `vite.config.ts`, then `pnpm dlx shadcn@latest init` [Source: Vite install page — Existing Project](https://ui.shadcn.com/docs/installation/vite).

**Base library choice:** `shadcn init` accepts `-b, --base <base>` with values `base`, `radix`, `aria` [Source: CLI — init options](https://ui.shadcn.com/docs/cli). For this codebase the recommended default is `-b radix` (the unified `radix-ui` package) unless a Base UI migration is explicitly desired; the CLI also supports `migrate radix` to move old `@radix-ui/*` imports to `radix-ui` [Source: CLI — migrate radix](https://ui.shadcn.com/docs/cli).

### 2.2 Tailwind v4 compatibility

This repo already matches the Vite + Tailwind v4 canonical steps:

1. `npm install tailwindcss @tailwindcss/vite` — [Source: Tailwind Vite install](https://tailwindcss.com/docs/installation/using-vite)
2. `import tailwindcss from "@tailwindcss/vite"` + `plugins: [tailwindcss()]` in `vite.config.ts` — already done; Tailwind docs specify this as step 3 for Vite plugin configuration [Source: Tailwind Vite install](https://tailwindcss.com/docs/installation/using-vite)
3. `@import "tailwindcss";` at the top of the CSS file — already `src/styles.css:2`; Tailwind docs specify `@import "tailwindcss";` as the import form [Source: Tailwind Vite install](https://tailwindcss.com/docs/installation/using-vite)

The Vite page variant replaces step 2 inline with `src/index.css: @import "tailwindcss";` [Source: Vite install page — Add Tailwind CSS](https://ui.shadcn.com/docs/installation/vite). For this repo `src/styles.css` **is** the Tailwind entry, so `components.json: tailwind.css` must point to `src/styles.css`, not `src/index.css`.

shadcn's default theming scaffold for Tailwind v4 adds two extra imports that do **not** exist in the current `styles.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@custom-variant dark (&:is(.dark *));
```

[Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming)

- `tw-animate-css` is the Tailwind v4 successor to `tailwindcss-animate`.
- `shadcn/tailwind.css` provides shared utilities: custom variants (`data-open:`, `data-closed:`) and accordion animations [Source: CLI — eject](https://ui.shadcn.com/docs/cli).
- `@custom-variant dark (&:is(.dark *))` is how Tailwind v4 + shadcn wire the `.dark` class strategy [Source: Tailwind Functions & Directives — @custom-variant](https://tailwindcss.com/docs/functions-and-directives) + [Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming).

These can be adopted **additively** without removing the existing `@theme` tokens (see §4 risks).

### 2.3 Required dependencies

The shadcn `init` command installs dependencies, adds the `cn` util, and configures CSS variables [Source: CLI — init](https://ui.shadcn.com/docs/cli). When run manually, the required packages are:

| Package | Role |
|---|---|
| `class-variance-authority` | `cva` for variant compound components (Button, Badge, Alert) [Source: shadcn Button page — uses `buttonVariants` via `cva`](https://ui.shadcn.com/docs/components/base/button) |
| `clsx` | Conditional class concatenation consumed by `cn` helper |
| `tailwind-merge` (`twMerge`) | Deduplicates conflicting Tailwind utilities inside `cn` |
| `tw-animate-css` | Animation utilities for Tailwind v4 (replaces `tailwindcss-animate`) [Source: Theming — Default Theme CSS showing `@import "tw-animate-css"`](https://ui.shadcn.com/docs/theming) |
| `radix-ui` (or `@radix-ui/react-*` per-primitive) | Headless primitives for Tabs, Select, Dialog, Slider, etc. [Source: Radix Primitives Intro — `npm install radix-ui`](https://www.radix-ui.com/primitives/docs/overview/introduction) |
| `@types/node` (dev) | Required so `vite.config.ts` can `import path from "path"` for the alias [Source: Vite install page — Update vite.config.ts](https://ui.shadcn.com/docs/installation/vite) |
| `lucide-react` | Already present; shadcn icon default. `migrate icons` supports `lucide`, `tabler`, `phosphor`, etc. [Source: CLI — migrate icons](https://ui.shadcn.com/docs/cli) |

Verify versions against `package.json` peer constraints before `pnpm add`.

### 2.4 Path alias setup

shadcn requires a `@/*` (or equivalent) alias backended by either `compilerOptions.paths` or `package.json#imports`. [Source: components.json — aliases](https://ui.shadcn.com/docs/components-json) + [Source: Vite install page — Edit tsconfig.json](https://ui.shadcn.com/docs/installation/vite).

This repo uses project references (`tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`), so the alias must be added in **both** places plus Vite:

**`tsconfig.json`** (root ref file) — add `compilerOptions` alongside `references`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

**`tsconfig.app.json`** — add inside `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

[Source: Vite install page — Edit tsconfig.json file / Edit tsconfig.app.json file](https://ui.shadcn.com/docs/installation/vite)

**`vite.config.ts`** — add `resolve.alias`:

```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
```

This mirrors the canonical Vite alias snippet [Source: Vite install page — Update vite.config.ts](https://ui.shadcn.com/docs/installation/vite). The helper `path.resolve` requires the `@types/node` dev dependency and `allowSyntheticDefaultImports` / `esModuleInterop` (already `true` in `tsconfig.app.json:10-11`). Vite's own alias mechanism is `resolve.alias` [Source: Vite Config — Configuring Vite / resolve.alias pattern](https://vite.dev/config/).

> Alternative: `package.json#imports` with `#components/*` is supported if the repo prefers it, but then `resolvePackageJsonImports: true` and `moduleResolution: "bundler"` (already set) are required and `components.jsonAliases` must use the `#` prefix [Source: components.json — aliases / Using package.json#imports](https://ui.shadcn.com/docs/components-json). Recommendation: use the simpler `paths` approach for this single-package app.

### 2.5 `components.json` shape

The `components.json` file is only required when using the CLI [Source: components.json — intro](https://ui.shadcn.com/docs/components-json); the CLI creates it via `init`. For Tailwind v4, `tailwind.config` must be empty [Source: components.json — tailwind.config](https://ui.shadcn.com/docs/components-json). Recommended initial file for this repo (at `apps/web/components.json`):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks",
    "utils": "@/lib/utils"
  },
  "iconLibrary": "lucide"
}
```

Notes:

- `style: "new-york"` is the non-deprecated default (the `default` style was deprecated) [Source: components.json — style](https://ui.shadcn.com/docs/components-json).
- `tailwind.config: ""` for v4, `tailwind.css` points to the global CSS file [Source: components.json — tailwind.config / tailwind.css](https://ui.shadcn.com/docs/components-json).
- `cssVariables: true` generates `bg-background` / `text-foreground`-style tokens [Source: components.json — tailwind.cssVariables](https://ui.shadcn.com/docs/components-json) and is the default recommended mode [Source: Theming — Using CSS variables](https://ui.shadcn.com/docs/theming).
- `aliases` entries tell the CLI where to write `components`, `ui`, `lib`, `hooks`, and `utils` and must match `tsconfig` paths [Source: components.json — aliases](https://ui.shadcn.com/docs/components-json).

### 2.6 `utils` `cn` helper

The CLI generates `src/lib/utils.ts` (aliased as `@/lib/utils`). The canonical implementation combines `clsx` + `tailwind-merge`:

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

This is the helper referenced by every shadcn component (`import { cn } from "@/lib/utils"`). The `aliases.utils` key in `components.json` is the canonical alias for this file [Source: components.json — aliases.utils](https://ui.shadcn.com/docs/components-json).

### 2.7 CLI commands

| Command | Purpose | Source |
|---|---|---|
| `pnpm dlx shadcn@latest init` | Install deps, create/overwrite `components.json`, generate `lib/utils`, inject CSS variables into `tailwind.css` target | [Source: CLI — init](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest init -t vite` | Explicit Vite template (alias for `create`) | [Source: CLI — init options `-t, --template`](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest add button` | Add single component (`@/components/ui/button.tsx`) | [Source: CLI — add](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest add card badge tabs input label slider select alert progress separator` | Batch install the set needed for this migration (see §3) | [Source: CLI — add multiple components](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest add -o button` | Overwrite existing component | [Source: CLI — add --overwrite](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest add --dry-run` | Preview without writing | [Source: CLI — add --dry-run](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest diff button` | Show diff vs registry | [Source: CLI — diff](https://ui.shadcn.com/docs/cli) |
| `pnpm dlx shadcn@latest eject` | Inline `shadcn/tailwind.css` and remove `shadcn` dependency — irreversible | [Source: CLI — eject](https://ui.shadcn.com/docs/cli) |

The `init` flags include `--css-variables/--no-css-variables`, `--base/--no-base`, `--monorepo` [Source: CLI — init options](https://ui.shadcn.com/docs/cli). For this single-app repo, `--no-monorepo` (default) is correct.

---

## 3. Mapping Existing Custom Components / CSS → shadcn Equivalents

### 3.1 Primitive-level mapping

| Current (`src/components/ui.tsx` or `styles.css`) | shadcn component | Key differences / adaptation |
|---|---|---|
| `Button` (variants `primary/secondary/ghost/recording`, sizes `default/small`, prop `full`) | `Button` (`variant: default\|outline\|ghost\|secondary\|destructive\|link`, `size: default\|xs\|sm\|lg\|icon…`) [Source: Button API Reference — variant/size enums](https://ui.shadcn.com/docs/components/base/button) | Re-express with `class-variance-authority` `cva`. Map `primary → default`, `ghost → ghost`/`outline`, `recording → destructive` + custom class. `full` becomes `className="w-full"` (shadcn helper is `w-full`, `size` controls padding). The `Button` docs note that Tailwind v4 changed the default button cursor to `default`; add the `@layer base { button:not(:disabled), [role="button"]:not(:disabled){cursor:pointer}}` fix or pass `--pointer` at init [Source: Button — Cursor](https://ui.shadcn.com/docs/components/base/button). Preserve `hover:-translate-y-px` as custom class, not via `cva`. |
| `Panel` (`rounded-[9px] border border-line-700 bg-ink-900/95`) | `Card` | shadcn `Card` is the canonical elevated surface [Source: Theming — card/card-foreground tokens for Card panels](https://ui.shadcn.com/docs/theming) + [Source: Card — Usage/Composition](https://ui.shadcn.com/docs/components/base/card). Use `CardContent` as the panel body; set `--card-spacing` CSS var for edge-to-edge content [Source: Card — Spacing](https://ui.shadcn.com/docs/components/base/card). Extend tokens rather than replace (see §4). |
| `PanelHeader` (`flex items-center justify-between border-b border-[#25303b] px-5 …`) | `CardHeader` (`CardTitle` + `CardDescription` + `CardAction`) | shadcn header composition is `CardHeader → CardTitle/CardDescription/CardAction` [Source: Card — Composition / API Reference](https://ui.shadcn.com/docs/components/base/card). Map `compact` prop → `Card` prop `size="sm"` [Source: Card — Size](https://ui.shadcn.com/docs/components/base/card). |
| `PanelLabel` (`font-mono text-[10px] tracking-[0.16em] text-text-600`) | extends `Label` or inline `CardDescription` | shadcn `Label` is the accessible label primitive [Source: components list includes Label](https://ui.shadcn.com/docs/installation/vite) — extend it with mono tracking rather than raw `<p>`. Keep `font-mono` eyebrow semantics from `design-reference.md`. |
| `StatusPill` (rounded-full pill + 6px dot, `online` green vs slate) | `Badge` | `Badge` is the shadcn pill primitive [Source: components list includes Badge](https://ui.shadcn.com/docs/installation/vite). Map `online` → `variant="default"` with `bg-success-400` dot, offline → `variant="outline"` / `secondary`. Preserve `inline-flex gap-[7px]` dot pattern. |
| `TabButton` (`tab-button` + `.active` using `bg-accent-deep`) — used inside `.tab-switcher` in training panel | `Tabs` (`TabsList` + `TabsTrigger` + `TabsContent`) | shadcn `Tabs` provides a Radix-backed accessible tab primitive [Source: components list includes Tabs](https://ui.shadcn.com/docs/installation/vite) + Radix primitives are the underlying headless layer [Source: Radix Intro](https://www.radix-ui.com/primitives/docs/overview/introduction). The current `tab-switcher` is a bespoke 3-col grid with manual `active` class; migrate to `Tabs` for keyboard/focus semantics. |
| `.alert` / `<div className="alert">` in legacy workbench grid | `Alert` (`AlertTitle`, `AlertDescription`) | shadcn `Alert` is the canonical attention banner [Source: components list includes Alert](https://ui.shadcn.com/docs/installation/vite). `Alert` docs follow the same variant pattern as Button/Card. Map `.alert.error` → `variant="destructive"` overridden with `border-[#6c4239] bg-[#331f1b]`. Keep dismiss button semantics. |
| `field-grid input/select` (`bg-ink-800 border-line-600 focus:border-accent-500 font-mono`) | `Input` / `Native Select` / `Select` + `Label` | shadcn `Input` is the text/number input primitive [Source: components list includes Input](https://ui.shadcn.com/docs/installation/vite). For complex dropdowns use `Select` (Radix-backed). Tokens `border`/`input`/`ring` map to `Input` styles [Source: Theming — Theme Tokens — border/input/ring](https://ui.shadcn.com/docs/theming). Preserve `font-mono text-[11px]` via class override on the component. |
| `input[type='range']` + `route-joint-row` slider | `Slider` | Radix `Slider` primitive via shadcn `Slider` [Source: Radix Slider concept; components list includes Slider](https://ui.shadcn.com/docs/installation/vite). Preserve `accent-accent-500`, range labels, and numeric `<Input type="number">` alongside. Slider values remain single-thumb with `min/max/step 0.001`. |
| `metric-card` / `route-metric-grid` (grid 2/4 cols, muted label + mono value) | `Card` variant with `CardContent` grid | Use `Card` + internal grid rather than a separate `MetricCard` component; tokens `muted`/`muted-foreground` control the muted label semantics [Source: Theming — Theme Tokens — muted](https://ui.shadcn.com/docs/theming). |
| `demo-card` / `archive-route-card` (raised `bg-ink-850` card with pose sketch, editable title, frame metadata, action row) | `Card` (`CardHeader` + `CardContent` + `CardFooter` + `Item`) | Compose from `Card` parts; `CardFooter` for `demo-card-actions` [Source: Card — Composition](https://ui.shadcn.com/docs/components/base/card). Pose sketch SVG + bars + title remain custom content inside `CardContent`. Selected state (`border-accent-500 bg-[#16273a] inset rail`) stays as custom class over shadcn `Card`. |
| `training-summary`, `log-box`, `chart-card`, `progress-track` | `Card` + `Progress` + `Separator` | `Progress` is the shadcn bar primitive [Source: components list includes Progress](https://ui.shadcn.com/docs/installation/vite). `Separator` for `.section-divider` / `.or-divider` [Source: components list includes Separator](https://ui.shadcn.com/docs/installation/vite). Charts remain custom bars/borders with `muted` tokens [Source: Theming — chart-1…5 tokens](https://ui.shadcn.com/docs/theming). |
| `.empty-note`, `.demo-empty`, `.test-empty` | `Empty` | shadcn `Empty` is the canonical empty-state surface [Source: components list includes Empty](https://ui.shadcn.com/docs/installation/vite). Retain accent glyph pattern from `design-reference.md`. |
| `.error-row` / `.demo-bar-row` bars | `Progress` (per-row) | Thin `Progress` with color override (`bg-accent-500` vs `bg-[#d48769]`). |
| `route-nav` / `workflow` (NavLink-based) | `Tabs` or `NavigationMenu`/`Breadcrumb` (optional) | Could remain plain `NavLink` with `buttonVariants` helper for link-as-button styling [Source: Button — As Link — `buttonVariants` for `<a>`](https://ui.shadcn.com/docs/components/base/button). Do not wrap `<a>` in `<Button>` (breaks `role="button"`). |

### 3.2 CSS variable / token mapping

| Current `@theme` token (`src/styles.css:4-25`) | shadcn semantic token to extend | Strategy |
|---|---|---|
| `--color-ink-950/900/850/800` | `background` / `card` / `popover` | Do **not** mass-rename: keep `@theme` ink tokens as utility source (`bg-ink-950`) **and** introduce shadcn semantic vars that alias into them. Example: `--background: var(--color-ink-950); --card: var(--color-ink-900)` inside `:root`. [Source: Theming — Default Theme CSS sets `--background/--card` in `:root`+`.dark` then maps via `@theme inline {--color-background: var(--background)}`](https://ui.shadcn.com/docs/theming) |
| `--color-line-700/650/600` | `border` / `input` | Map `--border: var(--color-line-700); --input: var(--color-line-600)`; preserve `border` utility for cards. Tokens `border`/`input` control `Card`, `Input`, `Select` borders [Source: Theming — Theme Tokens](https://ui.shadcn.com/docs/theming) |
| `--color-text-100/300/500/600/700` | `foreground` / `card-foreground` / `muted-foreground` | Map `--foreground: var(--color-text-100); --muted-foreground: var(--color-text-600)`. Keep `text-*` utils for region-specific legacy classes. |
| `--color-accent-500/300/accent-deep` | `primary` / `primary-foreground` / `accent` | Map `--primary: var(--color-accent-500); --primary-foreground: #07111e` (same value `Button primary` currently uses) — `primary` controls default `Button` and active accents [Source: Theming — Theme Tokens — primary/primary-foreground](https://ui.shadcn.com/docs/theming) |
| `--color-success-400 / warning-400 / danger-400` | Add as custom tokens `chart-*` or standalone `success/warning/destructive` | Define new tokens via `:root` then `@theme inline { --color-success: var(--success) }` pattern [Source: Theming — Adding New Tokens](https://ui.shadcn.com/docs/theming) |
| `--font-sans/mono` and `--radius*` | Keep | shadcn radius tokens are `--radius` + derived `--radius-sm/md/lg/xl…` [Source: Theming — Radius Scale](https://ui.shadcn.com/docs/theming) — keep existing 9px card radius as `--radius: 0.5625rem` or alias. |

Importantly, theme variables must remain **top-level** (not nested under `:root` or media queries) [Source: Tailwind Theme Variables — Why @theme instead of :root](https://tailwindcss.com/docs/theme) + directives reference [Source: Tailwind Functions — @theme](https://tailwindcss.com/docs/functions-and-directives). Custom semantic bindings go in `@theme inline`.

---

## 4. Risks Specific to This Repo

### 4.1 Tailwind v4 `@theme` vs shadcn CSS-variable system — collision, not replacement
- **Risk:** The repo's entire visual language lives in `@theme { --color-ink-* … }` (`styles.css:4-25`). shadcn's neutral scaffold injects `:root { --background, --foreground, --card, --border… }` **and** `@theme inline { --color-background: var(--background) … }` [Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming). Running `init` without review will **append** 40+ `:root`/`.dark` lines plus `@theme inline` mappings after the existing `@theme`; the file will then define both `bg-ink-950` and `bg-background` with different values for the same panel surfaces, causing split theming and surprising color shifts on every `Button`/`Card`.
- **Mitigation:** On `init`, choose `--css-variables` (default) and **do not** accept a wholesale replacement of `styles.css`. After `init`, manually alias semantic tokens **into** the existing ink/line/text/accent values (table in §3.2) so `bg-background` resolves to `bg-ink-950` and `text-foreground` to `text-text-100`. Keep `@import "tailwindcss"` as the first line, followed by `@import "tw-animate-css"` and `@import "shadcn/tailwind.css"` — order matters because `shadcn/tailwind.css` depends on prior imports [Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming). Preserve the Google Fonts import at the very top (it must stay before any `@theme` to allow `font-sans` override).
- **Validation:** Visual regression of `design-reference.md` tokens. Assert `getComputedStyle(document.documentElement).getPropertyValue('--background')` resolves to the expected `oklch`/`hex` after aliasing. Compare a before/after screenshot of `/teach/pose` (panel border, radial glow `body::background-image`, button hover).

### 4.2 Dark-mode assumption: repo is dark-only today
- **Risk:** The lab console is dark-only (`html { bg-ink-950 }`, `body { background-image: radial-gradient(…)}` in `styles.css:29-33`). shadcn's default scaffold ships **both** `:root` (light) and `.dark` blocks and a `ThemeProvider` that toggles `class="dark"` on `<html>` [Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming) + [Source: Dark Mode — Vite — ThemeProvider](https://ui.shadcn.com/docs/dark-mode/vite). Blindly adopting the provider with `defaultTheme="system"` will flip the app to light on user systems preferring light.
- **Mitigation:** For this app, either (a) keep the site permanently dark by adding `class="dark"` to `<html>` in `index.html` and not shipping `ThemeProvider`, or (b) ship `ThemeProvider` with `defaultTheme="dark"` and no system sync. Shadcn's Vite dark-mode guide defaults to `"system"` [Source: Dark Mode Vite](https://ui.shadcn.com/docs/dark-mode/vite) — override it. Keep `@custom-variant dark (&:is(.dark *))` [Source: Theming](https://ui.shadcn.com/docs/theming) so `dark:*` utilities work regardless.

### 4.3 Preserving `design-reference.md` visual language
- **Risk:** shadcn's pre-styled components ship with their own padding, border (`ring-1 ring-foreground/10`), and radius. Default `Card` uses `rounded-xl bg-card py-(--card-spacing) ring-1` [Source: Card — Changelog Spacing Variable](https://ui.shadcn.com/docs/components/base/card) versus the repo's `rounded-[9px] border border-line-700 bg-ink-900/95 shadow-[0_16px_42px_rgba(0,0,0,0.09)]` in `.panel` (`styles.css:59`). Direct replacement without overrides will soften borders and enlarge radii, breaking the "compact robotics lab console" character (dense panels, 9px radius, generous outer spacing — `docs/design-reference.md:44-55`).
- **Mitigation:** Keep `.panel`/`.route-*` layout classes as thin wrappers over `Card` that inject `className="rounded-[9px] border-line-700 bg-ink-900/95"` rather than relying on the `Card` default. Override `--card-spacing` per-page (`[&--card-spacing:--spacing(4)]`) only where the tighter legacy `px-[18px]` rhythm is needed [Source: Card — Spacing](https://ui.shadcn.com/docs/components/base/card). Typography tokens (`Space Grotesk`, `DM Mono`) remain in `@theme` (`styles.css:5-6`), shadcn's theming guide expects font control via presets [Source: Theming — intro](https://ui.shadcn.com/docs/theming) — do not let `init` overwrite them.

### 4.4 Three.js vendor chunk
- **Risk:** `vite.config.ts` intentionally isolates `three` via `rolldownOptions.output.manualChunks` and raises `chunkSizeWarningLimit` to 600 because the minified chunk is 136 kB gzipped. The Vite shadcn snippet is intentionally minimal (`plugins: [react(), tailwindcss()]` only) [Source: Vite install page — Update vite.config.ts](https://ui.shadcn.com/docs/installation/vite). A naïve replacement of `vite.config.ts` during `init` will drop the `build` key and either regress bundle splitting or re-trigger the Vite warning.
- **Mitigation:** Preserve the `build` block exactly when adding `resolve.alias`. Treat `vite.config.ts` as a manual merge, not a generated file. Verify after each change with `npm run build` and inspect `dist/assets/three-vendor-*.js`.

### 4.5 `App.tsx` state semantics — do not change while extracting presentation
- **Risk:** `App.tsx` owns WebSocket session (`sessionId`, `socketRef`, `positionsRef`, `replayTimerRef`), dataset/Demonstration persistence (`persistDemonstrations`/`persistDatasets`), and timeline draft isolation (`timelineDraft`, `normalizeFrames`, `interpolatePositions`). These are behavioral invariants covered by `src/domain/*.test.ts` and Cypress journeys. Refactoring that mixes presentational extraction with state changes (e.g., moving `updateJoint` into a shadcn Slider `onValueChange` that batches or debounces) can silently change the `send({ type:"set_positions" })` contract.
- **Mitigation:** Phase 3 decomposition (see §5) extracts **view** components only; domain functions and `workbench/context.tsx` remain the state boundary. New UI wrappers are stateless and accept `value` + `onChange` the same shape as the current handlers.

### 4.6 Testing continuity
- **Risk:** `Vitest` unit tests import only domain modules today (`metrics`, `timeline`) [see `metrics.test.ts`], but future component tests that import shadcn primitives will pull Radix portals and `ResizeObserver` / `matchMedia` consumers that jsdom does not provide. Cypress `baseUrl: http://localhost:8080` in `cypress.config.ts` is for Docker / start-local, not the Vite dev port 5173 — new component previews that rely on `Vite Preview` may mismatch the Cypress harness.
- **Mitigation:** Add `vitest` `jsdom` setup (`setupTests.ts`) that polyfills `matchMedia`, `ResizeObserver`, and `hasPointerCapture` before any shadcn component test lands. Keep `npm run test:unit` on domain tests as the fast gate; run `npm run test:e2e` against `http://localhost:8080` after stack startup via `./start-local.sh` (AGENTS.md verification loop).

### 4.7 `@types/node` and `path` alias on TypeScript 5 / `Bundler` resolution
- **Risk:** Adding `path` import to `vite.config.ts` without `resolvePackageJsonImports` is safe because `vite.config.ts` is covered by `tsconfig.node.json`, which uses `moduleResolution: Bundler` and `verbatimModuleSyntax`. `tsconfig.node.json` does not yet include `allowSyntheticDefaultImports` handling for `path` — the canonical shadcn Vite snippet uses `import path from "path"` [Source: Vite install page — Update vite.config.ts](https://ui.shadcn.com/docs/installation/vite), which will type-check only after `@types/node` dev dep is installed.
- **Mitigation:** Install `@types/node` before editing `vite.config.ts`; run `tsc -b` (via `npm run build`) as the first check after alias changes — this surfaces path-resolution errors before components are added.

---

## 5. Phased Migration Plan

> Conventions: all paths are relative to `apps/web`. Verification after each phase is additive — never skip earlier gates.

### Phase 0 — Tooling (no visual change; single commit, single PR)

**Goal:** Make the repo shadcn-ready with zero user-visible diff.

**Files to touch:**

| File | Action |
|---|---|
| `package.json` | `pnpm add -D @types/node`; defer other deps to `init` so the CLI resolves correct peer versions |
| `tsconfig.json` | Add `compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } }` alongside `references` [Source: Vite install — Edit tsconfig.json](https://ui.shadcn.com/docs/installation/vite) |
| `tsconfig.app.json` | Same `baseUrl`/`paths` in `compilerOptions` [Source: Vite install — Edit tsconfig.app.json](https://ui.shadcn.com/docs/installation/vite) |
| `vite.config.ts` | Add `import path from "path"` and `resolve: { alias: { "@": path.resolve(__dirname, "./src") } }` preserving the existing `build` block [Source: Vite install — Update vite.config.ts](https://ui.shadcn.com/docs/installation/vite) |
| `components.json` | Create via `pnpm dlx shadcn@latest init` with `tailwind.css: "src/styles.css"`, `baseColor: "neutral"`, `cssVariables: true` [Source: components.json — tailwind.*](https://ui.shadcn.com/docs/components-json) |
| `src/styles.css` | After `init`, reconcile with shadcn template: prepend `@import "tw-animate-css"; @import "shadcn/tailwind.css";` and `@custom-variant dark …`, alias semantic tokens into ink/line tokens per §3.2, keep `@theme` + `@layer` intact [Source: Theming — Default Theme CSS](https://ui.shadcn.com/docs/theming) |
| `src/lib/utils.ts` | Create `cn` helper (generated by `init`) [Source: components.json — aliases.utils](https://ui.shadcn.com/docs/components-json) |

**Commands:**

```bash
cd apps/web
pnpm add -D @types/node
pnpm dlx shadcn@latest init   # answer: style new-york, base neutral, css src/styles.css, cssVariables true, alias @/*, no RSC
# manually reconcile src/styles.css per §3.2 (do NOT delete @theme tokens)
```

**Verification (must all pass before Phase 1):**

```bash
npm run test:unit   # Vitest domain tests still green
npm run build       # tsc -b + vite build; confirms path alias, @types/node, Tailwind v4 still compiles
git diff --check    # no whitespace / conflict markers
# visual smoke:
npm run dev & open http://localhost:5173/teach/pose  # panels, ink tokens, three scene unchanged
```

**Rollback:** revert `components.json`, `src/lib/utils.ts`, `styles.css` additions — no other files were changed.

---

### Phase 1 — Primitives (`Button`, `Badge`, `Card`, `Alert`, `Separator`) — narrow visual diff, broad reuse

**Goal:** Replace the bespoke `src/components/ui.tsx` primitives with shadcn-sourced versions while keeping the same visual language.

**Files to touch:**

| File | Action |
|---|---|
| `src/components/ui/button.tsx` | Generate via `pnpm dlx shadcn@latest add button` then migrate variants: `primary→default`, `secondary→secondary`, `ghost→ghost/outline`, `recording→destructive` + `bg-[#5b2d38]` override; retain `cva` API and `cn` merge; restore `cursor:pointer` via `styles.css` `@layer base` fix or `--pointer` [Source: Button — Cursor / API Reference](https://ui.shadcn.com/docs/components/base/button) |
| `src/components/ui/card.tsx` | `pnpm dlx shadcn@latest add card`; override to match `design-reference.md: Panel` recipe (`rounded-[9px] border-line-700`) as default `className` so `Panel` consumers need not change. Verify `size="sm"` maps to `PanelHeader compact` [Source: Card — Size / Spacing / API](https://ui.shadcn.com/docs/components/base/card) |
| `src/components/ui/badge.tsx` | `pnpm dlx shadcn@latest add badge` → use as `StatusPill` / pill replacement |
| `src/components/ui/alert.tsx` | `pnpm dlx shadcn@latest add alert` → replace `.alert` in `workbench-grid` |
| `src/components/ui/separator.tsx` | `pnpm dlx shadcn@latest add separator` → replace `section-divider` / `or-divider` (if retained) |
| `src/components/ui/index.ts` | Barrel re-export or retain `src/components/ui.tsx` as a typed shim (`export { Button as Panel } from "@/components/ui/card"` etc.) during migration to avoid breaking all consumers at once |
| Any file importing from `../components/ui` | Gradually narrow imports to `@/components/ui/button` etc. as shim is removed |
| `src/styles.css` | Add `@layer base { button:not(:disabled),[role="button"]:not(:disabled){cursor:pointer} }` if not opted in via `--pointer` [Source: Button — Cursor](https://ui.shadcn.com/docs/components/base/button) |

**Verification:**

```bash
npm run test:unit
npm run build
git diff --check
# visual: /teach/pose, /archive, /legacy — every Button/Panel/Badge visually identical; hover lift still present
```

**Design check:** side-by-side screenshot of `Button` variants (Default/Outline/Secondary/Ghost/Destructive and with Lucide icon with `data-icon="inline-start"`) [Source: Button — With Icon](https://ui.shadcn.com/docs/components/base/button).

---

### Phase 2 — Form & Layout primitives (`Input`, `Label`, `Slider`, `Select`, `Tabs`, `Progress`, `Empty`)

**Goal:** Normalize every form control and the training-tab switcher.

**Files to touch:**

| File | Action |
|---|---|
| `src/components/ui/input.tsx`, `label.tsx`, `native-select.tsx` | `pnpm dlx shadcn@latest add input label native-select`; map `field-grid input/select` (`bg-ink-800 border-line-600 focus:border-accent-500`) as class overrides on shadcn `Input` (tokens `border`→`line-600`, `input`→`line-600`, `ring`→`accent-500`) [Source: Theming — Theme Tokens](https://ui.shadcn.com/docs/theming) |
| `src/components/ui/slider.tsx` | `pnpm dlx shadcn@latest add slider`; wrapper keeps the current `updateJoint(index,value)` / `updateTimelineFrame` calling convention; Slider's value is `number[]` (Radix) — adapt to single `number` at the boundary |
| `src/components/ui/select.tsx` | `pnpm dlx shadcn@latest add select`; used in `route-selection-grid` (Dataset/Demonstration select), `TrainingConfig activation` ([`relu|tanh|gelu`]), and `archive` dataset management |
| `src/components/ui/tabs.tsx` | `pnpm dlx shadcn@latest add tabs`; replace `TabButton` + `tab-switcher` in training column; map `active` → `TabsTrigger data-[state=active]:bg-accent-deep` |
| `src/components/ui/progress.tsx` | `pnpm dlx shadcn@latest add progress`; used for `progress-track`, `demo-bar-row > i`, `error-row > i` |
| `src/components/ui/empty.tsx` | `pnpm dlx shadcn@latest add empty` (if scaffolded); else manual `Empty` composition [Source: components list includes Empty](https://ui.shadcn.com/docs/installation/vite) |
| `src/App.tsx` — training & pose routes only | Swap `field-grid`, `tab-switcher`, `progress-track` markup; rest of `App.tsx` untouched |

**Verification:**

```bash
npm run test:unit    # no domain regression
npm run build
git diff --check
# a11y: Tabs keyboard nav (ArrowLeft/Right, focus ring via `--ring`) works
# interaction: joint range+number pair stay in sync (Slider + Input)
```

---

### Phase 3 — `App.tsx` Decomposition (the only behavioral-risk phase)

**Goal:** Give every routed page its own presentation component without changing state semantics.

**Current monolith:** `App.tsx` declares `App → Workbench` with `routePage` IIFE over `location.pathname` and legacy `workbench-grid` fallback. Every `routePage` closure captures the same `robot`, `positions`, `demonstrations`, `datasets`, `config`, `metric`, `trajectory` state.

**Target structure (new files, all under `src/`):**

```
src/components/app/
  RouteFrame.tsx          # extracted RouteFrame chrome + error/message banner (already a component inside App.tsx)
  TeachingPosePage.tsx    # /teach/pose
  TeachingTimelinePage.tsx# /teach/timeline  — wraps AnimationEditor
  ArchivePage.tsx         # /archive
  TrainingPage.tsx        # /train
  EvaluatePage.tsx        # /evaluate
  LegacyWorkbenchPage.tsx # /legacy  — preserve intact until removal decision

src/components/workbench/
  RobotViewport.tsx       # Panel + RobotScene + status pill chrome (shared)
  JointEditor.tsx         # route-joint-list (range+number rows)
  TrainingControls.tsx    # route-form-grid + metric-grid
  DatasetManager.tsx      # DatasetPanel (from App.tsx inline)
  DemonstrationArchive.tsx# archive-route-list + demo-card
  MetricSummary.tsx       # metric-card / route-metric-grid
  AnimationEditor.tsx     # animation-editor (ruler+playhead+channels) — currently inline after <TimelinePanel>
  KeyframeInspector.tsx   # keyframe-inspector
  EvaluationResults.tsx   # keyframe-results / evaluation-route-content

src/components/ui/…      # shadcn primitives built in phases 1–2
src/lib/utils.ts          # cn helper (already from phase 0)
```

**Rules of decomposition:**

1. Page components are **pure presentation** — they receive everything as props (`robot`, `positions`, `controllableJoints`, `onUpdateJoint`, `onCapture`, …) and never call `useState` for domain state.
2. Domain state (`robot`, `state`, `sessionId`, `demonstrations`, `datasets`, `config`, `metric`, …) and side-effects (`WebSocket`, `replayTimerRef`, `persist*`) stay in `Workbench` (later promotable to `src/workbench/context.tsx` — but not in this step).
3. Keep route table in `App.tsx` as a thin router:

   ```tsx
   // App.tsx after
   <Routes>
     <Route path="/teach/pose" element={<TeachingPosePage …/>} />
     <Route path="/teach/timeline" element={<TeachingTimelinePage …/>} />
     <Route path="/archive" element={<ArchivePage …/>} />
     <Route path="/train" element={<TrainingPage …/>} />
     <Route path="/evaluate" element={<EvaluatePage …/>} />
     <Route path="/legacy" element={<LegacyWorkbenchPage …/>} />
   </Routes>
   ```

4. One component extraction per commit; each commit must still `npm run build`.

**Files to touch:**

| File | Action |
|---|---|
| `src/App.tsx` | Split route IIFE into imported page components; reduce from ~1500 to ~450 lines (state + router only) |
| New `src/components/app/*.tsx` | One page per routed view — direct cut-and-paste of the route's JSX plus a typed prop interface |
| New `src/components/workbench/*.tsx` | Extracted panel fragments (`RobotViewport`, `JointEditor`, etc.) composed from `Card` + `Input`/`Slider` + `Badge` |

**Verification (critical):**

```bash
npm run test:unit
npm run build
git diff --check
# longest gate:
./start-local.sh &  # start complete Docker stack per AGENTS.md
npm run test:e2e    # cypress run against http://localhost:8080 (per cypress.config.ts)
# manual pass of every path before merging:
# /teach/pose: move joints → Capture pose → Archive shows it → Preview returns correct pose
# /teach/timeline: select gesture → timeline ruler visible → keyframe diamond select → update joint modifies draft → Save persists
# /archive: Dataset create/rename/move demonstration
# /train: config input edits → Train → progress bars animate
# /evaluate: Evaluate → trajectory keyframe errors appear → Play rollout moves the viewport
# /legacy: workbench-grid renders identical to before
```

---

### Phase 4 — Cleanup (`styles.css`, testing, final sweep)

**Goal:** Remove dead custom CSS after consumers have migrated; tighten the contract.

**Files to touch:**

| File | Action |
|---|---|
| `src/styles.css` | Remove per-component `@layer components` blocks as they become dead (`.button`, `.panel`, `.tab-button`, `.field-grid`, `progress-track`, `.alert` …) — **keep** `@theme` tokens, base reset (`html/body` bg, radial gradient, `input[type=range] accent-*`), layout shells (`.app-shell`, `.route-two-column`, `.animation-*`), and the tiny global overrides. Do **not** remove `.three-vendor` handling in `vite.config.ts`. |
| `src/components/ui.tsx` | Delete once all imports are via `@/components/ui/*` |
| `src/components/app/*` | Add focused `Vitest` component tests where they protect core behavior (Button variants, Card header composition, Tab keyboard, Slider+number sync). Add one Cypress journey that exercises the full teach→archive→train→evaluate flow (extends `cypress/e2e/demonstrations.cy.ts`). |
| `docs/design-reference.md` | Update Tailwind migration rules: document which tokens are now semantic aliases, which `components/ui/*` are canonical |
| `CONTEXT.md` | No change unless new domain terms are introduced (per AGENTS.md, update glossary before broad use) |
| `infra/` | No change — `AGENTS.md` forbids app implementation in `infra` |

**Verification (final gate):**

```bash
cd apps/web
npm run test:unit
npm run build        # inspect dist size vs baseline (three-vendor chunk still 136 kB gzipped)
git diff --check
git log --oneline -10  # PR review: only intended files changed (AGENTS.md)
```

---

## 6. Verification Checklist (applies to every phase)

Per `AGENTS.md` **Verification loop**:

```bash
cd apps/web
npm run test:unit
npm run build
git diff --check
# full-stack check (when meaningful):
./start-local.sh
cd apps/web && npm run test:e2e
```

Additionally:

- [ ] `pnpm dlx shadcn@latest add <component> --dry-run` was reviewed before writing
- [ ] `tailwind.css: "src/styles.css"` is correct (`tw-animate-css` / `shadcn/tailwind.css` order preserved)
- [ ] `vite.config.ts` still contains `build.chunkSizeWarningLimit: 600` and `manualChunks → three-vendor` — `npm run build` bundle report inspected
- [ ] Focus/keyboard: `Button`, `Input`, `Slider`, `Tabs`, `Select` all show `ring-ring` focus and `Space`/`Enter` activation

---

## 7. Sources

Primary sources consulted (no secondary blogs used):

| # | Source | URL |
|---|---|---|
| 1 | shadcn/ui — Installation: Vite | https://ui.shadcn.com/docs/installation/vite |
| 2 | shadcn/ui — Theming (CSS variables, tokens, radius, `shadcn/tailwind.css`) | https://ui.shadcn.com/docs/theming |
| 3 | shadcn/ui — Theming Default Theme CSS (canonical `globals.css` scaffold) | https://ui.shadcn.com/docs/theming (Default Theme CSS expand) |
| 4 | shadcn/ui — `components.json` spec | https://ui.shadcn.com/docs/components-json |
| 5 | shadcn/ui — CLI (init / add / diff / view / eject / migrate) | https://ui.shadcn.com/docs/cli |
| 6 | shadcn/ui — Dark Mode — Vite (ThemeProvider) | https://ui.shadcn.com/docs/dark-mode/vite |
| 7 | shadcn/ui — Button (cva variants, cursor, `buttonVariants`, API) | https://ui.shadcn.com/docs/components/base/button |
| 8 | shadcn/ui — Card (composition, size, spacing/CSS variable, API) | https://ui.shadcn.com/docs/components/base/card |
| 9 | Tailwind CSS — Installation: Using Vite | https://tailwindcss.com/docs/installation/using-vite |
| 10 | Tailwind CSS — Theme variables (`@theme`, namespaces, `inline`, top-level) | https://tailwindcss.com/docs/theme |
| 11 | Tailwind CSS — Functions & Directives (`@theme`, `@custom-variant`, `@apply`) | https://tailwindcss.com/docs/functions-and-directives |
| 12 | Vite — Getting Started (dev server, HMR, scaffolding) | https://vite.dev/guide/ |
| 13 | Vite — Configuring Vite (defineConfig, conditional/async config) | https://vite.dev/config/ |
| 14 | Vite — Shared/build options (`resolve.alias`, `build.rolldownOptions`) | https://vite.dev/config/shared-options (via Vite config index) |
| 15 | Radix UI — Primitives Introduction (`radix-ui` vs `@radix-ui/react-*`) | https://www.radix-ui.com/primitives/docs/overview/introduction |

---

## 8. Open Questions (for the implementing PR)

1. **Base vs Radix vs Aria** — `init -b base|radix|aria` is a one-time, non-reversible choice that sets future component generation (`components.json` style is locked after init [Source: components.json — style](https://ui.shadcn.com/docs/components-json)). Confirm with the team before `init`.
2. **`packages/` shared library** — `AGENTS.md` reserves `packages/` for genuinely shared contracts used by ≥2 apps. Do not promote `@/components/ui` to `packages/ui` now; `apps/web` is the only consumer.
3. **Legacy `/legacy` removal** — keep the `/legacy` `workbench-grid` route through phase 3 so the panel extraction has a living before/after comparison; schedule removal as a separate ADR.
4. **Icon library** — `lucide-react` is already the default and shadcn `migrate icons` targets it [Source: CLI — migrate icons](https://ui.shadcn.com/docs/cli); no switch to `tabler`/`phosphor` is needed unless the design system requires it.

---

*Research authored without code changes. Every command above was evaluated against the primary docs; no file was mutated.*
