/**
 * The domain dictionary — a deployment's ontology, stored in `lt_domain` and
 * exposed through the MCP surface so an agent can translate domain speech
 * ("printer PRN-001", "reset it") into the primitive call: which role/queue,
 * which metadata facet, which workflow, which verb.
 *
 * The dictionary declares only the SEMANTIC overlay the live registries can't
 * hold — jargon terms, verb guidance, kill roads, runbooks. Structure (an
 * entity's id facet, a role's title) is DERIVED from lt_roles /
 * lt_config_workflows at read time, so the merged view is always current.
 * Role verb semantics (what cancel MEANS for a row class) live on the role
 * itself, under reserved `lt_roles.properties` keys (ROLE_PROPERTY_KEYS in
 * services/role/types.ts); `get_domain_context` merges them in.
 */

export type DomainTermKind =
  /** A domain noun tracked through the system ("printer", "order"). */
  | 'entity'
  /** Jargon for a role/queue ("demand row" → print-operator). */
  | 'role'
  /** Jargon for a workflow ("the pipe" → orderPipeline). */
  | 'workflow'
  /** A metadata facet's meaning ("pdac", "facility"). */
  | 'facet'
  /** A domain verb and what it maps to ("reset" → cancel on a role). */
  | 'action'
  /** A standing rule, stated imperatively ("claims expire = recovery"). */
  | 'rule';

/** What a term maps to in platform primitives. All fields optional — a `rule`
 *  term maps to nothing; an `action` may name a verb + role. */
export interface DomainTermMapping {
  role?: string;
  roles?: string[];
  workflow?: string;
  facet?: string;
  /** A platform verb: claim | release | resolve | cancel | escalate | terminate. */
  verb?: string;
}

export interface DomainTerm {
  /** The word the operation actually uses. */
  term: string;
  /** Other spellings/phrases that mean the same thing. */
  aliases?: string[];
  kind: DomainTermKind;
  maps_to?: DomainTermMapping;
  /** 1–4 imperative sentences: what an agent must know before acting on this. */
  guidance: string;
  /** entity terms: override the id facet derived from the role's entity_facet. */
  idFacet?: string;
  /** workflow terms: how to stop it correctly ("terminate the root; never cancel the demand row"). */
  kill_road?: string;
  /** workflow terms: deterministic id convention ("pipe-<orderId>[-g<N>]"). */
  id_convention?: string;
  /** facet terms: the enumerable value domain, when closed. */
  values?: string[];
}

/** A named procedure as ordered, tool-level steps. */
export interface DomainRunbook {
  name: string;
  steps: string[];
}

export interface DomainDictionary {
  name: string;
  version: string;
  /** One page: what this deployment runs. */
  overview: string;
  terms?: DomainTerm[];
  runbooks?: DomainRunbook[];
}

/** Compact names-only index for the MCP `instructions` string. */
export interface DomainIndex {
  name: string;
  version: string;
  overview: string;
  /** Term names grouped by kind. */
  terms: Partial<Record<DomainTermKind, string[]>>;
  runbooks: string[];
}
