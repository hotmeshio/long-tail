In-memory registry of active HotMesh durable workers. Populated at startup after each `Durable.Worker.create()` call, used by the control plane to discover running workers and their task queues.

Key files:
- `registry.ts` — `registerWorker(name, taskQueue)` and `getRegisteredWorkers()` backed by an in-memory Map
