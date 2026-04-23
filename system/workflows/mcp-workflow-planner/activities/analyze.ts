/**
 * Analyze a specification to determine whether it requires plan mode.
 * Returns structural signals extracted from the input.
 */

const PLAN_SIGNALS = [
  /\bworkflow[s]?\b/gi,
  /\bstep\s+\d/gi,
  /\bphase\s+\d/gi,
  /\bfirst\b.*\bthen\b/gi,
  /\bcompos/gi,
  /\borchestrat/gi,
  /\bpipeline/gi,
  /\bsub-?process/gi,
  /\bplan\b/gi,
];

const MIN_PLAN_LENGTH = 500;

export interface SpecAnalysis {
  requires_plan: boolean;
  signal_count: number;
  char_count: number;
  signals_found: string[];
}

export async function analyzeSpecification(
  specification: string,
): Promise<SpecAnalysis> {
  const charCount = specification.length;
  const signalsFound: string[] = [];

  for (const pattern of PLAN_SIGNALS) {
    const matches = specification.match(pattern);
    if (matches?.length) {
      signalsFound.push(matches[0]);
    }
  }

  const requiresPlan = charCount >= MIN_PLAN_LENGTH && signalsFound.length >= 2;

  return {
    requires_plan: requiresPlan,
    signal_count: signalsFound.length,
    char_count: charCount,
    signals_found: signalsFound,
  };
}
