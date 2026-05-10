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

  // 1. Validate LLM API key
  if (!hasLLMApiKey(model)) {
    console.error(pc.red('\n  No LLM API key found.'));
    console.error(pc.dim('  Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.\n'));
    process.exit(1);
  }

  // 2. Resolve target path
  const resolved = resolveTarget(target);

  // 3. Discover workflows
  const workflows = discoverWorkflows(resolved, options.function);
  if (workflows.length === 0) {
    console.log(pc.yellow('\n  No workflow files found.\n'));
    process.exit(0);
  }

  // 4. Dry run — show discoveries and exit
  if (options.dryRun) {
    printDiscovery(workflows);
    return;
  }

  // 5. Compile each workflow
  console.log();
  const t0 = Date.now();
  let compiled = 0;

  for (const wf of workflows) {
    compiled += await compileOne(wf.path, wf.relativePath, wf.functionName, model, options.output)
      ? 1 : 0;
  }

  // 6. Summary
  printSummary(compiled, Date.now() - t0);

  if (compiled < workflows.length) {
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveTarget(target: string | undefined): { type: 'file' | 'directory'; path: string } {
  const resolved = path.resolve(target || '.');

  if (!fs.existsSync(resolved)) {
    console.error(pc.red(`\n  Not found: ${resolved}\n`));
    process.exit(1);
  }

  const stat = fs.statSync(resolved);
  return { type: stat.isDirectory() ? 'directory' : 'file', path: resolved };
}

function discoverWorkflows(
  resolved: { type: 'file' | 'directory'; path: string },
  functionFilter?: string,
) {
  if (resolved.type === 'file') {
    const baseDir = path.dirname(resolved.path);
    const wf = analyzeFile(resolved.path, baseDir, functionFilter);
    if (!wf) {
      console.log(pc.yellow(`\n  ${path.basename(resolved.path)} does not appear to be a durable workflow.\n`));
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
  outputDir?: string,
): Promise<boolean> {
  const spinner = ora({
    text: `Compiling ${pc.bold(relativePath)} (${functionName})`,
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

    const baseDir = outputDir || path.dirname(filePath);
    const outputRelative = path.relative(process.cwd(), outputPath);

    spinner.stop();
    printCompiled(relativePath, outputRelative, result);
    return true;
  } catch (err: any) {
    spinner.stop();
    printError(relativePath, err.message);
    return false;
  }
}
