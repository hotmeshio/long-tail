import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, User, BookOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useMyEscalationCount } from '../../hooks/useMyEscalationCount';
import { NatsStatus } from '../common/display/NatsStatus';
import { AppLogo } from '../common/display/AppLogo';

export function Header({ onToggleEventFeed, onToggleDocs }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void }) {
  const { user, logout } = useAuth();
  const pendingCount = useMyEscalationCount();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between px-5 relative z-30">
      <div className="flex items-center gap-4">
        <Link to="/" aria-label="Home">
          <AppLogo />
        </Link>
      </div>

      {/* Right: inbox, event status indicator + user menu */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleDocs}
          className="text-text-tertiary hover:text-accent transition-colors"
          aria-label="Documentation"
          title="Documentation"
        >
          <BookOpen className="w-4 h-4" strokeWidth={1.5} />
        </button>
        <Link
          to="/escalations/queue"
          className="relative text-text-tertiary hover:text-accent transition-colors"
          aria-label="Escalation inbox"
          title="Escalation inbox"
        >
          <Inbox className="w-4 h-4" strokeWidth={1.5} />
          <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${pendingCount > 0 ? 'bg-status-warning' : 'bg-text-tertiary'}`} />
          <span className={`absolute -top-2.5 -right-3 text-[8px] font-bold tabular-nums ${pendingCount > 0 ? 'text-status-warning' : 'text-text-tertiary'}`}>{pendingCount}</span>
        </Link>
        <NatsStatus onClick={onToggleEventFeed} />
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="btn-ghost text-xs flex items-center gap-1"
            >
              <User className="w-3.5 h-3.5 text-accent/75" strokeWidth={1.5} />
              {user.displayName || user.username || user.userId}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-surface-raised border border-surface-border rounded-md shadow-lg py-1 z-50">
                <Link
                  to="/credentials"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                >
                  Credentials
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="block w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
