# x-lt-transition — the post-submit hand-off

A role's versioned `form_schema` can declare, at its root, that submitting one of
its escalations should pause on a friendly wait screen instead of returning to
the list — because a follow-on escalation is about to be handed to the same
person. The result feels like a multi-page form: submit, a brief "one moment…",
then the next step opens automatically.

## Tokens (schema root)

| Token | Type | Meaning |
|-------|------|---------|
| `x-lt-transition` | boolean | Opt in to the wait screen after a successful resolve. |
| `x-lt-transition-message` | markdown | Shown on the wait screen. Defaults to a generic "preparing your next step" line. |
| `x-lt-transition-max-wait-seconds` | number | How long to wait for the follow-on before the fallback runs. Clamped to 5–300; defaults to 30. |
| `x-lt-transition-done` | href template | Where to go when the step ends without a further hand-off (see below). Independent of `x-lt-transition`. |

```jsonc
{
  "type": "object",
  "x-lt-transition": true,
  "x-lt-transition-message": "**Account saved.**\n\nSetting up your preferences…",
  "x-lt-transition-max-wait-seconds": 20,
  "properties": { /* … */ }
}
```

These tokens control **only the UX**. They carry no navigation target — the
schema never names the next escalation.

## How navigation happens

The follow-on is created **born assigned** to the submitter in a single atomic
commit, using the HotMesh `condition({ assignee, durationMinutes, parentId })`
primitive:

```ts
const step1 = await conditionLT<Step1 & { $resolution?: EscalationResolution }>(sig1, {
  role: STEP1_ROLE, /* … */ schemaVersion: 1,
});
const owner = step1.$resolution?.resolvedBy;      // who resolved step 1
const parent = step1.$resolution?.escalationId;   // step 1's id — the correlation key

await conditionLT<Step2>(sig2, {
  role: STEP2_ROLE,
  assignee: owner,          // born assigned — no create-then-claim race
  durationMinutes: 30,      // a hard claim, so it stays with the owner
  parentId: parent,         // the escalation the owner is on when they submit
  schemaVersion: 1,
});
```

The engine emits a `claimed` event for the born-assigned row carrying, in a
single definitive statement:

- `data.assigned_to` — who it went to,
- `data.parent_id` — the escalation it descends from,
- `assigned_at_creation: true` — that this was a directed, system-issued
  assignment, not an interactive claim.

The dashboard navigates only when all three line up with the viewer and the page
they are on: `assigned_to === me`, `parent_id ===` the escalation on screen, and
`assigned_at_creation === true`. An unrelated assignment or a claim the viewer
made themselves can never redirect them.

`durationMinutes` matters: an `assignee` with no window is a soft routing hint
that others may still claim, so a directed hand-off arms a claim window to keep
the follow-on with its owner.

## Where "done" goes — `x-lt-transition-done`

A step reached via a forward transition can't rely on `history.back()` — there is
no meaningful "back". So a terminal step (or any form) can declare where to go on
submit:

```jsonc
{ "x-lt-transition-done": "/escalations/available?role=onboarding-step-1" }
```

The value is an href template with the same `{{domain.path}}` interpolation and
routing rules as [`x-lt-href`](./x-lt-embed.md): an internal path navigates in-app,
anything else opens externally. It can be a plain page or a **rich faceted
worklist** URL (facets, role, assignment) — e.g. drop the operator onto the queue
of items still waiting. It is purely client-side: no server call, no event.

Resolution order on submit: `x-lt-transition` (wait for the hand-off) →
`x-lt-transition-done` (go to the declared destination) → `history.back()`. On a
transition step, `x-lt-transition-done` is also where the wait lands if the
follow-on never arrives.

## If the live event is missed

Event delivery is at-most-once: a crash between the commit and the publish drops
the event. When the wait exceeds `x-lt-transition-max-wait-seconds`, the page
runs a precise fallback — the child of this escalation assigned to the viewer
(`parent_id` + `assigned_to`) — and lands on it if present; otherwise it returns
to the list.

## Reference

The `transition-chain` example workflow (`examples/workflows/transition-chain`)
is a three-step onboarding wizard: step 1 is open to the pool, and steps 2 and 3
are born assigned to the owner. Steps 1 and 2 opt into the hand-off; step 3 is
terminal. See also `x-lt-submit-guard` in [x-lt-embed.md](./x-lt-embed.md) for
the sibling top-level form token.
