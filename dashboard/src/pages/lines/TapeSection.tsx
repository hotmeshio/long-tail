import { useRef } from 'react';
import { Maximize2, Minimize2, Radio } from 'lucide-react';
import { FullscreenOverlay } from '../../components/common/layout/FullscreenOverlay';
import { WireTape, type WireTapeProps } from './WireTape';

/** The embed: a bordered box of its own, the band inside, the list scrolling within. */
export const TAPE_BOX_CLASS = 'flex flex-col h-full min-h-0 overflow-hidden rounded-[var(--lt-radius-section)] border border-surface-border bg-surface-sunken';

export interface TapeSectionProps extends Omit<WireTapeProps, 'controls' | 'listClassName' | 'listRef'> {
  fullscreen: boolean;
  onFullscreen: (open: boolean) => void;
  /** Whether the shell's event stream already carries this line's wire. */
  watching: boolean;
  onWatch: () => void;
}

/**
 * The wire as an embed beneath the machines: boxed in, its filters and
 * controls in its own band, a full-screen view in the shell's overlay, and
 * a way to keep watching the line from the event stream anywhere in the app.
 */
export function TapeSection(props: TapeSectionProps) {
  const { fullscreen, onFullscreen, watching, onWatch, ...tape } = props;
  const listRef = useRef<HTMLUListElement | null>(null);
  const controls = (
    <>
      <button type="button" onClick={() => onFullscreen(true)} className="inline-flex items-center gap-1 text-2xs icon-link" title="Full screen">
        <Maximize2 className="w-3 h-3" />
        Full screen
      </button>
      <button
        type="button"
        onClick={onWatch}
        disabled={watching}
        className="inline-flex items-center gap-1 text-2xs icon-link disabled:opacity-60"
        title={watching ? 'The event stream carries this line' : 'Add this line to the event stream'}
      >
        <Radio className="w-3 h-3" />
        {watching ? 'Watching' : 'Watch on the event stream'}
      </button>
    </>
  );
  return (
    <section aria-label="Wire tape" className={TAPE_BOX_CLASS}>
      <WireTape {...tape} controls={controls} listRef={listRef} />
      <FullscreenOverlay open={fullscreen} onClose={() => onFullscreen(false)} sourceRef={listRef}>
        <div className="sticky top-0 float-right z-10">
          <button
            type="button"
            onClick={() => onFullscreen(false)}
            className="p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150 bg-surface-sunken/80 backdrop-blur-sm"
            title="Close (Esc)"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
        {fullscreen && <WireTape {...tape} listClassName="min-h-[60vh]" />}
      </FullscreenOverlay>
    </section>
  );
}
