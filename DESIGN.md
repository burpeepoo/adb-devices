---
version: alpha
name: Cirrus
description: A minimalist SaaS design system staged on a cloudy sky background, with pill geometry on every control and a single italic serif accent per hero.
colors:
  primary: "#0E1116"
  secondary: "#FFFFFF"
  tertiary: "#2E7DEF"
  neutral: "#5B6472"
  surface: "#FFFFFF"
  surface-page: "#EDF2F7"
  surface-horizon: "#B8D4F1"
  surface-sunken: "#F3F6FA"
  on-surface: "#0E1116"
  on-surface-muted: "#5B6472"
  on-primary: "#FFFFFF"
  border: "#E3E8EE"
  border-soft: "#EEF2F6"
  focus: "#2E7DEF"
  accent-signal: "#2E7DEF"
  accent-citrus: "#FF7A3D"
  accent-meadow: "#2BC48A"
  error: "#FF7A3D"
typography:
  font-display: "Inter Tight, Inter, system-ui, sans-serif"
  font-sans: "Inter, system-ui, sans-serif"
  font-serif: "Instrument Serif, Iowan Old Style, Georgia, serif"
  hero:
    fontFamily: "{typography.font-display}"
    fontWeight: 700
    fontSize: "clamp(56px, 6.4vw, 88px)"
    lineHeight: 1.02
    letterSpacing: "0"
  display-md:
    fontFamily: "{typography.font-display}"
    fontWeight: 700
    fontSize: "clamp(40px, 4vw, 56px)"
    lineHeight: 1.06
    letterSpacing: "0"
  headline-lg:
    fontFamily: "{typography.font-display}"
    fontWeight: 700
    fontSize: "40px"
    lineHeight: 1.18
    letterSpacing: "0"
  headline-md:
    fontFamily: "{typography.font-display}"
    fontWeight: 600
    fontSize: "28px"
    lineHeight: 1.22
    letterSpacing: "0"
  headline-sm:
    fontFamily: "{typography.font-display}"
    fontWeight: 600
    fontSize: "20px"
    lineHeight: 1.3
    letterSpacing: "0"
  body-lg:
    fontFamily: "{typography.font-sans}"
    fontWeight: 400
    fontSize: "17px"
    lineHeight: 1.55
  body-md:
    fontFamily: "{typography.font-sans}"
    fontWeight: 400
    fontSize: "15px"
    lineHeight: 1.55
  body-sm:
    fontFamily: "{typography.font-sans}"
    fontWeight: 400
    fontSize: "13px"
    lineHeight: 1.45
  label-sm:
    fontFamily: "{typography.font-sans}"
    fontWeight: 500
    fontSize: "12px"
    lineHeight: 1.3
    letterSpacing: "0.01em"
  accent-italic:
    fontFamily: "{typography.font-serif}"
    fontStyle: italic
    fontWeight: 400
    fontSize: "1.04em"
    letterSpacing: "0"
rounded:
  none: "0px"
  sm: "8px"
  md: "10px"
  lg: "16px"
  xl: "18px"
  check: "6px"
  full: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  4xl: "96px"
  container-pad: "32px"
  container-max: "1240px"
elevation:
  tier-1: "0 1px 2px rgba(14,17,22,0.06)"
  tier-2: "0 1px 3px rgba(14,17,22,0.08), 0 8px 18px -16px rgba(14,17,22,0.22)"
  focus-ring: "0 0 0 3px rgba(46,125,239,0.28)"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    height: "44px"
    padding: "0 22px"
  button-primary-hover:
    backgroundColor: "#1A1F28"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    height: "44px"
    padding: "0 22px"
    borderColor: "{colors.border}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    height: "44px"
    padding: "0 18px"
    borderColor: "{colors.border}"
  input-field-focus:
    borderColor: "{colors.focus}"
    boxShadow: "{elevation.focus-ring}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "32px"
    borderColor: "{colors.border}"
    boxShadow: "{elevation.tier-1}"
  card-flush:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0px"
    borderColor: "{colors.border}"
    boxShadow: "{elevation.tier-1}"
  slab:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "28px"
    borderColor: "{colors.border}"
    boxShadow: "{elevation.tier-2}"
  checkbox:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.check}"
    size: "18px"
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  tabs-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 16px"
    boxShadow: "{elevation.tier-2}"
  tabs-inactive:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 16px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    height: "28px"
    padding: "0 12px"
    borderColor: "{colors.border}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface-muted}"
    rounded: "{rounded.full}"
    size: "40px"
  rail-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  nav-link-active:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
---

## Overview

Cirrus treats the page as **open sky**. Content is staged on a soft, cloudy gradient — Horizon blue blended down into Sky, with three off-center cloud overlays drifting through. Every surface that holds content floats above that sky as a crisp white pill-radius card with a hairline border and a whisper-soft shadow. The page should feel like an early-morning window: weightless, quiet, expensive.

The product feel is **calm, editorial SaaS**. Restraint is the texture. Whitespace is the brand. The system avoids: heavy gradients, glass blur on flat regions, decorative pills and badges, dense metadata clutter, all-caps micro-labels, and any sense of "filling" the layout. If a space feels empty, that is correct — leave it empty.

Two motifs do all of the talking:

1. **The cloudy sky background.** It is the signature; it is non-negotiable. Every preview hero and the cover share the exact same recipe so the system is recognizable before any text loads.
2. **The italic serif accent.** Exactly one phrase per hero is set in Instrument Serif italic at the same optical size as the surrounding sans, colored slightly down to Mist. It is the system's only ornament.

Essential traits to preserve from the source direction: open-sky canvas, pill geometry on every interactive control, obsidian-black primary CTAs against white surfaces, a tri-color data accent of Signal Blue, Citrus, and Meadow, and a strict editorial typography pairing of Inter Tight (display) with Instrument Serif italic (single accent).

What Cirrus should never feel like: a generic blue-gradient SaaS template, a heavy glassmorphism dashboard, a content-dense admin panel, or a marketing page padded with decorative metadata.

## Colors

Cirrus is a six-color system with three accent reserves for data. Every interaction uses Ink on Cloud or Cloud on Ink. The accents never touch typography, surfaces, or borders.

- **Sky `#EDF2F7`** — the only page background. Always blended with the cloud overlay recipe, never used flat in product chrome.
- **Horizon `#B8D4F1`** — the top of the sky gradient and the ambient halo behind floating panels. Never used as a fill or accent.
- **Cloud `#FFFFFF`** — the single surface color for cards, inputs, popovers, the nav pill, and the icon rail. There is no second surface tier; depth comes from elevation, not tint.
- **Ink `#0E1116`** — primary text, headline color, and the fill for primary CTAs, active tabs, active rail items, and checked checkboxes. Ink is the system's strongest gesture; use it deliberately.
- **Mist `#5B6472`** — every secondary label, body subdued text, muted icon, and the color of the italic serif accent. Pair Mist with Ink in the same line to create a quiet hierarchy.
- **Edge `#E3E8EE`** — the only border tone. Use it as a 1px hairline on every floating surface, every input, every divider, and every dashed chart grid.

Data accents (chart fills, KPI deltas, focus ring only):

- **Signal Blue `#2E7DEF`** — primary data series and focus ring.
- **Citrus `#FF7A3D`** — secondary data series and warm callouts.
- **Meadow `#2BC48A`** — tertiary data series and positive deltas.

Contrast notes: Ink on Cloud passes AAA at body sizes. Mist on Cloud is intended for secondary text only and stays at body size or larger; never use Mist for small interactive labels under 13px. Signal Blue on Cloud is reserved for links and focus ring, not large fills.

## Typography

Three families, with a strict role for each.

- **Inter Tight** — display and headline weights at 600 and 700. Used for `display-hero`, `display-md`, `headline-lg`, `headline-md`, `headline-sm`, and the card title. Headlines run tight through line-height, while letter spacing stays `0`. Inter Tight is the only family allowed at display sizes.
- **Inter** — every body weight, label, metric, nav link, button label, input value, and numeral. Always tabular for numerics (`font-variant-numeric: tabular-nums`). Body sits at 15-17px; small labels never go below 12px.
- **Instrument Serif italic** — the signature accent. Used **exactly once per hero**, slipped inside the headline as a single phrase. Set at `1.04em` against its surrounding sans for optical balance, colored Mist (`#5B6472`) so it whispers next to the Ink headline. Never use Instrument Serif outside a hero headline. Never set it upright. Never use it for body, captions, or labels.

Hierarchy is built from **scale and weight contrast alone**. No all-caps labels, no small-caps eyebrows, no monospace micro-tags, no underlines except on hover for inline text links.

Spacing for headlines: leave at least one full body-line of breathing room above and below a hero or section heading. Hero subtext is constrained to 56 characters per line for measure.

## Layout

Cirrus is a **centered editorial grid** stacked over a single full-bleed sky. There is no wallpaper, no second background. The whole page sits inside a `1240px` max container with `32px` horizontal padding.

### Page rhythm

- **Section padding:** 96px top and bottom on desktop, 64px on tighter sections. Never tighter than 48px.
- **Vertical spacing inside sections:** stack at 24, 28, or 36px. Avoid 12-16px gaps in long-form sections; that density belongs to dashboards, not marketing.
- **Hero rhythm:** Nav, then 80-112px of sky, then headline, then 24px gap to subtext, then 36px gap to the CTA row.
- **Below the hero, float a single dashboard "slab"** (`border-radius: 36px`, Tier 2 shadow) that breaks halfway out of the hero section. This is the canonical Cirrus composition — sky above, slab floating into the next section.

### Hero pattern

- Headline is **centered**, max-width 18ch, weight 700, tracked tight.
- Inside the headline, mark exactly one phrase with `.accent-italic` (Instrument Serif italic, Mist). The phrase should be the *emotional weight* of the headline, not the verb. Example: "Manage your business with *smarter AI automation*".
- Subtext is centered, Mist, max-width 56ch.
- CTAs are a row of two: primary Ink pill on the left, secondary Cloud pill on the right, both 44px tall, gap 12px. Each CTA carries a single 16px Lucide icon to its left.

### Section patterns

- **Feature grid:** Three columns of cards on desktop, single column under 880px. Each card is 28px-radius, 32px padding, Tier 1 shadow, hairline Edge border. Cards carry a 36px icon tile (Ink fill, Cloud icon), a headline-sm title, and one body-md paragraph. No bullet lists inside cards.
- **Dashboard section:** A single slab containing a tab row (left), search/avatar row (right), title block, KPI strip with `.stat-row`, a `progress-tri` bar, and a chart card. Slab is the only place where two cards may sit visually side by side.
- **Pricing / plan:** Three cards in a row, the middle card identical in geometry but lifted 8px with Tier 2 shadow to signal recommendation. Do not change palette to highlight; let elevation do the work.
- **CTA banner:** A single full-width Cloud card with 40px padding, centered headline, single accent-italic phrase, and one primary CTA. Never two CTAs in a closing banner.

### Asymmetry rule

Cirrus is strict and centered above the fold and inside hero sections. Below the slab, prefer **left-aligned** content with a single column of text and a floating visual to the right. Centered text inside a marketing card is forbidden; centering is reserved for headers and CTAs.

### Responsive behavior

- At `<= 880px`, grids collapse to a single column, the nav pill collapses behind a Ink pill `Menu` button, the slab becomes full-bleed within the container and its inner stat row stacks 2x2.
- Hero font shrinks via the `clamp()` already set on `--fs-hero`. Do not introduce a separate mobile hero scale.

## Elevation & Depth

Cirrus has **two whisper-soft elevation tiers** and nothing else. Depth comes from the cloudy background lifting white surfaces, not from heavy shadows.

- **Tier 1 — floating surface:** Cards, inputs, the nav pill, the icon rail. `0 1px 1px rgba(14,17,22,0.04), 0 20px 40px -24px rgba(14,17,22,0.18)`. This shadow should be invisible from a meter away and only register as separation up close.
- **Tier 2 — active or hovering above sky:** The slab, active tab pill, popovers, recommended plan card. Same base plus `0 2px 6px rgba(14,17,22,0.06)`.

Borders are 1px Edge hairlines on every floating surface. The combination of hairline + soft shadow is the depth language; never substitute one for the other and never use both heavily at the same time.

Glassmorphism is **prohibited on flat content regions**. The only acceptable use of any backdrop tint is on the icon rail when it sits over the live sky background, and even then it is a Cloud pill with a hairline border, not a blurred translucent panel.

## Shapes

Pill geometry is the system's spine. The radius scale:

- `999px` (`rounded.full`) — buttons, inputs, search, tabs, chips, nav pill, sidebar rail, rail items, avatar pills, progress bars. **Every interactive control over the sky is a full pill.**
- `28px` (`rounded.lg`) — cards. Soft but architectural; never replace with a smaller radius.
- `36px` (`rounded.xl`) — the dashboard slab. Larger than a card to read as a "stage" rather than a panel.
- `20px` (`rounded.md`) — secondary tiles, icon tiles inside cards, image frames.
- `8px` (`rounded.check`) — checkboxes only.

There are **no sharp corners anywhere in the system.** A right angle is a bug.

Avatars are perfect circles. Brand mark sits inside a 36px Ink pill in the nav. Logos in CTA banners scale up to 88-120px in Ink only, never tinted with an accent.

Iconography is **Lucide**, one weight, stroke-width 1.75. Icons stay at 14-22px in product chrome. Never scale a Lucide glyph above 32px and never use one as a hero illustration; if a hero visual is needed, use the slab.

## Components

### Buttons

Two variants. Both are full pills, 44px tall, 22px horizontal padding, font-weight 500. Icons sit 8px before the label at 16px.

- **Primary:** Ink fill, Cloud text. Hover lifts to `#1A1F28`. This is the only black surface allowed in marketing chrome; do not introduce a third button color.
- **Secondary:** Cloud fill, Ink text, Edge hairline border. Hover fills to `surface-sunken`.
- **Ghost:** No fill, Ink text. Use only inside dense product chrome (e.g., card actions, table rows).

Size variants `btn-sm` (36px) and `btn-lg` (52px) exist; use sparingly. Icon-only buttons use `btn-icon` and stay perfectly circular.

Focus on every button is the Signal Blue ring (`focus-ring`), never an outline.

### Inputs

Pill input, Cloud surface, Edge border, 44px tall, 18px horizontal padding. Placeholder uses `text-soft` (`#8A93A3`). On focus, border switches to Signal Blue and the Signal Blue ring appears. Search inputs lead with a 16px Lucide `search` icon in Mist. Textareas keep the system feel with a 22px radius (soft rectangle, not pill) because pure pills break for multi-line.

### Cards

28px radius, Cloud surface, Edge hairline, Tier 1 shadow, default 32px padding. Cards are containers for content blocks, KPI tiles, charts, and feature grids. **Do not wrap every element in a card.** If a card has a single line of text inside it, the card is wrong; remove the chrome and let typography carry it.

The `card-flush` variant removes padding so the card can host an edge-to-edge chart or media. Use `slab` for the larger, more important stage surface that breaks out of a hero.

### Tabs

A pill row of tabs at 36px height. The active tab is Ink-filled with Cloud text and a Tier 2 shadow lift; inactive tabs are transparent with Ink text. Tabs may carry a 14px leading icon. Never underline a tab — the pill fill is the indicator.

### Checkbox

18px squircle, 8px radius, 1.5px Edge border, Cloud background. Checked state fills with Ink and shows a Cloud checkmark. Focus uses the Signal Blue ring. No indeterminate dash state in this version.

### Sidebar icon rail

A vertical Cloud pill with hairline border and Tier 1 shadow, holding 40px circular icon buttons. Active item fills Ink with Cloud icon; hover items wash to `surface-sunken`. The rail floats inside dashboard slabs on the left edge.

### Nav

A single floating Cloud pill at the top of the page holding 4-5 nav links. The active link is `surface-sunken` filled, inactive links are Mist that warm to Ink on hover. The Try / Sign in CTA sits to the far right as a primary Ink pill. No second nav row, no breadcrumbs over the sky.

### Chips

`chip` is reserved for **real, actionable data**: status, counts, filters. Cloud fill with hairline border. The `chip-ink` variant inverts to Ink fill / Cloud text for live status tokens. No decorative chips, no eyebrow chips, no "New" / "Pro" badges over headlines.

### Charts

Bars use the three accents at full saturation against an Edge dashed grid. Bar tops carry a 12% Cloud overlay only; no gradient fills under areas, no purple/blue SaaS gradients, no glow. KPI deltas use Meadow for up, Citrus for down. The legend uses small Mist labels with 8px colored dots.

### Avatars

Perfect circles, 32 / 40 / 56px. Edge hairline border. Use real user photography or initials in Ink on `surface-sunken`. Do not stack more than three overlapping avatars in any UI.

### Icon library

**Lucide.** Website: https://lucide.dev/. License: ISC. Used for navigation, buttons, tabs, rail items, KPI tile labels, and inline body icons. All icons render at 14-22px in `currentColor`. Pull the library at runtime via the Lucide CDN and use `<i data-lucide="name"></i>` markup, or paste official Lucide SVG markup inline. Do not invent custom paths and do not mix in another icon set.

## Do's and Don'ts

**Do:**

- Use the cloudy sky background on the hero of every page. It is the signature.
- Use exactly one Instrument Serif italic phrase per hero, set inside the headline, colored Mist.
- Make every interactive control a full pill: buttons, inputs, tabs, search, nav, chips, rail items.
- Use Ink for primary CTAs and active states; let that be the visual heaviest weight on the page.
- Use Edge as a 1px hairline on every floating surface, paired with a Tier 1 shadow.
- Use the three data accents *only* inside charts, KPI deltas, and the focus ring.
- Center the hero block above the fold; left-align body content in sections below the slab.
- Let whitespace breathe. If a region feels empty, leave it empty.
- Pair every primary CTA with one secondary CTA, never three.
- Use tabular numerals for every metric, price, and counter.

**Don't:**

- Don't place an eyebrow, kicker, category label, or tag above any heading. Lead with the headline.
- Don't use more than one italic serif phrase per page, and never set it upright or in body text.
- Don't recolor headlines or surfaces with the data accents. Signal, Citrus, and Meadow never touch typography or fills outside charts.
- Don't use sharp corners anywhere. A right angle on a control is a bug.
- Don't stack heavy shadows. The sky provides ambient lift; Tier 1 and Tier 2 are the only allowed elevations.
- Don't add decorative pills or badges ("New", "Pro", "Featured"). Pills carry real status only.
- Don't litter the page with all-caps monospace micro-labels, coordinates, version stamps, reading times, or any other "data exhaust".
- Don't use glass blur on flat content regions.
- Don't introduce linear purple-to-blue SaaS gradients. The only gradient in the system is the sky itself.
- Don't number cards (01 / 02 / 03) unless they represent a real sequential process.
- Don't wrap single sentences in cards. Use typography and whitespace to separate content.
- Don't fill empty regions with metadata to "make it look detailed."
- Don't use em dashes (—) in headings or copy; rewrite with commas or periods.
- Don't fetch Inter Tight or Instrument Serif from any provider other than Google Fonts; the imports in `system.css` are the source of truth.
