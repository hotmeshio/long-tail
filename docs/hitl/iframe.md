# Iframe Viewport Protocol

For fully custom UIs — PDF viewers, complex multi-step forms, specialized domain interfaces — replace the generated form with an iframe. The iframe owns its rendering: layout, widgets, and draft persistence belong to the embedded app. The schema remains the submission contract — with [server-side enforcement](../schema-enforcement.md) on the role, every payload the iframe (or anything else) submits validates against it. Reach for the schema-driven form first ([choosing your surface](../hitl-guide.md#choosing-your-surface)); use the iframe when the domain demands a surface the schema cannot express.

---

## Schema Declaration

```json
{
  "x-lt-viewport": {
    "type": "iframe",
    "src": "https://your-app.example.com/hitl-form"
  },
  "properties": { }
}
```

When `x-lt-viewport` is present, the dashboard renders an iframe instead of the standard form. The `properties` block still defines the resolver payload shape — and with enforcement on, it is the binding contract for every submission (see Submission Rules below).

---

## URL Token Substitution

The `src` value supports `{key}` tokens — single-brace, flat key lookup. The dashboard expands them at render time using values merged from three sources, in priority order:

| Priority | Source | Field |
|----------|--------|-------|
| 1 (highest) | `escalation_payload` | Per-escalation context set by the workflow |
| 2 | `envelope` | Input envelope set by the workflow |
| 3 (lowest) | `metadata` | Row metadata |

Keys present in multiple sources resolve from the highest-priority one. A key with no match is left as `{key}` in the final URL.

### Example — CAD designer workbench

The `cad-designer` role embeds a WebGL editor. Each escalation carries `workbenchId` and `companyId` in its payload; the dashboard injects them into the iframe URL at render time:

```typescript
// Form schema on the role
const WORKBENCH_FORM_SCHEMA = {
  'x-lt-viewport': {
    type: 'iframe',
    src: `${BASE_URL}/design?workbenchId={workbenchId}&companyId={companyId}`,
  },
  properties: {
    stl_url: {
      type: 'string',
      description: 'Object-storage URL of the completed design, set by the embedded editor.',
    },
  },
};

// Workflow side — the wait is a normal conditional; the iframe submits the payload
const design = await conditional<{ stl_url: string }>(signalId, {
  role: 'cad-designer',
  description: 'Design the widget for this order.',
  escalation_payload: JSON.stringify({ workbenchId, companyId }),
});
if (design) {
  await attachDesign(design.stl_url);
}
```

At render time the dashboard produces:

```
https://editor.internal/design?workbenchId=wb-123&companyId=co-456
```

`{workbenchId}` and `{companyId}` are resolved from `escalation_payload`, which has the highest priority — so even if the same keys appear in `envelope` or `metadata`, the payload values win.

### Common token patterns

| Goal | Source to use | Token |
|------|--------------|-------|
| Per-escalation session or record ID | `escalation_payload` | `{sessionId}`, `{orderId}` |
| Tenant or company context | `escalation_payload` or `envelope` | `{companyId}`, `{tenantId}` |
| Role-wide base path (same for all escalations) | `metadata` on the escalation or schema-level constant | Embed directly in `src` |
| Configuration passed at escalation creation | `envelope` | `{formMode}`, `{locale}` |

> **Note:** The `{key}` syntax used in the `src` URL is distinct from the `{{domain.path}}` syntax used in `x-lt-help`, `x-lt-active`, and list schema templates. The URL substitution is a flat key lookup across merged sources; the template tokens do a domain-routed deep path lookup.

---

## Message Protocol

Communication happens via `window.postMessage`.

### Parent → Iframe

```typescript
// Sent when the iframe signals ready (or on load)
{
  type: 'lt:init',
  escalation: {
    id: string,
    type: string,
    subtype: string,
    description: string | null,
    status: string,
    priority: number,
    role: string,
    workflow_type: string | null,
  },
  schema: Record<string, unknown>,   // The full form schema
}

// Optional: parent requests the iframe to submit
{ type: 'lt:requestSubmit' }
```

### Iframe → Parent

```typescript
// Signal that the iframe is ready to receive init data
{ type: 'lt:ready' }

// Submit the human's response — triggers escalation resolution
{ type: 'lt:submit', payload: { approved: true, notes: '...' } }

// Escalate to a different role
{ type: 'lt:escalate', target: 'senior-reviewer' }

// Auto-resize the iframe height
{ type: 'lt:resize', height: 600 }
```

---

## Minimal Example

```html
<!DOCTYPE html>
<html>
<head><title>Custom HITL Form</title></head>
<body>
  <div id="form"></div>
  <button id="submit">Approve</button>

  <script>
    window.parent.postMessage({ type: 'lt:ready' }, '*');

    window.addEventListener('message', (event) => {
      if (event.data.type === 'lt:init') {
        const { escalation, schema } = event.data;
        document.getElementById('form').textContent =
          `Reviewing: ${escalation.description}`;
      }
    });

    document.getElementById('submit').addEventListener('click', () => {
      window.parent.postMessage({
        type: 'lt:submit',
        payload: { responseType: 'approved', reviewed_at: new Date().toISOString() },
      }, '*');
    });
  </script>
</body>
</html>
```

---

## Submission Rules — the schema is still the contract

The iframe replaces the rendering, never the contract. Declare submission
rules on the same schema that carries `x-lt-viewport`, and turn on
[`enforce_schema`](../schema-enforcement.md) for the role:

```json
{
  "x-lt-viewport": { "type": "iframe", "src": "https://your-app.example.com/hitl-form" },
  "required": ["responseType"],
  "properties": {
    "responseType": {
      "type": "string",
      "enum": ["approved", "rework", "hold"]
    }
  }
}
```

With enforcement on, the gate sits at the API — on **every** resolve surface,
not just the iframe's `lt:submit`: resolve by id, `resolve_by_metadata`,
signal-key resolves, bulk, and the MCP tools all validate the payload against
this schema before anything is written. A submission missing `responseType`
(or carrying a value outside the enum) is rejected with the canonical 422 and
the escalation stays pending. That makes the pattern defensible against
errant ingress: a bridge or event handler that resolves rows generically with
a minimal payload can never close one of these — only a caller that states an
explicit, legal `responseType` can.

The rules for making the contract airtight:

- Put the deciding field in the root `required` array and give it **no
  `x-lt-showIf`** — a field hidden by a condition is waived from `required`,
  so an unconditional field is the unforgeable part of the contract.
- An `enum` bounds the legal outcomes; each of the embedded app's action
  buttons submits one of them.
- The iframe receives the schema in `lt:init`, so the embedded app can read
  the contract it must satisfy rather than duplicating it.
- The dashboard routes an enforcement 422 into the standard errors panel, so
  a contract violation from the embedded app is visible to the operator.
- Schema versions pin at escalation creation: rows created before the rule
  existed validate against their pinned version. Drain or migrate pending
  rows when introducing a new required field to an in-flight queue.

The `cad-designer` example (`examples/seed-workbench.ts`) ships this shape:
a required `responseType` enum on the viewport schema with `enforce_schema`
on the role.

---

## Security

- The iframe runs with `sandbox="allow-scripts allow-same-origin allow-forms"`
- The parent validates message origins — only messages from the iframe's declared origin are accepted, and `lt:init` posts only to that origin
- `lt:init` carries the escalation context the embedded app needs (`id`, `type`, `description`, `status`, `priority`, `role`, `envelope`, `metadata`, `escalation_payload`) — because the envelope travels, declare only trusted `src` origins
- With `enforce_schema` on the role, a compromised or buggy embedded app still cannot resolve outside the schema's contract — the server gate validates every payload
