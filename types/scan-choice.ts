/**
 * Info-choice types: the labeled choice set a PRESENT step renders under the
 * located reality, and the pointer the client sends back to execute one.
 * The choices are the same escalation primitives as step verbs — presented,
 * not auto-executed; the human's tap (or a second scan matching `code`) is
 * the disambiguator.
 */

import type { ScanStepParams, ScanVerb } from './scan-code';

/** One labeled choice on a PRESENT step. */
export interface ScanChoice {
  /** Button text — what the associate reads. */
  label: string;
  verb: ScanVerb;
  params?: ScanStepParams;
  /** Ask-first dialog before the choice executes (presentational; the server re-validates). */
  confirm?: { prompt: string };
  /** The choice executes only under a real acting identity (badge or a write-capable login). */
  requireActingIdentity?: boolean;
  /** Short token enabling double-scan selection (scan object, then an action card). */
  code?: string;
}

/**
 * A pointer to a presented choice, sent back for execution. The server
 * re-validates everything the pointer references — config, row, identity,
 * RBAC — before any verb runs; the pointer is never authority.
 */
export interface ScanChoiceExecuteRequest {
  schemeVersion: number;
  category: string;
  stepIndex: number;
  choiceIndex: number;
  escalationId: string;
  actingToken?: string;
}

/** One presented choice as the client sees it (CHOICES outcome). */
export interface ScanPresentedChoice {
  index: number;
  label: string;
  verb: ScanVerb;
  confirm?: { prompt: string };
  requireActingIdentity?: boolean;
  code?: string;
  /** True = the identity requirement is unsatisfied; render the notPrimed affordance. */
  withheld: boolean;
}
