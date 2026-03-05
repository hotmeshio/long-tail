import { Router } from 'express';

import { requireAuth } from '../modules/auth';
import authRouter from './auth';
import tasksRouter from './tasks';
import escalationsRouter from './escalations';
import workflowsRouter from './workflows';
import workflowStatesRouter from './exports';
import usersRouter from './users';
import rolesRouter from './roles';
import dbaRouter from './dba';
import maintenanceRouter from './maintenance';
import mcpRouter from './mcp';
import insightRouter from './insight';
import yamlWorkflowsRouter from './yaml-workflows';

const router = Router();

// Public routes (no auth required)
router.use('/auth', authRouter);

// Apply auth to all API routes
router.use(requireAuth);

router.use('/tasks', tasksRouter);
router.use('/escalations', escalationsRouter);
router.use('/workflows', workflowsRouter);
router.use('/workflow-states', workflowStatesRouter);
router.use('/config/maintenance', maintenanceRouter);
router.use('/users', usersRouter);
router.use('/roles', rolesRouter);
router.use('/dba', dbaRouter);
router.use('/mcp', mcpRouter);
router.use('/insight', insightRouter);
router.use('/yaml-workflows', yamlWorkflowsRouter);

export default router;
