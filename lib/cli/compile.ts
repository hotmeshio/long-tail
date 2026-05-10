import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import ora from 'ora';

import { compileDurableToYaml } from '../../services/yaml-workflow/durable-compiler';
import { hasLLMApiKey } from '../../services/llm';
import { scanForWorkflows, analyzeFile } from './scanner';
import {
  resolveOutputPath,
  writeCompiledYaml,
  printDiscovery,
  printCompiled,
  printSummary,
  printError,
} from './output';
import type { CompileOptions } from './types';

// ── Orchestrator ─────────────────────────────────────────────────────────

export async function compileCommand(
  target: string | undefined,
  options: CompileOptions,
): Promise<void> {
  const model = options.model || process.env.LT_LLM_MODEL_PRIMARY || 'claude-sonnet-4-6';
  const quiet = !!options.quiet;

  // 1. Validate LLM API key
  if (!hasLLMApiKey(model)) {
    if (!quiet) {
      console.error(pc.red('\n  No LLM API key found.'));
      console.error(pc.dim('  Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.'));
      console.error(pc.dim('  Or create a .env file in the current directory:\n'));
      console.error(pc.dim('    ANTHROPIC_API_KEY=sk-ant-...\n'));
    }
    process.exit(1);
  }

  // 2. Resolve target path
  const resolved = resolveTarget(target, quiet);

  // 3. Discover workflows
  const workflows = discoverWorkflows(resolved, options.function, quiet);
  if (workflows.length === 0) {
    if (!quiet) console.log(pc.yellow('\n  No workflow files found.\n'));
    process.exit(0);
  }

  // 4. Dry run — show discoveries and exit
  if (options.dryRun) {
    if (!quiet) printDiscovery(workflows);
    return;
  }

  // 5. Compile each workflow
  if (!quiet) console.log();
  const t0 = Date.now();
  let compiled = 0;

  for (const wf of workflows) {
    compiled += await compileOne(wf.path, wf.relativePath, wf.functionName, model, quiet, options.output)
      ? 1 : 0;
  }

  // 6. Summary
  if (!quiet) printSummary(compiled, Date.now() - t0);

  if (compiled < workflows.length) {
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveTarget(target: string | undefined, quiet: boolean): { type: 'file' | 'directory'; path: string } {
  const resolved = path.resolve(target || '.');

  if (!fs.existsSync(resolved)) {
    if (!quiet) console.error(pc.red(`\n  Not found: ${resolved}\n`));
    process.exit(1);
  }

  const stat = fs.statSync(resolved);
  return { type: stat.isDirectory() ? 'directory' : 'file', path: resolved };
}

function discoverWorkflows(
  resolved: { type: 'file' | 'directory'; path: string },
  functionFilter?: string,
  quiet?: boolean,
) {
  if (resolved.type === 'file') {
    const baseDir = path.dirname(resolved.path);
    const wf = analyzeFile(resolved.path, baseDir, functionFilter);
    if (!wf) {
      if (!quiet) console.log(pc.yellow(`\n  ${path.basename(resolved.path)} does not appear to be a durable workflow.\n`));
      process.exit(0);
    }
    return [wf];
  }
  return scanForWorkflows(resolved.path, functionFilter);
}

async function compileOne(
  filePath: string,
  relativePath: string,
  functionName: string,
  model: string,
  quiet: boolean,
  outputDir?: string,
): Promise<boolean> {
  const modelShort = model.replace(/^claude-/, '').replace(/^gpt-/, '');
  const spinner = quiet
    ? null
    : ora({
        text: `Compiling ${pc.bold(relativePath)} ${pc.dim(`(${functionName} · ${modelShort})`)}`,
        indent: 2,
      }).start();

  try {
    const result = await compileDurableToYaml({
      source: filePath,
      isFilePath: true,
      workflowName: functionName,
      name: functionName,
    });

    const outputPath = resolveOutputPath(filePath, outputDir);
    writeCompiledYaml(outputPath, result, filePath, functionName, model);

    const outputRelative = path.relative(process.cwd(), outputPath);

    spinner?.stop();
    if (!quiet) printCompiled(relativePath, outputRelative, result);
    return true;
  } catch (err: any) {
    spinner?.stop();
    if (!quiet) printError(relativePath, formatCompileError(err));
    return false;
  }
}

function formatCompileError(err: any): string {
  const msg = err.message || String(err);

  // LLM API errors
  if (msg.includes('401') || msg.includes('authentication')) {
    return 'API key rejected — check ANTHROPIC_API_KEY or OPENAI_API_KEY';
  }
  if (msg.includes('429') || msg.includes('rate limit')) {
    return 'Rate limited — wait a moment and retry';
  }
  if (msg.includes('Failed to get valid JSON')) {
    return 'LLM returned invalid output after 3 attempts — try a different model with --model';
  }

  // File errors
  if (msg.includes('ENOENT')) {
    return `File not found: ${msg.split("'").at(1) || msg}`;
  }

  // Truncate long errors
  return msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
}
