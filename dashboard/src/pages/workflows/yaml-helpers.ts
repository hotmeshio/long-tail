import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProcessServer {
  appId: string;
  workflows: LTYamlWorkflowRecord[];
  toolCount: number;
  status: string;
  updatedAt: string;
}

// ── Grouping & filtering helpers ──────────────────────────────────────────────

export function groupByAppId(workflows: LTYamlWorkflowRecord[]): ProcessServer[] {
  const map = new Map<string, LTYamlWorkflowRecord[]>();
  for (const wf of workflows) {
    const list = map.get(wf.app_id) ?? [];
    list.push(wf);
    map.set(wf.app_id, list);
  }

  return [...map.entries()].map(([appId, wfs]) => {
    const statusPriority: Record<string, number> = { active: 0, deployed: 1, draft: 2, archived: 3 };
    const bestStatus = wfs.reduce(
      (best, wf) => ((statusPriority[wf.status] ?? 9) < (statusPriority[best] ?? 9) ? wf.status : best),
      wfs[0].status,
    );
    const latest = wfs.reduce((max, wf) => (wf.updated_at > max ? wf.updated_at : max), wfs[0].updated_at);

    return {
      appId,
      workflows: wfs,
      toolCount: wfs.length,
      status: bestStatus,
      updatedAt: latest,
    };
  });
}

/** Client-side search: match server name or any tool's graph_topic/description */
export function matchesSearch(server: ProcessServer, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  if (server.appId.toLowerCase().includes(q)) return true;
  return server.workflows.some(
    (wf) =>
      wf.graph_topic.toLowerCase().includes(q) ||
      wf.name?.toLowerCase().includes(q) ||
      wf.description?.toLowerCase().includes(q),
  );
}

/** Filter tools within a server that match the search term */
export function filterTools(workflows: LTYamlWorkflowRecord[], search: string): LTYamlWorkflowRecord[] {
  if (!search) return workflows;
  const q = search.toLowerCase();
  return workflows.filter(
    (wf) =>
      wf.graph_topic.toLowerCase().includes(q) ||
      wf.name?.toLowerCase().includes(q) ||
      wf.description?.toLowerCase().includes(q),
  );
}
