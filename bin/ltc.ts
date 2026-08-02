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
import * as personas from '../lib/cli/commands/personas';
import * as streams from '../lib/cli/commands/streams';

const pkg = require('../package.json');
const envPath = path.resolve(process.cwd(), '.env');
const envLoaded = fs.existsSync(envPath);

// ── Error handler ────────────────────────────────────────────────────────

function handleError(err: any): never {
  const msg = err.message || String(err);
  console.error(`\n  ${pc.red('✗')} ${msg}`);
  // Schema-validation rejections carry field-level violations — print each
  // one the way the dashboard's errors panel lists them.
  if (Array.isArray(err.violations)) {
    for (const v of err.violations) {
      const where = v.escalationId ? `${v.escalationId} · ${v.field}` : v.field;
      console.error(`    ${pc.dim('·')} ${pc.bold(where)} — ${v.message}`);
    }
  }
  console.error('');
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

escCmd.command('aggregate-facets')
  .description('Grouped analytics over escalation intervals: membership at an instant, or dwell over a window')
  .option('--role <role>', 'Single pond role')
  .option('--roles <json>', 'Multiple roles, JSON array (no role at all = every pond; global principals only)')
  .option('--entity <key>', "Entity facet key (e.g. serialNumber) — scopes to every role declaring it (the entity's system)")
  .option('--group-state', "Group by the derived STATE label (each role's subtypes or itself) — 'how do the entities spend their time'")
  .option('--facets <json>', 'Required facets (JSON object, metadata @>)')
  .option('--exists <json>', 'Metadata keys that must be present (JSON array)')
  .option('--prefix <json>', 'Case-insensitive prefix match on facet values, e.g. \'{"serialNumber":"PRN"}\'')
  .option('--any-of <json>', 'Rows carrying ANY of these facet sets (JSON array, max 200) — target an explicit entity set')
  .option('--group-columns <list>', 'Comma-separated group columns: role,subtype,status')
  .option('--group-facets <list>', 'Comma-separated metadata keys to group by')
  .option('--as-of <iso>', 'Membership at this ISO instant (default: now; past reconstructs the live set then)')
  .option('--window <json>', 'Dwell window {"from":"...","to":"..."} — switches the measure to dwell')
  .option('--distinct-by <key>', 'Count DISTINCT of this facet (entities, not rows; membership only)')
  .option('--live-statuses <list>', 'Comma-separated statuses considered live (default: pending)')
  .option('--order-by <json>', 'Result-group order, JSON array e.g. \'[{"field":"count","direction":"desc"}]\'')
  .option('--limit <n>', 'Max result groups')
  .option('--offset <n>', 'Result-group offset')
  .option('--json', 'JSON output')
  .action(wrap(esc.aggregateByFacets));

escCmd.command('timeline <key> <value>')
  .description("One entity's ordered escalation-interval timeline (gaps = untracked time)")
  .option('--roles <json>', 'Restrict to these roles, JSON array')
  .option('--entity <key>', "Scope to the entity's system (every role declaring this entity facet); omitted with no --roles, the query spans every queue (global principals only)")
  .option('--from <iso>', 'Window start (with --to; only overlapping intervals)')
  .option('--to <iso>', 'Window end')
  .option('--select-facets <list>', 'Comma-separated metadata keys to surface per interval')
  .option('--order <dir>', 'asc (default) or desc — desc + --before pages a long history recent-first')
  .option('--before <iso>', 'Strict upper bound on startedAt — the "load earlier" cursor')
  .option('--limit <n>', 'Max intervals')
  .option('--json', 'JSON output')
  .action(wrap(esc.timelineByFacet));

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

// ── Personas ─────────────────────────────────────────────────────────────

const personasCmd = program.command('personas').description('Personas — named role bundles with per-role relationship scope');

personasCmd.command('list')
  .option('--json', 'JSON output')
  .option('-q, --quiet', 'Keys only')
  .action(wrap(personas.listPersonas));

personasCmd.command('get <key>')
  .description('Show a persona with its role links and assignees')
  .option('--json', 'JSON output')
  .action(wrap(personas.getPersona));

personasCmd.command('assign <key> <userId>')
  .description('Assign a persona to a user (idempotent; re-assigning overlays fresh)')
  .option('--json', 'JSON output')
  .action(wrap(personas.assignPersona));

personasCmd.command('unassign <key> <userId>')
  .description('Unassign a persona — removes only the memberships it sustains')
  .option('--json', 'JSON output')
  .action(wrap(personas.unassignPersona));

personasCmd.command('for-user <userId>')
  .description('Show the personas a user holds and the composed role/scope map')
  .option('--json', 'JSON output')
  .action(wrap(personas.getUserPersonas));

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
