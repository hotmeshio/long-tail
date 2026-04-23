# HotMesh Activity Types Reference

Eight activity types compose the full YAML workflow vocabulary. The builder prompt
includes **trigger**, **worker**, **hook**, and **cycle** by default. The remaining
types — **await**, **signal**, and **interrupt** — are injected when the
specification requires composition, cross-workflow signaling, or cancellation.

---

## trigger

Entry point. Exactly one per workflow. Activates when the workflow's `subscribes`
topic receives a message.

```yaml
t1:
  type: trigger
  output:
    schema:
      type: object
  stats:
    id: '{$self.input.data.workflowId}'   # optional: custom job ID
    key: '{$self.input.data.entityId}'     # optional: job key for lookups
    parent: '{$self.input.data.originJobId}'
    adjacent: '{$self.input.data.parentJobId}'
  job:
    maps:
      field: '{$self.output.data.field}'   # promote to shared job state
```

**Key properties:**
- `stats.id` — custom job ID (UUID generated if absent). Duplicate IDs throw `DuplicateJobError`.
- `stats.key` — job key for indexed lookups.
- `stats.parent` / `stats.adjacent` — link to origin and parent jobs for lineage.
- Trigger output is accessible to all downstream activities via `{t1.output.data.*}`.

---

## worker

Dispatches work to a registered callback function via topic-based routing.
Duplex (two-leg) execution: Leg 1 publishes the message, Leg 2 receives the response.

```yaml
a1:
  type: worker
  topic: my.worker.topic
  input:
    schema:
      type: object
      properties:
        x: { type: string }
    maps:
      x: '{t1.output.data.inputField}'
      workflowName: 'tool_name'              # routes to MCP tool handler
      _scope: '{t1.output.data._scope}'      # IAM context threading
  output:
    schema:
      type: object
      properties:
        y: { type: string }
  job:
    maps:
      result: '{$self.output.data.y}'        # promote to shared job state
```

**Key properties:**
- `topic` — matches the registered worker's topic binding.
- `input.maps` — transforms data from upstream activities into this activity's input.
- `output.maps` — transforms the worker's response before downstream consumption.
- `job.maps` — promotes activity data to shared workflow state. Use on the last activity for workflow result.
- Retry is configured at worker registration (not in YAML): `maximumAttempts`, `backoffCoefficient`, `maximumInterval`.

---

## hook

Versatile pause/resume activity with three operating modes:

### Mode 1: Web Hook (external signal)

Pauses the workflow until an external signal arrives on a named topic.

```yaml
wait_for_approval:
  type: hook
  hook:
    type: object
    properties:
      approved: { type: boolean }
      notes: { type: string }
  output:
    schema:
      type: object
  job:
    maps:
      approved: '{$self.hook.data.approved}'
      notes: '{$self.hook.data.notes}'
```

Requires a matching entry in the graph-level `hooks` section:

```yaml
hooks:
  approval.topic.name:
    - to: wait_for_approval
      conditions:
        match:
          - expected: '{$job.metadata.jid}'
            actual: '{$self.hook.data.job_id}'
```

Signal data is accessible via `{$self.hook.data.*}`.

### Mode 2: Time Hook (sleep)

Pauses for a specified duration in seconds.

```yaml
delay:
  type: hook
  sleep: 5
```

`sleep` supports `@pipe` expressions for dynamic delays (e.g., exponential backoff).

### Mode 3: Passthrough

When neither `sleep` nor `hook` is configured, acts as a data-mapping convergence
point. Executes immediately — no pause.

```yaml
merge:
  type: hook
  output:
    maps:
      combined: '{step_a.output.data.x}'
```

### Mode 4: Cycle pivot

When `cycle: true` is set, the hook becomes an iteration anchor that a `cycle`
activity can loop back to.

```yaml
pivot:
  type: hook
  cycle: true
  output:
    maps:
      index: 0
      items: '{prior_step.output.data.list}'
```

---

## cycle

Loops back to an ancestor hook marked `cycle: true`. Each iteration runs in an
isolated dimensional thread — activity state is fresh, but `job.maps` accumulates
across iterations.

```yaml
next_item:
  type: cycle
  ancestor: pivot                            # must have cycle: true
  input:
    maps:
      index:
        '@pipe':
          - ['{pivot.output.data.index}', 1]
          - ['{@math.add}']
```

Use conditional transitions to control when to loop vs. exit:

```yaml
transitions:
  do_work:
    - to: next_item
      conditions:
        code: 500                            # loop on error
    - to: done                               # exit on success
```

---

## await

Invokes a child workflow (sub-flow) by publishing to its `subscribes` topic.
Establishes parent-child relationship. Duplex execution: Leg 1 starts the child,
Leg 2 receives the child's final output.

```yaml
a1:
  type: await
  topic: child.workflow.topic                # must match child's subscribes
  await: true                                # wait for completion (default)
  input:
    schema:
      type: object
      properties:
        orderId: { type: string }
    maps:
      orderId: '{t1.output.data.id}'
  output:
    schema:
      type: object
      properties:
        approved: { type: boolean }
    maps:
      approval: '{$self.output.data.approved}'
  job:
    maps:
      approval: '{$self.output.data.approved}'
```

**Key properties:**
- `topic` — the child workflow's `subscribes` topic (must be in the same app).
- `await: true` (default) — blocks until child completes. Child's output becomes this activity's output.
- `await: false` — fire-and-forget. Child starts, parent continues immediately. `$self.output.data.job_id` returns the child's job ID.
- Input maps wire parent data into the child's trigger input.
- Output maps transform the child's final result.

**Fire-and-forget mode:**

```yaml
background:
  type: await
  topic: background.process
  await: false
  job:
    maps:
      childJobId: '{$self.output.data.job_id}'
```

**When to use:** Same-namespace workflow composition. The child must be another
graph in the same `app.id`. For cross-namespace invocation, use a worker activity
that calls the target as an MCP tool instead.

---

## signal

Resumes paused hook activities by delivering data. The counterpart to hook's
web-hook mode. Enables cross-workflow communication.

### Signal One (single target)

```yaml
notify:
  type: signal
  subtype: one
  topic: approval.topic.name                 # matches the hook's signal topic
  signal:
    maps:
      approved: true
      job_id: '{t1.output.data.targetJobId}'
  status: success
  code: 200                                  # 200 = close hook, 202 = keep alive
```

**Key properties:**
- `subtype: one` — targets a specific hook by topic.
- `signal.maps` — data delivered to the waiting hook (becomes `$self.hook.data`).
- `code: 200` — closes the hook after delivery. `code: 202` — keeps the hook alive for additional signals.

### Signal All (fan-out)

```yaml
notify_all:
  type: signal
  subtype: all
  key_name: parent_job_id                    # index facet to match
  key_value: '{t1.output.data.parentId}'
  signal:
    maps:
      status: complete
  scrub: true                                # clean up indexes after signal
```

Resumes all workflows sharing a common indexed key value.

---

## interrupt

Terminates a workflow. Can target the current workflow or a remote workflow by job ID.

### Self-interrupt

```yaml
cancel:
  type: interrupt
  reason: 'Validation failed'
  throw: true
  code: 410
  job:
    maps:
      cancelled_at: '{$self.output.metadata.ac}'
```

Halts the current workflow immediately. Use conditional transitions to route to
interrupt only when cancellation is needed.

### Remote interrupt

```yaml
stop_child:
  type: interrupt
  topic: child.flow.topic
  target: '{t1.output.data.childJobId}'      # job ID to interrupt
  throw: false
  descend: true                              # cascade to descendants
  job:
    maps:
      interrupted: true
```

**Key properties:**
- `target` — job ID of the workflow to interrupt. Supports `@pipe` expressions.
- `topic` — topic of the target workflow.
- `throw: true` — raises `JobInterrupted` error in the target.
- `descend: true` — cascades interruption to child/descendant workflows.
- `code` — error code (default: 410).
- Remote interrupt: current workflow continues to adjacent activities.
- Self-interrupt: current workflow terminates after this activity.

---

## Summary

| Type | Category | Legs | Purpose |
|------|----------|------|---------|
| trigger | Entry | 1 | Workflow entry point, receives input |
| worker | Duplex | 2 | Dispatches work to registered functions |
| hook | Duplex/Passthrough | 1-2 | Pause (signal/sleep), passthrough, or cycle pivot |
| cycle | One-leg | 1 | Loop back to ancestor hook |
| await | Duplex | 2 | Invoke child workflow, optionally wait |
| signal | One-leg | 1 | Resume paused hooks with data |
| interrupt | One-leg/Duplex | 1-2 | Terminate current or remote workflow |
