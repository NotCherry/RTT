# ADR 0003: Lab-dark design system and shadcn usage

- Status: Accepted
- Date: 2026-08-30
- Scope: Frontend design tokens, typography, shadcn usage

## Context

`components.json` declares `style: new-york`, `baseColor: neutral`, `cssVariables: true` — i.e. shadcn new-york. New contributors expect the default shadcn look (light zinc/neutral, `Inter`, `radius: 0.625rem`, minimal shadows) shown on <https://ui.shadcn.com>.

The app does not look like default shadcn because `src/styles.css` intentionally overwrites the entire token layer:

- `@theme` replaces `--font-sans` with `Space Grotesk` and `--font-mono` with `DM Mono` (loaded via Google Fonts), and defines a custom palette `--color-ink-*`, `--color-line-*`, `--color-text-*`, `--color-accent-*`.
- `:root` and `.dark` map shadcn semantic vars (`--background`, `--foreground`, `--card`, `--primary`, `--border`, …) to the lab palette (`--color-ink-950: #0b0e13` as background, `--color-accent-500: #4e9cf5` as primary) instead of shadcn neutral.
- `body` is forced dark: `bg-ink-950 text-text-100` with `radial-gradient(circle at 77% 0%, #182234 0, #0b0e13 37rem)`.
- Headings/kickers/panel labels are hard-coded as `text-[17px] tracking-[-0.03em]` / `font-mono text-[10px] tracking-[0.16em]` etc.

This is by design: the workbench is a dark lab console, not a neutral marketing/dashboard canvas. shadcn is intentionally used as **primitive layer only** (Radix + `cva` + `cn` + `data-slot`), not as visual brand.

Additional drift made the divergence worse:

- Legacy `App.tsx` workbench still uses raw `<button class="button primary">` / `.panel` CSS instead of `<Button>`/`<Card>`.
- `src/components/ui/slider.tsx` and `select.tsx` are native-element facades, not Radix primitives, but still expose shadcn `data-slot` API.
- Hardcoded `bg-[#243346]`, `text-slate-400`, `text-blue-100` bypass tokens.

## Decision

1. **Keep lab-dark as product brand.** Do not revert to default neutral shadcn. Default shadcn can be recovered by deleting the custom `@theme` + `:root` block — that is not desired.
2. **Use shadcn as single primitive source of truth.** All UI must compose from `src/components/ui/*` (`Button`, `Card`, `Badge`, `Input`, `Label`, `NativeSelect`/`Select`, `Slider`, `Tabs`, `Separator`, `Progress`, `Alert`, `Empty`, `Typography`). No raw `class="button"` or global `h1/h2` styles outside Typography.
3. **Single token set in one place.** `src/styles.css` `@theme` + `@theme inline` is the only token definition. `:root` / `.dark` are identical because the app is dark-only — this duplication is kept intentionally but documented here to avoid "fix the duplicate" churn. Light mode is explicitly not supported in MVP.
4. **Enforce unification.** Arbitrary colors (`bg-[#...]`, `text-slate-*`, `text-blue-*`) are lint-forbidden. Typography must go through `Typography` primitives. Facade components must be either promoted to real Radix or renamed `Native*` and documented.

## Consequences

- New pages look lab-dark by construction; they will never look like default shadcn docs unless tokens are swapped.
- To preview default shadcn, run with `src/styles.css` tokens commented out — useful for debugging shadcn upgrades but not for product.
- Follow-up tasks: scaffold `Typography`, consolidate tokens, unify `Button`/`Panel`, fix/replace facade primitives, dedupe `workbench-*` vs `route-*` layout CSS, add lint guardrails, and verify build/tests.
