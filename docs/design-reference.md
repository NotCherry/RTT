# Robot Teaching Environment — Visual Design Reference

This document records the visual language of the current workbench so future screens and components remain coherent while the implementation moves to Tailwind CSS.

## Product character

The interface should feel like a compact robotics lab console: technical, calm, dark, precise, and inspectable. It should emphasize recorded behavior and the live robot viewport without turning training metrics into the primary product surface.

Use restrained blue interaction accents against charcoal panels. Reserve bright colors for state, progress, and actionable focus. Favor dense information layouts with generous outer spacing, short labels, monospace values, and clear borders instead of decorative gradients.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `ink-950` | `#0b0e13` | Page background |
| `ink-900` | `#11161e` | Panel surface |
| `ink-850` | `#141b24` | Cards and input surfaces |
| `ink-800` | `#151e29` | Form controls |
| `line-700` | `#2a3440` | Panel borders |
| `line-650` | `#293643` | Card borders and chart surfaces |
| `line-600` | `#354352` | Input borders |
| `text-100` | `#e9eef6` | Primary text |
| `text-300` | `#cbd9e8` | Headings and emphasized values |
| `text-500` | `#8998aa` | Secondary text |
| `text-600` | `#718298` | Labels and muted copy |
| `text-700` | `#596777` | Footer and low-priority metadata |
| `accent-500` | `#4e9cf5` | Primary action, active state, trainable joint |
| `accent-300` | `#75b5ff` | Primary hover and highlight |
| `accent-deep` | `#233a53` | Active tabs and selected surfaces |
| `success-400` | `#69d696` | Connected and ready state |
| `warning-400` | `#d7bd82` | Editing and attention state |
| `danger-400` | `#ff7d87` | Recording and destructive state |

The page retains a subtle radial blue glow from the upper-right corner. Gradients should support depth, not become a primary visual motif.

## Typography

- **Display and UI:** Space Grotesk, weights 400–700.
- **Technical values:** DM Mono, weights 400–500.
- **Eyebrows and panel labels:** DM Mono, 9–10px, uppercase, letter spacing around `0.16em`.
- **Main title:** 17px, semibold, tight tracking.
- **Hero title:** responsive 28–46px, tight line-height and negative tracking.
- **Body copy:** 12–14px with muted blue-gray color.
- **Technical output:** 9–11px DM Mono.

## Layout

- App shell max width: approximately 1640px.
- Desktop shell padding: `28px 38px 22px`.
- Main workbench: three columns — live viewport, robot controls, training/archive tools.
- Column gap: 13px.
- Panels have a minimum 1px border, 9px radius, dark translucent surface, and a soft shadow.
- At medium widths, the viewport spans the full row and the two tool panels sit beneath it.
- At mobile widths, panels become a vertical stack and the workflow indicator can scroll horizontally.

## Component recipes

### Panel

A panel is a bordered dark surface with clipped rounded corners. Its header has a bottom divider, a DM Mono label, a concise heading, and an optional status or step badge.

### Button

- Primary: blue fill, dark text, 5px radius, semibold, slight lift on hover.
- Secondary: blue-gray fill with pale blue text.
- Ghost: transparent with a muted border.
- Small buttons use 8px × 11px padding and 11px technical text.
- Disabled buttons retain their shape but use reduced opacity and a not-allowed cursor.

### Status pill

Pills use full rounding, a 1px border, DM Mono text, and a 6px status dot. Connected/ready states use green; idle states stay blue-gray.

### Tabs

Tabs sit in a dark inset track with a thin border. The selected tab uses a deep blue surface and pale blue text. Counts appear as small rounded blue badges.

### Archive card

Demonstration cards use a slightly raised panel surface, a compact pose sketch, an editable title, frame metadata, joint bars, and right-aligned action buttons. Selected cards use an accent border and a narrow inset blue rail.

### Metric chart

Charts are compact diagnostic surfaces: dark background, faint horizontal grid, blue bars/lines, monospace labels, and a small latest-value footer. Metrics should support training inspection without dominating the recording workflow.

### Form control

Inputs and selects use dark surfaces, 1px muted borders, 4px radius, DM Mono values, and blue focus borders. Range controls use the blue accent and preserve visible lower/upper labels.

### Empty state

Empty states are centered, low contrast, and short. Use one accent glyph, one emphasized sentence, one explanatory line, and a secondary action where recovery is possible.

## Interaction principles

1. Keep the 3D viewport visually dominant.
2. Make capture, replay, and archive actions obvious before training actions.
3. Use color to communicate state, not decoration.
4. Keep numbers and robot joint values monospace and aligned.
5. Preserve focus states and keyboard-visible controls when extracting components.
6. New components should consume shared tokens and recipes rather than introduce one-off colors.

## Tailwind migration rules

- Define the token palette and font families in Tailwind theme configuration.
- Prefer composable utility classes in reusable components over selectors tied to page structure.
- Keep only true global behavior in the base stylesheet: font loading, reset, page background, and range-control defaults.
- Use semantic component wrappers such as `Panel`, `Button`, `StatusPill`, `TabButton`, `MetricChart`, and `ArchiveCard`.
- Keep application behavior in `App.tsx`; move presentational markup and styling into components without changing state semantics.
