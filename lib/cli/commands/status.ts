import pc from 'picocolors';
import { apiFetch } from '../client';
import { getServerUrl } from '../auth';

export async function statusCommand(): Promise<void> {
  const server = getServerUrl();
  console.log(`\n  ${pc.bold('Long Tail')} ${pc.dim(server || 'unknown')}\n`);

  const [settings, escalations, workflows, pipelines] = await Promise.all([
    apiFetch('/settings').catch(() => null),
    apiFetch('/escalations?status=pending&limit=1').catch(() => null),
    apiFetch('/workflows/discovered?include_system=false').catch(() => null),
    apiFetch('/yaml-workflows?status=active&limit=1').catch(() => null),
  ]);

  const pending = (escalations as any)?.total ?? '?';
  const workerCount = (workflows as any)?.workflows?.length ?? '?';
  const pipelineCount = (pipelines as any)?.total ?? (pipelines as any)?.workflows?.length ?? '?';
  const transport = (settings as any)?.events?.transport ?? '?';

  console.log(`  ${pc.yellow('●')} Pending escalations  ${pc.bold(String(pending))}`);
  console.log(`  ${pc.green('●')} Active workers        ${pc.bold(String(workerCount))}`);
  console.log(`  ${pc.cyan('●')} Pipeline tools        ${pc.bold(String(pipelineCount))}`);
  console.log(`  ${pc.dim('●')} Event transport       ${transport}`);
  console.log();
}
