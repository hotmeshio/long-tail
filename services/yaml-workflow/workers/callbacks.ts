import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import {
  LLM_MAX_ARRAY_ITEMS,
  LLM_MAX_INPUT_CHARS,
  LLM_MAX_TOKENS_JSON,
  LLM_MODEL_SECONDARY,
} from '../../../modules/defaults';
import { loggerRegistry } from '../../../lib/logger';
import { callLLM as callLLMService } from '../../llm';
import type { ChatMessage, LLMResponse } from '../../llm';
import type { ActivityManifestEntry } from '../../../types/yaml-workflow';

interface CallLLMOptions {
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

/** Call the LLM with messages and optional format options. */
async function callWorkerLLM(
  messages: ChatMessage[],
  options?: CallLLMOptions,
): Promise<LLMResponse> {
  return callLLMService({
    model: LLM_MODEL_SECONDARY,
    max_tokens: options?.max_tokens ?? LLM_MAX_TOKENS_JSON,
    messages,
    ...(options?.response_format ? { response_format: options.response_format } : {}),
  });
}

/**
 * Compact input data for LLM consumption: truncate large arrays and
 * strip fields that are unhelpful for summarization (ids, trace data).
 */
export function compactForLlm(input: Record<string, unknown>): Record<string, unknown> {
  const omitKeys = new Set(['trace_id', 'span_id', 'resolved_at']);
  const compact = (val: unknown): unknown => {
    if (Array.isArray(val)) {
      const mapped = val.map(compact);
      if (mapped.length > LLM_MAX_ARRAY_ITEMS) {
        return [...mapped.slice(0, LLM_MAX_ARRAY_ITEMS), `... (${mapped.length - LLM_MAX_ARRAY_ITEMS} more)`];
      }
      return mapped;
    }
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (!omitKeys.has(k)) out[k] = compact(v);
      }
      return out;
    }
    return val;
  };
  return compact(input) as Record<string, unknown>;
}

/**
 * Build an LLM worker callback that interpolates a prompt template with
 * input data and calls the LLM for interpretation/synthesis.
 */
export function buildLlmCallback(activity: ActivityManifestEntry) {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const rawInput = (data.data || {}) as Record<string, unknown>;
    const input = compactForLlm(rawInput);
    const template = activity.prompt_template || '';
    const model = activity.model || LLM_MODEL_SECONDARY;

    // Serialize and enforce hard character limit
    let inputJson = JSON.stringify(input, null, 2);
    if (inputJson.length > LLM_MAX_INPUT_CHARS) {
      inputJson = inputJson.slice(0, LLM_MAX_INPUT_CHARS) + '\n... (truncated)';
    }

    // Parse the template into messages. Format: [role]\ncontent\n\n[role]\ncontent
    const messages: Array<{ role: string; content: string }> = [];
    const parts = template.split(/\n\n(?=\[(?:system|user|assistant)\])/);
    for (const part of parts) {
      const roleMatch = part.match(/^\[(\w+)\]\n([\s\S]*)$/);
      if (roleMatch) {
        let content = roleMatch[2];
        // Interpolate {field} placeholders with input data
        // {input_data} is a special placeholder for the full JSON input
        content = content.replace(/\{input_data\}/g, inputJson);
        content = content.replace(/\{(\w+)\}/g, (_, key) => {
          if (key in input) return String(input[key]);
          return `{${key}}`;
        });
        messages.push({ role: roleMatch[1], content });
      } else if (part.trim()) {
        messages.push({ role: 'user', content: part.trim() });
      }
    }

    if (messages.length === 0) {
      messages.push({ role: 'user', content: `Analyze the following data:\n${inputJson}` });
    }

    // Call the LLM with JSON mode for structured output
    const response = await callWorkerLLM(messages as any, {
      max_tokens: LLM_MAX_TOKENS_JSON,
      response_format: { type: 'json_object' },
    });
    const content = response.content || '';

    // Try to parse JSON from the response
    let result: unknown;
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/\s*```$/m, '')
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { response: content };
    }

    loggerRegistry.info(`[yaml-workflow] LLM step completed (model: ${model}, topic: ${activity.topic})`);
    return {
      metadata: { ...data.metadata },
      data: result as Record<string, unknown>,
    };
  };
}

/**
 * Apply a derivation strategy to produce a computed value from a source string.
 */
function applyDerivation(
  value: string,
  spec: NonNullable<NonNullable<ActivityManifestEntry['transform_spec']>['derivations']>[string],
): string {
  let result = value;
  switch (spec.strategy) {
    case 'slugify': {
      // Extract path from URL if it looks like a URL, otherwise use raw value
      try {
        const url = new URL(result);
        result = url.pathname.replace(/^\//, '').replace(/\//g, '-') || 'home';
      } catch {
        result = result.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (spec.prefix) result = spec.prefix + result;
      if (spec.suffix) result = result + spec.suffix;
      break;
    }
    case 'prefix':
      result = (spec.prefix || '') + result + (spec.suffix || '');
      break;
    case 'template':
      result = (spec.template || '{value}').replace(/\{value\}/g, result);
      break;
    case 'passthrough':
      break;
  }
  return result;
}

/**
 * Build a transform worker callback that reshapes array data between steps.
 * Applies field renames, defaults, and derivations.
 */
export function buildTransformCallback(activity: ActivityManifestEntry) {
  const spec = activity.transform_spec;
  if (!spec) throw new Error(`Transform activity ${activity.activity_id} missing transform_spec`);

  return async (data: StreamData): Promise<StreamDataResponse> => {
    const input = (data.data || {}) as Record<string, unknown>;
    const sourceData = input[spec.sourceField];

    if (!Array.isArray(sourceData)) {
      // Pass through non-array data unchanged
      return {
        metadata: { ...data.metadata },
        data: { [spec.targetField]: sourceData, ...input },
      };
    }

    // Resolve dynamic directory prefix from trigger inputs (e.g., screenshot_dir)
    const dirKeys = ['screenshot_dir', 'screenshots_dir', 'output_dir'];
    const dynamicDir = dirKeys.reduce<string | null>(
      (found, key) => found || (input[key] ? String(input[key]) : null), null,
    );

    const reshaped = sourceData.map((item: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};

      // Apply field map: target key -> source key
      for (const [targetKey, sourceKey] of Object.entries(spec.fieldMap)) {
        if (sourceKey !== null) {
          out[targetKey] = item[sourceKey];
        } else if (spec.derivations?.[targetKey]) {
          // Computed field: use dynamic dir when available for path derivations
          const derivation = { ...spec.derivations[targetKey] };
          if (dynamicDir && targetKey.includes('path')) {
            derivation.prefix = dynamicDir.replace(/\/$/, '') + '/';
          }
          const sourceValue = String(item[derivation.sourceKey] || '');
          out[targetKey] = applyDerivation(sourceValue, derivation);
        }
      }

      // Apply defaults
      if (spec.defaults) {
        for (const [key, value] of Object.entries(spec.defaults)) {
          if (!(key in out)) out[key] = value;
        }
      }

      return out;
    });

    // Return reshaped data alongside any other input fields (session handles, etc.)
    const result: Record<string, unknown> = { ...input, [spec.targetField]: reshaped };
    return {
      metadata: { ...data.metadata },
      data: result,
    };
  };
}
