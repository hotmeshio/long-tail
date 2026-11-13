import { useSettings, type EngineSettings } from '../api/settings';

const NATIVE_ENGINE: EngineSettings = {
  provider: 'hotmesh',
  native: true,
  capabilities: { execution: true, terminate: true, list: true, start: true },
  consoleUrl: null,
};

/** The durable engine. HotMesh until settings load, and on servers that predate the field. */
export function useEngine(): EngineSettings {
  const { data } = useSettings();
  return data?.engine ?? NATIVE_ENGINE;
}

/** True when the deployment can list workflow executions: HotMesh, or a provider that lists. */
export function engineListsExecutions(engine: EngineSettings): boolean {
  return engine.native || !!engine.capabilities.list;
}

/** True when the deployment can invoke and schedule workflows: HotMesh, or a provider that starts them. */
export function engineStartsWorkflows(engine: EngineSettings): boolean {
  return engine.native || !!engine.capabilities.start;
}

/** The engine console link for a workflow, or null when no template is configured. */
export function engineConsoleUrl(engine: EngineSettings, workflowId: string): string | null {
  if (!engine.consoleUrl) return null;
  return engine.consoleUrl.replace('{workflowId}', encodeURIComponent(workflowId));
}
