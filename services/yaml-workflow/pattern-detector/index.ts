/**
 * Pattern detection for YAML workflow generation.
 *
 * Analyzes extracted step sequences to detect higher-order structural
 * patterns -- entirely tool-agnostic. The detector recognizes shapes
 * in the call flow (iteration, repetition) and collapses them into
 * richer YAML structures.
 *
 * Patterns detected:
 * 1. **Iteration**: Same tool called N times with systematically varying
 *    arguments -> collapse into a single step with an array input.
 * 2. **Constant args**: Arguments that don't change across repeated calls
 *    -> extract as shared config (not iterated).
 * 3. **Array source**: When a prior step's result contains an array
 *    whose length matches the repetition count -> link as the data source.
 */

export type { ExtractedStepLike, PatternAnnotation } from './types';
export { collapseIterationPatterns, detectPatterns } from './collapse';
