The HTTP framework boundary. `index.ts` is the only module in Long Tail that imports `express`; everything else imports from here.

Key exports:
- `Router` — router factory (and type), used by every route module
- `Request`, `Response`, `NextFunction`, `RequestHandler`, `ErrorRequestHandler`, `Application` — handler types
- `createApp()` — a new application, used only by the standalone server
- `jsonBody()` — JSON body parsing
- `serveStatic()` — static file serving

Long Tail runs standalone (it owns the app) and embedded (it mounts routers on a host's app, for example NestJS). In embedded mode the host owns the server, its settings (`trust proxy`) and its global middleware; Long Tail reads settings through the request and adds nothing global.

`tests/lib/http-boundary.test.ts` fails the build when any other file imports `express` directly. Two standalone processes are exempt because they are separate servers, not Long Tail: `tests/mock-oauth/server.ts` and `examples/external-mcp-server/server.ts`.
