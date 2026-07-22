# Design

Long-tail ships one design system. The built-in pages and every form generated
from your schemas render from the same rules, so a form you author with plain
JSON Schema and `x-lt-*` tokens arrives already styled, responsive, accessible,
and themed. This page explains the principles in the terms that matter when you
author schemas and copy, the rules the renderer applies to errors, and how a
deployment plugs its own stylesheet in through static config.

The full internal doctrine lives in
[`docs/design-principles.md`](../design-principles.md); the reference form
implementation is `examples/workflows/acme-stations`.

---

## The principles, from the author's seat

### Tokens carry everything

Every color, size, radius, and spacing value in the product flows through a
`--lt-*` CSS variable. Your schemas never mention style — they declare
structure (`title`, `description`, sections, `x-lt-*` tokens) and the renderer
supplies the design. This is what makes theming total: a registered stylesheet
restyles the dashboard and your generated forms in one stroke, including full
dark themes.

### Color means "act here"

Surfaces stay near-neutral with a whisper of the theme hue; the saturated
accent appears only in small doses — links, buttons, checks, focus states.
Because color is scarce, anything colored reads as actionable. The same rule
governs your content: labels and copy render near-black, status renders through
the status tokens, and the accent marks the interactive. A form that "adds
color" through its copy fights the system; a form that relies on structure gets
the emphasis for free.

### Text: black speaks, color acts

Labels resolve from your schema (`title` first, then title-cased keys — see
[form.md](form.md)) and render in the neutral near-black ramp. Headings are
small-caps, light-weight, generously sized; section names you declare in
`x-lt-section-options` render in that voice. Nothing informative renders below
11px.

### Fields behave by declaration

- **Width follows content.** Forms hold a readable measure; selects size to
  their options; numbers stay hand-sized; prose fields fill their cell. You
  never set widths.
- **Decisions are enums.** A decision field renders as a select opening on an
  explicit disabled **Choose…** placeholder — the resolver picks; nothing is
  an implicit default. Model decisions as `enum`, never as booleans.
- **Checkboxes are confirmations of work**, and they live in checklists.
  Sentence-length require-all rituals render one per row; short pick-any tags
  (reasons, categories) flow as selectable chips. The renderer chooses from
  your item lengths and `x-lt-require-all`; override with `x-lt-variant`.
- **Required is marked everywhere.** Every field in `required` — and every
  require-all checklist — carries the red asterisk. Declare `required`
  honestly and the form communicates it uniformly.

### The form doctrine

The shape that makes a resolver fast:

1. **Facts first, as a dictionary** — read-only work-item facts render as a dense
   spec sheet (`x-lt-display: "dictionary"`), not as form rows.
2. **One explicit decision gates the form** — until the outcome is chosen,
   the page shows facts and the decision, nothing else.
3. **Linear reveals** — each outcome fades in exactly the section it needs
   (`x-lt-showIf`), so cause and effect are visible in time.
4. **Pairs render side by side** — `x-lt-column-group` keeps Left and Right
   together; two-column dictionaries fill row by row.
5. **Sign-off last** — a short audit note closes the form.

### Responsive comes free

Geometry follows the container, not the viewport. Your dictionary reflows from
paired columns to stacked labels as space narrows; tables fold into dense
console cards instead of ever scrolling horizontally; the form grid drops to
one column when a side panel narrows it. Authors declare structure once; every
width from an iPad to a wall monitor is handled.

---

## Error display

Errors follow fixed rules; your schema and copy determine only their content.

**At the field.** The first failing check on a visible field renders inline:
the control's border turns to the status-error token, the field shakes once and
settles, and the message appears beneath the control. Format guards fire on
blur; everything else fires on submit. The message rides `aria-describedby`,
so screen readers announce it with the field.

**The errors panel.** A blocked submit opens the right-side panel with the
full list — one row per issue, showing the field's label (derived exactly as
the form derives it, so `title` pays off here too) and the message. Clicking a
row scrolls to and focuses the field. The panel is `aria-live`; the count
("3 issues to resolve") updates as fixes land.

**Server enforcement, same surfaces.** Roles with schema enforcement enabled
validate the submission server-side and reject invalid payloads with a
canonical `422` carrying per-field errors. The form maps those onto the same
inline and panel surfaces — a resolver sees one error language whether the
check ran in the browser or on the server.

**Hidden fields are exempt.** Fields hidden by `x-lt-showIf` at submission
time are skipped by required validation — an unchosen branch never blocks the
chosen one.

**Error copy is instruction.** An error message states the fix, in the
imperative, in one line: "Enter a quantity between 1 and 4." It names what to
do next, never narrates what went wrong at length, and never speaks as the
system ("invalid input detected"). When you supply custom validation messages,
write them as the direct instruction the resolver should follow.

---

## Recommendations — write instructions that work

The renderer guarantees the anatomy: label, one instruction line, control, in
that order, for every input. Your job is the words. The tone is a sparse
economist: say what to do, to the actor, and stop.

| Write | In place of |
|-------|-------------|
| Pick Reject to file a report | Reject files a report |
| Confirm each custom item on the widget | Items should be confirmed |
| Enter the count from the work ticket | Quantity field |
| Resolve — the widget moves on to final QA | When resolved, the widget will be moved on |

- **Every input carries a `title` and one `description` line.** The
  description is the instruction: imperative, actor-addressed, one line.
  Inputs sharing a row should carry instructions of similar length so their
  controls align.
- **Consequences ride the same sentence.** "Pick Complete to send the widget
  to final QA" tells the actor what to do and what happens, in one
  breath. A second sentence is almost always the start of a paragraph nobody
  reads.
- **The escalation `description` is a title, not a sentence.** It names the
  artifact — "Addons — ACME-1042 · wgt-8127" — because it becomes the detail
  page's heading and the list's summary line.
- **The WHY lives in `x-lt-help`.** Reference tables, vocabulary, and
  decision consequences belong in the side panel, in markdown, where the
  resolver can consult them without the form carrying paragraphs. Keep it
  factual; skip the motivation.
- **Let defaults do the routine work.** Standard confirmations arrive
  pre-checked via `formDefaults` — the resolver unchecks what isn't true.
  The work item's own custom items arrive unchecked; those clicks are the record.

---

## Plugging in a stylesheet

A deployment takes control of the design system through the `branding` block
of the static start config. `customCss` is appended to the dashboard
stylesheet; `themes` registers full themes that join the header theme picker
alongside the built-ins. Both are served at `GET /api/settings/custom.css` and
load before first paint.

```typescript
import { start } from 'long-tail';

await start({
  // ...database, workers, roles...
  branding: {
    appName: 'AcmeAdmin',

    // Targeted overrides — adjust tokens globally.
    customCss: `
      :root {
        --lt-radius-field: 6px;
        --lt-measure-form: 48rem;
      }
    `,

    // A full registered theme. Author every --lt-* token under the
    // [data-theme] selector; the id becomes the data-theme attribute and
    // the theme appears in the header picker with its swatch.
    themes: [
      {
        id: 'acme-slate',
        label: 'Acme Slate',
        swatch: '#334155',
        dark: true,
        css: `
          [data-theme='acme-slate'] {
            color-scheme: dark;
            --lt-color-scheme: dark;

            --lt-surface: 15 23 42;          /* page wash */
            --lt-surface-raised: 30 41 59;   /* header, sheets */
            --lt-surface-sunken: 10 16 30;   /* section bands */
            --lt-surface-hover: 40 53 74;
            --lt-surface-border: 51 65 85;

            --lt-field-bg: 34 46 66;         /* fields step lighter than the page */
            --lt-field-border: 71 85 105;
            --lt-field-focus: 41 56 81;

            --lt-accent: 125 170 255;
            --lt-accent-hover: 155 190 255;
            --lt-heading: 170 200 255;

            --lt-text-primary: 233 238 248;
            --lt-text-secondary: 185 197 219;
            --lt-text-tertiary: 140 155 182;
            --lt-text-quaternary: 105 120 148;
          }
        `,
      },
    ],
  },
});
```

Values are RGB triplets (`15 23 42`, not `#0F172A`) so the system can apply
alpha through `rgb(var(--lt-*) / <alpha>)`. The bundled Midnight theme
(`examples/themes/midnight.ts`) is a complete worked example covering every
token family — surfaces, fields, accent, text ramp, and the status family —
and is registered through this exact mechanism; deployment themes are
first-class in the same way.

Keep the elevation logic when authoring a theme: the page carries the wash,
sections are distinct surfaces on it, and fields step away from their surface
— darker than the sheets in a light theme, lighter than the shade in a dark
one. A theme that holds those relationships inherits the whole system's
legibility; the tokens make it a matter of picking six surface values.
