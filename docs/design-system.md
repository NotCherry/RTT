# Design System — Enforcement Guide

This doc is the enforcement companion to ADR 0003.

## Why this does not look like default shadcn

`shadcn` is **not a theme**. It is a copy-paste primitive library: `new-york` gives you Radix wrappers + `cva` + `tailwind-merge` + `data-slot` + CSS vars. The *look* comes entirely from the tokens you put in `src/styles.css`.

Default `shadcn new-york` tokens (what you see on ui.shadcn.com):

- `--background: 0 0% 100%` (white / zinc-100), `--foreground: 240 10% 3.9%`, `--primary: 240 5.9% 10%`, `--radius: 0.625rem`, font `Inter`/`Geist`.

This repo **replaces all of them**:

- `@theme --font-sans: Space Grotesk`, `--font-mono: DM Mono`, `--color-ink-950: #0b0e13` → `--background: var(--color-ink-950)`
- Dark-only lab console (`:root` == `.dark`), accent `--color-accent-500: #4e9cf5`.
- To recover default shadcn: comment out `@theme` + `:root`/`.dark` blocks and leave `shadcn/tailwind.css` defaults — intentionally not done.

So `shadcn` **is** giving this — you asked it to. The earlier audit flagged that half the code still bypasses it via raw `class="button"` and hardcoded `bg-[#243346]` / `text-slate-400`.

## Single source of truth

- **Tokens:** `apps/web/src/styles.css` `@theme` + `@theme inline` only. No other `tailwind.config.*`. To add a color, add `--color-*` there and reference as `bg-*` / `text-*` / `border-*`.
- **Typography:** `apps/web/src/components/ui/typography.tsx` (`H1/H2/H3/Kicker/Eyebrow/PanelLabelText/IntroCopy/Body/Mono/Caption`). Never use raw `<h2>` or `p.kicker` or ad-hoc `text-[11px]`.
- **Actions:** `src/components/ui.tsx` `Button` (which wraps `src/components/ui/button.tsx` shadcn). Never `class="button secondary"`. For links use `<Button asChild><Link/></Button>`.
- **Surfaces:** `Panel`/`PanelHeader`/`PanelLabel` (wraps `Card`). Never `class="panel"`.
- **Forms:** `Input`, `Label`, `NativeSelect` (native element). `Select` is a facade shim — see primitives fix.
- **Status:** `Badge`/`StatusPill`, `Separator`, `Progress`, `Alert`, `Empty`.

## Enforcement (scaffolding in place)

- `apps/web/scripts/enforce-design-system.mjs` — CI fails if:
  - `bg-[#` / `border-[#` / `text-[#` appears in `src/` (must be token)
  - `text-slate-` / `text-blue-` / `bg-slate-` / `bg-blue-` appears (must be `text-text-*` / `bg-ink-*` / `bg-accent-*`)
  - `class="button` / `className="button` appears (must be `<Button>`)
  - raw `<h1>`/`<h2>`/`<h3>` outside `typography.tsx` (warn)
- Run: `node scripts/enforce-design-system.mjs` (also wired in `npm run lint` next).
- Facade primitives (`slider.tsx`/`select.tsx`) are documented as native-backed MVP shims; promoting to Radix is task `primitives-fix`.

## Migration recipe (for remaining pages)

1. Replace `p.kicker` → `<Kicker>`, `h2` → `<H2>`, `p.intro-copy` → `<IntroCopy>`, `h3` → `<H3>`, `p.panel-label` → `<PanelLabelText>`.
2. Replace `<a class="button ghost small">` / `<Link class="button secondary">` → `<Button variant="ghost" size="small" asChild><a>` / `<Button variant="secondary" size="small" asChild><Link>`.
3. Replace `bg-[#0d131b]` / `text-slate-500` → `bg-ink-950` / `text-text-600` etc. (see `@theme`).
4. Run `npm run build` + `node scripts/enforce-design-system.mjs` until green.
