# Iframe Viewport Protocol

For fully custom UIs — PDF viewers, complex multi-step forms, specialized domain interfaces — replace the generated form with an iframe. The iframe owns its entire surface: platform-side validation, layout, widgets, and draft persistence apply to the generated form, so the embedded app provides its own. Reach for the schema-driven form first ([choosing your surface](../hitl-guide.md#choosing-your-surface)); use the iframe when the domain demands a surface the schema cannot express.

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

When `x-lt-viewport` is present, the dashboard renders an iframe instead of the standard form. The `properties` block still defines the resolver payload shape for typing purposes.

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

// Workflow side — the wait is a normal conditionLT; the iframe submits the payload
const design = await conditionLT<{ stl_url: string }>(signalId, {
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
        payload: { approved: true, reviewed_at: new Date().toISOString() },
      }, '*');
    });
  </script>
</body>
</html>
```

---

## Security

- The iframe runs with `sandbox="allow-scripts allow-same-origin allow-forms"`
- The parent validates message origins — only messages from the iframe's declared origin are accepted
- The `envelope` field (which may contain secrets) is not sent to the iframe
- Only safe escalation metadata (`id`, `type`, `description`, `status`, `priority`, `role`) is exposed
