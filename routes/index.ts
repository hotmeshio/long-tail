import { Router } from 'express';

import { requireAuth } from '../modules/auth';
import tasksRouter from './tasks';
import escalationsRouter from './escalations';
import workflowsRouter from './workflows';
import workflowStatesRouter from './exports';
import configRouter from './config';
import usersRouter from './users';
import dbaRouter from './dba';

const router = Router();

// Apply auth to all API routes
router.use(requireAuth);

router.use('/tasks', tasksRouter);
router.use('/escalations', escalationsRouter);
router.use('/workflows', workflowsRouter);
router.use('/workflow-states', workflowStatesRouter);
router.use('/config/workflows', configRouter);
router.use('/users', usersRouter);
router.use('/dba', dbaRouter);

export default router;
