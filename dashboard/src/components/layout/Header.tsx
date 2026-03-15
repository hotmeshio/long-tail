import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { NatsStatus } from '../common/display/NatsStatus';
import { AppLogo } from '../common/display/AppLogo';
import { InsightSearch } from '../insight/InsightSearch';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between px-5 relative z-30">
      <Link to="/" aria-label="Home">
        <AppLogo />
      </Link>

      {/* Center: AI search */}
      <InsightSearch />

      {/* Right: NATS indicator + user identity + sign out */}
      <div className="flex items-center gap-4">
        <NatsStatus />
        {user && (
          <span className="text-xs text-text-tertiary">
            {user.displayName || user.username || user.userId}
          </span>
        )}
        <button onClick={logout} className="btn-ghost text-xs">
          Sign Out
        </button>
      </div>
    </header>
  );
}
