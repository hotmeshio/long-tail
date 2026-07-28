import * as scanCodeService from '../../services/scan-code';
import type { LTApiResult } from '../../types/sdk';

// ── Scheme CRUD ────────────────────────────────────────────────────────────
// Admin gating happens at the transport layer (requireAdmin on routes, admin
// MCP registration) — same convention as workflow config.

export async function listScanSchemes(): Promise<LTApiResult> {
  try {
    const schemes = await scanCodeService.listScanSchemes();
    return { status: 200, data: { schemes } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getScanScheme(input: { version: number }): Promise<LTApiResult> {
  try {
    const scheme = await scanCodeService.getScanScheme(input.version);
    if (!scheme) return { status: 404, error: `No scan scheme for version ${input.version}` };
    const rules = await scanCodeService.listScanRules(input.version);
    return { status: 200, data: { scheme, rules } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function upsertScanScheme(
  input: scanCodeService.ScanSchemeInput,
): Promise<LTApiResult> {
  try {
    const scheme = await scanCodeService.upsertScanScheme(input);
    return { status: 200, data: { scheme } };
  } catch (err: any) {
    // Write-time invariant violations are caller errors, not server faults.
    return { status: 400, error: err.message };
  }
}

export async function deleteScanScheme(input: { version: number }): Promise<LTApiResult> {
  try {
    const deleted = await scanCodeService.deleteScanScheme(input.version);
    if (!deleted) return { status: 404, error: `No scan scheme for version ${input.version}` };
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Rule CRUD ──────────────────────────────────────────────────────────────

export async function listScanRules(input: { version: number }): Promise<LTApiResult> {
  try {
    const rules = await scanCodeService.listScanRules(input.version);
    return { status: 200, data: { rules } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getScanRule(
  input: { version: number; category: string },
): Promise<LTApiResult> {
  try {
    const rule = await scanCodeService.getScanRule(input.version, input.category);
    if (!rule) {
      return { status: 404, error: `No scan rule for ${input.version}:${input.category}` };
    }
    return { status: 200, data: { rule } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function upsertScanRule(
  input: scanCodeService.ScanRuleInput,
): Promise<LTApiResult> {
  try {
    const scheme = await scanCodeService.getScanScheme(input.scheme_version);
    if (!scheme) {
      return { status: 404, error: `No scan scheme for version ${input.scheme_version} — create the scheme first` };
    }
    const rule = await scanCodeService.upsertScanRule(input);
    return { status: 200, data: { rule } };
  } catch (err: any) {
    return { status: 400, error: err.message };
  }
}

export async function deleteScanRule(
  input: { version: number; category: string },
): Promise<LTApiResult> {
  try {
    const deleted = await scanCodeService.deleteScanRule(input.version, input.category);
    if (!deleted) {
      return { status: 404, error: `No scan rule for ${input.version}:${input.category}` };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
