# NCS Grading Design Contract

This file is the source of truth for the visual design of `norituku/norikane_satoshi_HP`.
AI coding agents must read this before creating or modifying any UI.

## 0. Role of this file

`AGENTS.md` explains how agents should work in this repository.
`DESIGN.md` explains what the site should look and feel like.

When UI-related instructions conflict, follow this order:

1. Current implementation tokens in `src/app/globals.css`
2. This `DESIGN.md`
3. Component implementations in `src/components/**`
4. Older Notion notes or historical design descriptions

The old neumorphism direction is retired. Do not reintroduce `neu-*` classes or `--neu-*` tokens.

## 1. Visual theme and mood

The site is a personal portfolio for Satoshi Norikane / NCS Grading, a freelance colorist.
The tone should be:

- light, calm, professional, editorial
- text-first and trust-building rather than flashy
- glassmorphism over a soft lavender aurora background
- controlled and spacious, not decorative for its own sake
- visually rich enough to feel current, but never noisy

Keywords: `light glassmorphism`, `aurora gradient`, `frosted white cards`, `lavender base`, `quiet professional`, `colorist portfolio`, `text-first`.

Avoid: dark cinematic UI, neon, heavy gradients, heavy shadows, cyberpunk, Apple-like over-animation, loud SaaS landing pages.

## 2. Canonical design tokens

The canonical token definitions live in `src/app/globals.css` under `:root`.
Do not invent parallel tokens unless the user explicitly asks for a design-system migration.

### 2.1 Core CSS variables

| Token | Value | Role |
|---|---:|---|
| `--bg-base` | `#F8F6FF` | Page background base |
| `--accent-primary` | `#8B7FFF` | Primary accent, active dots, glyphs, subtle highlights |
| `--accent-secondary` | `#C4B5FD` | Secondary soft accent |
| `--text-primary` | `#1C0F6E` | Main text color |
| `--text-muted` | `#6B5FA8` | Secondary text color |
| `--glass-bg` | `rgba(255, 255, 255, 0.45)` | Standard glass card fill |
| `--glass-border` | `rgba(255, 255, 255, 0.62)` | Standard glass card border |
| `--glass-shadow` | `0 8px 32px rgba(139, 127, 255, 0.15)` | Standard glass card shadow |
| `--hp-radius-sm` | `12px` | Small cards, inputs, tags, buttons |
| `--hp-radius` | `16px` | Standard cards and figure shells |
| `--hp-radius-lg` | `20px` | Larger cards |

### 2.2 Aurora background tokens

| Token | Value | Role |
|---|---:|---|
| `--aurora-purple` | `rgba(139, 127, 255, 0.28)` | Main lavender glow |
| `--aurora-pink` | `rgba(255, 143, 171, 0.20)` | Warm soft glow |
| `--aurora-sky` | `rgba(125, 211, 252, 0.20)` | Cool soft glow |

The body background is:

```css
background-color: var(--bg-base);
background-image:
  radial-gradient(ellipse at 15% 40%, var(--aurora-purple) 0%, transparent 55%),
  radial-gradient(ellipse at 85% 15%, var(--aurora-pink) 0%, transparent 45%),
  radial-gradient(ellipse at 55% 85%, var(--aurora-sky) 0%, transparent 45%);
background-attachment: fixed;
```

Do not add new aurora colors such as orange, teal, green, or neon cyan for this site.
If older notes mention orange aurora, treat that as historical and superseded by the current implementation.

## 3. Typography contract

Fonts are loaded in `src/app/layout.tsx`.

| Role | Font | Variable | Weights |
|---|---|---|---|
| Japanese / default UI | Noto Sans JP | `--font-sans` | 400, 600, 700 |
| Latin brand / numeric emphasis | Inter | `--font-inter` | 400, 600, 700 |
| Code / counters / small technical labels | Geist Mono | `--font-geist-mono` | default |

### 3.1 Japanese UI rules

This site is Japanese-first. Quality often breaks in text handling before it breaks in color.

- Body Japanese text should use relaxed line-height: usually `leading-relaxed` or `md:leading-[1.75]`.
- Do not add letter-spacing to normal Japanese body copy.
- Use wide tracking only for short labels / eyebrow text: `tracking-[0.22em]` or `tracking-[0.28em]`.
- Keep headings tight but readable: `tracking-tight` is OK for large display headings.
- Avoid `break-all` as a blanket fix. Use it only for URLs or unavoidable technical strings.
- Forms, tables, captions, and body prose must have separate density rules.

### 3.2 Type hierarchy

| Role | Typical class |
|---|---|
| Page title | `text-3xl md:text-4xl xl:text-5xl font-bold tracking-tight text-hp` |
| Hero display | `text-5xl md:text-7xl xl:text-8xl font-bold leading-[0.95] tracking-tight text-white` |
| Section heading | `text-2xl md:text-3xl font-semibold text-hp` |
| Card heading | `text-base md:text-lg font-semibold text-hp` |
| Body | `text-base md:text-lg leading-relaxed text-hp-muted` |
| Small body | `text-xs md:text-sm leading-relaxed text-hp-muted` |
| Eyebrow | `text-xs uppercase tracking-[0.22em] text-hp-muted` |
| Technical counter | `font-[var(--font-geist-mono)] text-[10px] text-hp-muted` |

## 4. Component styling contract

Use the utility classes defined in `src/app/globals.css`.

### 4.1 Standard surfaces

#### `.glass-card`

Use for main section cards, note cards, article wrappers, and major panels.

```css
background: var(--glass-bg);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border: 1px solid var(--glass-border);
box-shadow: var(--glass-shadow);
border-radius: var(--hp-radius);
```

#### `.glass-card-sm`

Use for smaller secondary cards inside a main section.

```css
background: rgba(255, 255, 255, 0.35);
backdrop-filter: blur(8px);
border: 1px solid rgba(255, 255, 255, 0.52);
box-shadow: 0 4px 16px rgba(139, 127, 255, 0.10);
border-radius: var(--hp-radius-sm);
```

#### `.glass-bar`

Use for the fixed header and mobile menu.

```css
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(14px) saturate(140%);
border-bottom: 1px solid rgba(0, 0, 0, 0.06);
box-shadow: 0 4px 20px rgba(28, 15, 110, 0.06);
```

#### `.glass-btn`

Use for buttons and icon buttons.

```css
background: rgba(255, 255, 255, 0.52);
backdrop-filter: blur(8px);
border: 1px solid rgba(255, 255, 255, 0.65);
border-radius: var(--hp-radius-sm);
color: var(--text-primary);
transition: all 0.2s ease;
```

Hover may increase opacity and use the existing purple-tinted shadow.
Active may use a slight scale down (`scale(0.98)`).
Do not create new button colors for primary/secondary states unless a full token migration is requested.

#### `.glass-input`

Use for input and textarea fields.

Focus ring must be subtle and purple-tinted:
`0 0 0 3px rgba(139, 127, 255, 0.12)`.

#### `.glass-badge`

Use for tool tags and compact labels.

### 4.2 Nesting rule

A parent `<article>` or major section may already be `.glass-card`.
Do not stack multiple blur-heavy glass cards inside each other.
Inside a glass parent, prefer:

- `bg-white/35` or `bg-white/40`
- `border border-white/55`
- `rounded-[12px]`
- no additional blur
- minimal or no shadow

This is especially important for note diagrams.

## 5. Layout principles

### 5.1 Page shell

Use this shell for main content sections:

```tsx
<section className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14">
  <div className="glass-card p-8 md:p-10 xl:p-14">
    {/* content */}
  </div>
</section>
```

Canonical width and padding:

| Item | Value |
|---|---|
| Max width | `max-w-[1440px]` |
| Horizontal padding | `px-6 md:px-10 xl:px-14` |
| Main top padding | `pt-24 md:pt-28` from `layout.tsx` |
| Section spacing | `space-y-10 md:space-y-14` or local `mt-8/10/12` |

Older notes may mention `px-4 md:px-8 xl:px-12`; the current implementation uses `px-6 md:px-10 xl:px-14` and that is the contract.

### 5.2 Current site structure

The home page is a one-page portfolio with anchored sections:

- `/` top / Hero
- `/#profile` profile
- `/#philosophy` notes (display label: ノート)
- `/#contact` contact
- schedule / password-gated calendar section

Only note articles are individual pages:

- `/notes/correction`
- `/notes/grading`
- `/notes/filmlook`

The internal anchor remains `/#philosophy` for compatibility, but the visible UI label is `ノート`.

### 5.3 Responsive behavior

| Breakpoint | Behavior |
|---|---|
| `<768px` | Single column, hamburger nav, horizontal scroll cards preserved |
| `768px–1279px` | Two-column profile layout, desktop nav |
| `1280px+` | Full spacing, wider section padding |

Horizontal scroll cards are intentional for notes and featured works. Do not convert them into dense grids without a design review.

## 6. Page-specific guidance

### 6.1 Header

The header uses `.glass-bar`, not a floating neumorphic nav.
It is fixed at the top and spans the full width.

- Brand block: avatar + `NCS GRADING` + `Norikane Colour Studio Grading`
- Desktop nav: inline links
- Active indicator: small purple dot
- Mobile nav: hamburger, then `.glass-bar` dropdown

### 6.2 Hero

Hero is the only intentionally darker / high-contrast section.
It uses a full-viewport purple visual field and white text.
It should remain restrained and cinematic only in the sense of spacious composition, not dark UI throughout the site.

Do not add glass cards over the hero unless specifically requested.

### 6.3 Notes list

Notes are horizontally scrolling `.glass-card` links.
Use `Note 01`, `Note 02`, etc. with Inter / compact tracking.

### 6.4 Note article pages

Article pages use:

```tsx
<article className="glass-card p-8 md:p-10 xl:p-14">
```

Article prose must be highly readable. Favor line-height and spacing over dense UI.
Do not add heavy visual sections inside articles unless they support reading.

## 7. Diagram design contract

Diagrams in note articles are rendered by `src/components/notes/note-diagram.tsx` and configured in `src/lib/notes/diagrams.ts`.

### 7.1 Two-layer model

Diagrams use two layers:

1. AI-generated or rendered background image in `public/notes/diagrams/<slug>.webp`
2. Semantic labels, numbers, cards, and glyphs rendered in React / CSS

Meaning must live in React/CSS, not inside generated images.
Generated images must not contain Japanese text, English text, numbers, arrows, UI screenshots, logos, or labels.

### 7.2 Figure shell

`NoteDiagram` uses:

```tsx
<figure className="my-8 overflow-hidden rounded-[16px] border border-white/55 bg-white/35 md:my-10">
```

Because the parent article is already `.glass-card`, the figure shell must not add another blur.

### 7.3 Diagram layouts

Existing layout types:

- `chaos-vs-structured` — left/right contrast
- `centered-axes` — center concept + axes + hints
- `horizontal-flow` — left-to-right process
- `keypoint-row` — 2–5 equal key cards

When adding a new diagram, first try to fit one of these layouts.
Only add a new layout if the structure truly cannot be represented by the existing four.

### 7.4 Diagram visual style

- Image base: `#F8F6FF`
- Accent: `#8B7FFF`
- Glow colors: `--aurora-purple`, `--aurora-pink`, `--aurora-sky`
- Density: spacious, readable in 5 seconds
- Forbidden: dark noir, cinematic black, neon, orange/teal extra aurora, text baked into image

## 8. Quality layers for AI agents

Use a three-layer quality model, but adapt it to this repository.

### L1 — Contract compliance (required everywhere)

A UI change fails L1 if any of these are true:

- Uses `neu-*` classes or `--neu-*` tokens
- Adds new color tokens without updating this file and `globals.css`
- Uses Tailwind default heavy shadows such as `shadow-lg`, `shadow-xl` for primary surfaces
- Adds dark sections outside the hero
- Breaks the canonical width/padding shell
- Uses fonts other than Noto Sans JP, Inter, Geist Mono
- Bakes text into diagram images
- Makes Japanese body text cramped

### L2 — Experience quality (important sections)

Required for home, profile, contact, and note article pages:

- spacing rhythm feels consistent
- hover/focus states are clear but quiet
- form errors explain what happened and what to do
- mobile layout remains readable without zooming
- horizontal scroll areas have enough padding and snap behavior
- text hierarchy is obvious without relying on color alone

### L3 — Signature moments (limited use)

Only a few places should aim for L3:

- Hero first impression
- profile identity block
- note diagrams
- future portfolio / showreel sections

L3 should not mean more effects. For this site, L3 means clarity, restraint, and memorable composition.

## 9. Do / Don't

### Do

- Use `.glass-card`, `.glass-card-sm`, `.glass-btn`, `.glass-input`, `.glass-badge`, `.glass-bar`.
- Use semantic colors: `text-hp`, `text-hp-muted`, `var(--accent-primary)`.
- Use white translucency and thin borders for internal blocks.
- Preserve the Japanese-first reading experience.
- Keep CTA language calm and professional.
- Reuse existing layouts before inventing new ones.
- Update this file when the design system changes.

### Don't

- Do not use the retired neumorphism system.
- Do not add `--neu-*`, `.neu-raised`, `.neu-inset`, `.neu-btn`, `.neu-input`.
- Do not use dark UI outside the hero.
- Do not add new aurora colors.
- Do not use thick borders or default Tailwind heavy shadows.
- Do not nest blur-heavy cards.
- Do not introduce new fonts.
- Do not make Japanese body copy tight or overly letter-spaced.
- Do not rely on color alone for meaning.
- Do not turn the portfolio into a loud SaaS landing page.

## 10. Agent implementation checklist

Before modifying UI:

- [ ] Read `DESIGN.md`
- [ ] Check `src/app/globals.css` for existing tokens/utilities
- [ ] Search for existing component patterns before creating new ones
- [ ] Decide whether the change is L1, L2, or L3

Before finishing UI work:

- [ ] No `neu-*` or `--neu-*`
- [ ] No unapproved colors or shadows
- [ ] Header still uses `.glass-bar`
- [ ] Main sections use the canonical shell
- [ ] Japanese text is readable on mobile
- [ ] Focus states are visible
- [ ] Diagrams keep text in React/CSS, not in images
- [ ] Run build/lint if code was changed

## 11. Quick prompts for agents

When asking an AI agent to build UI in this repo, use:

> Follow `DESIGN.md`. Use the existing Glass Design System in `src/app/globals.css`. Do not use the retired neumorphism rules. Reuse `.glass-card`, `.glass-card-sm`, `.glass-btn`, `.glass-input`, `.glass-badge`, and `.glass-bar`. Keep Japanese text readable and use the canonical `max-w-[1440px] px-6 md:px-10 xl:px-14` shell.

For diagrams:

> Follow the diagram contract in `DESIGN.md`. Generate only soft background imagery; put all labels, numbers, cards, and glyphs in React/CSS through `note-diagram.tsx`. Use `#F8F6FF`, `#8B7FFF`, and the three aurora colors only. No baked-in text or arrows.
