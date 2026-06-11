import { loggerRegistry } from '../lib/logger';
import { sanitizeToolName, sanitizeServerName } from '../modules/utils';
import type { LTGraphWorkflowConfig } from '../types/startup';

/**
 * Register declarative graph (YAML/DAG) workflows at startup — the graph-form
 * peer of durable `workers`. Each flow is created insert-if-absent, then
 * deployed + activated through the same path the dashboard uses.
 *
 * On a re-boot where the flow already exists, description and output_schema are
 * synced if they've changed (e.g. after updating the example config).
 *
 * Per-flow failures are logged and skipped so a single malformed flow can never
 * block boot.
 */
export async function seedGraphWorkflows(configs: LTGraphWorkflowConfig[]): Promise<void> {
  const { createYamlWorkflowDirect, listYamlWorkflows, updateYamlWorkflow } = await import('../api/yaml-workflows/crud');
  const { deployYamlWorkflow } = await import('../api/yaml-workflows/deploy');

  for (const gf of configs) {
    const namespace = sanitizeServerName(gf.namespace ?? 'graph');
    const graphTopic = sanitizeToolName(gf.name);
    try {
      const created = await createYamlWorkflowDirect({
        name: gf.name,
        description: gf.description,
        yaml_content: gf.yaml,
        input_schema: gf.inputSchema,
        output_schema: gf.outputSchema,
        app_id: gf.namespace,
        tags: gf.tags,
      });

      if (created.status === 409) {
        // Flow already exists — sync description and output_schema if stale.
        const listing = await listYamlWorkflows({ app_id: namespace, graph_topic: graphTopic, limit: 1 });
        const match = listing.data?.workflows?.[0];
        if (match) {
          const updates: Record<string, any> = {};
          if (gf.description && match.description !== gf.description) updates.description = gf.description;
          if (gf.outputSchema && JSON.stringify(match.output_schema ?? {}) === '{}') updates.output_schema = gf.outputSchema;
          if (Object.keys(updates).length > 0) {
            await updateYamlWorkflow({ id: match.id, ...updates });
            loggerRegistry.info(`[long-tail] graph flow updated: ${gf.name}`);
          } else {
            loggerRegistry.info(`[long-tail] graph flow already registered: ${gf.name}`);
          }
        } else {
          loggerRegistry.info(`[long-tail] graph flow already registered: ${gf.name}`);
        }
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
