import { useEffect, useState } from 'react';
import { CircleX, Package, ScanBarcode } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';
import { HeldRoster } from './HeldRoster';
import { OpenButton } from './OpenButton';
import { expectedLine } from './RefusalPanel';
import type { StationSubject } from '../../../lib/scan-subject';
import type { ScanOpenLink } from '../../../api/scan-codes';

const RELEASE_LABEL_DEFAULT = 'Put it down';

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

/**
 * The station holding an item. With a headline (where the item goes) the
 * destination leads, read from across the bench: the container code largest, its
 * place name under it, the item itself as a quiet line above. Without one,
 * the item leads. The subject lapses on its own (the scan pipeline clears it
 * at expiry); the per-second tick is a visible clock, not polling.
 *
 * With `show`, the held row's roster stays under the card for the whole
 * motion, and a refused scan reads on the card above it. The release button
 * reads as the rule names it; Open leads into the held row.
 */
export function HoldScreen({
  subject,
  primedName,
  progress,
  progressLabel = 'checked off',
  note,
  refusal,
  refreshKey = 0,
  onRelease,
  onOpen,
  onAllIn,
}: {
  subject: StationSubject;
  primedName: string | null;
  progress?: { filled: number; total: number; remaining: number } | null;
  /** What the count measures: a fill checks items off, an accumulate adds them. */
  progressLabel?: string;
  /** The last act's done copy while the item is still held (a fill in progress). */
  note?: string | null;
  /** A refused scan while the list stays on screen. */
  refusal?: { markdown: string; expected?: string[]; open?: ScanOpenLink } | null;
  /** Changes on every bench response, so the shown roster refetches. */
  refreshKey?: number;
  onRelease: () => void;
  /** The station leaves for an Open target. */
  onOpen?: () => void;
  /** Every entry on the shown roster is in. */
  onAllIn?: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, []);

  const destination = !!subject.headline;

  return (
    <div
      key={subject.escalationId}
      className={`flex-1 flex flex-col items-center ${subject.show ? 'justify-start' : 'justify-center'} text-center py-16 animate-page-enter`}
      data-testid="hold-screen"
    >
      {destination ? (
        <>
          <p className="text-sm text-text-tertiary">
            Holding <span className="font-mono text-text-secondary">{subject.label}</span>
          </p>
          <h1
            className="mt-6 font-mono font-light text-7xl leading-none tracking-tight text-text-primary max-w-full break-all"
            data-testid="hold-headline"
          >
            {subject.headline}
          </h1>
          {subject.subline && (
            <p className="heading-2 mt-4" data-testid="hold-subline">{subject.subline}</p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-8">
            <Package className="w-10 h-10 text-accent-muted" strokeWidth={1} />
            <ScanBarcode className="w-8 h-8 text-text-quaternary" strokeWidth={1} />
          </div>
          <p className="text-sm text-text-tertiary">Holding</p>
          <h1 className="text-3xl font-light text-text-primary tracking-tight mt-1 font-mono">{subject.label}</h1>
        </>
      )}
      {subject.expect?.prompt ? (
        <div className="text-lg text-text-secondary mt-8 max-w-prose">
          <SimpleMarkdown content={subject.expect.prompt} inherit />
        </div>
      ) : (
        <p className="text-lg text-text-secondary mt-8">Scan where it goes</p>
      )}
      {refusal && (
        <div role="alert" className="mt-6 flex items-start gap-3 text-left max-w-prose" data-testid="hold-refusal">
          <CircleX className="w-6 h-6 text-status-error shrink-0 mt-0.5" strokeWidth={1.5} />
          <div>
            <div className="text-lg text-text-primary"><SimpleMarkdown content={refusal.markdown} inherit /></div>
            {refusal.expected && refusal.expected.length > 0 && (
              <p className="text-sm text-text-secondary mt-1">
                Expected <span className="text-text-primary">{expectedLine(refusal.expected)}</span>
              </p>
            )}
            {refusal.open && <OpenButton open={refusal.open} onLeave={onOpen} />}
          </div>
        </div>
      )}
      {note ? (
        <div className="text-base text-text-primary mt-4" data-testid="hold-progress">
          <SimpleMarkdown content={note} inherit />
        </div>
      ) : progress && progress.total > 0 && (
        <p className="text-base text-text-primary mt-4 tabular-nums" data-testid="hold-progress">
          {progress.filled} of {progress.total} {progressLabel}
        </p>
      )}
      {subject.claimedBy && (
        <p className="text-sm text-status-warning mt-4">Claimed by {subject.claimedBy.displayName}</p>
      )}
      <div className="w-16 border-t border-surface-border my-8" />
      <p className="text-sm text-text-tertiary">
        {primedName ? `Badge: ${primedName}` : 'Scan your badge when you place it'}
        <span className="mx-2">·</span>
        <span className="font-mono tabular-nums">{secondsLeft(subject.expiresAt)}s</span>
      </p>
      <div className="flex items-center gap-4">
        {subject.open && <OpenButton open={subject.open} onLeave={onOpen} />}
        <button
          type="button"
          onClick={onRelease}
          className={subject.release?.tone === 'accent'
            ? 'btn-primary mt-6'
            : 'mt-6 text-sm text-text-tertiary hover:text-text-secondary hover:underline'}
          data-testid="hold-release"
        >
          {subject.release?.label ?? RELEASE_LABEL_DEFAULT}
        </button>
      </div>
      {subject.show && (
        <HeldRoster
          escalationId={subject.escalationId}
          field={subject.show}
          refreshKey={refreshKey}
          onAllIn={subject.whenAllIn ? onAllIn : undefined}
        />
      )}
    </div>
  );
}
