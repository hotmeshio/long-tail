import { Router } from 'express';

import { requireAuth } from '../modules/auth';
import authRouter from './auth';
import authSSORouter from './auth-sso';
import oauthRouter from './oauth';
import delegationRouter from './delegation';
import tasksRouter from './tasks';
import escalationsRouter from './escalations';
import workflowsRouter from './workflows';
import workflowStatesRouter from './exports';
import usersRouter from './users';
import meRouter from './me';
import rolesRouter from './roles';
import dbaRouter from './dba';
import maintenanceRouter from './maintenance';
import mcpRouter from './mcp';
import insightRouter from './insight';
import yamlWorkflowsRouter from './yaml-workflows';
import settingsRouter from './settings';
import pipelinesRouter from './pipelines';
import namespacesRouter from './namespaces';
import filesRouter from './files';
import fileBrowserRouter from './file-browser';
import controlplaneRouter from './controlplane';
import botAccountsRouter from './bot-accounts';
import docsRouter from './docs';
import workflowSetsRouter from './workflow-sets';
import knowledgeRouter from './knowledge';
import agentsRouter from './agents';
import capabilitiesRouter from './capabilities';
import topicsRouter from './topics';
import natsCredentialsRouter from './nats-credentials';

const router = Router();

// Public routes (no auth required — they handle their own auth)
router.use('/auth', authRouter);
router.use('/auth', authSSORouter);
router.use('/auth/oauth', oauthRouter);
router.use('/delegation', delegationRouter);
router.use('/files', filesRouter);
router.use('/settings', settingsRouter);

// Apply auth to all API routes
router.use(requireAuth);

router.use('/nats-credentials', natsCredentialsRouter);
router.use('/tasks', tasksRouter);
router.use('/escalations', escalationsRouter);
router.use('/workflows', workflowsRouter);
router.use('/workflow-states', workflowStatesRouter);
router.use('/config/maintenance', maintenanceRouter);
router.use('/users', usersRouter);
router.use('/me', meRouter);
router.use('/roles', rolesRouter);
router.use('/dba', dbaRouter);
router.use('/mcp', mcpRouter);
router.use('/insight', insightRouter);
router.use('/yaml-workflows', yamlWorkflowsRouter);
router.use('/pipelines', pipelinesRouter);
router.use('/mcp-runs', pipelinesRouter); // backward-compat alias
router.use('/namespaces', namespacesRouter);
router.use('/file-browser', fileBrowserRouter);
router.use('/controlplane', controlplaneRouter);
router.use('/bot-accounts', botAccountsRouter);
router.use('/docs', docsRouter);
router.use('/workflow-sets', workflowSetsRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/agents', agentsRouter);
router.use('/capabilities', capabilitiesRouter);
router.use('/topics', topicsRouter);

import overviewRouter from './overview';
router.use('/overview', overviewRouter);

import diagnosticsRouter from './diagnostics';
router.use('/diagnostics', diagnosticsRouter);

export default router;
