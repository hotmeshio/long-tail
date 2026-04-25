import { Router } from 'express';

import { requireAuth } from '../modules/auth';
import authRouter from './auth';
import oauthRouter from './oauth';
import delegationRouter from './delegation';
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
import settingsRouter from './settings';
import mcpRunsRouter from './mcp-runs';
import namespacesRouter from './namespaces';
import filesRouter from './files';
import controlplaneRouter from './controlplane';
import botAccountsRouter from './bot-accounts';
import docsRouter from './docs';
import workflowSetsRouter from './workflow-sets';

const router = Router();

// Public routes (no auth required — they handle their own auth)
router.use('/auth', authRouter);
router.use('/auth/oauth', oauthRouter);
router.use('/delegation', delegationRouter);
router.use('/files', filesRouter);
router.use('/settings', settingsRouter);

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
router.use('/mcp-runs', mcpRunsRouter);
router.use('/namespaces', namespacesRouter);
router.use('/controlplane', controlplaneRouter);
router.use('/bot-accounts', botAccountsRouter);
router.use('/docs', docsRouter);
router.use('/workflow-sets', workflowSetsRouter);

export default router;
