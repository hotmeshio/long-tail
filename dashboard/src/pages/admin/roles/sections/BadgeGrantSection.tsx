import { IdCard } from 'lucide-react';
import { SectionGroup, safeParseJson, type Draft } from '../role-detail-shared';

interface BadgeGrant {
  ttl_seconds?: number;
  max_uses?: number;
}

/** The role's `badge_grant` from the draft's properties JSON, or null when it declares none. */
export function readBadgeGrantDraft(properties: string): BadgeGrant | null {
  const parsed = safeParseJson(properties);
  const grant = parsed.ok ? parsed.value?.badge_grant : undefined;
  return grant && typeof grant === 'object' && !Array.isArray(grant) ? (grant as BadgeGrant) : null;
}

/** Write one badge_grant field into the properties JSON; null when the bag is unparseable. */
export function patchBadgeGrantDraft(properties: string, patch: BadgeGrant): string | null {
  const parsed = safeParseJson(properties);
  if (!parsed.ok) return null;
  const bag: Record<string, unknown> = { ...(parsed.value ?? {}) };
  const next: Record<string, unknown> = { ...(readBadgeGrantDraft(properties) ?? {}), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  if (Object.keys(next).length) bag.badge_grant = next;
  else delete bag.badge_grant;
  return JSON.stringify(bag, null, 2);
}

/**
 * How a badge behaves at this role's stations: how long a scan stays primed
 * and how many acts it covers. Empty fields keep the badge scheme's policy.
 */
export function BadgeGrantSection({ draft, update }: { draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const grant = readBadgeGrantDraft(draft.properties) ?? {};
  const set = (patch: BadgeGrant) => {
    const next = patchBadgeGrantDraft(draft.properties, patch);
    if (next !== null) update({ properties: next });
  };
  const number = (value: string) => (value === '' ? undefined : Number(value));

  return (
    <SectionGroup icon={IdCard} label="Badge at this station" annotation="how long a badge scan lasts here">
      <p className="text-2xs text-text-tertiary leading-relaxed mb-3">
        A badge scanned on a device signed in to this role mints under this policy. Leave a field
        empty to keep the badge scheme's own value.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Lasts (seconds)</span>
          <span className="block text-2xs text-text-tertiary mb-1">1–86400; 600 is ten minutes.</span>
          <input
            type="number" min={1} max={86400}
            value={grant.ttl_seconds ?? ''}
            onChange={(e) => set({ ttl_seconds: number(e.target.value) })}
            className="input w-[12rem]"
            aria-label="Badge lasts (seconds)"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Acts per badge scan</span>
          <span className="block text-2xs text-text-tertiary mb-1">0 = as many as fit in the time; 1 = one act per scan.</span>
          <input
            type="number" min={0}
            value={grant.max_uses ?? ''}
            onChange={(e) => set({ max_uses: number(e.target.value) })}
            className="input w-[12rem]"
            aria-label="Acts per badge scan"
          />
        </label>
      </div>
    </SectionGroup>
  );
}
