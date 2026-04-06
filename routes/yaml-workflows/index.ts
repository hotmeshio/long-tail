import { Router } from 'express';

import crudRouter from './crud';
import deploymentRouter from './deployment';
import versionsRouter from './versions';

const router = Router();

// Mount in the same order as the original monolithic file.
// crud.ts handles: GET /, POST /, GET /app-ids, GET /:id, PUT /:id,
//                  POST /:id/regenerate, DELETE /:id
router.use(crudRouter);

// deployment.ts handles: POST /:id/deploy, POST /:id/activate,
//                        POST /:id/invoke, POST /:id/archive
router.use(deploymentRouter);

// versions.ts handles: GET /:id/versions, GET /:id/versions/:version,
//                      GET /:id/yaml
router.use(versionsRouter);

export default router;
