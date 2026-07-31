import type { CSSProperties } from 'react';
import { LT_BASE } from '../../../lib/base-path';

interface AppLogoProps {
  size?: 'sm' | 'lg';
  /** Hide the wordmark (used during login launch animation). */
  hideLabel?: boolean;
  /** Extra CSS classes on the outer container. */
  className?: string;
  /** Override the wordmark text. Defaults to "LongTail". */
  appName?: string;
  /**
   * `mark` renders the pineapple alone at header scale — no wordmark, no
   * rotation, no watermark bleed. The header-diet variant for narrow
   * viewports where the mark IS the brand.
   *
   * `comet` renders a large tilted pineapple bleeding above/behind the header
   * — no wordmark, motion energy at the smallest breakpoint.
   */
  variant?: 'full' | 'mark' | 'comet';
}

/**
 * Shared branding mark used in the header toolbar and login page.
 *
 * The pineapple is rendered large + rotated behind the wordmark, creating a
 * watermark effect. It takes the theme accent color (the PNG's alpha channel
 * used as a CSS mask) at reduced opacity so the ink wordmark stays legible.
 * The `size` prop scales the pair:
 * - `sm` (default) — toolbar height
 * - `lg` — login page hero
 */
export function AppLogo({ size = 'sm', hideLabel = false, className = '', appName = 'LongTail', variant = 'full' }: AppLogoProps) {
  const isLarge = size === 'lg';

  if (variant === 'comet') {
    // Pineapple watermark behind the hamburger area: 202° rotation (180° from
    // the naive upright) puts the crown downward and the leafy base streaming
    // upward — the same motion logic as the full-logo's -rotate-[120deg]
    // watermark. z-index: -1 keeps it behind hamburger / back-fwd siblings
    // within the header's stacking context while remaining visible above the
    // header's own background paint. Negative left pulls the mark back over
    // the hamburger button; top bleeds slightly above the header top edge so
    // the leaf tips clip at the viewport boundary (tail of the comet).
    return (
      <div
        className={`relative overflow-visible ${className}`}
        style={{ width: '2.5rem', height: '2.5rem', flexShrink: 0 }}
      >
        <span
          role="img"
          aria-label={appName}
          className="logo-mark absolute pointer-events-none select-none"
          style={{
            '--logo-url': `url(${LT_BASE}/logo512.png)`,
            width: '82px',
            height: '82px',
            top: '-12px',
            left: '-80px',
            transform: 'rotate(232deg)',
            zIndex: -1,
            opacity: 0.55,
          } as CSSProperties}
        />
      </div>
    );
  }

  if (variant === 'mark') {
    return (
      <div className={`flex items-center ${className}`}>
        <span
          role="img"
          aria-label={appName}
          className="logo-mark shrink-0 w-7 h-7"
          style={{ '--logo-url': `url(${LT_BASE}/logo512.png)` } as CSSProperties}
        />
      </div>
    );
  }

  const imgClass = isLarge
    ? 'w-[16rem] h-[16rem] -rotate-[120deg] opacity-55 -ml-10'
    : 'w-[12.5rem] h-[12.5rem] -rotate-[120deg] opacity-55 -ml-8';

  const textClass = isLarge
    ? 'text-[44px] font-normal text-text-primary tracking-[0.15em] -ml-[12.5rem]'
    : 'text-[36px] font-normal text-text-primary tracking-[0.15em] -ml-[9.75rem]';

  return (
    <div className={`flex items-center ${className}`} style={{ height: '50px' }}>
      <span
        role="img"
        aria-label={appName}
        className={`logo-mark shrink-0 z-0 ${imgClass}`}
        style={{ '--logo-url': `url(${LT_BASE}/logo512.png)` } as CSSProperties}
      />
      <span className={`z-[1] transition-opacity duration-300 ${textClass} ${hideLabel ? 'opacity-0' : ''}`}>
        {appName}
      </span>
    </div>
  );
}
