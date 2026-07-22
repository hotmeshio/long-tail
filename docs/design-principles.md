# Design Principles

The design system behind the dashboard and every generated x-lt-* form. One
token vocabulary, one value discipline, one form doctrine — the built-in pages
and the forms customers author render from the same rules.

---

## 1. Tokens are the system

Every color, size, radius, and spacing knob flows through a `--lt-*` CSS
variable declared in `dashboard/src/styles/globals.css`. Nothing paints a raw
hex. A registered stylesheet (`branding.customCss` / `branding.themes` in
`start()`) can therefore restyle the entire product — including full dark
themes — with zero source changes. Midnight is the standing proof: if a color
escapes the token system, it glows in the dark.

Deliberate exceptions, each carrying a stated constraint in code: the
signature pad (the exported PNG is a document — ink on white), customer
iframes (their HTML assumes a white canvas), OAuth brand marks, theme-picker
swatches, and overlay scrims.

## 2. Color — the value discipline

Chroma is spent, not spread.

- **Surfaces are near-neutral.** Hover fills, sunken section bands, and
  borders carry only a whisper of the theme hue. Chroma never lands on a
  large rectangle — a colored slab makes every real accent invisible.
- **The accent appears in small doses**: links, buttons, checks, pills,
  section labels, focus states. Because it is scarce, it reads as "act here."
- **Dark themes are the same principle, inverted** — near-black neutral
  surfaces, the identical accent discipline. Midnight is not a different
  design; it is the same design at night.
- **Status is information, not decoration.** Text-safe status tokens
  (≥4.5:1) for words; brighter `-graphic` variants for dots, bars, and
  charts (≥3:1).
- **The focus fill is the one ambient accent moment** — entering a field
  earns the tint.

## 3. Text — black speaks, color acts

- One neutral near-black ramp shared by every light theme: `#171717` body,
  `#373737` labels, `#646464` helper, `#8C8C8C` low-emphasis meta. Labels are
  never theme-colored — a tinted label is indistinguishable from a link.
  If it's colored, it must be clickable.
- **11px floor.** No informative text below `text-2xs`. Quaternary tone is
  reserved for large or decorative text (≥3:1).
- **Headings**: near-black (`#333333`), small caps, weight 300, generous
  sizes — `heading-1` (2.125rem) / `heading-2` (1.5rem) / `heading-3`
  (1.25rem). The size carries hierarchy; the light weight keeps it elegant.
  Mono identifiers (role keys, workflow types, topics) stay code-styled,
  never small-caps.

## 4. Fields and controls

- **One recipe** (`.field/.input/.select/.textarea`): white body, light
  neutral border, 3px radius (`--lt-radius-field`), border deepens to accent
  and fill takes the theme tint on focus. Every field-like control uses the
  recipe or the tokens — no bespoke field styling.
- **Width follows content, capped by the measure:**
  - Generated forms hold a readable measure (`max-w-form`, 56rem). A wide
    monitor gets margin, never a 2000px input.
  - Selects size to their content, floored at 16rem for presence — a
    one-word choice never stretches across the page.
  - Number inputs hold a hand-sized 12rem.
  - Text and textarea fill their cell — prose deserves the measure.
- **Decisions are never checkboxes.** A decision is an enum opening on an
  explicit disabled **Choose…** placeholder. The user picks; nothing is an
  implicit first option, and there is no way back to unchosen.
- Checkboxes exist only inside checklists — confirmations of work, not
  choices.

## 5. Layout — the canonical shell

```
┌──────────────── Header (full width) ────────────────┐
│ left nav │        main viewport        │ right panel │
└──────────────── EventFeed (full width) ─────────────┘
```

- Header and event-stream footer span the full width. The left nav and the
  global right SlidePanel are flex siblings of the main viewport — content
  narrows when either opens; nothing overlays it. Pages fill the right panel
  via `useShellPanel()`. The DocsDrawer is the full-screen overlay for
  markdown.
- iPad (768–1366) is the floor target: page padding clamps down, the sidebar
  auto-collapses below 1024, nothing depends on hover alone.
- Structure comes from typography, whitespace, and divider lines — never
  rounded-bordered cards, never gradient fades. Sections sit on a barely
  sunken band with an accent left rule.

## 6. The form doctrine

The reference implementation is `examples/workflows/acme-stations` — mimic it.

1. **Facts first, as a dictionary.** Read-only order facts render as a dense
   label/value spec sheet (`x-lt-display: "dictionary"`), not form rows.
2. **One explicit decision** gates the form. Until it is made the page shows
   facts, the decision, nothing else — even sign-off waits.
3. **Linear reveals.** Each outcome fades in exactly the section it needs
   (`x-lt-showIf` value matches). The enter animation makes the
   cause-and-effect visible in time: click Reject, watch the report arrive.
4. **The left/right law.** Left and Right always render side by side, Left
   first — as dictionary pairs (two-column dictionaries fill row by row, so
   consecutive items share a row) and as inputs (`x-lt-column-group` pairs
   them in one cell, the 2×2).
5. **Checklists**: standard confirmations may arrive pre-checked
   (formDefaults) — the standard is the default and the resolver unchecks
   what isn't true. The order's own custom work arrives unchecked; those
   clicks are the record. `x-lt-require-all` guards completion.
6. **Every input carries a `title` and one instructional `description`
   line.** The WHY — reference tables, consequences, vocabulary — lives in
   `x-lt-help` beside the form.
7. **Sign-off last.** A short audit note with a live counter.
8. Hidden conditional fields still submit their defaults; resolver contracts
   treat empty as absent.

## 7. Copy — the economist tone

Say what to do. One line per instruction. Consequences stated plainly
("Complete moves the order to post-print QA; Reject files a report").
Reference tables over paragraphs. Never preachy, never motivational, never
"you're the first human — do well." State what a thing is and does, never
what it lacks.

## 8. Motion

Motion explains causality; it never decorates. Reveals fade in tied to the
choice that caused them (200–300ms enter). Errors shake once and settle.
Panels slide as flex siblings so content reflows rather than being covered.
Nothing loops, nothing floats.

## 9. Accessibility floors

- Body and label text ≥4.5:1; large/meta text and graphics ≥3:1.
- Every input is label-associated; errors and helpers ride
  `aria-describedby`; the errors panel click-focuses the field
  (`data-field-key` is a contract).
- Disabled forms use `inert` — out of the tab order, not just grayed.
- `color-scheme` follows the theme so native controls match the surface.

## 10. Never

Raw hex in components. Chroma on large surfaces. Theme-colored labels.
Text below 11px. Decisions as checkboxes. Implicit select defaults.
Full-width one-word inputs. Cards and gradient fades. "Back to X" links.
Polling. Preachy copy. Customer names — the showcase brand is always Acme.
