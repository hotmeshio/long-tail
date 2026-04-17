Pluggable event bus for publishing workflow lifecycle events (milestones, task state changes, escalations, workflow completions). Uses an adapter pattern — multiple adapters can be registered and events fan out to all of them.

Key files:
- `index.ts` — `LTEventRegistry` singleton: `register(adapter)`, `connect()`, `publish(event)`, `disconnect()`, `clear()`
- `publish.ts` — Typed publish helpers: `publishMilestoneEvent()`, `publishTaskEvent()`, `publishEscalationEvent()`, `publishWorkflowEvent()`. All are fire-and-forget (errors swallowed).
- `memory.ts` — `InMemoryEventAdapter`: captures events in an array for test assertions
- `nats.ts` — `NatsEventAdapter`: publishes JSON payloads to NATS subjects (`lt.events.{type}`)

No SQL or LLM prompts. Event types are defined in `types/index.ts` (`LTEvent`, `LTEventAdapter`, `LTEventType`).
