import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { runWithToolContext } from '../../iam/context';
import type { ToolContext, ToolPrincipal } from '../../../types/tool-context';

/**
 * Build a ToolContext from the `_scope` input parameter.
 * YAML activities receive `_scope` threaded from the trigger through every step.
 */
export function buildToolContextFromScope(scope: Record<string, any>): ToolContext {
  return {
    principal: scope.principal as ToolPrincipal,
    ...(scope.initiatingPrincipal
      ? { initiatingPrincipal: scope.initiatingPrincipal as ToolPrincipal }
      : {}),
    credentials: {
      scopes: scope.scopes ?? [],
    },
    trace: {},
  };
}

/**
 * Wrap a worker callback with scope injection via AsyncLocalStorage.
 * If `_scope` is present in the input data, builds a ToolContext and
 * wraps the callback so `getToolContext()` works inside tool code.
 */
export function wrapWithScope(
  callback: (data: StreamData) => Promise<StreamDataResponse>,
): (data: StreamData) => Promise<StreamDataResponse> {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const input = (data.data || {}) as Record<string, unknown>;
    const scope = input._scope as Record<string, any> | undefined;
    if (scope?.principal) {
      const ctx = buildToolContextFromScope(scope);
      return runWithToolContext(ctx, () => callback(data));
    }
    return callback(data);
  };
}
