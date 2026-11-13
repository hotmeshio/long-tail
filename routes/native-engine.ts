import type { NextFunction, Request, RequestHandler, Response } from '../lib/http';
import { durableProviderRegistry } from '../services/durable-provider';

export interface EngineNeutralRoute {
  method: string;
  path: RegExp;
}

/** Workflow routes every engine serves: control, results, configs, invoke and schedules. */
export const WORKFLOW_NEUTRAL_ROUTES: EngineNeutralRoute[] = [
  { method: 'POST', path: /^\/[^/]+\/terminate$/ },
  { method: 'GET', path: /^\/[^/]+\/describe$/ },
  { method: 'GET', path: /^\/[^/]+\/result$/ },
  { method: 'GET', path: /^\/config$/ },
  { method: 'GET', path: /^\/[^/]+\/config$/ },
  { method: 'PUT', path: /^\/[^/]+\/config$/ },
  { method: 'DELETE', path: /^\/[^/]+\/config$/ },
  { method: 'GET', path: /^\/[^/]+\/input-lookups$/ },
  { method: 'GET', path: /^\/invocable$/ },
  { method: 'GET', path: /^\/discovered$/ },
  { method: 'POST', path: /^\/[^/]+\/invoke$/ },
  { method: 'GET', path: /^\/cron\/status$/ },
];

/** Workflow-state routes every engine serves: the executions list and timeline. */
export const WORKFLOW_STATE_NEUTRAL_ROUTES: EngineNeutralRoute[] = [
  { method: 'GET', path: /^\/jobs$/ },
  { method: 'GET', path: /^\/[^/]+\/execution$/ },
];

/** The error a HotMesh-only route returns when another engine runs workflows. */
export function nativeEngineError(): string {
  return `Requires the HotMesh durable engine. This deployment runs ${durableProviderRegistry.name}.`;
}

/**
 * Serve the route only when HotMesh runs customer workflows. With another
 * provider the route answers 501, so callers learn why instead of reading
 * empty HotMesh tables. `except` lists routes inside the router that work
 * on every engine.
 */
export function requireNativeEngine(except: EngineNeutralRoute[] = []): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (durableProviderRegistry.isNative) return next();
    if (except.some((route) => route.method === req.method && route.path.test(req.path))) return next();
    res.status(501).json({ error: nativeEngineError() });
  };
}
