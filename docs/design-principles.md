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

- **Surfaces are near-neutral.** Hover fills, section bands, and borders
  carry only a whisper of the theme hue. Chroma never lands on a large
  rectangle — a colored slab makes every real accent invisible.
- **One elevation logic, both polarities.** The page carries the base wash
  (a light theme tint by day, the deep shade at night); sections and sheets
  are distinct surfaces on it (white paper by day, the deeper well at
  night); fields are wells that step AWAY from their surface (darker than
  white by day, lighter than the shade at night). Light is Midnight
  inverted — never a flat white page with white sections.
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
- **Item length and selection mode determine list geometry.**
  Sentence-length require-all *rituals* read top-down, one per row — the
  vertical stack is deliberate. Short pick-any *tags* (reasons, categories)
  flow horizontally as selectable chips: thumb-sized pills that wrap,
  selection in solid accent. Never stack six two-word items into six
  full-width rows — endless y with an empty x is a dead layout.
- **Required is marked, everywhere.** Every required input — text, select,
  number, upload, checkbox, or checkbox group — carries the red asterisk at
  its label. A require-all checklist is required by definition and marked
  like the rest. Required or optional is never a guess.

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

1. **Facts first, as a dictionary.** Read-only work-item facts render as a dense
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
   what isn't true. The work item's own custom work arrives unchecked; those
   clicks are the record. `x-lt-require-all` guards completion.
6. **Every input carries a `title` and one instructional `description`
   line — no input goes without.** The anatomy is fixed and identical for
   every input kind: label, instruction, control, in that order. The
   anatomy is a declared column, never an accident of width — the label is
   a block, so a narrow control (a number, a short select) can never ride
   sideways beside it when the instruction line is absent. Inputs that
   share a row carry instructions of similar length so their controls align
   across the row; a bare input beside an instructed one is a consistency
   defect, in both content and alignment. The WHY — reference tables,
   consequences, vocabulary — lives in `x-lt-help` beside the form.
7. **Sign-off last.** A short audit note with a live counter.
8. Hidden conditional fields still submit their defaults; resolver contracts
   treat empty as absent.

## 7. Copy — the economist tone

The escalation `description` is the detail page's title: a short noun
phrase naming the artifact — "Final QA — ACME-1042 · wgt-8127" —
never a sentence, never an instruction, never a status report.

Say what to do. Speak to the actor, in the imperative, always: "Pick Reject
to file a report" — never "Reject files a report." The system is never the
subject of an instruction, and passive voice never appears. One line per
instruction; consequences ride the same sentence ("Resolve — the widget moves
on to assembly"). Reference tables over paragraphs. Never preachy, never
motivational, never "you're the first human — do well." State what a thing is
and does, never what it lacks.

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

## 10. Responsive — geometry follows the container

1. **Geometry follows the container, not the viewport.** Side panels, the
   facet drawer, and the nav rail narrow containers below any viewport
   breakpoint — a `md:`/`lg:` variant on a content grid is a defect.
   Viewport variants are lawful only in the shell frame (header, nav rail),
   where the viewport is the container.
2. **Thresholds are named container tokens** (tailwind `containers`):
   `@dict-inline` 22rem · `@grp-cols` 26rem · `@form-cols` 34rem ·
   `@filters` 72rem · `@dict-pairs` 38rem · `@table` 48rem. Components use
   the names, never raw rem values. A fold threshold is sized for the
   HEAVIEST content its component carries — escaping to the condensed
   format early beats ever letting a bar wrap.
3. **The dictionary reflow ladder** — the poster child. The same
   label/value pairs render as: two pairs per row at `@dict-pairs`; one
   label|value pair per row at `@dict-inline`; label stacked over value
   below. Pairing order never changes across geometries.
4. **A table row IS a dictionary.** Below `@table`, tables fold into dense
   console-style cards — identity columns become the title line, the rest
   fold into label/value pairs on the dictionary ladder. **Tables never
   scroll horizontally** — master lists use `layout="fixed"` so a table
   physically cannot outgrow its container. Fixed columns cut both ways:
   **cell content never bleeds into a neighbor** — every cell clips
   (`overflow-hidden` on the `td`) and every text-bearing pill or label
   truncates with an ellipsis (`max-w-full` + `truncate`), carrying the
   full value in `title` for hover reveal.
5. **The column budget, disclosed both ways.** The floor set — identity,
   owner, urgency, age — always renders. Enrichment columns (workflow,
   metadata facets) return only when the table's container has room
   (`showFrom: '@split' | '@wall'`); below that they fold into card pairs.
   The list is a jumping-off spot: the metadata cell carries the refine
   icons — filter within the role, search across roles, shift+click to AND
   facets — the ELK-style drill the whole product surfaces.
6. **Refine icons are always visible enough to tap** — half-opacity at
   rest, full on hover. Hover-only affordances do not exist on the floor.
7. **Disclosure order**: drop priority-3 columns, fold priority-2 into
   pairs, keep priority-1 always.
8. **Touch parity**: every hover-only affordance has a tap equivalent —
   the iPad floor has no hover.
9. **The header diet ladder** (below lg): mark-only logo, icon+count links,
   secondary actions fold into the user menu, the nav rail becomes a
   drawer behind a menu button.
10. **Sticky elements are never containers** — `container-type` breaks
   `position: sticky` on the same element; wrap the geometry element
   instead.

## 11. Never

Raw hex in components. Chroma on large surfaces. Theme-colored labels.
Text below 11px. Decisions as checkboxes. Implicit select defaults.
Full-width one-word inputs. Tag lists stacked as rows. Unmarked required
fields. Inputs without instruction lines. Passive voice or system-voice
copy. Horizontal scroll. Viewport breakpoints on content grids. Cards and
gradient fades. "Back to X" links. Polling. Preachy copy. Customer names —
the showcase brand is always Acme.
