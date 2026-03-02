import { useAuth } from '../../hooks/useAuth';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between px-5">
      {/* Left: branding */}
      <div className="flex items-center overflow-hidden">
        <img
          src="/logo512.png"
          alt="LongTail"
          className="w-[12.5rem] h-[12.5rem] shrink-0 -rotate-[120deg] z-0 opacity-40 -ml-8"
        />
        <span className="text-[36px] font-normal text-text-primary tracking-[0.15em] z-[1] -ml-[9.75rem]">
          LongTail
        </span>
      </div>

      {/* Right: user identity + sign out */}
      <div className="flex items-center gap-4">
        {user && (
          <span className="text-xs text-text-tertiary font-mono">
            {user.userId}
          </span>
        )}
        <button onClick={logout} className="btn-ghost text-xs">
          Sign Out
        </button>
      </div>
    </header>
  );
}
