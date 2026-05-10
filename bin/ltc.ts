#!/usr/bin/env node

// Suppress internal logger output in CLI mode — the spinner is the progress indicator
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { program } from 'commander';
import pc from 'picocolors';

import { compileCommand } from '../lib/cli/compile';
import { initCommand } from '../lib/cli/init';

const pkg = require('../package.json');

// Detect if .env was loaded
const envPath = path.resolve(process.cwd(), '.env');
const envLoaded = fs.existsSync(envPath);

program
  .name('ltc')
  .description('Long Tail Compiler — tsc for workflows')
  .version(pkg.version)
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.commands[0]?.opts?.() || {};
    if (opts.quiet) return;
    console.log();
    console.log(`  ${pc.bold('ltc')} ${pc.dim(`v${pkg.version}`)}`);
    if (envLoaded) {
      console.log(`  ${pc.dim('.env loaded')}`);
    }
  });

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
  .description('Create a .env file with LLM API key template')
  .action(initCommand);

program.parse();
