import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, User, BookOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEscalationCounts } from '../../hooks/useEscalationCounts';
import { NatsStatus } from '../common/display/NatsStatus';
import { AppLogo } from '../common/display/AppLogo';

function CountBadge({ count, active, color = 'bg-blue-500', textColor = 'text-blue-500' }: { count: number; active: boolean; color?: string; textColor?: string }) {
  return (
    <>
      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${active ? color : 'bg-text-tertiary/40'}`} />
      <span className={`absolute -top-2.5 -right-3 text-[8px] font-bold tabular-nums ${active ? textColor : 'text-text-tertiary'}`}>
        {count}
      </span>
    </>
  );
}

export function Header({ onToggleEventFeed, onToggleDocs }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void }) {
  const { user, logout } = useAuth();
  const { available, mine } = useEscalationCounts();
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

      {/* Right: escalation indicators | separator | docs, events, user */}
      <div className="flex items-center gap-4">
        {/* Escalation indicators — leftmost */}
        <Link
          to="/escalations/available"
          className="relative text-text-tertiary hover:text-accent transition-colors"
          aria-label="Available escalations"
          title="Available escalations"
        >
          <AlertCircle className="w-4 h-4" strokeWidth={1.5} />
          <CountBadge count={available} active={available > 0} />
        </Link>
        <Link
          to="/escalations/queue"
          className="relative text-text-tertiary hover:text-accent transition-colors"
          aria-label="My escalation queue"
          title="My escalation queue"
        >
          <Inbox className="w-4 h-4" strokeWidth={1.5} />
          <CountBadge count={mine} active={mine > 0} color="bg-status-warning" textColor="text-status-warning" />
        </Link>

        {/* Separator */}
        <div className="w-px h-5 bg-surface-border" />

        {/* Events, docs, user */}
        <NatsStatus onClick={onToggleEventFeed} />
        <button
          onClick={onToggleDocs}
          className="text-text-tertiary hover:text-accent transition-colors"
          aria-label="Documentation"
          title="Documentation"
        >
          <BookOpen className="w-4 h-4" strokeWidth={1.5} />
        </button>
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
