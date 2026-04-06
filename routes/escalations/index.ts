import { Router } from 'express';

import { registerListRoutes } from './list';
import { registerBulkRoutes } from './bulk';
import { registerSingleRoutes } from './single';
import { registerResolveRoutes } from './resolve';

const router = Router();

// Registration order matters: literal paths before parameterized /:id routes.

// GET /, /available, /types, /stats
registerListRoutes(router);

// POST /release-expired, PATCH /priority, POST /bulk-claim,
// POST /bulk-assign, PATCH /bulk-escalate, POST /bulk-triage
registerBulkRoutes(router);

// PATCH /:id/escalate, GET /by-workflow/:workflowId,
// GET /:id, POST /:id/claim, POST /:id/release
registerSingleRoutes(router);

// POST /:id/resolve
registerResolveRoutes(router);

export default router;
