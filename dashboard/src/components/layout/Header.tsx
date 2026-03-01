import { useAuth } from '../../hooks/useAuth';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between px-5">
      {/* Left: branding */}
      <div className="flex items-center">
        <img
          src="/logo512.png"
          alt="LongTail"
          className="w-10 h-10 shrink-0 -rotate-[120deg] mt-3"
        />
        <span className="text-[22px] font-normal text-text-primary tracking-tight -ml-[2px]">
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
