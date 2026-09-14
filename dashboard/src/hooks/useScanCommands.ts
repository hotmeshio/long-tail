import { useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { SCAN_SCHEME_KINDS, useScanSchemes, type ScanRule } from '../api/scan-codes';
import { toScanCommand, type ScanCommand } from '../lib/search-command';

const CATALOG_STALE_MS = 5 * 60_000;

type RulesResult = UseQueryResult<{ rules: ScanRule[] }>;

// Module-level so react-query can memoize the combined shape across renders.
const combineRules = (results: RulesResult[]) => ({
  rules: results.map((r) => r.data?.rules ?? null),
  loading: results.some((r) => r.isLoading),
});

/**
 * The runnable commands the toolbar offers: every enabled rule of every
 * enabled action scheme, in scheme then category order. Identity (badge)
 * schemes carry no runnable rules and are left out.
 */
export function useScanCommands(enabled: boolean): { commands: ScanCommand[]; loading: boolean } {
  const schemes = useScanSchemes({ enabled, staleTime: CATALOG_STALE_MS });
  const actionSchemes = useMemo(
    () => (schemes.data?.schemes ?? [])
      .filter((s) => s.enabled && s.kind === SCAN_SCHEME_KINDS.ACTION)
      .sort((a, b) => a.version - b.version),
    [schemes.data],
  );

  const { rules, loading } = useQueries({
    queries: actionSchemes.map((s) => ({
      queryKey: ['scan-schemes', s.version, 'actions'],
      queryFn: () => apiFetch<{ rules: ScanRule[] }>(`/scan-codes/schemes/${s.version}/actions`),
      enabled,
      staleTime: CATALOG_STALE_MS,
    })),
    combine: combineRules,
  });

  const commands = useMemo(
    () => actionSchemes.flatMap((scheme, i) =>
      (rules[i] ?? [])
        .filter((r) => r.enabled)
        .sort((a, b) => a.category.localeCompare(b.category))
        .map((r) => toScanCommand(scheme, r))),
    [actionSchemes, rules],
  );

  return { commands, loading: schemes.isLoading || loading };
}
