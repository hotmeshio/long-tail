import { useSettings, type EngineSettings } from '../api/settings';

const NATIVE_ENGINE: EngineSettings = {
  provider: 'hotmesh',
  native: true,
  capabilities: { execution: true, terminate: true },
  consoleUrl: null,
};

/** The durable engine. HotMesh until settings load, and on servers that predate the field. */
export function useEngine(): EngineSettings {
  const { data } = useSettings();
  return data?.engine ?? NATIVE_ENGINE;
}

/** The engine console link for a workflow, or null when no template is configured. */
export function engineConsoleUrl(engine: EngineSettings, workflowId: string): string | null {
  if (!engine.consoleUrl) return null;
  return engine.consoleUrl.replace('{workflowId}', encodeURIComponent(workflowId));
}
