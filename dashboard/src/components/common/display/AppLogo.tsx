interface AppLogoProps {
  size?: 'sm' | 'lg';
  /** Hide the wordmark (used during login launch animation). */
  hideLabel?: boolean;
}

/**
 * Shared branding mark used in the header toolbar and login page.
 *
 * The logo image is rendered large + rotated behind the wordmark,
 * creating a watermark effect. The `size` prop scales the pair:
 * - `sm` (default) — toolbar height
 * - `lg` — login page hero
 */
export function AppLogo({ size = 'sm', hideLabel = false }: AppLogoProps) {
  const isLarge = size === 'lg';

  const imgClass = isLarge
    ? 'w-[16rem] h-[16rem] -rotate-[120deg] opacity-40 -ml-10'
    : 'w-[12.5rem] h-[12.5rem] -rotate-[120deg] opacity-40 -ml-8';

  const textClass = isLarge
    ? 'text-[44px] font-normal text-text-primary tracking-[0.15em] -ml-[12.5rem]'
    : 'text-[36px] font-normal text-text-primary tracking-[0.15em] -ml-[9.75rem]';

  return (
    <div className="flex items-center" style={{ height: '50px' }}>
      <img
        src="/logo512.png"
        alt="LongTail"
        className={`shrink-0 z-0 ${imgClass}`}
      />
      <span className={`z-[1] transition-opacity duration-300 ${textClass} ${hideLabel ? 'opacity-0' : ''}`}>
        LongTail
      </span>
    </div>
  );
}
