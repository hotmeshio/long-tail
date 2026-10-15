import express from 'express';

/**
 * The single module that imports the HTTP framework.
 *
 * Routes, middleware, adapters and the standalone server take routers,
 * handler types and body/static middleware from here. Long Tail runs both
 * as its own server and as a guest on a host's Express instance (NestJS,
 * Express), so the framework dependency has exactly one owner.
 */

export { Router } from 'express';
export type {
  Application,
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

type JsonBodyOptions = Parameters<typeof express.json>[0];
type StaticFilesOptions = Parameters<typeof express.static>[1];

/** A new application. Only the standalone server owns one; embedded mode uses the host's. */
export function createApp(): express.Application {
  return express();
}

/** JSON body parsing. A body the host already parsed is left as is. */
export function jsonBody(options?: JsonBodyOptions): express.RequestHandler {
  return express.json(options);
}

/** Static file serving from `root`. */
export function serveStatic(root: string, options?: StaticFilesOptions): express.RequestHandler {
  return express.static(root, options);
}

/**
 * Non-credentialed CORS for public endpoints: any origin may call them, and
 * preflight requests are answered here.
 */
export function allowAnyOrigin(methods: string[] = ['GET', 'POST']): express.RequestHandler {
  const allowMethods = [...methods, 'OPTIONS'].join(', ');
  return (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', allowMethods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

type FormBodyOptions = Parameters<typeof express.urlencoded>[0];

/** URL-encoded form body parsing. A body the host already parsed is left as is. */
export function formBody(options: FormBodyOptions = { extended: false }): express.RequestHandler {
  return express.urlencoded(options);
}
