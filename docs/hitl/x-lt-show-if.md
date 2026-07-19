# Conditional Visibility

## `x-lt-showIf`

A field can be shown or hidden based on a value in the escalation context. Apply `x-lt-showIf` to any property:

```json
"x-lt-showIf": "domain.path"
```

The value at `domain.path` is evaluated for truthiness. If truthy, the field shows; if absent, null, false, or an empty string, it is hidden. Prefix `!` to invert — show when the value is absent or falsy.

### Domains

| Domain | Resolves against |
|--------|-----------------|
| `metadata` | The row's metadata dict |
| `payload` | The escalation context payload (`escalation_payload`) |
| `envelope` | The workflow-sent input envelope |
| `escalation` | Top-level escalation row fields (`role`, `status`, `priority`, …) |
| `resolver` | The submitted resolver payload — **live**: reacts in real time as the user edits the form |

Conditions based on `metadata`, `payload`, `envelope`, and `escalation` are static (read from the stored row). Conditions based on `resolver` are dynamic — the field appears or disappears immediately as the user edits a sibling field, without a page reload.

### Item type branching

A queue that receives both regular items and a special signal type. The payload carries `crew_pill` to distinguish them:

```json
{
  "title": "Worker Station",
  "properties": {
    "action_taken": {
      "type": "string",
      "enum": ["completed", "deferred", "escalated"],
      "description": "Outcome for this work item",
      "x-lt-showIf": "!payload.crew_pill"
    },
    "notes": {
      "type": "string",
      "format": "textarea",
      "x-lt-showIf": "!payload.crew_pill"
    },
    "shutdown_ack": {
      "type": "boolean",
      "title": "Acknowledge shutdown",
      "description": "Confirm you are stopping work and clearing the station",
      "x-lt-showIf": "payload.crew_pill"
    }
  }
}
```

### Approval/rejection — live conditional required

`rejection_reason` is hidden when `approved` is checked. Because the condition targets `resolver.approved`, the field appears immediately when the user unchecks the toggle — no submit needed. The `required` array marks `rejection_reason` as required — the required check is skipped for fields hidden by `x-lt-showIf`:

```json
{
  "title": "Quality Review",
  "x-lt-order": ["approved", "rejection_reason", "notes"],
  "required": ["rejection_reason"],
  "properties": {
    "approved": {
      "type": "boolean",
      "description": "Approve this submission"
    },
    "rejection_reason": {
      "type": "string",
      "format": "textarea",
      "description": "Explain why this submission is not approved",
      "x-lt-showIf": "!resolver.approved"
    },
    "notes": {
      "type": "string",
      "format": "textarea",
      "description": "Reviewer notes"
    }
  }
}
```

In the workflow, guard the payload fields before accessing them:

```typescript
const decision = await conditionLT<{
  approved: boolean;
  rejection_reason?: string;
  notes?: string;
}>(signalId, { role: 'quality-reviewer', /* ... */ });

if (!decision.approved) {
  await sendForRework({ reason: decision.rejection_reason, notes: decision.notes });
} else {
  await advanceOrder();
}
```

### Submission behavior

Hidden fields are not rendered but their values (if any) remain in form state and are submitted only if they were filled before being hidden. Required validation is not applied to fields hidden at submission time.

---

## `x-lt-hide-if-empty`

A field with `"x-lt-hide-if-empty": true` is suppressed entirely when its value is null, an empty string, `false`, or `0`. This is primarily useful for `readOnly` fact fields that are only present on some escalations:

```json
{
  "properties": {
    "heel_raise": {
      "type": "string",
      "readOnly": true,
      "x-lt-hide-if-empty": true,
      "description": "Heel raise specification"
    },
    "notes": {
      "type": "string",
      "readOnly": true,
      "x-lt-hide-if-empty": true,
      "description": "Additional processing notes"
    }
  }
}
```

`x-lt-hide-if-empty` is evaluated against the field's current value in form state. It is distinct from `x-lt-showIf`, which evaluates against a path in the escalation context.
