/**
 * get_domain_context — the deployment's domain dictionary, merged with live
 * platform state so an agent can translate domain speech into primitive calls.
 *
 * The dictionary (lt_domain, TTL-cached) holds the semantic overlay: jargon
 * terms mapped to roles/workflows/facets/verbs, guidance, runbooks. This tool
 * JOINS it with the live registries at call time — role entries carry the live
 * row's title/description/entity_facet plus its properties verb semantics
 * (on_cancel/on_timeout/worked_by); workflow entries carry the live config;
 * entity entries carry the id facet derived from their role. References to
 * since-removed roles/workflows are annotated, never thrown. Read-safe.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getDomainDictionary, getDomainIndex } from '../../../services/domain';
import { listRolesWithDetails } from '../../../services/role';
import { ROLE_PROPERTY_KEYS } from '../../../services/role/types';
import { listWorkflowConfigs } from '../../../services/config';
import { listFacetKeys } from '../../../services/escalation/queries';
import type { DomainTerm } from '../../../types';
import { getDomainContextSchema } from './schemas';

const REGISTER_HINT =
  'An admin can register a dictionary via startConfig.mcp.domainDictionaryPath or PUT /api/domain.';

const norm = (s: string) => s.trim().toLowerCase();

/** True when the term (or any alias) matches the lookup name. */
function termMatches(term: DomainTerm, name: string): boolean {
  const n = norm(name);
  if (norm(term.term) === n) return true;
  return (term.aliases ?? []).some((a) => norm(a) === n);
}

/** Role names a term references (for live joins). */
function rolesOf(term: DomainTerm): string[] {
  const out: string[] = [];
  if (term.maps_to?.role) out.push(term.maps_to.role);
  if (term.maps_to?.roles) out.push(...term.maps_to.roles);
  return out;
}

// ---------------------------------------------------------------------------
// Registry-derived fallback — the ontology FLOOR. The live registries already
// self-describe the structure: roles (title/description/entity_facet + verb
// semantics from properties), workflow configs, and in-use facet keys. When no
// dictionary is registered, this tool serves that derived view, so it is
// useful on every deployment from day one; a dictionary ADDS the jargon,
// guidance, and runbooks the registries cannot know.
// ---------------------------------------------------------------------------

/** Topics that only exist as authored dictionary content. */
const AUTHORED_TOPICS = new Set(['action', 'rule', 'runbook']);

async function derivedContext(topic?: string, name?: string): Promise<unknown> {
  if (topic && AUTHORED_TOPICS.has(topic)) {
    return {
      derived: true,
      error: `"${topic}" entries are authored in the dictionary; none is registered.`,
      hint: REGISTER_HINT,
    };
  }

  const [roles, configs, facetKeys] = await Promise.all([
    listRolesWithDetails(),
    listWorkflowConfigs(),
    listFacetKeys({ global: true }),
  ]);

  const roleEntries = roles.map((r) => {
    const props = r.properties ?? {};
    return {
      kind: 'role' as const,
      term: r.role,
      derived: true,
      title: r.title ?? undefined,
      description: r.description ?? undefined,
      entity_facet: r.entity_facet ?? undefined,
      on_cancel: typeof props[ROLE_PROPERTY_KEYS.ON_CANCEL] === 'string' ? props[ROLE_PROPERTY_KEYS.ON_CANCEL] : undefined,
      on_timeout: typeof props[ROLE_PROPERTY_KEYS.ON_TIMEOUT] === 'string' ? props[ROLE_PROPERTY_KEYS.ON_TIMEOUT] : undefined,
      worked_by: typeof props[ROLE_PROPERTY_KEYS.WORKED_BY] === 'string' ? props[ROLE_PROPERTY_KEYS.WORKED_BY] : undefined,
    };
  });

  // Entities: roles sharing an entity_facet form that entity's system; the
  // facet key is the best available name until a dictionary declares a noun.
  const rolesByFacet = new Map<string, string[]>();
  for (const r of roles) {
    if (!r.entity_facet) continue;
    const list = rolesByFacet.get(r.entity_facet) ?? [];
    list.push(r.role);
    rolesByFacet.set(r.entity_facet, list);
  }
  const entityEntries = [...rolesByFacet.entries()].map(([facet, facetRoles]) => ({
    kind: 'entity' as const,
    term: facet,
    derived: true,
    idFacet: facet,
    roles: facetRoles,
    guidance: `Query escalations with facets={${facet}: value}, created_at desc.`,
  }));

  const workflowEntries = configs.map((c) => ({
    kind: 'workflow' as const,
    term: c.workflow_type,
    derived: true,
    description: c.description ?? undefined,
    invocable: c.invocable,
    task_queue: c.task_queue ?? undefined,
    stop_note: 'Stop a workflow with terminate_workflow (kills the handle AND cancels its escalations).',
  }));

  const facetEntries = facetKeys.map((key) => ({ kind: 'facet' as const, term: key, derived: true }));

  if (!topic) {
    return {
      derived: true,
      note: `No dictionary is registered — this index is derived from the live registries. ${REGISTER_HINT}`,
      terms: {
        entity: entityEntries.map((e) => e.term),
        role: roleEntries.map((r) => r.term),
        workflow: workflowEntries.map((w) => w.term),
        facet: facetEntries.map((f) => f.term),
      },
      runbooks: [],
    };
  }

  const byTopic: Record<string, Array<Record<string, any>>> = {
    entity: entityEntries,
    role: roleEntries,
    workflow: workflowEntries,
    facet: facetEntries,
    term: [...entityEntries, ...roleEntries, ...workflowEntries, ...facetEntries],
  };
  let entries = byTopic[topic] ?? [];
  if (name) entries = entries.filter((e) => norm(e.term) === norm(name));
  if (!entries.length) {
    return {
      derived: true,
      error: `No live-registry entry matches topic "${topic}"${name ? ` name "${name}"` : ''}.`,
      hint: 'Call with no args for the derived index.',
    };
  }
  return entries;
}

/**
 * Enrich terms with live registry state. Dangling references are annotated so
 * a stale dictionary reads as stale instead of lying or crashing.
 */
async function enrichTerms(terms: DomainTerm[]): Promise<Record<string, any>[]> {
  const wantsRoles = terms.some((t) => rolesOf(t).length > 0);
  const wantsWorkflows = terms.some((t) => t.maps_to?.workflow);
  const [roles, configs] = await Promise.all([
    wantsRoles ? listRolesWithDetails() : Promise.resolve([]),
    wantsWorkflows ? listWorkflowConfigs() : Promise.resolve([]),
  ]);
  const roleByName = new Map(roles.map((r) => [r.role, r]));
  const configByType = new Map(configs.map((c) => [c.workflow_type, c]));

  return terms.map((t) => {
    const out: Record<string, any> = { ...t };

    const liveRoles = rolesOf(t).map((name) => {
      const row = roleByName.get(name);
      if (!row) return { role: name, dangling: 'no longer a live role' };
      const props = row.properties ?? {};
      return {
        role: row.role,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        entity_facet: row.entity_facet ?? undefined,
        on_cancel: typeof props[ROLE_PROPERTY_KEYS.ON_CANCEL] === 'string' ? props[ROLE_PROPERTY_KEYS.ON_CANCEL] : undefined,
        on_timeout: typeof props[ROLE_PROPERTY_KEYS.ON_TIMEOUT] === 'string' ? props[ROLE_PROPERTY_KEYS.ON_TIMEOUT] : undefined,
        worked_by: typeof props[ROLE_PROPERTY_KEYS.WORKED_BY] === 'string' ? props[ROLE_PROPERTY_KEYS.WORKED_BY] : undefined,
      };
    });
    if (liveRoles.length) out.live_roles = liveRoles;

    if (t.kind === 'entity' && !out.idFacet) {
      // Fallback derivation for docs written before the role declared its facet.
      const derived = liveRoles.find((r) => 'entity_facet' in r && r.entity_facet);
      if (derived) out.idFacet = (derived as any).entity_facet;
    }

    if (t.maps_to?.workflow) {
      const config = configByType.get(t.maps_to.workflow);
      out.live_workflow = config
        ? {
            workflow_type: config.workflow_type,
            description: config.description ?? undefined,
            invocable: config.invocable,
            task_queue: config.task_queue ?? undefined,
          }
        : { workflow_type: t.maps_to.workflow, dangling: 'not a registered workflow' };
      out.stop_note = 'Stop a workflow with terminate_workflow (kills the handle AND cancels its escalations).';
    }

    return out;
  });
}

export function registerDomainContextTools(server: McpServer): void {
  (server as any).registerTool(
    'get_domain_context',
    {
      title: 'Get Domain Context',
      description:
        'The deployment\'s domain dictionary merged with live platform state — how ' +
        'this operation\'s jargon maps to roles, queues, workflows, escalations, and ' +
        'metadata facets. No args → overview + index. { topic, name } → specific ' +
        'entries: entity (id facet + roles → build an escalation query on ' +
        'facets={idFacet: value}, sorted created_at desc), role (live title + ' +
        'cancel/timeout semantics), workflow (kill road + id convention), facet, ' +
        'action, rule, or runbook; topic `term` looks a word or alias up across every ' +
        'kind. Works on every deployment: with no dictionary registered it serves a ' +
        'view derived from the live registries (roles, entity facets, workflows, ' +
        'facet keys). Call this before acting on anything deployment-specific — ' +
        'verbs like cancel invert meaning by role.',
      inputSchema: getDomainContextSchema,
    },
    async (args: z.infer<typeof getDomainContextSchema>) => {
      const respond = (payload: unknown) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      });

      const record = await getDomainDictionary();
      if (!record) return respond(await derivedContext(args.topic, args.name));
      const doc = record.doc;

      if (!args.topic) return respond(await getDomainIndex());

      if (args.topic === 'runbook') {
        const runbooks = doc.runbooks ?? [];
        return respond(args.name ? runbooks.filter((r) => norm(r.name) === norm(args.name!)) : runbooks);
      }

      let terms = doc.terms ?? [];
      if (args.topic !== 'term') terms = terms.filter((t) => t.kind === args.topic);
      if (args.name) terms = terms.filter((t) => termMatches(t, args.name!));

      if (!terms.length) {
        return respond({
          error: `No dictionary entry matches topic "${args.topic}"${args.name ? ` name "${args.name}"` : ''}.`,
          hint: 'Call with no args for the index of known terms.',
        });
      }
      return respond(await enrichTerms(terms));
    },
  );
}
