/**
 * Lightweight regex-based metadata extractor for durable workflow source.
 *
 * Extracts structural hints (activity names, primitives, control flow)
 * that ground the LLM during compilation. This is NOT a full AST parser —
 * it gives the LLM better context without requiring ts-morph or the TS compiler API.
 */

import type { DurableSourceMetadata } from './types';

/**
 * Extract structural metadata from durable workflow TypeScript source.
 */
export function extractDurableMetadata(
  source: string,
  workflowFunctionName: string,
): DurableSourceMetadata {
  return {
    workflowFunctionName,
    activityNames: extractActivityNames(source),
    durablePrimitives: extractDurablePrimitives(source),
    envelopeFields: extractEnvelopeFields(source),
    activityImports: extractActivityImports(source),
    hasForLoop: /\bfor\s*\(/.test(source) || /\.forEach\(/.test(source),
    hasPromiseAll: /Promise\.all/.test(source),
    hasConditionalBranch: /\bif\s*\(/.test(source),
    hasEscalation: /type:\s*['"]escalation['"]/.test(source),
  };
}

/**
 * Extract activity function names from proxyActivities destructuring.
 *
 * Matches patterns like:
 *   const { greet, fetchData } = Durable.workflow.proxyActivities<T>({ ... });
 */
function extractActivityNames(source: string): string[] {
  const names: string[] = [];

  // Match destructured names from proxyActivities assignments
  const proxyPattern = /(?:const|let)\s*\{\s*([^}]+)\}\s*=\s*(?:Durable\.workflow\.)?proxyActivities/g;
  let match: RegExpExecArray | null;
  while ((match = proxyPattern.exec(source)) !== null) {
    const destructured = match[1];
    for (const name of destructured.split(',')) {
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
  }

  return names;
}

/**
 * Extract Durable.workflow.* primitive calls.
 */
function extractDurablePrimitives(source: string): string[] {
  const primitives: string[] = [];
  const seen = new Set<string>();

  // Durable.workflow.sleep, condition, startChild, workflowInfo, etc.
  const durablePattern = /Durable\.workflow\.(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = durablePattern.exec(source)) !== null) {
    const prim = match[1];
    if (prim !== 'proxyActivities' && !seen.has(prim)) {
      seen.add(prim);
      primitives.push(prim);
    }
  }

  // conditionLT (LT-specific wrapper)
  if (/conditionLT/.test(source) && !seen.has('conditionLT')) {
    primitives.push('conditionLT');
  }

  // executeLT (orchestrator wrapper)
  if (/executeLT/.test(source) && !seen.has('executeLT')) {
    primitives.push('executeLT');
  }

  return primitives;
}

/**
 * Extract envelope field names from data destructuring.
 *
 * Matches patterns like:
 *   const { message, role } = envelope.data;
 *   const { productName, stations } = envelope.data as { ... };
 */
function extractEnvelopeFields(source: string): string[] {
  const fields: string[] = [];

  const envelopePattern = /(?:const|let)\s*\{\s*([^}]+)\}\s*=\s*envelope\.data/g;
  let match: RegExpExecArray | null;
  while ((match = envelopePattern.exec(source)) !== null) {
    const destructured = match[1];
    for (const field of destructured.split(',')) {
      // Strip defaults and type annotations
      const name = field.trim().split(/\s*[=:]/)[0].trim();
      if (name) fields.push(name);
    }
  }

  return fields;
}

/**
 * Extract import paths for activity modules.
 *
 * Matches: import * as activities from './activities';
 *          import * as interceptorActivities from '../../../services/interceptor/activities';
 */
function extractActivityImports(source: string): string[] {
  const imports: string[] = [];

  const importPattern = /import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}
