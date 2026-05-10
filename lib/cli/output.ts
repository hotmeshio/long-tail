import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

import type { CompileDurableResult } from '../../services/yaml-workflow/durable-compiler';
import type { DiscoveredWorkflow } from './types';

/**
 * Build the output file path for a compiled workflow.
 * Default: adjacent to source — assembly-line.ts → assembly-line.compiled.yaml
 */
export function resolveOutputPath(sourcePath: string, outputDir?: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const outputFile = `${base}.compiled.yaml`;
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    return path.join(outputDir, outputFile);
  }
  return path.join(path.dirname(sourcePath), outputFile);
}

/**
 * Write the compiled YAML with a header comment.
 */
export function writeCompiledYaml(
  outputPath: string,
  result: CompileDurableResult,
  sourcePath: string,
  functionName: string,
  model: string,
): void {
  const header = [
    `# Compiled from: ${path.basename(sourcePath)}`,
    `# Function: ${functionName}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Model: ${model}`,
    '#',
    '# This YAML DAG is functionally equivalent to the source durable workflow',
    '# but runs without replay overhead. Each step executes exactly once.',
    '',
  ].join('\n');

  fs.writeFileSync(outputPath, header + result.yaml, 'utf-8');
}

/**
 * Print a discovery summary (dry-run mode).
 */
export function printDiscovery(workflows: DiscoveredWorkflow[]): void {
  console.log();
  console.log(pc.bold(`  Found ${workflows.length} workflow${workflows.length === 1 ? '' : 's'}:`));
  console.log();

  for (const wf of workflows) {
    const framework = wf.framework === 'hotmesh-durable'
      ? pc.cyan('HotMesh Durable')
      : wf.framework === 'temporal'
        ? pc.magenta('Temporal')
        : pc.dim('unknown');

    console.log(`  ${pc.green('●')} ${pc.bold(wf.relativePath)}`);
    console.log(`    Function: ${pc.white(wf.functionName)}  ·  ${framework}`);
    if (wf.activities.length > 0) {
      console.log(`    Activities: ${wf.activities.join(', ')}`);
    }
    if (wf.primitives.length > 0) {
      console.log(`    Control flow: ${wf.primitives.join(', ')}`);
    }
    console.log();
  }
}

/**
 * Print a compilation success line.
 */
export function printCompiled(
  relativePath: string,
  outputRelative: string,
  result: CompileDurableResult,
): void {
  const activityCount = result.activityManifest.filter((a) => a.type === 'worker').length;
  const inputKeys = Object.keys(
    (result.inputSchema as any)?.properties || {},
  );
  const inputs = inputKeys.length > 0 ? inputKeys.join(', ') : 'none';

  console.log(`  ${pc.green('✓')} ${relativePath} ${pc.dim('→')} ${pc.bold(outputRelative)}`);
  console.log(
    `    ${activityCount} activities · ${inputKeys.length} inputs (${inputs}) · topic: ${pc.cyan(result.graphTopic)}`,
  );
}

/**
 * Print final summary.
 */
export function printSummary(count: number, elapsedMs: number): void {
  const seconds = (elapsedMs / 1000).toFixed(1);
  console.log();
  console.log(
    `  ${pc.bold(`Compiled ${count} workflow${count === 1 ? '' : 's'}`)} in ${seconds}s`,
  );
  console.log();
}

/**
 * Print an error for a single workflow.
 */
export function printError(relativePath: string, error: string): void {
  console.log(`  ${pc.red('✗')} ${relativePath}`);
  console.log(`    ${pc.red(error)}`);
}
