import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Inbox, User, BookOpen, Radio, X, BookmarkPlus } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useEscalationCounts } from '../../hooks/useEscalationCounts';
import { useEventStatus } from '../../hooks/useEventContext';
import { useSettings } from '../../api/settings';
import { AppLogo } from '../common/display/AppLogo';
import { EasterEggPanel } from './EasterEggPanel';
import { clearViewAs } from '../../lib/view-as';
import { THEMES, THEME_LABELS, THEME_SWATCHES, getTheme, setTheme, type Theme } from '../../lib/theme';
import { QUEUED_COLOR, ACTIVE_COLOR } from '../../pages/operations/PaceChart';

const BOOKMARKS_KEY = 'lt:bookmarks';

type Bookmark = { label: string; url: string };

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function persistBookmarks(bookmarks: Bookmark[]): void {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)); } catch {}
}

export function Header({ onToggleEventFeed, onToggleDocs }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void }) {
  const { user, logout } = useAuth();
  const { isBuilder, isOps, viewAs, realIsBuilder } = useAccess();
  const { available, mine } = useEscalationCounts();
  const { connected } = useEventStatus();
  const { data: settings } = useSettings();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [theme, setActiveTheme] = useState<Theme>(getTheme);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const menuRef = useRef<HTMLDivElement>(null);

  const appName = settings?.branding?.appName;

  const selectTheme = (next: Theme) => {
    setTheme(next);
    setActiveTheme(next);
  };

  const addBookmark = () => {
    const label = window.prompt('Bookmark label:');
    if (!label?.trim()) return;
    const url = location.pathname + location.search;
    const next = [...bookmarks, { label: label.trim(), url }].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    setBookmarks(next);
    persistBookmarks(next);
    setMenuOpen(false);
  };

  const removeBookmark = (bm: Bookmark) => {
    const next = bookmarks.filter((b) => !(b.label === bm.label && b.url === bm.url));
    setBookmarks(next);
    persistBookmarks(next);
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
    <>
      {/* The header is its own stacking context, so its children's z is capped
          by the header's z against page-level fixed layers (facet drawer z-40,
          help panel z-[45], docs drawer z-50). At rest it sits at z-30 so those
          drawers may cover it; while the user menu is open it lifts to the menu
          tier (z-[100]) so an open menu is never occluded. */}
      <header className={`h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between pl-2 pr-5 relative ${menuOpen ? 'z-[100]' : 'z-30'}`}>
        <Link
          to="/"
          aria-label="Home"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setSettingsPanelOpen(true);
            }
          }}
        >
          <AppLogo appName={appName} />
        </Link>

        <div className="flex items-center gap-5">
          {/* Escalations: all */}
          <Link
            to="/escalations/available"
            className="flex items-center gap-1.5 text-[11px] transition-colors text-text-quaternary hover:text-text-secondary"
            style={available > 0 ? { color: QUEUED_COLOR } : undefined}
            title="All escalations"
          >
            <Inbox className="w-3.5 h-3.5" strokeWidth={1.5} />
            all{available > 0 && <sup className="tabular-nums font-medium text-[0.5em]">{available}</sup>}
          </Link>

          {/* Escalations: mine */}
          <Link
            to="/escalations/queue"
            className="flex items-center gap-1.5 text-[11px] transition-colors text-text-quaternary hover:text-text-secondary"
            style={mine > 0 ? { color: ACTIVE_COLOR } : undefined}
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

          {realIsBuilder && (
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

          {/* View-as indicator — visible when simulating a lower role */}
          {viewAs && (
            <>
              <span className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-accent select-none">
                <span className="capitalize font-medium tracking-wide">{viewAs} View</span>
                <button
                  onClick={clearViewAs}
                  title="Restore your real view"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
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
                <div className="absolute right-0 top-full mt-1 w-52 bg-surface-raised border border-surface-border rounded-md shadow-lg py-1 z-[100]">
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

                  {/* Bookmarks */}
                  <div className="border-t border-surface-border/60 pt-1">
                    {bookmarks.map((bm) => (
                      <div key={`${bm.label}::${bm.url}`} className="flex items-center group px-3 py-1.5 hover:bg-surface-hover">
                        <Link
                          to={bm.url}
                          onClick={() => setMenuOpen(false)}
                          title={bm.url}
                          className="flex-1 min-w-0 text-xs text-text-secondary hover:text-text-primary truncate"
                        >
                          {bm.label}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeBookmark(bm)}
                          title={`Remove "${bm.label}"`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-0.5 shrink-0 text-text-quaternary hover:text-status-error"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <hr className="border-surface-border/60 mx-3 my-0.5" />
                    <button
                      type="button"
                      onClick={addBookmark}
                      className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                      Add Bookmark
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {settingsPanelOpen && (
        <EasterEggPanel onClose={() => setSettingsPanelOpen(false)} />
      )}
    </>
  );
}
