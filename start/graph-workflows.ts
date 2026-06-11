import { loggerRegistry } from '../lib/logger';
import { sanitizeToolName, sanitizeServerName } from '../modules/utils';
import type { LTGraphWorkflowConfig } from '../types/startup';

function extractYamlVersion(yaml: string): string {
  const m = yaml.match(/^\s*version:\s*['"]?(\S+?)['"]?\s*$/m);
  return m?.[1] ?? '0';
}

/**
 * Register declarative graph (YAML/DAG) workflows at startup — the graph-form
 * peer of durable `workers`. Each flow is created insert-if-absent, then
 * deployed + activated through the same path the dashboard uses.
 *
 * On a re-boot where the flow already exists:
 *   - description and output_schema are synced if stale
 *   - when the YAML version bumps, yaml_content is updated and the flow is redeployed
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
        app_id: namespace,
        tags: gf.tags,
      });

      if (created.status === 409) {
        // Flow already exists — sync stale fields and redeploy if YAML version bumped.
        const listing = await listYamlWorkflows({ app_id: namespace, graph_topic: graphTopic, limit: 1 });
        const match = listing.data?.workflows?.[0];
        if (match) {
          const updates: Record<string, any> = {};
          if (gf.description && match.description !== gf.description) updates.description = gf.description;
          if (gf.outputSchema) updates.output_schema = gf.outputSchema;
          if (gf.inputSchema) updates.input_schema = gf.inputSchema;

          const storedVersion = extractYamlVersion(match.yaml_content ?? '');
          const newVersion = extractYamlVersion(gf.yaml);
          const yamlChanged = newVersion !== storedVersion;
          if (yamlChanged) {
            updates.yaml_content = gf.yaml;
          }

          if (Object.keys(updates).length > 0) {
            await updateYamlWorkflow({ id: match.id, ...updates });
            loggerRegistry.info(`[long-tail] graph flow updated: ${gf.name}`);
          }

          if (yamlChanged) {
            const deployed = await deployYamlWorkflow({ id: match.id });
            if (deployed.status !== 200) {
              loggerRegistry.warn(
                `[long-tail] graph flow redeploy failed for ${gf.name}: ${deployed.error ?? 'unknown error'}`,
              );
            } else {
              loggerRegistry.info(`[long-tail] graph flow redeployed: ${gf.name} (v${newVersion})`);
            }
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
