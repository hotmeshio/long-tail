# Reviewing Proposed Values (`x-lt-confidence`)

When a model fills a form (a document read, a record matched, a reading interpreted), the person who verifies it needs three things at a glance: which values the model was unsure of, what it proposed, and what they changed. `x-lt-confidence` gives a form all three, while it is worked and after it is resolved.

---

## The Inputs

The workflow proposes values in `envelope.formDefaults`, which prefill the form as usual, and scores them in `envelope.confidence`, the same shape with numbers in `[0, 1]`:

```typescript
await conditional<IntakeReviewV1>(signalId, {
  role: 'intake-verifier',
  envelope: {
    formDefaults: { applicant: { first_name: 'Jon', date_of_birth: '1987-03-04' }, account_type: 'individual' },
    confidence:   { applicant: { first_name: 0.52, date_of_birth: 0.58 },        account_type: 0.66 },
  },
  schemaVersion: 1,
});
```

Both are read in payload shape and mapped through `x-lt-bind`, so a form field bound to `applicant.first_name` reads its proposal and its score from that path.

## The Token

Declare the tranches at the schema root:

```json
{
  "x-lt-confidence": {
    "tranches": [
      { "below": 0.6, "label": "Low",   "tone": "error" },
      { "below": 0.85, "label": "Check", "tone": "warning" }
    ]
  },
  "properties": { "...": {} }
}
```

| Field | Meaning |
|-------|---------|
| `tranches` | Any number of `{ below, label, tone }`. A score falls into the first tranche whose `below` it is under; a score at or above every threshold is confident and carries no mark |
| `tranches[].below` | A threshold in `(0, 1]` |
| `tranches[].label` | The tranche's name, shown beside each field and in the review key |
| `tranches[].tone` | `error`, `warning` or `info`; defaults to `warning` |
| `scores` | The context path to the scores. Defaults to `envelope.confidence` |
| `proposed` | The context path to the proposals. Defaults to `envelope.formDefaults` |
| `facets` | `true` stamps a review summary onto the row's metadata when it resolves; see [Review Facets](#review-facets) |

`"x-lt-confidence": true` uses the default tranches: Low under 0.6, Check under 0.85. A field opts out with `"x-lt-confidence": false`; display-only widgets never take part.

## What the Form Shows

- **The tranche, on the field.** The control's rule carries the tranche tone, and a line under it names the tranche and the score: `● Low · 52%`. Focus still takes the accent, and a validation error keeps its own rule.
- **The review key, above the fields.** One entry per tranche with its count, and **Edited** with the count of changed answers out of the proposed ones. Each entry walks its fields: press **Low** and the next low-confidence field scrolls into view and takes focus.
- **What it was, while editing.** Once an answer differs from its proposal, the field shows **Edited**. Press it to see the proposed value and **Restore** it.
- **What it became, after submit.** A locked or resolved form shows each changed field as `Was ~~Jon~~ → John`, beside its tranche.

The proposal comes from the envelope, which the resolve leaves untouched, and the answer from the stored resolver payload, so a resolved row shows the same review indefinitely without storing anything extra. Answers compare as values: an empty string and a missing answer are equal, `"42"` equals `42`, text compares by its words (surrounding and repeated whitespace is not a change), and object key order is ignored. The answer is stored exactly as submitted.

## Review Facets

With `"facets": true`, the server summarizes each review when the row resolves and merges the summary into its metadata, inside the same guarded update that resolves it:

| Key | Value |
|-----|-------|
| `review_outcome` | `corrected` when any shown answer differs from its proposal, else `accepted` |
| `review_changed` | How many shown answers differ, as a string (`"3"`) |
| `review_worst` | The lowest tranche any shown field fell into (`"Low"`); absent when every score cleared |

The counts cover the fields the form shows for the submitted answer, the same set the review key counts, and use the comparison above. They are computed by the server from the role's schema, so an answer submitted through the form, the API or an MCP tool reports the same way, and they win over a caller's metadata of the same name. Values are strings, so `metadata @>` filters and analytics groupings match them exactly.

The facets need the role to enforce its schema (`enforce_schema: true`): that is when the server holds the form the answer is checked against. Every single-row resolve path stamps them. A bulk resolve applies one payload to many rows and stamps none, so those rows report no `review_outcome`, which keeps answers approved in bulk apart from reviewed ones. Rows resolved before a form opts in carry no facets, and the tranche named in `review_worst` is the one the row's pinned schema version declared.

Record what produced the proposals in the row's metadata too (`extractor: 'intake-extractor-v1'`), so reports compare one version with the next.

## Reporting

Every resolved row keeps what was proposed (`envelope.formDefaults`), how sure the model was (`envelope.confidence`), what the reviewer submitted (`resolver_payload`), who resolved it (`metadata.resolved_by`), the work time (`resolved_at - claimed_at`) and the schema version that set the tranches (`metadata.schema_version`).

**Trends** come from the review facets and the [resolved measure](../escalation-analytics.md): rows resolved in a window, per day, week or month, grouped by any facets. It is available over HTTP, the SDK, the CLI and the `aggregate_by_facets` MCP tool, so an agent can answer "compare the extractor versions' correction rates by week since October" in one call:

```typescript
await lt.escalations.aggregateByFacets({
  query: { role: 'intake-verifier' },
  groupBy: { facets: ['extractor', 'review_outcome'] },
  measure: { kind: 'resolved', window: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }, bucket: 'week' },
});
```

Group by `review_worst` to see how often each tranche led to a correction, or by `review_changed` for a histogram of edits per review. `search_by_facets` with `{ "review_outcome": "corrected" }` lists the rows behind a count.

**Per-field detail** (which fields are corrected most, and how often each score band was right) reads the row columns directly. Run it on a read replica or warehouse copy: it compares every scored field of every row in the window. This query walks the scores, so a field with a proposal and no score is left out, and it compares stored JSON strictly (`"42"` differs from `42`, and whitespace counts):

```sql
WITH RECURSIVE scored AS (
  SELECT e.id, ARRAY[k] AS path, v
  FROM lt_escalations e, jsonb_each(e.envelope->'confidence') AS t(k, v)
  WHERE e.role = 'intake-verifier' AND e.status = 'resolved'
    AND e.resolved_at >= '2026-10-01' AND e.resolved_at < '2026-11-01'
  UNION ALL
  SELECT s.id, s.path || t.k, t.v
  FROM scored s, jsonb_each(s.v) AS t(k, v)
  WHERE jsonb_typeof(s.v) = 'object'
)
SELECT array_to_string(s.path, '.') AS field,
       width_bucket((s.v)::numeric, 0, 1, 10) AS score_band,
       count(*) AS reviewed,
       count(*) FILTER (
         WHERE (e.envelope->'formDefaults' #> s.path) IS DISTINCT FROM (e.resolver_payload #> s.path)
       ) AS corrected
FROM scored s JOIN lt_escalations e ON e.id = s.id
WHERE jsonb_typeof(s.v) = 'number'
GROUP BY 1, 2
ORDER BY 1, 2;
```

The role and `resolved_at` range use the resolved-rows index; the comparison runs once per scored field.

## In the Workflow

The same rules are exported for workflow and agent code, so a workflow can record what a person corrected, the feedback a model's next round learns from:

```typescript
import { differsFromProposal } from '@hotmeshio/long-tail';

const corrections = Object.entries(flat(proposed))
  .filter(([path, value]) => differsFromProposal(value, get(review, path)));
```

`readConfidenceSpec`, `buildFormReview`, `summarizeReview` and `buildReviewFacets` are exported beside it.

## With Documents

A review usually sits beside the document it checks. Name the files on the escalation and show them in a split form; see [files.md](files.md).

## Reference Example

`examples/workflows/document-intake/` is the canonical reference: a split form with the application and ID card in the pane, nine scored proposals in two tranches, review facets and the extractor version on the row, and an activity that records each correction. Invoke `documentIntake` with `{ "data": { "applicationId": "APP-1043" } }`.
