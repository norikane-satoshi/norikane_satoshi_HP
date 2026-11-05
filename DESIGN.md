# NCS Grading Design Contract

The visual design contract for `norikane-satoshi/norikane_satoshi_HP`. Agents read this before changing any UI.

`AGENTS.md` says how to work in the repository; this file says what the site looks like. The executable source of
every token and utility is `src/app/globals.css`; this file names them and says when to use them, and never copies
their values. When the two disagree, the implementation wins and this file is fixed.

## 1. Theme: noir (whole site, 2026-11-05)

The site is the portfolio of Satoshi Norikane, colorist; the operating entity is 合同会社のりかね映像設計室
(founded 2026-09-03). It has one theme: a dark, editorial "noir" look.

- Ink ground (`--bg-base`), ivory text (`--text-primary`, `--text-muted`), no accent hue. Colour comes from the
  work stills and videos. `color-scheme: dark` gives dark native controls.
- Separate content with whitespace and 1px rules (`--hp-color-rule`, `.hp-rule-top`, `.hp-rule-bottom`,
  `.hp-section-heading-row`), not glass cards. Panels are used only where the UI needs one (calendar, forms, chatbot).
- Calm, professional, text-first. Avoid neon, heavy gradients, heavy shadows, and loud SaaS landing-page patterns.

### 1.1 Tokens and utilities

- Surfaces: `--glass-bg`, `--hp-color-surface-raised` (solid panel, dialogs), `--hp-color-fill` /
  `--hp-color-fill-hover` (controls), `--hp-color-border` / `--hp-color-border-strong`.
- Calendar: `--hp-color-calendar-*`, `--hp-calendar-status-surface`. Today is red (`--hp-color-calendar-today`, the
  owner's instruction 2026-11-06; the only hue in the UI). Selected dates are ivory with `--hp-color-calendar-on-strong` text.
- Chatbot: `--hp-color-chatbot-*`. `[data-hp-chatbot-root]` (the widget and its portalled dialogs) thins
  `--glass-bg` because the chatbot stacks panels.
- Utilities: `.glass-card`, `.glass-card-sm`, `.glass-btn`, `.glass-input`, `.glass-badge`, `.glass-bar`,
  `.glass-inset`, `.glass-subpanel` (a block inside a panel; no extra blur), `.text-hp`, `.text-hp-muted`.
- Do not add colour tokens, shadows, or fonts without updating this file and `globals.css` together.
- Unavailable booking states use muted, text-derived neutrals (a faint fill and a strike), never the accent.

## 2. Typography

Fonts are loaded in `src/app/layout.tsx`.

| Role | Font | Variable |
|---|---|---|
| Japanese default and headings | Noto Serif JP | `--font-mincho` (also `--font-sans` / `--font-heading`) |
| Japanese UI and note headings | Noto Sans JP | `--font-gothic` |
| Latin display headings | Instrument Serif | `--font-latin-display` (also `--font-display`) |
| Latin labels, numbers, eyebrows | Inter | `--font-inter` |
| Code and small technical labels | Geist Mono | `--font-geist-mono` |

The site is Japanese-first:

- Body text uses relaxed line-height; no letter-spacing on Japanese body copy.
- Wide tracking only for short labels and eyebrows (`tracking-[0.22em]`).
- No blanket `break-all`; only for URLs and technical strings.
- Page titles: `.hp-heading` at `text-3xl md:text-4xl xl:text-5xl`, weight 500.

## 3. Layout

- Page shell: `.hp-section-shell` (max width 1440px, padding `px-6 md:px-10 xl:px-14`). Main top padding comes from
  `layout.tsx`.
- A page title sits in a `.hp-section-heading-row` (title and actions over a rule).
- Responsive: one column under 768px with a hamburger menu; desktop nav from 768px; full spacing from 1280px.

### 3.1 Site structure

The home page is one page with anchored sections: Hero, `/#works` (作品), `/#philosophy` (ノート), `/#profile`.
`/#press` opens the Talks & Press modal; it is not a section. Keep the page short: long lists open in a modal
(Talks & Press, the biography).

Individual pages: note articles (`/notes/<slug>`), booking (`/booking`, history, settings, edit), LINE booking
(`/line/booking`), login, signup, privacy, terms, and the public availability calendar (`/availability-calendar`).

## 4. Page guidance

- Header: `.glass-bar`, fixed, full width. The logo is inverted through `--hp-logo-filter`. Desktop nav: 作品 /
  ノート / プロフィール; the active item shows a small dot.
- Hero: full-viewport muted trailer footage. `HERO_CLIPS` in `src/components/hp/featured-works-data.ts` is the only
  list of scenes (10 s each, dip to black between). Pick scenes without burned-in text; `zoom` pushes letterbox and
  captions out of frame. Text uses `--hp-color-on-media`. It keeps moving with reduced motion on (owner's instruction,
  2026-11-04); elements that must keep transitions carry `.hp-motion-keep`. No cards over the hero.
- Featured works: a full-width, auto-scrolling row of 16:9 YouTube previews (heading and progress bar stay in the
  shell). A mouse drag anywhere in the section scrolls the row. Every work has a `youtubeId`; `loopStart`/`loopEnd` cut a video down to its clean part, and
  `fixedThumbnail` pins the cover to the official thumbnail. Do not turn it into a grid without a design review.
- Section headings: `SectionHeading` (`src/components/hp/section-heading.tsx`), a large Latin title in
  `.hp-latin-display` over a rule. No section numbers.
- Profile: `.hp-surface-band`. SNS links are `.hp-icon-badge` buttons with official icons in their brand colours;
  Talks & Press is a `.hp-icon-badge` with the microphone-and-page icon. The profile photo opens the biography
  (`src/components/hp/biography-data.ts`), written in the first person (私).
- Links: `.hp-text-link` in prose, `.hp-plain-link` with an `ArrowUpRight` icon in external lists.
- Notes list: a two-column grid (one on phones) of `.hp-note-card` links, all the same size, including external
  articles. `src/lib/hp/home-notes.ts` holds thumbnails and external articles.
- Note articles: `.hp-note-article` with `.hp-note-header` and `.hp-note-body`; text in a 46rem column, figures may be
  wider. Body copy is Mincho in `--text-muted`, headings Gothic in `--text-primary`, `h2` starts with a 1px rule.
- Booking pages: no outer card; the calendar, side panel and form keep their own panels. Past days sink into the
  ground, weekends are not tinted.
- Chatbot: the widget is shared by every page. Selected dates are ivory with ink text.

## 5. Diagram contract

Note figures are `NoteVisual` components in `src/components/notes/visuals/*.tsx` inside a `.hp-note-figure`
(a 1px rule above and below, no box).

- Drawn for the ink ground: text and lines in ivory, panels as dark translucency, category colours lightened to read
  on ink (keep hue and saturation).
- Readable in 5 seconds. Text, numbers, and glyphs are rendered in React/CSS, never baked into images.
- Animated figures play whenever they are on screen, even with reduced motion on (2026-11-05).
- Motion: an entrance when the figure first comes into view (panels rise in, curves draw on); eased moves with a short
  hold and a slight overshoot; light up only what matters now; a soft glow under lines. No red warning flashes or
  glows. `correction-control-math.tsx` is the reference implementation.

The v3 `NoteDiagram` (`src/components/notes/note-diagram.tsx`, background images in `public/notes/diagrams/`) is
still light and only used by unpublished notes; redraw it for noir before one of those notes is published.

## 6. Checklist

Before finishing UI work:

- Reuses existing tokens and utilities; no new colours, shadows, or fonts without updating this file.
- Uses the page shell; Japanese text is readable on mobile; focus states are visible.
- Meaning does not rely on colour alone.
- Desktop and mobile checked; build, lint, and tests run.
