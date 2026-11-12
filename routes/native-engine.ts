import type { NextFunction, Request, RequestHandler, Response } from '../lib/http';
import { durableProviderRegistry } from '../services/durable-provider';

export interface EngineNeutralRoute {
  method: string;
  path: RegExp;
}

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
