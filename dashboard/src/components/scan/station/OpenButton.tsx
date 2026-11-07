import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClaimEscalation } from '../../../api/escalations';
import { metadataFacetsUrl } from '../../../lib/facet-url';
import type { ScanOpenLink } from '../../../api/scan-codes';

/** How long a claim made by Open lasts, as the detail page's own Claim. */
export const OPEN_CLAIM_MINUTES = 30;

/** Where an Open button leads: a row's detail page, or the list of rows sharing its facets. */
export function openPath(open: ScanOpenLink): string | null {
  if (open.facets) return metadataFacetsUrl(open.facets, open.role ?? null);
  return open.escalationId ? `/escalations/detail/${open.escalationId}` : null;
}

/**
 * The way from a scan result into its target, in the app. With `claim`, the
 * row is claimed first as the person acting (the badge rides the request);
 * a claim the server refuses still opens the row, read-only.
 */
export function OpenButton({ open, onLeave }: {
  open: ScanOpenLink;
  /** Runs before the station leaves (a hold lets go of its item). */
  onLeave?: () => void;
}) {
  const navigate = useNavigate();
  const claim = useClaimEscalation();
  const [busy, setBusy] = useState(false);
  const path = openPath(open);
  if (!path) return null;

  const go = async () => {
    setBusy(true);
    if (open.claim && open.escalationId) {
      try {
        await claim.mutateAsync({ id: open.escalationId, durationMinutes: OPEN_CLAIM_MINUTES });
      } catch {
        // The detail page shows the row as it stands and offers its own Claim.
      }
    }
    onLeave?.();
    navigate(path);
  };

  return (
    <button type="button" onClick={go} disabled={busy} className="btn-secondary mt-6" data-testid="scan-open">
      {open.label}
    </button>
  );
}
