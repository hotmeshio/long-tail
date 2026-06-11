import { loggerRegistry } from '../lib/logger';
import type { LTGraphWorkflowConfig } from '../types/startup';

/**
 * Register declarative graph (YAML/DAG) workflows at startup — the graph-form
 * peer of durable `workers`. Each flow is created insert-if-absent, then
 * deployed + activated through the same path the dashboard uses.
 *
 * Per-flow failures are logged and skipped so a single malformed flow can never
 * block boot. Re-registration on a later boot is a no-op (topic already exists).
 */
export async function seedGraphWorkflows(configs: LTGraphWorkflowConfig[]): Promise<void> {
  const { createYamlWorkflowDirect } = await import('../api/yaml-workflows/crud');
  const { deployYamlWorkflow } = await import('../api/yaml-workflows/deploy');

  for (const gf of configs) {
    const namespace = gf.namespace ?? 'graph';
    try {
      const created = await createYamlWorkflowDirect({
        name: gf.name,
        description: gf.description,
        yaml_content: gf.yaml,
        input_schema: gf.inputSchema,
        app_id: namespace,
        tags: gf.tags,
      });

      // 409 = a flow with this topic already exists in the namespace (prior boot).
      // Leave the already-deployed version in place — registration is insert-if-absent.
      if (created.status === 409) {
        loggerRegistry.info(`[long-tail] graph flow already registered: ${gf.name}`);
        continue;
      }
      if (created.status !== 200 || !created.data?.id) {
        loggerRegistry.warn(
          `[long-tail] graph flow create failed for ${gf.name}: ${created.error ?? 'unknown error'}`,
        );
        continue;
      }

      const deployed = await deployYamlWorkflow({ id: created.data.id });
      if (deployed.status !== 200) {
        loggerRegistry.warn(
          `[long-tail] graph flow deploy failed for ${gf.name}: ${deployed.error ?? 'unknown error'}`,
        );
        continue;
      }

      loggerRegistry.info(
        `[long-tail] graph flow registered + deployed: ${gf.name} (namespace: ${namespace})`,
      );
    } catch (err: any) {
      loggerRegistry.warn(`[long-tail] graph flow seed error for ${gf.name}: ${err.message}`);
    }
  }
}
