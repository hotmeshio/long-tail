// The media a deployment prints on: the shipped presets plus any the host
// declares in start({ labels: { media } }).

import { config } from '../../modules/config';
import { LABEL_MEDIA, assertValidMedia, resolveMedia } from '../../shared/labels/media';
import type { LabelMedia } from '../../shared/labels/types';

let hostMedia: LabelMedia[] = [];
let defaultMediaId = config.LT_LABELS_DEFAULT_MEDIA;

/** Replace the host's media presets; each must fit its page and not shadow a shipped id. */
export function registerLabelMedia(media: LabelMedia[]): void {
  for (const m of media) {
    assertValidMedia(m);
    if (LABEL_MEDIA.some((shipped) => shipped.id === m.id)) {
      throw new Error(`label media "${m.id}" is a shipped preset; give the host preset its own id`);
    }
  }
  hostMedia = [...media];
}

/** Set the deployment's default media; it must be a known preset. */
export function setDefaultLabelMedia(id: string): void {
  resolveMedia(id, labelMediaPresets());
  defaultMediaId = id;
}

export function labelMediaPresets(): LabelMedia[] {
  return [...LABEL_MEDIA, ...hostMedia];
}

export function defaultLabelMediaId(): string {
  return defaultMediaId;
}

/** The media a job prints on: the job's choice, the template's, then the deployment default. */
export function mediaForJob(requested: string | LabelMedia | undefined, templateMedia: string | null): LabelMedia {
  return resolveMedia(requested ?? templateMedia ?? defaultMediaId, labelMediaPresets());
}

/** Restore the shipped presets and the configured default. For tests. */
export function resetLabelMedia(): void {
  hostMedia = [];
  defaultMediaId = config.LT_LABELS_DEFAULT_MEDIA;
}
