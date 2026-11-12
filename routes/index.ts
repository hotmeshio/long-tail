import { Router } from '../lib/http';

import { requireAuth } from '../modules/auth';
import { requireNativeEngine } from './native-engine';
import authRouter from './auth';
import authSSORouter from './auth-sso';
import oauthRouter from './oauth';
import oauthServerRouter from './oauth-server';
import delegationRouter from './delegation';
import tasksRouter from './tasks';
import escalationsRouter from './escalations';
import workflowsRouter from './workflows';
import workflowStatesRouter from './exports';
import usersRouter from './users';
import meRouter from './me';
import rolesRouter from './roles';
import personasRouter from './personas';
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
import scanCodesRouter from './scan-codes';
import labelsRouter from './labels';
import identifiersRouter from './identifiers';
import domainRouter from './domain';
import announcementsRouter from './announcements';
import machinesRouter from './machines';

// Routes that work on every durable engine; the rest of their routers are HotMesh-only.
const WORKFLOW_NEUTRAL_ROUTES = [
  { method: 'POST', path: /^\/[^/]+\/terminate$/ },
  { method: 'GET', path: /^\/[^/]+\/describe$/ },
];
const WORKFLOW_STATE_NEUTRAL_ROUTES = [
  { method: 'GET', path: /^\/[^/]+\/execution$/ },
];

const router = Router();

// Public routes (no auth required — they handle their own auth)
router.use('/auth', authRouter);
router.use('/auth', authSSORouter);
router.use('/auth/oauth', oauthRouter);
router.use('/oauth', oauthServerRouter);
router.use('/delegation', delegationRouter);
router.use('/files', filesRouter);
router.use('/settings', settingsRouter);

// Apply auth to all API routes
router.use(requireAuth);

router.use('/nats-credentials', natsCredentialsRouter);
router.use('/tasks', requireNativeEngine(), tasksRouter);
router.use('/escalations', escalationsRouter);
router.use('/workflows', requireNativeEngine(WORKFLOW_NEUTRAL_ROUTES), workflowsRouter);
router.use('/workflow-states', requireNativeEngine(WORKFLOW_STATE_NEUTRAL_ROUTES), workflowStatesRouter);
router.use('/config/maintenance', requireNativeEngine(), maintenanceRouter);
router.use('/users', usersRouter);
router.use('/me', meRouter);
router.use('/roles', rolesRouter);
router.use('/personas', personasRouter);
router.use('/dba', requireNativeEngine(), dbaRouter);
router.use('/mcp', mcpRouter);
router.use('/insight', requireNativeEngine(), insightRouter);
router.use('/yaml-workflows', requireNativeEngine(), yamlWorkflowsRouter);
router.use('/pipelines', requireNativeEngine(), pipelinesRouter);
router.use('/mcp-runs', requireNativeEngine(), pipelinesRouter); // backward-compat alias
router.use('/namespaces', requireNativeEngine(), namespacesRouter);
router.use('/file-browser', fileBrowserRouter);
router.use('/controlplane', requireNativeEngine(), controlplaneRouter);
router.use('/bot-accounts', botAccountsRouter);
router.use('/docs', docsRouter);
router.use('/workflow-sets', requireNativeEngine(), workflowSetsRouter);
router.use('/knowledge', knowledgeRouter);
router.use('/agents', agentsRouter);
router.use('/capabilities', capabilitiesRouter);
router.use('/topics', topicsRouter);
router.use('/scan-codes', scanCodesRouter);
router.use('/labels', labelsRouter);
router.use('/identifiers', identifiersRouter);
router.use('/domain', domainRouter);
router.use('/announcements', announcementsRouter);
router.use('/machines', machinesRouter);

import overviewRouter from './overview';
router.use('/overview', overviewRouter);

import diagnosticsRouter from './diagnostics';
router.use('/diagnostics', requireNativeEngine(), diagnosticsRouter);

export default router;
