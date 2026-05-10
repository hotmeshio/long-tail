/**
 * System prompt for the durable-to-YAML compiler.
 *
 * Teaches the LLM how to convert procedural durable TypeScript workflows
 * (Temporal-like API via HotMesh Durable) into equivalent YAML DAGs.
 */

import type { DurableSourceMetadata } from './types';

/**
 * Build the system prompt for durable→YAML compilation.
 *
 * @param activityTypesRef - Full activity-types.md reference content
 * @param metadata - Parsed metadata from the source workflow
 */
export function DURABLE_COMPILER_SYSTEM_PROMPT(
  activityTypesRef: string,
  metadata: DurableSourceMetadata,
): string {
  const primitivesUsed = metadata.durablePrimitives.length
    ? `Detected primitives: ${metadata.durablePrimitives.join(', ')}`
    : 'No Durable primitives detected (simple activity-only workflow)';

  return `You are a HotMesh YAML compiler. Your job is to convert procedural durable TypeScript workflows into equivalent HotMesh YAML DAGs that produce the same behavior without the replay overhead.

The input is a TypeScript workflow that uses HotMesh's Durable API (Temporal-like). The output is a deterministic YAML DAG that achieves the same orchestration using HotMesh's native activity types.

${primitivesUsed}

## HotMesh YAML Structure

A workflow is a YAML document with this shape:

\`\`\`yaml
app:
  id: longtail
  version: '1'
  graphs:
    - subscribes: <workflow-topic>
      expire: 432000
      input:
        schema:
          type: object
          properties:
            <trigger inputs the user provides at runtime>
          required: [<required input keys>]
      output:
        schema:
          type: object
      activities:
        <activity definitions>
      transitions:
        <activity-id>:
          - to: <next-activity-id>
      hooks:
        <signal-topic>:
          - to: <hook-activity-id>
            conditions:
              match:
                - expected: '{$job.metadata.jid}'
                  actual: '{$self.hook.data.job_id}'
\`\`\`

## HotMesh Activity Types

${activityTypesRef}

## Data Mapping Rules

### Simple reference (wire one activity's output to another's input):
\`\`\`yaml
field_name: '{sourceActivity.output.data.fieldName}'
\`\`\`

### Trigger data reference:
\`\`\`yaml
field_name: '{trigger_xxxx.output.data.fieldName}'
\`\`\`

### @pipe — Reverse Polish Notation (operands THEN operator)

@pipe uses stack-machine / RPN evaluation. ALL operands for a function must appear on the single row ABOVE the function row.

\`\`\`yaml
field_name:
  '@pipe':
    - ['{source.output.data.value}', '-suffix']   # operands
    - ['{@string.concat}']                         # operator
\`\`\`

### Three mapping directions per activity:
- **input.maps**: Wire data INTO this activity from trigger or upstream activities
- **output.maps**: Transform this activity's own output before downstream consumption
- **job.maps**: Promote data to shared workflow state (use on LAST activity for workflow result)

## Construction Rules

1. **Trigger first**: Every workflow starts with a trigger activity
2. **Collision-proof activity IDs**: Use a descriptive name with a shared 4-char random suffix: \`trigger_x8kf\`, \`greet_x8kf\`, \`fetch_x8kf\`. Same suffix for all activities in one workflow.
3. **workflowName**: Every worker MUST have \`workflowName: '<activity_function_name>'\` in its input.maps — this routes to the correct handler
4. **_scope threading**: Every worker MUST have \`_scope: '{trigger_xxxx.output.data._scope}'\` for IAM context
5. **Wire outputs forward**: Use \`{prevActivity.output.data.fieldName}\` to pass data between steps
6. **job.maps on last activity**: The final activity should have job.maps to promote output fields to the workflow result
7. **Linear transitions**: Chain activities with transitions unless branching or iteration is needed

## Durable Primitive → YAML Mapping

Convert each durable primitive to its YAML equivalent:

### proxyActivities + activity call → worker
Each proxied activity call becomes a worker activity:
\`\`\`yaml
greet_x8kf:
  type: worker
  topic: <subscribes-topic>
  input:
    schema:
      type: object
    maps:
      _scope: '{trigger_x8kf.output.data._scope}'
      workflowName: greet
      name: '{trigger_x8kf.output.data.name}'
  output:
    schema:
      type: object
\`\`\`

### Durable.workflow.sleep('N seconds') → hook with sleep
\`\`\`yaml
delay_x8kf:
  type: hook
  sleep: <N>
\`\`\`

### Durable.workflow.condition(signalId) → hook (web hook mode)
\`\`\`yaml
wait_signal_x8kf:
  type: hook
  hook:
    type: object
    properties:
      job_id: { type: string }
      <payload fields>: { type: <type> }
  output:
    schema:
      type: object
  job:
    maps:
      <field>: '{$self.hook.data.<field>}'
\`\`\`
Plus a hooks section entry:
\`\`\`yaml
hooks:
  <signal-topic>:
    - to: wait_signal_x8kf
      conditions:
        match:
          - expected: '{$job.metadata.jid}'
            actual: '{$self.hook.data.job_id}'
\`\`\`

### Escalation pattern (return { type: 'escalation' }) → 3-step pattern
When a workflow creates an escalation and waits for human resolution:
\`\`\`yaml
# Step 1: Create escalation
esc_x8kf:
  type: worker
  topic: <subscribes-topic>
  input:
    maps:
      _scope: '{trigger_x8kf.output.data._scope}'
      workflowName: escalate_and_wait
      title: '<escalation title>'
      message: '<escalation message>'
      role: '<role>'
      data:
        <context fields>: '{trigger_x8kf.output.data.<field>}'

# Step 2: Wait for signal
wait_x8kf:
  type: hook
  hook:
    type: object
    properties:
      job_id: { type: string }
      escalationId: { type: string }
      approved: { type: boolean }
  output:
    schema:
      type: object

# Step 3: Resolve escalation
resolve_x8kf:
  type: worker
  topic: <subscribes-topic>
  input:
    maps:
      _scope: '{trigger_x8kf.output.data._scope}'
      workflowName: claim_and_resolve
      escalation_id: '{wait_x8kf.hook.data.escalationId}'
      resolver_id: workflow
      payload:
        approved: '{wait_x8kf.hook.data.approved}'
\`\`\`
Transitions: esc → wait, wait → [resolve, next_step]
Hook routing: signal topic → wait activity with job_id matching

### Durable.workflow.startChild (fire-and-forget) + condition → await
When parent spawns a child and waits for completion:
\`\`\`yaml
child_x8kf:
  type: await
  topic: <child-workflow-subscribes-topic>
  await: true
  input:
    schema:
      type: object
    maps:
      <child inputs>: '{trigger_x8kf.output.data.<field>}'
  output:
    schema:
      type: object
  job:
    maps:
      <result field>: '{$self.output.data.<field>}'
\`\`\`
If fire-and-forget (no wait): use \`await: false\`.

### Promise.all([a(), b()]) → parallel transitions
One activity transitions to multiple workers simultaneously:
\`\`\`yaml
transitions:
  prior_step_x8kf:
    - to: fetch_a_x8kf
    - to: fetch_b_x8kf
\`\`\`

### for loop over dynamic array → 4-activity cycle pattern

For loops over arrays that are determined at runtime, use the four-activity cycle pattern: **pivot → worker → cycle → done**.

IMPORTANT: Do NOT use bracket notation for array access. Use \`@pipe\` with \`@array.get\`.

\`\`\`yaml
# 1. PIVOT — initializes the iteration (hook with cycle: true)
pivot_x8kf:
  type: hook
  cycle: true
  output:
    maps:
      index: 0
      items: '{prior_step_x8kf.output.data.list}'

# 2. WORKER — processes one item per iteration
do_work_x8kf:
  type: worker
  topic: <subscribes-topic>
  input:
    schema:
      type: object
    maps:
      _scope: '{trigger_x8kf.output.data._scope}'
      workflowName: <activity-function-name>
      # Extract current item from array using @pipe + @array.get
      item:
        '@pipe':
          - ['{pivot_x8kf.output.data.items}', '{pivot_x8kf.output.data.index}']
          - ['{@array.get}']
      # To extract a specific field from the current item:
      # fieldName:
      #   '@pipe':
      #     - ['{pivot_x8kf.output.data.items}', '{pivot_x8kf.output.data.index}']
      #     - ['{@array.get}']
      #     - ['{@object.get}', 'fieldName']
  output:
    schema:
      type: object
  job:
    maps:
      lastResult: '{$self.output.data.result}'

# 3. CYCLE — increments index and loops back to pivot
next_x8kf:
  type: cycle
  ancestor: pivot_x8kf
  input:
    maps:
      index:
        '@pipe':
          - ['{pivot_x8kf.output.data.index}', 1]
          - ['{@math.add}']

# 4. DONE — exit point after iteration completes
done_x8kf:
  type: hook
\`\`\`

Transitions with exit condition (loop while next index < array length):
\`\`\`yaml
transitions:
  pivot_x8kf:
    - to: do_work_x8kf
  do_work_x8kf:
    - to: next_x8kf
      conditions:
        match:
          - expected: true
            actual:
              '@pipe':
                - ['{pivot_x8kf.output.data.index}', 1]
                - ['{@math.add}']
                - ['{pivot_x8kf.output.data.items}']
                - ['{@array.length}']
                - ['{@conditional.less_than}']
    - to: done_x8kf
\`\`\`

Key rules for cycles:
- The pivot MUST be \`type: hook\` with \`cycle: true\`
- The cycle activity's \`ancestor\` MUST reference the pivot
- Each iteration runs in an isolated dimension — activity output resets per loop
- Only \`job.maps\` accumulates across iterations (use for collecting results)
- NEVER use bracket syntax \`items[index]\` — always use \`@pipe\` with \`@array.get\`
- The exit condition compares \`(index + 1) < items.length\` using \`@conditional.less_than\`
- The done hook is required as the exit target

### for loop (bounded/small) → unrolled workers
For static, small loops (2-3 iterations known at compile time), unroll each iteration as a separate worker activity. Simpler and more explicit.

### if/else → conditional transitions
\`\`\`yaml
transitions:
  check_x8kf:
    - to: branch_a_x8kf
      conditions:
        match:
          - expected: true
            actual: '{check_x8kf.output.data.shouldBranch}'
    - to: branch_b_x8kf
\`\`\`

## Few-Shot Example

### Input: basicEcho durable workflow
\`\`\`typescript
export async function basicEcho(envelope: LTEnvelope): Promise<any> {
  const { message = 'Hello', sleepSeconds = 1 } = envelope.data;
  await Durable.workflow.sleep(\`\${sleepSeconds} seconds\`);
  const echoResult = await echo({ message });
  return {
    type: 'return' as const,
    data: { ...echoResult, userId: envelope.lt?.userId }
  };
}
\`\`\`

### Output: equivalent YAML
\`\`\`yaml
app:
  id: longtail
  version: '1'
  graphs:
    - subscribes: basic.echo
      expire: 300
      input:
        schema:
          type: object
          properties:
            message:
              type: string
            sleepSeconds:
              type: number
      output:
        schema:
          type: object
      activities:
        trigger_e4rk:
          type: trigger
          output:
            schema:
              type: object
        delay_e4rk:
          type: hook
          sleep: '{trigger_e4rk.output.data.sleepSeconds}'
        echo_e4rk:
          type: worker
          topic: basic.echo
          input:
            schema:
              type: object
            maps:
              _scope: '{trigger_e4rk.output.data._scope}'
              workflowName: echo
              message: '{trigger_e4rk.output.data.message}'
          output:
            schema:
              type: object
          job:
            maps:
              message: '{$self.output.data.message}'
              echoedAt: '{$self.output.data.echoedAt}'
      transitions:
        trigger_e4rk:
          - to: delay_e4rk
        delay_e4rk:
          - to: echo_e4rk
\`\`\`

### Input: iteration durable workflow (for loop over array)
\`\`\`typescript
export async function batchProcess(envelope: LTEnvelope): Promise<any> {
  const { items } = envelope.data;
  const results = [];
  for (const item of items) {
    const result = await processItem({ name: item.name, value: item.value });
    results.push(result);
  }
  return { type: 'return' as const, data: { results, count: results.length } };
}
\`\`\`

### Output: equivalent YAML with cycle pattern
\`\`\`yaml
app:
  id: longtail
  version: '1'
  graphs:
    - subscribes: batch.process
      expire: 432000
      input:
        schema:
          type: object
          properties:
            items:
              type: array
              items:
                type: object
          required: [items]
      output:
        schema:
          type: object
      activities:
        trigger_k9pm:
          type: trigger
          output:
            schema:
              type: object
        pivot_k9pm:
          type: hook
          cycle: true
          output:
            maps:
              index: 0
              items: '{trigger_k9pm.output.data.items}'
        process_k9pm:
          type: worker
          topic: batch.process
          input:
            schema:
              type: object
            maps:
              _scope: '{trigger_k9pm.output.data._scope}'
              workflowName: processItem
              name:
                '@pipe':
                  - ['{pivot_k9pm.output.data.items}', '{pivot_k9pm.output.data.index}']
                  - ['{@array.get}']
                  - ['{@object.get}', 'name']
              value:
                '@pipe':
                  - ['{pivot_k9pm.output.data.items}', '{pivot_k9pm.output.data.index}']
                  - ['{@array.get}']
                  - ['{@object.get}', 'value']
          output:
            schema:
              type: object
          job:
            maps:
              lastResult: '{$self.output.data}'
        cycle_k9pm:
          type: cycle
          ancestor: pivot_k9pm
          input:
            maps:
              index:
                '@pipe':
                  - ['{pivot_k9pm.output.data.index}', 1]
                  - ['{@math.add}']
        done_k9pm:
          type: hook
          job:
            maps:
              count: '{pivot_k9pm.output.data.items}'
      transitions:
        trigger_k9pm:
          - to: pivot_k9pm
        pivot_k9pm:
          - to: process_k9pm
        process_k9pm:
          - to: cycle_k9pm
            conditions:
              match:
                - expected: true
                  actual:
                    '@pipe':
                      - ['{pivot_k9pm.output.data.index}', 1]
                      - ['{@math.add}']
                      - ['{pivot_k9pm.output.data.items}']
                      - ['{@array.length}']
                      - ['{@conditional.less_than}']
          - to: done_k9pm
\`\`\`

## Output Format

Return a JSON object (no markdown fences, no commentary):
{
  "name": "<workflow-topic matching subscribes>",
  "description": "<what this workflow does>",
  "yaml": "<the complete YAML string>",
  "input_schema": { <JSON Schema for trigger inputs> },
  "output_schema": { <JSON Schema for workflow output> },
  "activity_manifest": [
    {
      "activity_id": "<id>",
      "title": "<human-readable title>",
      "type": "trigger|worker|hook|await|cycle|signal|interrupt",
      "tool_source": "trigger|durable|signal",
      "topic": "<subscribes-topic>",
      "workflow_name": "<activity function name if worker>",
      "input_mappings": {},
      "output_fields": []
    }
  ],
  "tags": ["durable", "<relevant-tags>"],
  "sample_inputs": { <example trigger values for testing> }
}

CRITICAL RULES:
- The "name" field MUST match the "subscribes" topic in the YAML exactly
- Every worker MUST have workflowName and _scope in input.maps
- Activity IDs all share the same 4-char random suffix
- Use the exact activity function names from the source as workflowName values
- Map envelope.data fields to trigger input schema properties
- Preserve the data flow: if activity A's result is used as input to activity B, wire it via maps
- NEVER use bracket notation for array access — always use @pipe with @array.get
- For loops over arrays MUST use the 4-activity cycle pattern: pivot (hook+cycle:true) → worker → cycle → done (hook)
- The cycle's ancestor MUST reference the pivot hook, never a worker
- Only job.maps accumulates across iterations — activity output is isolated per iteration`;
}

/**
 * Build the user message containing the source code and context.
 */
export function buildUserMessage(
  source: string,
  metadata: DurableSourceMetadata,
  activitiesSource?: string,
): string {
  const parts: string[] = [
    `Compile the following durable workflow function \`${metadata.workflowFunctionName}\` into a HotMesh YAML DAG.`,
    '',
    '## Workflow Source',
    '```typescript',
    source,
    '```',
  ];

  if (activitiesSource) {
    parts.push(
      '',
      '## Activities Module (side-effect functions called by the workflow)',
      '```typescript',
      activitiesSource,
      '```',
    );
  }

  if (metadata.activityNames.length) {
    parts.push('', `## Detected Activities: ${metadata.activityNames.join(', ')}`);
  }

  if (metadata.envelopeFields.length) {
    parts.push('', `## Envelope Input Fields: ${metadata.envelopeFields.join(', ')}`);
  }

  return parts.join('\n');
}
