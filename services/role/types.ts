/** Type definitions for the role and escalation chain service. */

import type { RoleHomeView } from './constants';

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

export interface RoleDetail {
  role: string;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

/**
 * The role row as a self-describing surface: title, purpose, the escalation
 * metadata contract, and which face to land on.
 */
export interface RoleConfig {
  role: string;
  title: string | null;
  purpose: string | null;
  metadata_schema: Record<string, any> | null;
  home_view: RoleHomeView | null;
}

/** Patch shape for updating a role's self-describing config. */
export interface RoleConfigPatch {
  title?: string | null;
  purpose?: string | null;
  metadataSchema?: Record<string, any> | null;
  homeView?: RoleHomeView | null;
}

/**
 * The declared per-unit TAT target for one station on a role — the promise the
 * measured per-unit TAT is read against (the overview's 100% line).
 */
export interface RoleDial {
  role: string;
  station_key: string;
  target_tat_seconds: number;
  created_at: Date;
  updated_at: Date;
}

/** Mutable fields when upserting a dial. */
export interface RoleDialInput {
  targetTatSeconds: number;
}
