# x-lt-footer — the escalation footer, configured

A role's versioned `form_schema` can, at its root, shape the standard escalation
footer: rename its action controls and fold claim-and-submit into one gesture.
Both tokens are opt-in top-level form tokens, siblings of
[`x-lt-transition`](./x-lt-transition.md) and `x-lt-submit-guard`
([x-lt-embed.md](./x-lt-embed.md)).

## Tokens (schema root)

| Token | Type | Meaning |
|-------|------|---------|
| `x-lt-submit-on-claim` | boolean | Claiming also resolves, submitting whatever the form holds. Defaults off. |
| `x-lt-labels` | object | Per-target overrides for the footer's action labels. |

## `x-lt-labels` — configurable copy

An object whose keys are standard footer targets and whose values are the labels
to render in their place:

| Target | Default | Control |
|--------|---------|---------|
| `claim` | Claim | The claim button (unclaimed). |
| `cancel` | Cancel / Cancel escalation | The cancel control, both states. |
| `submit` | Submit / Acknowledge | The resolve button (claimed). |
| `release` | Release | The release tab. |

```jsonc
{
  "type": "object",
  "x-lt-labels": { "claim": "Claim and Submit", "submit": "Approve" },
  "properties": { /* … */ }
}
```

Only the known targets are read; unknown keys and non-string values are
ignored. Any target the schema omits keeps its default, so a schema overrides
just the controls it cares about. The pending, triage, and confirmation states
("Claiming…", "Send to Triage", "Yes, Release") keep their own copy.

## `x-lt-submit-on-claim` — the one-gesture claim

When true, clicking Claim also resolves the escalation in the same gesture,
submitting the form's current values — its seeded defaults (metadata,
`formDefaults`, or schema `default`), or a restored draft. The person advances
the work item with a single click; there is no second Submit step.

```jsonc
{
  "type": "object",
  "x-lt-submit-on-claim": true,
  "x-lt-labels": { "claim": "Claim and Submit" },
  "properties": {
    "approved": { "type": "boolean", "default": true }
  }
}
```

Claim and resolve are distinct operations — the server accepts a resolve only
from the claimant — so they run in sequence: claim, then resolve. If the seeded
defaults fail validation the claim still stands and the page drops into the
normal claimed state with the field errors in the side panel, so the person
completes the form by hand. Pair it with `x-lt-labels.claim` so the button reads
honestly ("Claim and Submit").

Use it when the standard outcome needs only a confirmation — the defaults are
the answer, and claiming is the decision.
