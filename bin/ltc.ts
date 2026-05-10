#!/usr/bin/env node

import 'dotenv/config';
import { program } from 'commander';

import { compileCommand } from '../lib/cli/compile';

// Read version from package.json at runtime
const pkg = require('../package.json');

program
  .name('ltc')
  .description('Long Tail Compiler — tsc for workflows')
  .version(pkg.version);

program
  .command('compile [target]')
  .description('Compile durable TypeScript workflows to YAML DAGs')
  .option('--dry-run', 'Show discovered workflows without compiling')
  .option('-o, --output <dir>', 'Output directory (default: adjacent to source)')
  .option('--model <model>', 'LLM model to use')
  .option('--function <name>', 'Workflow function name (auto-detected if omitted)')
  .action(compileCommand);

program.parse();
