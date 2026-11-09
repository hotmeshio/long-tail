import { CONFIDENCE_TONES, type ConfidenceTone } from '../../../lib/x-lt-confidence';

/** Text-safe status tokens for words, graphic tokens for dots. One map, so every tranche reads alike. */
export const REVIEW_TONE_CLASSES: Record<ConfidenceTone, { text: string; dot: string }> = {
  [CONFIDENCE_TONES.ERROR]: { text: 'text-status-error', dot: 'bg-status-error' },
  [CONFIDENCE_TONES.WARNING]: { text: 'text-status-warning', dot: 'bg-status-pending-graphic' },
  [CONFIDENCE_TONES.INFO]: { text: 'text-status-active', dot: 'bg-status-active' },
};

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}
