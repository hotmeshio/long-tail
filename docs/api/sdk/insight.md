# lt.insight

LLM-powered natural-language queries and workflow generation against connected MCP servers.

## mcpQuery

Execute a natural-language query against connected MCP servers.

```typescript
const result = await lt.insight.mcpQuery({
  prompt: 'Find all open issues labeled bug',
  tags: ['github'],
  wait: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | Yes | The natural-language query to execute |
| `tags` | `string[]` | No | Tags to scope which MCP servers are queried |
| `wait` | `boolean` | No | When true, block until the query completes; otherwise return immediately |
| `direct` | `boolean` | No | When true, bypass workflow orchestration and query the LLM directly |
| `context` | `any` | No | Additional context forwarded to the LLM |

**Returns:** `LTApiResult<any>`

**Auth:** Optional (userId forwarded to the query pipeline when provided)

---

## buildWorkflow

Generate a workflow definition from a natural-language description.

```typescript
const result = await lt.insight.buildWorkflow({
  prompt: 'Screenshot a URL, analyze the image, and store results in a spreadsheet',
  tags: ['browser', 'vision', 'sheets'],
  wait: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | Yes | Natural-language description of the desired workflow |
| `tags` | `string[]` | No | Tags to scope available MCP tools |
| `wait` | `boolean` | No | When true, block until generation completes |
| `feedback` | `string` | No | Refinement feedback on a previous generation |
| `prior_yaml` | `string` | No | YAML from a previous generation to refine |
| `answers` | `any` | No | Answers to clarifying questions from a prior round |
| `prior_questions` | `any` | No | Questions from a prior round for context |

**Returns:** `LTApiResult<any>`

**Auth:** Optional (userId forwarded to the builder when provided)

---

## refineWorkflow

Refine an existing workflow definition using feedback.

```typescript
const result = await lt.insight.refineWorkflow({
  prompt: 'Screenshot and analyze a URL',
  prior_yaml: existingYaml,
  feedback: 'Add a retry step if the screenshot fails',
  wait: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | Yes | Original natural-language description |
| `prior_yaml` | `string` | Yes | The YAML workflow to refine |
| `feedback` | `string` | Yes | User feedback describing desired changes |
| `tags` | `string[]` | No | Tags to scope available MCP tools |
| `wait` | `boolean` | No | When true, block until refinement completes |

**Returns:** `LTApiResult<any>`

**Auth:** Optional (userId forwarded to the builder when provided)

---

## describeWorkflow

Generate a human-readable description and tags for a workflow.

```typescript
const result = await lt.insight.describeWorkflow({
  prompt: 'Take a screenshot of a URL and analyze it with GPT-4 Vision',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | Yes | The workflow prompt or content to describe |
| `result_title` | `string` | No | Title from the workflow result for additional context |
| `result_summary` | `string` | No | Summary from the workflow result for additional context |

**Returns:** `LTApiResult<{ description: string, tags: string[] }>`

**Auth:** Not required
