# Label Sheets

Every physical thing a floor acts on carries a printed scan code: locations,
containers, stations, machines, and the badges people scan to act. Label sheets print
those codes from the scan schemes that read them, on office printers (A4 and
Letter label stock, ID card stock) and thermal printers (ZPL).

A label is a heading, up to two lines of text, and one to four codes for one
target, each printed beside the act it names. A container label can print
**Check in** and **Check out** side by side; the person scanning chooses the
act by choosing which code to scan. The text is whatever the target's facts
say: the platform has no notion of what a target is.

## Contents

- [Templates](#templates)
- [Targets](#targets)
- [Media and layout](#media-and-layout)
- [Output](#output)
- [Checking codes before printing](#checking-codes-before-printing)
- [Badges are credentials](#badges-are-credentials)
- [Who may print](#who-may-print)
- [The label ledger](#the-label-ledger)
- [Printer transports](#printer-transports)
- [Declaring templates in code](#declaring-templates-in-code)
- [Agents](#agents)

## Templates

A template says what one label shows, for one scan scheme. Templates print
codes the platform mints: schemes with `fixed` or `delimited` encoding.

| Field | Meaning |
|---|---|
| `codes` | 1 to 4 of the scheme's rules, in print order. Each has a `caption` (default: the rule's name) and a `tone`: `solid` (white text on a black band), `outline`, or `plain`. Tones tell neighbouring codes apart on black-only stock. |
| `text.title`, `text.lines` | A heading and up to two lines, written in label tokens. |
| `symbology` | `code128` (default; shelves scanned from a distance), `qrcode`, or `datamatrix` (small labels). |
| `human_readable` | Print the code as text under its symbol. |
| `media` | The default media preset for this template. |
| `sensitive` | Printing confirms first and records who and what the labels name. Always true on an identity scheme. |

Label tokens:

| Token | Value |
|---|---|
| `{target}` | The code's target (action schemes). |
| `{item.<facet>}` | A facet of the row the target came from, or a column of a pasted list. |
| `{user.display_name}`, `{user.name}`, `{user.email}`, `{user.roles}`, `{user.<property>}` | The badge holder (identity schemes). |
| `{scheme.name}` | The scheme's name. |

A token with no value prints empty, and the preview warns about it
(`missing_token`, naming the facts the label does have). Captions take tokens
too; a caption left blank prints the rule's name as written. Identity
credentials never print as text:
`{target}` and `{user.<identity key>}` are refused on identity templates.

Manage templates on **Admin → Scan Codes → (scheme) → Labels**, through
`PUT /api/labels/templates/:name`, or with the `upsert_label_template` MCP
tool. Every write bumps the template's `revision`; an edit that names
`expected_revision` is refused when someone else saved first.

## Targets

A print job is a template plus a source of targets:

| Source | Targets |
|---|---|
| `{ kind: 'range', prefix, from, to, pad, suffix }` | A numbered run: `A-01` to `A-40`. Targets can be printed before anything else is known about them. |
| `{ kind: 'list', text }` | One target per line. A header row starting with `target` names the other columns, which fill `{item.<column>}`. |
| `{ kind: 'escalations', ids }` | Rows selected in a list. Each row is read as the caller; its metadata fills `{item.*}`. |
| `{ kind: 'facets', query }` | Every row a faceted search returns, searched as the caller. The newest row per target wins. |
| `{ kind: 'users', userIds, role }` | Users carrying the identity scheme's key: the ids given, everyone in `role`, or with neither, every badge holder. The only source an identity template accepts. On **Accounts**, **Print badges** prints the selected users, or with none selected, everyone or everyone in a role. |

A job holds at most `LT_LABELS_MAX_PER_JOB` labels (default 1000) and at most
`LT_LABELS_MAX_CREDENTIALS_PER_JOB` badges (default 200).

## Media and layout

Shipped presets (`GET /api/labels/media`):

| Family | Presets |
|---|---|
| A4 | `a4-l7160` (21 per sheet), `a4-l7163` (14), `a4-l7165` (8), `a4-l7173` (10), `a4-l7651` (65), `a4-a6` (4), `a4-placard` (1), `a4-cr80` (10 ID cards) |
| Letter | `letter-5160` (30), `letter-5163` (10), `letter-22805` (24 squares), `letter-placard` (1), `letter-cr80` (8 ID cards) |
| Thermal | `thermal-4x6`, `thermal-4x2`, `thermal-2x1` at 203 dpi |

A job prints on the media it names, then the template's media, then the
deployment default (`LT_LABELS_DEFAULT_MEDIA`, `a4-l7160` unless set). A job
can also pass a custom grid: page size, rows and columns, label size,
margins and gutters, all in millimetres.

Per job:

- `startPosition` skips used labels on the first sheet (counted from 1).
- `copies` prints each label several times, together.
- `onePerPage` puts each label on its own page (placards).
- `cutMarks` prints trim marks for card stock.

Labels lay out to fit their box. When a code would print below the stock's
minimum bar width (`minModuleMm`, 0.25 mm on the presets) or without its blank
margin, the job reports a `scale` or `quiet_zone` warning.

## Output

`POST /api/labels/issue` delivers a job as:

| `output` | Result |
|---|---|
| `sheet` | The laid-out sheet as JSON. The dashboard prints it through the browser at exact size. |
| `pdf` | A PDF at the media's exact page size. |
| `zpl` | ZPL for thermal media, using the printer's own barcode commands. |
| `transport:<name>` | Sent through a registered [printer transport](#printer-transports). |

PDF text uses Helvetica, which covers Latin names with accents. A deployment
that prints names in other scripts registers a font with
`start({ labels: { font: { regular, bold } } })`.

## Checking codes before printing

A preview (`POST /api/labels/preview`) lays out the job without printing or
recording it, and lists a warning for every label that would fail on the floor:

- `unparseable`: the code does not read back as its scheme, or the scheme is disabled.
- `rule_disabled`: the code's rule is disabled; scanning it does nothing.
- `unresolved`: the target names no row today, or the badge holder is not an active user.
- `missing_token`: the heading, a line or a caption reads `{item.<facet>}` or `{user.<key>}`, and the label's data has no such value.
- `scale`, `quiet_zone`, `overflow`, `unencodable`: the code or text does not fit the label.

The dashboard prints only after a preview of the same choice. In Chrome, the
preview can also decode every code on screen and report any it cannot read
back.

## Badges are credentials

An identity scheme's code acts as a person, so printing one follows its own
rules:

- Only a credential issuer may print or reissue a badge (see [Who may print](#who-may-print)).
- A badge preview is masked: it shows where each code goes, never the code.
- Printing asks for confirmation (`confirm: true`), and the ledger row naming the requester and every holder is written before any code is composed.
- Badge codes travel in response bodies with `Cache-Control: no-store`, never in URLs, and never in logs or the ledger.
- User reads (`GET /api/users`, `GET /api/users/:id`, user writes' responses) leave identity keys out of `metadata` and list them in `identity_bound`.
- Setting or removing an identity key by hand (`PATCH /api/users/:id/properties`) needs the same access and is recorded as a `bind`.
- Badge scans are unchanged: a scanned token resolves against `lt_users.metadata` on the server, as before.

The user API protections (the last two points, and the refusal of identity keys
in wholesale `metadata` writes) are on by default.
`start({ labels: { protectIdentityKeys: false } })` or
`LT_PROTECT_IDENTITY_KEYS=false` keeps the earlier users API behavior; badge
printing and reissue still need `credentialIssuer`. Either way, a `metadata`
replace keeps the identity keys it leaves out.

**Reissue** (`POST /api/labels/badges/reissue`) mints a new credential that
fits the scheme's encoding, writes it and its ledger row in one statement, and
prints the new badge. On a delimited identity scheme the credential is
`target_length` random characters (8 to 64, default 10; **Badge length** on
the scheme page), and the badge encodes it with its prefix, for example
`14:0:7KQ2M9XW4H`. On a fixed scheme it is `target_length` digits. Badges of
any length keep scanning; the length only shapes new ones. Ten characters keep
a Code 128 badge on an ID card comfortably above the minimum bar width. The old code resolves to no one from that moment. An
acting grant minted from the old badge before the reissue lasts until its
`grant_ttl_seconds` runs out.

## Who may print

| Labels | Access |
|---|---|
| Item labels (action schemes) | Admin access or role management (admin, superadmin, the `engineer` role). |
| Badges (identity schemes) | The `credentialIssuer` capability: superadmin, or a holder of the `credential-issuer` role. Admin type alone does not grant it. |
| Templates | Role management to write; any signed-in user to read. |

## The label ledger

Every print, reissue and binding is a row in `lt_label_jobs`: who asked, when,
the template and its revision (with a snapshot), the media and output, and
what the labels name: targets for item labels, user ids for badges. Rows are
never deleted by the platform; the only columns it updates are the delivery
stamps of a transport job.

**Admin → Label History** (`GET /api/labels/jobs`) lists the ledger.
Credential issuers see every row; other readers see item jobs and their own.
**Print again** (`POST /api/labels/jobs/:id/reprint`) prints a job, or chosen
labels of it, again from its source with the template as it is now, and
records a new job. A badge reprint confirms again.

An `idempotencyKey` on an issue request makes it safe to repeat, which is what
a workflow activity retry does. The repeat records nothing new and prints only
the labels the first request recorded:

- A sheet, PDF or ZPL output renders those labels again.
- A transport output is sent under a delivery lease. Claiming the lease is one
  statement, so concurrent repeats send once. A job already delivered is not
  sent again. A job whose send failed, or whose sender stopped before the
  transport accepted, is sent by the next repeat once its lease
  (`LT_LABELS_DELIVERY_LEASE_SECONDS`, default 120) lapses.
- A key used before for a different template or output answers `409`.

Workflow activities pass their workflow id as the key.

## Printer transports

A transport routes issued labels to a printer: a thermal printer on the
network, a print server, a watched folder. Hosts register transports by name:

```typescript
import type { LTLabelTransport } from '@hotmeshio/long-tail';

const thermal: LTLabelTransport = {
  formats: ['zpl'],
  async send({ jobId, payload, destination }) {
    await sendToPrinter(destination, payload as string);
    return { accepted: true, detail: jobId };
  },
};

start({ labels: { transports: { thermal }, defaultMedia: 'a4-l7160' } });
```

A job sends with `output: 'transport:thermal'`; `destination` on the request
passes through to `send` as given, and the transport decides what it names. A name with no registered transport is refused
before anything is recorded. `GET /api/labels/transports` lists the registered
names, and the dashboard offers **Send** when one accepts the job's format.

The examples register `storage-drop`, which writes each job to file storage at
`labels/<jobId>.<format>`.

## Declaring templates in code

Templates declare with their scheme and follow the
[code-owned configuration](code-owned-configuration.md) contract as one unit
with it:

```typescript
scanSchemes: [
  {
    version: 14,
    name: 'Container',
    target_facet: 'containerId',
    encoding: 'delimited',
    rules: [
      { category: '0', name: 'Check in', steps: [/* … */] },
      { category: '1', name: 'Check out', steps: [/* … */] },
    ],
    labels: [
      {
        name: 'container',
        title: 'Container',
        codes: [{ category: '0', tone: 'solid' }, { category: '1', tone: 'outline' }],
        text: { title: '{target}', lines: ['{item.subtitle}'] },
        media: 'a4-l7160',
      },
    ],
  },
],
```

## Agents

The admin MCP server carries `list_label_templates`, `upsert_label_template`,
`delete_label_template`, and `render_label_sheet`. `render_label_sheet` issues
item labels as the caller, stores the PDF or ZPL in file storage, and returns
the job id, the file ref, a link valid for ten minutes, and the warnings.
It refuses sensitive and identity templates: people print badges.

The `relabel` example workflow shows labels printed from a workflow: it asks a
person for a label's second line, then prints the label with it through a
transport, keyed by its workflow id.
