import { CallbackEventAdapter } from '../../lib/events/callback';
import { eventRegistry } from '../../lib/events';
import { loggerRegistry } from '../../lib/logger';
import type { LTStartConfig } from '../../types/startup';
import { DURABLE_LOG } from './constants';
import { recordFollow, removeFollow } from './follow-store';
import { createHotMeshProvider } from './hotmesh';
import { durableProviderRegistry } from './registry';
import { DurableRelay } from './relay';
import { startOnProvider } from './start';

export { durableProviderRegistry } from './registry';
export { createHotMeshProvider } from './hotmesh';
export { DurableRelay, backoffMs, type RelayPassResult } from './relay';
export { WorkflowFollower } from './follow';
export { claimDueFollows, recordFollow, removeFollow } from './follow-store';
export { openWait, getWaitByEscalationId, SignalKeyTakenError, WaitRoleError, type DurableWaitRow, type OpenedWait } from './waits';
export { cancelRunWaits, cancelWaitsIfRunClosed, cancelWaitsOfClosedRun } from './closure';
export { foldWaitDeclaration, WaitDeclarationError } from './declaration';
export { summarizeExecution } from './summary';
export { DURABLE_LOG, FOLLOW_DEFAULTS, RELAY_DEFAULTS, WAIT_LIMITS } from './constants';
export { engineCanStart } from './start';

const KICK_PATTERNS = ['system.escalation.*.*.resolved', 'system.escalation.*.*.cancelled'];

let relay: DurableRelay | null = null;
let unsubscribers: Array<() => void> = [];

/**
 * Throw on a start config that a non-HotMesh provider cannot serve. Those
 * features run as HotMesh workflows inside this process.
 */
export function assertDurableConfig(startConfig: LTStartConfig): void {
  const provider = startConfig.durable?.provider;
  if (!provider || provider.capabilities.native) return;
  const name = provider.name;
  if (startConfig.escalation?.strategy === 'mcp') {
    throw new Error(`durable.provider "${name}": escalation.strategy "mcp" (triage) requires HotMesh`);
  }
  const hotmeshWorker = startConfig.workers?.find((w) => typeof w.workflow !== 'string');
  if (hotmeshWorker) {
    throw new Error(
      `durable.provider "${name}": \`workers\` entries name ${name} workflows as strings, ` +
        `such as { taskQueue: '${hotmeshWorker.taskQueue}', workflow: 'reviewOrder', config }`,
    );
  }
  if (startConfig.examples) {
    throw new Error(`durable.provider "${name}": \`examples\` are HotMesh workflows; disable them`);
  }
}

/** Register the configured provider, or HotMesh. */
export function registerDurableProvider(startConfig: LTStartConfig): void {
  assertDurableConfig(startConfig);
  const config = startConfig.durable ?? {};
  durableProviderRegistry.register(config.provider ?? createHotMeshProvider(), config);
  loggerRegistry.info(DURABLE_LOG.REGISTERED, { provider: durableProviderRegistry.name });
}

/** Start the delivery relay when a non-HotMesh provider runs workflows. */
export function startDurableRelay(): void {
  if (relay || durableProviderRegistry.isNative) return;
  relay = new DurableRelay(durableProviderRegistry.current, durableProviderRegistry.settings.relay);
  const callbacks = eventRegistry.getAdapter(CallbackEventAdapter);
  if (callbacks) {
    unsubscribers = KICK_PATTERNS.map((pattern) => callbacks.on(pattern, () => relay?.kick()));
  }
  relay.start();
}

/**
 * Start a workflow on the provider and follow it, so a run that ends before
 * any wait still publishes its completion. The follow is stored first, so it
 * holds whatever happens to this process after the engine accepts the start.
 */
export async function startProviderWorkflow(input: Parameters<typeof startOnProvider>[0]): Promise<void> {
  const provider = durableProviderRegistry.name;
  const followed = await recordFollow(provider, input.workflowId, input.workflowType);
  try {
    await startOnProvider(input);
  } catch (err) {
    if (followed) await removeFollow(provider, input.workflowId).catch(() => undefined);
    throw err;
  }
  relay?.watch(input.workflowId);
}

/** Ask the relay for a pass now (after an in-process resolve). */
export function kickDurableRelay(): void {
  relay?.kick();
}

export async function stopDurableRelay(): Promise<void> {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  await relay?.stop();
  relay = null;
}
