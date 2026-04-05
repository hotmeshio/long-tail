import { Router } from 'express';

import discoveryRouter from './discovery';
import configRouter from './config';
import invocationRouter from './invocation';

const router = Router();

// Mount in original route registration order:
// 1. Discovery: /workers, /discovered, /cron/status
router.use(discoveryRouter);
// 2. Config: /config, /:type/config (GET, PUT, DELETE)
router.use(configRouter);
// 3. Invocation & observation: /:type/invoke, /:workflowId/*
router.use(invocationRouter);

export default router;
