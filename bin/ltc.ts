#!/usr/bin/env node

// Suppress internal logger output in CLI mode
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { program } from 'commander';
import pc from 'picocolors';

import { compileCommand } from '../lib/cli/compile';
import { initCommand } from '../lib/cli/init';
import { login, logout } from '../lib/cli/auth';
import { statusCommand } from '../lib/cli/commands/status';
import * as esc from '../lib/cli/commands/escalations';
import * as wf from '../lib/cli/commands/workflows';
import * as pip from '../lib/cli/commands/pipelines';
import * as kb from '../lib/cli/commands/knowledge';
import * as mcp from '../lib/cli/commands/mcp';
import * as usr from '../lib/cli/commands/users';
import * as roles from '../lib/cli/commands/roles';
import * as streams from '../lib/cli/commands/streams';

const pkg = require('../package.json');
const envPath = path.resolve(process.cwd(), '.env');
const envLoaded = fs.existsSync(envPath);

// ── Error handler ────────────────────────────────────────────────────────

function handleError(err: any): never {
  const msg = err.message || String(err);
  console.error(`\n  ${pc.red('✗')} ${msg}\n`);
  process.exit(1);
}

function wrap(fn: (...args: any[]) => Promise<void>) {
  return (...args: any[]) => fn(...args).catch(handleError);
}

// ── Program ──────────────────────────────────────────────────────────────

program
  .name('ltc')
  .description('Long Tail CLI — workflows, escalations, knowledge, and more')
  .version(pkg.version)
  .hook('preAction', (thisCommand) => {
    const cmd = thisCommand.args?.[0];
    // Skip banner for quiet/json modes and version
    if (process.argv.includes('-q') || process.argv.includes('--quiet') || process.argv.includes('--json')) return;
    if (cmd === '--version' || cmd === '-V') return;
    console.log();
    console.log(`  ${pc.bold('ltc')} ${pc.dim(`v${pkg.version}`)}`);
    if (envLoaded) console.log(`  ${pc.dim('.env loaded')}`);
  });

// ── Auth ─────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with a Long Tail instance')
  .option('-s, --server <url>', 'Server URL')
  .option('-u, --username <name>', 'Username')
  .option('-p, --password <pass>', 'Password')
  .action(wrap(async (opts) => login(opts)));

program
  .command('logout')
  .description('Clear stored credentials')
  .action(() => logout());

program
  .command('status')
  .description('Show instance health and summary counts')
  .action(wrap(statusCommand));

// ── Compile ──────────────────────────────────────────────────────────────

program
  .command('compile [target]')
  .description('Compile durable TypeScript workflows to YAML DAGs')
  .option('--dry-run', 'Show discovered workflows without compiling')
  .option('-o, --output <dir>', 'Output directory (default: adjacent to source)')
  .option('--model <model>', 'LLM model to use')
  .option('--function <name>', 'Workflow function name (auto-detected if omitted)')
  .option('-q, --quiet', 'Minimal output (exit codes only)')
  .action(compileCommand);

program
  .command('init')
  .description('Create a .env file with API key template')
  .action(initCommand);

// ── Escalations ──────────────────────────────────────────────────────────

const escCmd = program.command('escalations').alias('esc').description('Manage escalations');

escCmd.command('list')
  .option('--status <status>', 'Filter by status (pending, resolved, cancelled)')
  .option('--role <role>', 'Filter by role')
  .option('--search <term>', 'Exact-match by correlation id (escalation id, workflow id, or origin id). For a value inside metadata, use --facets')
  .option('--limit <n>', 'Max results')
  .option('--facets <json>', 'Required metadata facets, JSON object (metadata @>), e.g. \'{"filament":"pla"}\'')
  .option('--block <json>', 'Exclude rows containing ANY of these facet sets, JSON array')
  .option('--range <json>', 'Numeric ranges over facets, JSON array e.g. \'[{"facet":"confidence","op":"<=","value":0.7}]\'')
  .option('--exists <json>', 'Metadata keys that must be present, JSON array of strings')
  .option('--roles <json>', 'Restrict to these roles, JSON array (narrows within scope)')
  .option('--available <bool>', 'true = unclaimed/expired only; false = held now')
  .option('--order-by <json>', 'Sort keys, JSON array e.g. \'[{"field":"metadata.confidence","numeric":true,"direction":"asc"}]\'')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(esc.listEscalations));

escCmd.command('get <id>')
  .option('--json', 'JSON output')
  .action(wrap(esc.getEscalation));

escCmd.command('claim <id>')
  .option('--duration <minutes>', 'Claim duration in minutes')
  .action(wrap(esc.claimEscalation));

escCmd.command('release <id>')
  .action(wrap(esc.releaseEscalation));

escCmd.command('resolve <id>')
  .requiredOption('--data <json>', 'Resolver payload (JSON string)')
  .action(wrap(esc.resolveEscalation));

escCmd.command('find-by-meta <key> <value>')
  .description('Find escalations by metadata key-value pair')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(esc.findByMetadata));

escCmd.command('claim-by-meta <key> <value>')
  .description('Claim an escalation by metadata key-value pair')
  .option('--duration <minutes>', 'Claim duration in minutes')
  .option('--assignee <external_id>', 'Claim on behalf of user (external_id)')
  .option('--meta <json>', 'Merge metadata (JSON object, e.g. \'{"claimedBy":"jimbo"}\')')
  .action(wrap(esc.claimByMetadata));

escCmd.command('resolve-by-meta <key> <value>')
  .description('Resolve an escalation by metadata key-value pair')
  .option('--data <json>', 'Resolver payload (JSON string)')
  .option('--assignee <external_id>', 'Resolve on behalf of user (external_id)')
  .option('--meta <json>', 'Merge metadata (JSON object)')
  .action(wrap(esc.resolveByMetadata));

escCmd.command('resolve-by-ids <ids...>')
  .description('Resolve a set of escalations by id')
  .requiredOption('--payload <json>', 'Resolver payload (JSON string)')
  .option('--metadata <json>', 'Merge metadata (JSON object)')
  .action(wrap(esc.resolveByIds));

escCmd.command('search-facets')
  .description('Item-level faceted search over a pond (role-scoped)')
  .requiredOption('--role <role>', 'Pond role to search')
  .option('--status <status>', 'Filter by status')
  .option('--available', 'Only available (unclaimed/expired)')
  .option('--facets <json>', 'Required facets (JSON object)')
  .option('--limit <n>', 'Max results')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(esc.searchByFacets));

escCmd.command('claim-groups')
  .description('Batch-claim complete origin groups in priority order')
  .requiredOption('--role <role>', 'Pond role to claim from')
  .option('--facets <json>', 'Required facets (JSON object)')
  .option('--limit <n>', 'Max groups to claim')
  .option('--duration <minutes>', 'Claim duration in minutes')
  .option('--size-facet <key>', 'Metadata facet declaring group size')
  .option('--json', 'JSON output')
  .action(wrap(esc.claimGroups));

escCmd.command('claim-by-facets')
  .description('Batch-claim individual rows matching facets')
  .requiredOption('--role <role>', 'Pond role to claim from')
  .option('--facets <json>', 'Required facets (JSON object)')
  .option('--limit <n>', 'Max rows to claim')
  .option('--duration <minutes>', 'Claim duration in minutes')
  .option('--all-or-none', 'Claim all matched rows or none')
  .option('--json', 'JSON output')
  .action(wrap(esc.claimByFacets));

// ── Workflows ────────────────────────────────────────────────────────────

const wfCmd = program.command('workflows').alias('wf').description('Manage durable workflows');

wfCmd.command('list')
  .option('--include-system', 'Include system workflows')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(wf.listWorkflows));

wfCmd.command('invoke <type>')
  .option('--data <json>', 'Input data (JSON string)')
  .option('--json', 'JSON output')
  .action(wrap(wf.invokeWorkflow));

wfCmd.command('status <id>')
  .option('--json', 'JSON output')
  .action(wrap(wf.getWorkflowStatus));

wfCmd.command('result <id>')
  .option('--json', 'JSON output')
  .action(wrap(wf.getWorkflowResult));

wfCmd.command('terminate <id>')
  .action(wrap(wf.terminateWorkflow));

// ── Pipelines (YAML Workflows) ──────────────────────────────────────────

const pipCmd = program.command('pipelines').alias('pip').description('Manage YAML pipeline tools');

pipCmd.command('list')
  .option('--status <status>', 'Filter by status (active, draft, deployed, archived)')
  .option('--limit <n>', 'Max results')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(pip.listPipelines));

pipCmd.command('get <id>')
  .option('--json', 'JSON output')
  .action(wrap(pip.getPipeline));

pipCmd.command('deploy <id>')
  .action(wrap(pip.deployPipeline));

pipCmd.command('invoke <id>')
  .option('--data <json>', 'Input data (JSON string)')
  .option('--sync', 'Wait for result')
  .option('--json', 'JSON output')
  .action(wrap(pip.invokePipeline));

pipCmd.command('archive <id>')
  .action(wrap(pip.archivePipeline));

// ── Knowledge ────────────────────────────────────────────────────────────

const kbCmd = program.command('knowledge').alias('kb').description('Manage knowledge store');

kbCmd.command('domains')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(kb.listDomains));

kbCmd.command('list <domain>')
  .option('--search <term>', 'Search by key or tag')
  .option('--limit <n>', 'Max results')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'Keys only')
  .action(wrap(kb.listEntries));

kbCmd.command('get <domain> <key>')
  .option('--json', 'JSON output')
  .action(wrap(kb.getEntry));

kbCmd.command('set <domain> <key> <path> <value>')
  .option('--json', 'JSON output')
  .description('Set a value at a dot-path (e.g., ltc kb set research screenshots google.holiday "Mother\'s Day")')
  .action(wrap(kb.setField));

kbCmd.command('remove <domain> <key> <path>')
  .description('Remove a field at a dot-path')
  .action(wrap(kb.removeField));

kbCmd.command('delete <domain> <key>')
  .description('Delete an entire entry')
  .action(wrap(kb.deleteEntry));

// ── MCP ──────────────────────────────────────────────────────────────────

const mcpCmd = program.command('mcp').description('MCP server and tool management');

mcpCmd.command('servers')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(mcp.listServers));

mcpCmd.command('tools <serverId>')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'Names only')
  .action(wrap(mcp.listTools));

// ── Users ────────────────────────────────────────────────────────────────

const usrCmd = program.command('users').description('User management (admin)');

usrCmd.command('list')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(usr.listUsers));

usrCmd.command('get <id>')
  .option('--json', 'JSON output')
  .action(wrap(usr.getUser));

// ── Roles ────────────────────────────────────────────────────────────────

const rolesCmd = program.command('roles').description('Roles — the queue-backed work surfaces where workflows hand off to people');

rolesCmd.command('list')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'Names only')
  .action(wrap(roles.listRoles));

rolesCmd.command('schema <role>')
  .description('Show a role\'s form/metadata schema (latest, or a pinned version)')
  .option('--version <n>', 'Read an immutable snapshot from the version history')
  .option('--json', 'JSON output')
  .action(wrap(roles.getRoleSchema));

rolesCmd.command('schema-versions <role>')
  .description('List a role\'s schema version history (newest first)')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'Versions only')
  .action(wrap(roles.listRoleSchemaVersions));

rolesCmd.command('save-schema <role>')
  .description('Save the role\'s escalation form schema (a change creates the next version)')
  .option('--file <path>', 'JSON Schema file (reads stdin when omitted)')
  .option('--summary <text>', 'Change summary recorded on the new version')
  .option('--json', 'JSON output')
  .action(wrap(roles.saveRoleSchema));

// ── Streams ─────────────────────────────────────────────────────────────

const streamsCmd = program.command('streams').description('Browse stream messages (admin)');

streamsCmd.command('list')
  .requiredOption('-n, --namespace <ns>', 'Schema namespace (e.g. durable)')
  .requiredOption('-s, --source <source>', 'Stream type (engine or worker)')
  .option('--status <status>', 'Filter by status (pending, claimed, processed, dead_lettered)')
  .option('--stream <name>', 'Filter by stream name (partial match)')
  .option('--type <type>', 'Filter by message type (worker only)')
  .option('--limit <n>', 'Max results (default 25)')
  .option('--offset <n>', 'Pagination offset')
  .option('--sort <col>', 'Sort column (created_at, stream_name, priority, id)')
  .option('--order <dir>', 'Sort direction (asc, desc)')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'IDs only')
  .action(wrap(streams.listMessages));

// ── Parse ────────────────────────────────────────────────────────────────

program.parse();
