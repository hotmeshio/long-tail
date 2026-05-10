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
  .option('--limit <n>', 'Max results')
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

// ── Parse ────────────────────────────────────────────────────────────────

program.parse();
