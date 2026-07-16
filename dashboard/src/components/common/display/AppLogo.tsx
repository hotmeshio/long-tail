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
export function AppLogo({ size = 'sm', hideLabel = false, className = '', appName = 'LongTail' }: AppLogoProps) {
  const isLarge = size === 'lg';

  const imgClass = isLarge
    ? 'w-[16rem] h-[16rem] -rotate-[120deg] opacity-40 -ml-10'
    : 'w-[12.5rem] h-[12.5rem] -rotate-[120deg] opacity-40 -ml-8';

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
