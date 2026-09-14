# Invoke Forms

A workflow's invoke form can be the same rich, versioned form the escalation surfaces use. Declare `inputSchema` on the worker config and the Invoke Tool page renders it with the full [x-lt-* vocabulary](../hitl-guide.md#full-vocabulary-quick-reference): two-column layout, sections, column groups, conditional display, instruction blocks, dynamic options, and a help panel. The submitted `data` is the x-lt-bind mapped payload, and the invoke API validates it against the same schema with the same shared pass, so a payload the form accepts is accepted by the API, and a rejection lists the exact violations the form shows.

Without `inputSchema`, the page renders the envelope template form from `envelopeSchema` exactly as before. Nothing changes for existing deployments until a workflow opts in.

## Declaring the form

```typescript
const fleetToolsConfig: LTWorkerConfig = {
  description: '**Fleet tools** — one form, four tools for one machine.',
  invocable: true,
  invocationRoles: ['printer-fleet', 'print-servicer'],
  envelopeSchema: { data: {}, metadata: { source: 'dashboard' } },
  inputSchema: FLEET_TOOLS_INPUT_SCHEMA,
  icon: WORKFLOW_ICONS.WRENCH,
};
```

Workflow names read as titles on the page: `fleetTools` shows as **Fleet Tools**, and queue names the same way, with the identifiers kept as metadata beside them.

| Field | Role in the invoke |
|---|---|
| `inputSchema` | The form. JSON Schema `properties` plus x-lt-* tokens. Rendered by the Invoke Tool page; enforced by the invoke API. |
| `envelopeSchema.metadata` | The `metadata` stamped on every run from this form. `envelopeSchema.data` is ignored when `inputSchema` is present. |
| `invocationRoles` | Who sees the workflow on the Invoke Tool page and who may start it. Empty means every authenticated user. |
| `description` | One line at the top of the form column, markdown allowed. Keep the reference material in `x-lt-help`, which appears in the side panel on demand. |
| `icon` | A curated icon from `WORKFLOW_ICONS` (`icon: WORKFLOW_ICONS.WRENCH`). Leads the workflow's row and heading in place of the tier glyph so operators tell tools apart at a glance. The registry offers the same set as a picker. |

The registry detail page edits the same schema under **Input Form** in its Invocation column, beside a live preview of the form, and the registration wizard offers the field for new entries. The reference is [`examples/workflows/fleet-tools/forms.ts`](../../examples/workflows/fleet-tools/forms.ts): a `serialNumber` and an `action` decision, then one section per action that appears only when that action is chosen, each carrying its own knobs and its own instruction block.

## Form values, payload, and domains

The form edits flat values keyed by property name. On submit, `x-lt-bind` maps them into the nested `data` the workflow receives:

```jsonc
// properties
"serialNumber": { "x-lt-bind": "printer.serialNumber" },
"action":       { "x-lt-bind": "tool.action" },
"copies":       { "x-lt-bind": "tool.details.copies", "x-lt-showIf": "input.action=reprint-label" }

// POST /api/workflows/fleetTools/invoke
{ "data": { "printer": { "serialNumber": "printer-07" }, "tool": { "action": "reprint-label", "details": { "copies": 2 } } },
  "metadata": { "source": "dashboard" } }
```

Conditions and help tokens read the live form under the `input` domain: `x-lt-showIf: "input.action=retire"`, `{{input.serialNumber}}`. `resolver` names the same values, so a schema written for an escalation form works unchanged. The only other domain an invoke form can read is `metadata`, the envelope metadata declared above.

Hidden conditional fields still submit their defaults, as on every x-lt-* form. Treat empty as absent in the workflow.

## Conditional instructions

An instruction is a read-only markdown field. Give it the same `x-lt-showIf` as the knobs it explains and it arrives with them:

```jsonc
"powerCycleFirst": {
  "type": "string",
  "x-lt-widget": "markdown",
  "readOnly": true,
  "default": "**Power cycle first.** Most stalls clear on a restart.",
  "x-lt-section": "Report the machine offline",
  "x-lt-showIf": ["input.action=report-offline", "!input.powerCycled"]
}
```

An array of conditions requires every one, so the prompt belongs to its tool and still reacts to the checkbox.

`x-lt-help` on the schema root is the longer reference for the side panel: markdown, tables, and `{{input.*}}` tokens that re-interpolate as the operator types.

## The Invoke Tool page

The page is open to anyone the server lists an invokable workflow for. Builders reach **Invoke Tool** under Orchestrate; every other persona gets a **Tools** section in the nav that appears only when there is something to invoke. Each invokable workflow is a tool; the list sits on the left, grouped by task queue, with the first workflow preselected; the form takes the rest of the row. Below 1280px the list folds into a select and the form takes the full width.

The form's side panel carries two views: **Instructions**, the interpolated `x-lt-help`, and **Issues**, the current violations, each click focusing its field. A server rejection lands in the same Issues view.

Once a run starts, the page subscribes to `system.workflow.{workflowId}.completed` and `.failed` for that id. The outcome and the workflow's returned `data` render beside Submit, so a tool's answer comes back to the person who asked for it. Submit disarms after one click until the person chooses to submit again, and a warning offers to reconnect live events when they are off.

## The server contract

`POST /api/workflows/:type/invoke` validates `data` against `input_schema` after the role check and before anything starts. A rejection is the canonical 422 body used by every schema gate:

```json
{
  "error": "data failed input schema validation (2 violations)",
  "code": "schema_validation",
  "violations": [
    { "field": "serialNumber", "message": "Required" },
    { "field": "action", "message": "Required" }
  ],
  "role": null,
  "schemaVersion": null,
  "workflowType": "fleetTools"
}
```

The MCP tools `invoke_workflow` and `invoke_workflow_read_safe` run the same gate and return the body as an error result. The gate reads bound paths from the nested `data`, skips fields a `x-lt-showIf` hides, and applies every validation keyword the form applies.

`GET /api/workflows/invocable` returns the caller's invokable workflows with their tier. The list and the gate share one predicate, so the page never offers a workflow the API would refuse.
