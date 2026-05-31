import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, User, BookOpen, Radio } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEscalationCounts } from '../../hooks/useEscalationCounts';
import { useEventStatus } from '../../hooks/useEventContext';
import { useAIOverride } from '../../api/settings';
import { AppLogo } from '../common/display/AppLogo';

export function Header({ onToggleEventFeed, onToggleDocs }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void }) {
  const { user, logout } = useAuth();
  const { available, mine } = useEscalationCounts();
  const { connected } = useEventStatus();
  const { aiOverrideActive, toggleAIOverride } = useAIOverride();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        <Link
          to="/"
          aria-label="Home"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              toggleAIOverride();
            }
          }}
        >
          <AppLogo className={aiOverrideActive ? 'grayscale opacity-60' : ''} />
        </Link>
      </div>

      <div className="flex items-center gap-5">
        {/* Escalations: all */}
        <Link
          to="/escalations/available"
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            available > 0 ? 'text-blue-400 hover:text-blue-300' : 'text-text-quaternary hover:text-text-secondary'
          }`}
          title="Available escalations"
        >
          <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
          all{available > 0 && <span className="tabular-nums font-medium">{available}</span>}
        </Link>

        {/* Escalations: mine */}
        <Link
          to="/escalations/queue"
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            mine > 0 ? 'text-status-warning hover:text-amber-300' : 'text-text-quaternary hover:text-text-secondary'
          }`}
          title="My escalation queue"
        >
          <Inbox className="w-3.5 h-3.5" strokeWidth={1.5} />
          mine{mine > 0 && <span className="tabular-nums font-medium">{mine}</span>}
        </Link>

        <div className="w-px h-4 bg-surface-border" />

        {/* Events */}
        <button
          type="button"
          onClick={onToggleEventFeed}
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            connected ? 'text-emerald-400 hover:text-emerald-300' : 'text-text-quaternary hover:text-text-secondary'
          }`}
          title={connected ? 'Live events — click to toggle feed' : 'Events disconnected'}
        >
          <Radio className="w-3.5 h-3.5" strokeWidth={1.5} />
          events
        </button>

        {/* Docs */}
        <button
          onClick={onToggleDocs}
          className="flex items-center gap-1.5 text-[11px] text-text-quaternary hover:text-text-secondary transition-colors"
          title="Documentation"
        >
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
          docs
        </button>

        <div className="w-px h-4 bg-surface-border" />

        {/* User menu */}
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
