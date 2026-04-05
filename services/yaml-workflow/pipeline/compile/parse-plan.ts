/**
 * LLM response parsing for compilation plans.
 *
 * Parses raw JSON from the LLM into a typed EnhancedCompilationPlan,
 * handling missing or malformed fields gracefully.
 */

import type {
  EnhancedCompilationPlan,
  IterationSpec,
  DataFlowEdge,
  StepSpec,
} from '../../types';

/**
 * Parse the LLM's JSON response into an EnhancedCompilationPlan.
 * Handles missing/malformed fields gracefully.
 */
export function parsePlan(raw: string, stepCount: number): EnhancedCompilationPlan {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  // Parse steps
  const steps: StepSpec[] = (parsed.steps || []).map((s: any) => ({
    index: typeof s.index === 'number' ? s.index : 0,
    purpose: s.purpose || '',
    disposition: s.disposition === 'exploratory' ? 'exploratory' : 'core',
  }));

  // Parse iterations
  const iterations: IterationSpec[] = (parsed.iterations || []).map((it: any) => ({
    bodyStepIndex: typeof it.body_step_index === 'number' ? it.body_step_index : 0,
    toolName: it.tool_name || '',
    serverId: it.server_id,
    sourceStepIndex: typeof it.source_step_index === 'number' ? it.source_step_index : 0,
    sourceField: it.source_field || 'items',
    varyingKeys: Array.isArray(it.varying_keys) ? it.varying_keys : [],
    constantArgs: it.constant_args && typeof it.constant_args === 'object' ? it.constant_args : {},
    keyMappings: it.key_mappings && typeof it.key_mappings === 'object' ? it.key_mappings : {},
  }));

  // Parse data flow
  const dataFlow: DataFlowEdge[] = (parsed.data_flow || []).map((df: any) => {
    const edge: DataFlowEdge = {
      fromStep: df.from_step === 'trigger' ? 'trigger' : (typeof df.from_step === 'number' ? df.from_step : 0),
      fromField: df.from_field || '',
      toStep: typeof df.to_step === 'number' ? df.to_step : 0,
      toField: df.to_field || '',
      isSessionWire: !!df.is_session_wire,
    };
    // Parse transform spec if present — normalize snake_case from LLM to camelCase
    if (df.transform && typeof df.transform === 'object') {
      const rawDerivations = df.transform.derivations as Record<string, any> | undefined;
      const derivations = rawDerivations
        ? Object.fromEntries(
            Object.entries(rawDerivations).map(([k, v]) => [k, {
              sourceKey: v.source_key || v.sourceKey || '',
              strategy: v.strategy || 'passthrough',
              ...(v.prefix ? { prefix: v.prefix } : {}),
              ...(v.suffix ? { suffix: v.suffix } : {}),
              ...(v.template ? { template: v.template } : {}),
            }]),
          )
        : undefined;
      edge.transform = {
        fieldMap: df.transform.field_map && typeof df.transform.field_map === 'object'
          ? df.transform.field_map : {},
        ...(df.transform.defaults ? { defaults: df.transform.defaults } : {}),
        ...(derivations ? { derivations } : {}),
      };
    }
    return edge;
  });

  // Parse inputs
  const inputs = (parsed.inputs || []).map((inp: any) => ({
    key: inp.key,
    type: inp.type || 'string',
    classification: inp.classification === 'dynamic' ? 'dynamic' as const : 'fixed' as const,
    description: inp.description || '',
    ...(inp.default !== undefined ? { default: inp.default } : {}),
  }));

  return {
    intent: parsed.intent || '',
    description: parsed.description || '',
    steps,
    coreStepIndices: parsed.core_step_indices || steps
      .filter(s => s.disposition === 'core')
      .map(s => s.index),
    inputs,
    iterations,
    dataFlow,
    sessionFields: Array.isArray(parsed.session_fields) ? parsed.session_fields : [],
    hasIteration: iterations.length > 0 || !!parsed.has_iteration,
  };
}
