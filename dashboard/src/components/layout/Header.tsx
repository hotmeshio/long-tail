import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, User, BookOpen, Radio } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useEscalationCounts } from '../../hooks/useEscalationCounts';
import { useEventStatus } from '../../hooks/useEventContext';
import { useAIOverride } from '../../api/settings';
import { AppLogo } from '../common/display/AppLogo';
import { THEMES, THEME_LABELS, THEME_SWATCHES, getTheme, setTheme, type Theme } from '../../lib/theme';

export function Header({ onToggleEventFeed, onToggleDocs }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void }) {
  const { user, logout } = useAuth();
  const { isBuilder, isOps } = useAccess();
  const { available, mine } = useEscalationCounts();
  const { connected } = useEventStatus();
  const { toggleAIOverride } = useAIOverride();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setActiveTheme] = useState<Theme>(getTheme);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectTheme = (next: Theme) => {
    setTheme(next);
    setActiveTheme(next);
  };

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
          <AppLogo />
        </Link>
      </div>

      <div className="flex items-center gap-5">
        {/* Escalations: all */}
        <Link
          to="/escalations/available"
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            available > 0 ? 'text-status-active hover:text-status-active/80' : 'text-text-quaternary hover:text-text-secondary'
          }`}
          title="All escalations"
        >
          <Inbox className="w-3.5 h-3.5" strokeWidth={1.5} />
          all{available > 0 && <sup className="tabular-nums font-medium text-[0.5em]">{available}</sup>}
        </Link>

        {/* Escalations: mine */}
        <Link
          to="/escalations/queue"
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            mine > 0 ? 'text-status-warning hover:text-status-warning/80' : 'text-text-quaternary hover:text-text-secondary'
          }`}
          title="My escalation queue"
        >
          <Inbox className="w-3.5 h-3.5" strokeWidth={1.5} />
          mine{mine > 0 && <sup className="tabular-nums font-medium text-[0.5em]">{mine}</sup>}
        </Link>

        {(isBuilder || isOps) && (
          <>
            <div className="w-px h-4 bg-surface-border" />

            {/* Events — admins run the floor from live events, same as builders */}
            <button
              type="button"
              onClick={() => {
                if (!connected) {
                  window.location.reload();
                } else {
                  onToggleEventFeed?.();
                }
              }}
              className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                connected ? 'text-status-success hover:text-status-success/80' : 'text-text-quaternary hover:text-text-secondary'
              }`}
              title={connected ? 'Live events — click to toggle feed' : 'Events disconnected — click to reconnect'}
            >
              <Radio className="w-3.5 h-3.5" strokeWidth={1.5} />
              events
            </button>
          </>
        )}

        {isBuilder && (
          <>
            {/* Docs */}
            <button
              onClick={onToggleDocs}
              className="flex items-center gap-1.5 text-[11px] text-text-quaternary hover:text-text-secondary transition-colors"
              title="Documentation"
            >
              <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
              docs
            </button>
          </>
        )}

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
                <div className="px-3 py-2 border-t border-surface-border/60">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-text-tertiary mb-1.5">Theme</p>
                  <div className="flex items-center gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => selectTheme(t)}
                        title={THEME_LABELS[t]}
                        aria-label={`${THEME_LABELS[t]} theme`}
                        className={`w-4 h-4 rounded-full transition-transform hover:scale-110 ${
                          theme === t ? 'ring-2 ring-offset-1 ring-surface-border' : ''
                        }`}
                        style={{ backgroundColor: THEME_SWATCHES[t] }}
                      />
                    ))}
                  </div>
                </div>
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
