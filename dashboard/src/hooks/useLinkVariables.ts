import { useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useRoleDetails } from '../api/roles';
import {
  substituteLinkVars,
  setLinkVarValue,
  useLinkVarValues,
} from '../lib/link-vars';

/** One declared variable, annotated with the role that declared it. */
export interface DeclaredLinkVariable {
  name: string;
  label?: string;
  default?: string;
  fromRole: string;
}

/**
 * The member's link-variable surface: the union of declarations across their
 * roles (first declaring role wins per name — same rule as role-pin labels),
 * the device's bound values, and a resolver that substitutes any templated
 * URL into a concrete one. Global viewers (superadmin, admin) see every
 * role's declarations — the same breadth their role pickers have — so they
 * can bind and preview any station's scope.
 */
export function useLinkVariables(): {
  declarations: DeclaredLinkVariable[];
  values: Record<string, string>;
  defaults: Record<string, string>;
  resolveUrl: (url: string) => string;
  setValue: (name: string, value: string | null) => void;
} {
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  const userId = user?.userId ?? null;
  const globalViewer = isSuperAdmin || hasRoleType('admin');
  const memberRoles = useMemo(
    () => new Set((user?.roles ?? []).map((r) => r.role)),
    [user],
  );
  const { data: roleData } = useRoleDetails({ enabled: globalViewer || memberRoles.size > 0 });
  const values = useLinkVarValues(userId);

  const declarations = useMemo(() => {
    const out: DeclaredLinkVariable[] = [];
    const seen = new Set<string>();
    for (const r of roleData?.roles ?? []) {
      if (!globalViewer && !memberRoles.has(r.role)) continue;
      const declared = (r.properties as Record<string, unknown> | undefined)?.link_variables;
      if (!Array.isArray(declared)) continue;
      for (const d of declared) {
        const name = (d as { name?: unknown })?.name;
        if (typeof name !== 'string' || name === '' || seen.has(name)) continue;
        seen.add(name);
        const label = (d as { label?: unknown }).label;
        const dflt = (d as { default?: unknown }).default;
        out.push({
          name,
          ...(typeof label === 'string' && label !== '' ? { label } : {}),
          ...(typeof dflt === 'string' && dflt !== '' ? { default: dflt } : {}),
          fromRole: r.role,
        });
      }
    }
    return out;
  }, [roleData, memberRoles, globalViewer]);

  const defaults = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of declarations) {
      if (d.default !== undefined) out[d.name] = d.default;
    }
    return out;
  }, [declarations]);

  const resolveUrl = useCallback(
    (url: string) => substituteLinkVars(url, values, defaults),
    [values, defaults],
  );

  const setValue = useCallback(
    (name: string, value: string | null) => {
      if (userId) setLinkVarValue(userId, name, value);
    },
    [userId],
  );

  return { declarations, values, defaults, resolveUrl, setValue };
}
