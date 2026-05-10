/**
 * Durable-to-YAML compiler — converts procedural TypeScript workflows to YAML DAGs.
 *
 * This is "Path 3" for YAML DAG creation: static compilation from durable source
 * code without executing the workflow. The LLM translates the procedural orchestration
 * into an equivalent HotMesh YAML DAG that runs without replay overhead.
 *
 * Pipeline:
 *   1. Read source (file or inline string)
 *   2. Optionally resolve and read the activities module
 *   3. Extract metadata (activity names, primitives, control flow)
 *   4. Build LLM messages (system prompt + source + metadata)
 *   5. Call LLM (temperature 0, retry on parse failure)
 *   6. Fix known @pipe anti-patterns
 *   7. Return result compatible with existing YAML workflow CRUD
 */

import { readFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';

import { callLLM, type LLMResponse } from '../../llm';
import { LLM_MODEL_PRIMARY } from '../../../modules/defaults';
import { loggerRegistry } from '../../../lib/logger';
import { sanitizeToolName as sanitizeName } from '../../../modules/utils';
import type { CompileDurableOptions, CompileDurableResult, DurableSourceMetadata } from './types';
import { extractDurableMetadata } from './parser';
import { DURABLE_COMPILER_SYSTEM_PROMPT, buildUserMessage } from './prompts';

export type { CompileDurableOptions, CompileDurableResult } from './types';

const MAX_COMPILE_ATTEMPTS = 3;
const COMPILER_MAX_TOKENS = 8192;

/**
 * Compile a durable TypeScript workflow into a HotMesh YAML DAG.
 */
export async function compileDurableToYaml(
  options: CompileDurableOptions,
): Promise<CompileDurableResult> {
  const appId = options.appId || 'longtail';
  const graphTopic = options.subscribes || sanitizeName(options.name);

  // 1. Read source
  const source = options.isFilePath
    ? await readFile(options.source, 'utf-8')
    : options.source;

  // 2. Extract metadata
  const metadata = extractDurableMetadata(source, options.workflowName);

  // 3. Optionally resolve and read activities module
  let activitiesSource: string | undefined;
  if (options.isFilePath && metadata.activityImports.length > 0) {
    activitiesSource = await resolveActivitiesSource(
      options.source,
      metadata.activityImports,
    );
  }

  // 4. Load activity types reference
  const activityTypesRef = await loadActivityTypesReference();

  // 5. Build LLM messages
  const messages: any[] = [
    {
      role: 'system',
      content: DURABLE_COMPILER_SYSTEM_PROMPT(activityTypesRef, metadata),
    },
    {
      role: 'user',
      content: buildUserMessage(source, metadata, activitiesSource),
    },
  ];

  // 6. Call LLM with retry on parse failure
  let parsed: any = null;
  let lastError: string = '';

  for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    const response: LLMResponse = await callLLM({
      model: LLM_MODEL_PRIMARY,
      messages,
      temperature: 0,
      max_tokens: COMPILER_MAX_TOKENS,
    });

    loggerRegistry.info(
      `[durable-compiler] attempt=${attempt} ${Date.now() - t0}ms | in=${response.usage?.prompt_tokens} out=${response.usage?.completion_tokens}`,
    );

    const content = response.content || '';

    try {
      parsed = parseJsonResponse(content);
      break;
    } catch (err: any) {
      lastError = err.message;
      loggerRegistry.warn(
        `[durable-compiler] JSON parse failed (attempt ${attempt}): ${lastError}`,
      );

      // Feed error back for retry
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your response was not valid JSON. Error: ${lastError}\n\nPlease return ONLY the JSON object with no markdown fences or surrounding text.`,
      });
    }
  }

  if (!parsed) {
    throw new Error(
      `[durable-compiler] Failed to get valid JSON after ${MAX_COMPILE_ATTEMPTS} attempts. Last error: ${lastError}`,
    );
  }

  // 7. Fix known @pipe anti-patterns
  let yaml = fixPipePatterns(parsed.yaml || '');

  // 7b. Rewrite app.id to match the target appId
  yaml = yaml.replace(/^(\s*id:\s*)(.+)$/m, `$1${appId}`);

  // 8. Extract the actual subscribes topic from the YAML (LLM may choose its own)
  const subscribesMatch = yaml.match(/subscribes:\s*(.+)/);
  const actualTopic = subscribesMatch
    ? subscribesMatch[1].trim().replace(/^['"]|['"]$/g, '')
    : graphTopic;

  // 9. Build result
  return {
    yaml,
    inputSchema: parsed.input_schema || {},
    outputSchema: parsed.output_schema || {},
    activityManifest: parsed.activity_manifest || [],
    graphTopic: actualTopic,
    appId,
    tags: parsed.tags || ['durable'],
    inputFieldMeta: [],
    category: 'durable',
  };
}

/**
 * Parse a JSON response from the LLM, stripping markdown fences if present.
 */
function parseJsonResponse(content: string): any {
  let cleaned = content.trim();

  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }

  return JSON.parse(cleaned);
}

/**
 * Fix known @pipe anti-patterns that LLMs consistently produce.
 * Same fixes as the workflow-builder.
 */
function fixPipePatterns(yaml: string): string {
  // Fix: ['{@date.toISOString}'] then [0, 10] then ['{@string.substring}']
  yaml = yaml.replace(
    /(\['\{@date\.toISOString\}'\])\s*\n(\s*)- \[0, 10\]\s*\n(\s*)- \['\{@string\.substring\}'\]/g,
    "['{@date.toISOString}', 0, 10]\n$2- ['{@string.substring}']",
  );

  return yaml;
}

/**
 * Load the full activity-types.md reference file.
 */
async function loadActivityTypesReference(): Promise<string> {
  try {
    const refPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'system',
      'workflows',
      'mcp-workflow-builder',
      'reference',
      'activity-types.md',
    );
    return await readFile(refPath, 'utf-8');
  } catch {
    // Fallback: return minimal reference if file not found
    return '(Activity types reference not available — use trigger, worker, hook, await, cycle, signal, interrupt types as documented in HotMesh.)';
  }
}

/**
 * Resolve and read activities source from import paths.
 * Returns combined source of all activity modules found.
 */
async function resolveActivitiesSource(
  workflowFilePath: string,
  importPaths: string[],
): Promise<string | undefined> {
  const dir = dirname(workflowFilePath);
  const sources: string[] = [];

  for (const importPath of importPaths) {
    // Try common extensions
    const basePath = resolve(dir, importPath);
    for (const ext of ['.ts', '/index.ts', '.js', '/index.js']) {
      try {
        const content = await readFile(basePath + ext, 'utf-8');
        sources.push(`// ${importPath}\n${content}`);
        break;
      } catch {
        // Try next extension
      }
    }
  }

  return sources.length > 0 ? sources.join('\n\n') : undefined;
}
