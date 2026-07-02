---
version: alpha
name: Marque
description: Editorial brand identity and design-system handbook with deep violet ink, lavender paper surfaces, and confident geometric display type.
theme: light
colors:
  paper: "#FAFAFC"
  veil: "#EEE9FB"
  veil-deep: "#E3DCF6"
  ink: "#1A1A2E"
  ink-soft: "#2A2A3E"
  primary: "#4727B5"
  primary-hover: "#3A1F9A"
  secondary: "#2A1574"
  tertiary: "#8B72F0"
  neutral: "#6B6680"
  surface: "#FAFAFC"
  surface-raised: "#EEE9FB"
  on-surface: "#1A1A2E"
  on-primary: "#FFFFFF"
  border: "#E5E1EF"
  border-strong: "#D6CFE8"
  focus: "#8B72F0"
  error: "#B54727"
  success: "#1F7A4C"
typography:
  display-xl:
    fontFamily: Plus Jakarta Sans
    fontWeight: 800
    fontSize: 112px
    lineHeight: 1.02
    letterSpacing: -0.025em
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontWeight: 800
    fontSize: 84px
    lineHeight: 1.02
    letterSpacing: -0.025em
  display-md:
    fontFamily: Plus Jakarta Sans
    fontWeight: 800
    fontSize: 56px
    lineHeight: 1.02
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontWeight: 700
    fontSize: 44px
    lineHeight: 1.12
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontWeight: 700
    fontSize: 32px
    lineHeight: 1.12
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontWeight: 700
    fontSize: 24px
    lineHeight: 1.12
  title:
    fontFamily: Plus Jakarta Sans
    fontWeight: 600
    fontSize: 20px
    lineHeight: 1.3
  body-lg:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 18px
    lineHeight: 1.6
  body-md:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 16px
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 14px
    lineHeight: 1.55
  label-sm:
    fontFamily: JetBrains Mono
    fontWeight: 500
    fontSize: 12px
    lineHeight: 1.4
    letterSpacing: 0.12em
    textTransform: uppercase
  mono-md:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 14px
    lineHeight: 1.5
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 14px
  xl: 20px
  2xl: 28px
  3xl: 36px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 72px
  3xl: 128px
  gutter: 24px
  container: 1200px
elevation:
  flat: none
  card: 0 24px 48px -28px rgba(71,39,181,0.22), 0 2px 6px -2px rgba(26,26,46,0.06)
  lift: 0 36px 60px -28px rgba(71,39,181,0.32), 0 4px 12px -4px rgba(26,26,46,0.08)
  focus-ring: 0 0 0 2px #FAFAFC, 0 0 0 4px #8B72F0
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 0 24px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 0 24px
    border: 1.5px solid {colors.primary}
  button-secondary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 0 16px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 14px 16px
    border: 1px solid {colors.border}
  input-field-focus:
    border: 1px solid {colors.primary}
    elevation: "{elevation.focus-ring}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 32px
    border: 1px solid {colors.border}
  card-veil:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: 32px
  card-hero:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.3xl}"
    padding: 72px
  checkbox:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xs}"
    size: 18px
    border: 1.5px solid {colors.border-strong}
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    border: 1.5px solid {colors.primary}
  tabs-track:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.full}"
    padding: 4px
  tabs-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 36px
    padding: 0 20px
  tag:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 26px
    padding: 0 12px
    typography: "{typography.label-sm}"
  tag-solid:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
---

## Overview

Marque is an editorial brand-identity handbook turned into a working design system. It reads like a printed brand book: oversized geometric display headlines lead every page, generous lavender margins frame editorial blocks, and a single deep-violet "signature" surface anchors each section's brand voice. The product should feel curated, opinionated, and quietly luxurious — the same register as a premium identity guidelines deck — while remaining a fully functional product UI.

### ADB Manager Adaptation

This project applies Marque to a dense desktop operations tool, not a marketing site. Keep the Marque palette, type families, paper/veil layering, indigo primary controls, royal signature surfaces, and flatter card treatment. For app UI, do not use viewport-scaled font sizing or negative letter spacing; use fixed token sizes and `letter-spacing: 0` unless a form-bound mono label needs modest positive tracking.

The emotional target is *confident calm*: surfaces breathe, the type does the heavy lifting, and a small repertoire of decorative motifs (concentric stripes and a striped orb mark) recurs as a recognizable thread. The system should feel like a publication, not a SaaS dashboard. Avoid: glassmorphism, gradients on text, soft neumorphism, busy backgrounds, decorative drop shadows, or a colorful multi-hue palette. The palette is monochromatic violet with one warm-white paper, and that restraint is the brand.

Essential traits to preserve from the brief: (1) oversized confident display type as the primary graphic element, (2) the striped orb signature mark used sparingly as an ornament, (3) editorial card-stack composition on a lavender-tinted paper canvas, (4) one rare deep-violet hero block per page to carry brand voice in white type, and (5) sections that lead with the heading itself — never a kicker or eyebrow label above an `h1`/`h2`.

## Colors

The system runs on a single hue family: a warm violet stretched from `#FAFAFC` paper to `#1A1A2E` ink, with `#4727B5` indigo as the primary brand color and `#2A1574` royal as the deep signature block. The palette is intentionally narrow so that the deep violet block reads as a brand statement rather than another surface.

Roles:

- `paper` (`#FAFAFC`) — the canvas. Every page starts here. Carries a faint lavender cast that ties it to the brand without competing with content.
- `veil` (`#EEE9FB`) — the lavender surface used for cards, swatches, quote blocks, and segmented tab tracks. Pairs with paper to create quiet layered density.
- `ink` (`#1A1A2E`) — body type, headings, and high-contrast foreground on paper/veil. Slightly cooler than pure black, sitting in the brand's color temperature.
- `indigo` (`#4727B5`) — the primary brand violet. Used for the brand mark, primary buttons, key links, focus rings on indigo accents, and chart strokes.
- `royal` (`#2A1574`) — the deep signature surface. Reserved for one hero/feature block per page. Carries the brand voice in white display type and is the visual anchor.
- `halo` (`#8B72F0`) — secondary accent. Used for focus rings, chart accent, and small highlights inside the royal hero (it reads well on both paper and royal).
- `whisper` (`#6B6680`) — captions, metadata, supporting prose, inactive tab labels.
- `hairline` (`#E5E1EF`) — borders, dividers, quiet rules.

Contrast: ink-on-paper passes WCAG AA at every size; whisper-on-paper passes AA only at body sizes and larger — never use it for small labels. White on royal is the default for the deep block; never place ink on royal. Indigo on paper passes AA for body text and large headings.

Do not introduce a second hue. If a status color is needed, use the supplied `error` and `success` values, but treat them as rare diagnostics, not brand colors.

## Typography

Three families, used in narrow roles:

- **Plus Jakarta Sans** (display, 700/800) — every heading, hero number, and oversized brand statement. Tight tracking (`-0.025em` for display, `-0.015em` for headlines) and near-1.0 line height. This is the brand voice.
- **Inter** (body, 400/500/600/700) — all body copy, controls, labels-as-prose, and supporting text. Used at 16–18px with relaxed 1.6 line height for editorial readability.
- **JetBrains Mono** (mono, 400/500) — token codes, hex values, numeric metadata, uppercase tracked labels (the `.label` class). The mono treatment is what gives Marque its "brand book specimen sheet" feel.

The display family is treated as a graphic element: lead with display type, let it set the cadence of the page, and pair it with airy white space. Section headings sit at `headline-lg` (44px) or `headline-md` (32px). Body copy never exceeds 64ch.

**Eyebrows/kickers are forbidden.** Do not place a short label, category tag, or all-caps line directly above a heading. The heading itself opens every section. Uppercase tracked labels in JetBrains Mono are used for column captions, swatch names, and stat labels — never as a kicker above an `h1`/`h2`.

## Layout

The system is built on a 1200px default container with 32px outer padding. A wider 1320px container exists for galleries; a narrow 720–880px container is used for prose-heavy reading pages.

**Page rhythm.** Sections breathe at 96–128px vertical padding (`section`) by default. Tighter sections (`section-tight`) drop to 72px when stacking many cards. Within sections, content stacks at 24–40px gaps. The grid system is a 12-column grid with 24px gutters; asymmetric splits (4+8, 5+7) are preferred over symmetric 6+6 because the editorial voice depends on visual hierarchy, not balance.

**Section patterns** downstream agents should reuse:

- *Hero / brand statement*: a single full-width royal `card-hero` block with oversized white display headline, short body, and one primary CTA. Place the striped orb ornament faded behind the type at top-right. One hero per page maximum.
- *Editorial intro*: large display headline left-aligned, supporting lead paragraph (max 60ch) below, optional metadata row in mono labels. No eyebrow.
- *Feature grid*: 2- or 3-column grid of `card` or `card-veil` blocks. Use mixed surface treatment (paper + veil) to introduce rhythm.
- *Photo gallery / specimen sheet*: `card-photo` blocks with 4:3 ratio, 14px clipping, soft `card` shadow. Stack 2–3 across with generous gutters.
- *Specimen / token row*: 4-up `swatch` grid for color tokens; horizontal row of `stat` blocks for numeric metadata.
- *Empty state*: centered orb mark at quarter opacity, headline, body, single button.

**Alignment.** Lead left. Center alignment is reserved for cover/hero pages and for stat blocks. Do not center every section; the editorial cadence depends on a strong left edge.

**Responsive behavior.** At ≤960px, multi-column grids collapse to 2-up; at ≤640px, to a single column. Hero padding drops from 72px to 40px. Display type scales fluidly via `clamp()` so headlines stay confident on small screens without breaking the layout.

## Elevation & Depth

Marque is mostly flat. Depth is a deliberate accent, never the default.

- **Card shadow** (`--shadow-card`): a soft 24–48px diffuse violet-tinted shadow on key cards only — feature cards, active tab pills, the photo specimen blocks. Never on every card.
- **Royal hero**: sits flat, no shadow. Its color does the work.
- **Borders**: 1px hairline (`#E5E1EF`) is the default separator. Use it for quiet card outlines and table rows. Avoid heavy borders.
- **Focus ring**: 2px paper offset + 2px halo halo (the `--focus-ring` token). Visible on all interactive elements and required for accessibility.

No glassmorphism, no neumorphism, no glow effects, no gradient text, no inner-shadow inputs. Translucency is used only inside the royal hero for the decorative stripe/hex motifs and the ornament orb.

## Shapes

A small radius vocabulary tied to component scale:

- `xs` 4px — checkbox.
- `sm` 8px — small chips, tooltips.
- `md` 12px — inputs, selects, textareas.
- `lg` 14px — cards, photo blocks, swatches.
- `xl` 20px — large modal-style panels.
- `2xl` 28px / `3xl` 36px — the royal `card-hero` only.
- `full` 999px — primary/secondary buttons, tags, segmented tab pills.

Decorative motifs (used sparingly): concentric horizontal stripes and a flat hexagonal grid overlay drawn from the orb logo. Render them as inline SVG or CSS gradients **inside the royal hero only** at 8–16% white opacity. Never use them as global page backgrounds or wallpapers.

## Components

**Buttons.** Pill-shaped (`radius-full`), 44px default height, 24px horizontal padding. Primary fills indigo, hovers to royal. Secondary is transparent with a 1.5px indigo outline that fills on hover. Ghost is transparent ink-on-paper with a veil hover surface. On royal heroes, swap to `btn-on-royal` (white fill, royal text) or `btn-on-royal-outline` (white outline).

**Inputs.** 12px radius, hairline border on paper background, 14px vertical / 16px horizontal padding. Focus state shifts the border to indigo and adds the 2-step focus halo. Labels above inputs use the mono uppercase `field-label` (this is a label, not a kicker — it is bound to a form control, not opening a section).

**Cards.** Default `card` is paper with hairline border and 14px radius. `card-veil` swaps the background to lavender for layered editorial density. `card-elevated` adds the soft violet shadow for key emphasis. `card-photo` clips imagery at 14px with a veil background fallback. `card-hero` is the rare deep-violet panel with 36px radius, 72–96px padding, and an optional ornament orb.

**Checkboxes.** 18px square with 4px radius, 1.5px hairline-strong border unchecked. Checked state fills with indigo and renders a white check glyph. Radio variant shares the same color logic with a circular shape and dot.

**Tabs.** A pill segmented control: 4px-padded veil track, 36px pills. The active tab swaps to paper with a soft shadow and indigo text; inactive tabs are whisper text on a transparent surface. Use for view switching, never as a primary nav.

**Tags / chips.** 26px pills. Default is veil background with indigo text; `tag-solid` is royal with white text for emphasis; `tag-outline` is transparent with indigo border. Keep tag labels short (1–2 words).

**Brand mark / lockup.** The striped orb is the signature element. In headers, render at 28–32px next to the wordmark "Marque" in Plus Jakarta Sans 800. On the royal hero, render at 240px+ at 12–16% white opacity as a faded ornament behind the headline. Always indigo on light surfaces, white on royal. The mark recolors via `currentColor`.

**Icons.** **Lucide** is the chosen library (https://lucide.dev/, ISC license). Use Lucide's outline icons at 18px (24px for larger affordances) with 1.75 stroke width. Color via `currentColor` so icons inherit from their text. Pick a small consistent set per page (search, arrow-right, check, x, chevron-down, menu) and do not mix with other libraries. Load via the Lucide CDN script and call `lucide.createIcons()`.

**Imagery.** Photography is warm, candid, and treated with rounded 14px clipping. Never duotone the photography — the palette restraint depends on photography reading as warm/human against the cool violet system. Subjects are everyday and well-lit.

**Motion.** Transitions are short and unobtrusive: 120ms for state flips (hover, focus), 200ms for surface changes (tab swap, button fill), 360ms for layout changes. Use a single easing (`cubic-bezier(0.2, 0.7, 0.3, 1)`). No bounce, no parallax, no autoplay.

## Do's and Don'ts

**Do**

- Lead every section with its heading at `headline-lg` or `headline-md`; let the type carry the hierarchy.
- Mix paper and veil surfaces within a page to create editorial rhythm without introducing new colors.
- Use one royal hero block per page as the brand anchor and keep it visually quiet (flat, no shadow, one CTA).
- Place the striped orb mark sparingly: header lockup, hero ornament, and quarter-opacity section divider. Three placements per page maximum.
- Treat uppercase mono labels as captions for swatches, stats, and metadata rows — never above a heading.
- Use asymmetric 12-column splits (4+8, 5+7) for editorial layouts; reserve 6+6 for true comparisons.
- Render the striped/hex motifs only inside the royal hero, at low white opacity.
- Pair tight display headlines with relaxed-leading body copy at 16–18px and a max measure of 60–64ch.

**Don't**

- Don't add a short label, kicker, or all-caps line directly above an `h1`/`h2`. Lead with the heading itself.
- Don't introduce a second hue family or use ink on royal — the palette restraint is the brand.
- Don't use the stripe or hex motifs as a global page background or under body content.
- Don't add shadows to every card, or apply the elevated shadow to the royal hero.
- Don't duotone photography or apply a violet color overlay to imagery; keep photos warm and natural.
- Don't center body copy or stack every section center-aligned; lead left.
- Don't mix icon libraries; Lucide is the only set.
- Don't use gradients on text, glassmorphism, neumorphism, or inner-shadow inputs.
- Don't place more than one royal hero per page, or scale the orb ornament larger than ~60% of the hero width.
