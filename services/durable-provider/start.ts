import { loggerRegistry } from '../../lib/logger';
import { DURABLE_LOG } from './constants';
import { durableProviderRegistry } from './registry';

/** True when HotMesh runs workflows, or the provider can start them. */
export function engineCanStart(): boolean {
  if (durableProviderRegistry.isNative) return true;
  const provider = durableProviderRegistry.current;
  return !!provider.capabilities.start && typeof provider.start === 'function';
}

/** Start a workflow on the registered provider with the envelope as its one argument. */
export async function startOnProvider(input: {
  workflowType: string;
  workflowId: string;
  taskQueue: string;
  envelope: Record<string, any>;
}): Promise<void> {
  const provider = durableProviderRegistry.current;
  if (!provider.start || !provider.capabilities.start) {
    throw new Error(`The ${provider.name} provider does not start workflows`);
  }
  await provider.start({
    workflowType: input.workflowType,
    workflowId: input.workflowId,
    taskQueue: input.taskQueue,
    args: [input.envelope],
  });
  loggerRegistry.info(DURABLE_LOG.STARTED, {
    provider: provider.name,
    workflowId: input.workflowId,
    workflowType: input.workflowType,
  });
}
