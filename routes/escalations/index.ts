import { Router } from 'express';

import { registerListRoutes } from './list';
import { registerBulkRoutes } from './bulk';
import { registerMetadataRoutes } from './metadata';
import { registerSingleRoutes } from './single';
import { registerResolveRoutes } from './resolve';
import { registerFacetRoutes } from './facets';

const router = Router();

// Registration order matters: literal paths before parameterized /:id routes.

// GET /, /available, /types, /stats
registerListRoutes(router);

// POST /release-expired, PATCH /priority, POST /bulk-claim,
// POST /bulk-assign, PATCH /bulk-escalate, POST /bulk-triage
registerBulkRoutes(router);

// GET /by-metadata, POST /claim-by-metadata, POST /resolve-by-metadata
registerMetadataRoutes(router);

// POST /search-by-facets, /claim-groups, /claim-by-facets
registerFacetRoutes(router);

// PATCH /:id/escalate, GET /by-workflow/:workflowId,
// GET /:id, POST /:id/claim, POST /:id/release
registerSingleRoutes(router);

// POST /:id/resolve
registerResolveRoutes(router);

export default router;
