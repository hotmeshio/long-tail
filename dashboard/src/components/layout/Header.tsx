import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Inbox, User, BookOpen, Menu, Radio, X, BookmarkPlus, ChevronLeft, ChevronRight, ScanBarcode } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { usePersona } from '../../hooks/usePersona';
import { useEscalationCounts } from '../../hooks/useEscalationCounts';
import { useEventStatus } from '../../hooks/useEventContext';
import { useSettings } from '../../api/settings';
import { AppLogo } from '../common/display/AppLogo';
import { EasterEggPanel } from './EasterEggPanel';
import { clearViewAs } from '../../lib/view-as';
import { getAllThemes, registerThemes, getTheme, setTheme, type Theme } from '../../lib/theme';
import { useShellPanel } from '../../hooks/useShellPanel';
import { useScanEnabled } from '../../hooks/useScanInput';
import { ScanPanel } from '../scan/ScanPanel';
import { useKioskMode } from '../../hooks/useKioskMode';
import { useRoleDetails } from '../../api/roles';
import { displayRoleTitle } from '../../lib/role-display';

const BOOKMARKS_KEY = 'lt:bookmarks';
const SCAN_PANEL_KEY = 'scan';

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

export function Header({ onToggleEventFeed, onToggleDocs, onToggleNav }: { onToggleEventFeed?: () => void; onToggleDocs?: () => void; onToggleNav?: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { viewAs, realIsBuilder } = useAccess();
  const { available, mine } = useEscalationCounts();
  usePersona();
  const { connected } = useEventStatus();
  const { data: settings } = useSettings();
  const { role: kioskRole, targets: kioskTargets, selectable: kioskSelectable, selectRole: selectKioskRole } = useKioskMode();
  const { data: roleDetails } = useRoleDetails({ enabled: kioskSelectable });
  const { setPanel, closePanel, open: panelOpen, ownerKey } = useShellPanel();
  const scanEnabled = useScanEnabled();
  const location = useLocation();

  const toggleScanPanel = () => {
    if (panelOpen && ownerKey === SCAN_PANEL_KEY) {
      closePanel(SCAN_PANEL_KEY);
    } else {
      setPanel(<ScanPanel onClose={() => closePanel(SCAN_PANEL_KEY)} />, {
        width: 360,
        key: SCAN_PANEL_KEY,
      });
    }
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [theme, setActiveTheme] = useState<Theme>(getTheme);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const menuRef = useRef<HTMLDivElement>(null);

  const appName = settings?.branding?.appName;

  // Deployment-registered themes join the picker beside the built-ins; their
  // CSS is already loaded via /api/settings/custom.css.
  const brandThemes = settings?.branding?.themes;
  const allThemes = useMemo(() => {
    registerThemes(brandThemes ?? []);
    return getAllThemes();
  }, [brandThemes]);

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
          by the header's z against page-level fixed layers (help panel z-[45],
          docs drawer z-50). At rest it sits at z-30 so those overlays may cover
          it; while the user menu is open it lifts to the menu tier (z-[100])
          so an open menu is never occluded. */}
      <header className={`h-14 shrink-0 border-b border-surface-border bg-surface-raised flex items-center justify-between pl-2 pr-5 relative ${menuOpen ? 'z-[100]' : 'z-30'}`}>
        <div className="flex items-center gap-1 min-w-0">
          {/* Below lg the nav rail is a drawer behind this button. */}
          {onToggleNav && (
            <button
              onClick={onToggleNav}
              className="lg:hidden p-2 text-text-secondary hover:text-text-primary transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>
          )}
          {/* Brand — full watermark on desktop, comet mark on small screens. */}
          <Link
            to="/"
            aria-label="Home"
            className="shrink-0"
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setSettingsPanelOpen(true);
              }
            }}
          >
            <AppLogo appName={appName} className="hidden lg:flex" />
            <AppLogo appName={appName} variant="comet" className="flex lg:hidden" />
          </Link>
          {/* Separator groups back/forward away from the logo on desktop. */}
          <div className="hidden lg:block w-px h-4 bg-surface-border mx-1" />
          {/* Back / Forward — accent-colored, all breakpoints. The theme color
              signals "navigation" clearly; the header's 56px height satisfies
              the 44px touch-target floor without extra vertical padding. */}
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-accent/60 hover:text-accent transition-colors"
            aria-label="Go back"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <button
            onClick={() => navigate(1)}
            className="p-2 text-accent/60 hover:text-accent transition-colors"
            aria-label="Go forward"
          >
            <ChevronRight className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center gap-5">
          {/* Escalations: all */}
          <Link
            to="/escalations/available"
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              available > 0 ? 'text-status-queued' : 'text-text-quaternary hover:text-text-secondary'
            }`}
            title="All escalations"
          >
            <Inbox className="w-4 h-4" strokeWidth={1.5} />
            <span className="hidden lg:inline">all</span>
            {available > 0 && <sup className="tabular-nums font-medium text-[0.5em]">{available}</sup>}
          </Link>

          {/* Escalations: mine */}
          <Link
            to="/escalations/queue"
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              mine > 0 ? 'text-status-claimed' : 'text-text-quaternary hover:text-text-secondary'
            }`}
            title="My escalation queue"
          >
            <Inbox className="w-4 h-4" strokeWidth={1.5} />
            <span className="hidden lg:inline">mine</span>
            {mine > 0 && <sup className="tabular-nums font-medium text-[0.5em]">{mine}</sup>}
          </Link>

          <div className="hidden lg:block w-px h-4 bg-surface-border" />

          {/* Scan — manual code entry + wedge capture settings. Every persona
              sees it when the deployment opts in (features.scanCodes, easter
              egg override for testing). Hardware scans work from any page;
              this opens the panel that reports them. */}
          {scanEnabled && (
            <button
              type="button"
              onClick={toggleScanPanel}
              className="flex items-center gap-1.5 text-xs text-text-quaternary hover:text-text-secondary transition-colors"
              title="Scan a code"
            >
              <ScanBarcode className="w-4 h-4" strokeWidth={1.5} />
              <span className="hidden lg:inline">scan</span>
            </button>
          )}

          {/* Events — every login watches the floor live; the stream itself is
              role-scoped server-side, so members simply receive fewer events. */}
          <button
            type="button"
            onClick={() => {
              if (!connected) {
                window.location.reload();
              } else {
                onToggleEventFeed?.();
              }
            }}
            className={`hidden lg:flex items-center gap-1.5 text-xs transition-colors ${
              connected ? 'text-status-success hover:text-status-success/80' : 'text-text-quaternary hover:text-text-secondary'
            }`}
            title={connected ? 'Live events — click to toggle feed' : 'Events disconnected — click to reconnect'}
          >
            <Radio className="w-4 h-4" strokeWidth={1.5} />
            events
          </button>

          {realIsBuilder && (
            <>
              {/* Docs */}
              <button
                onClick={onToggleDocs}
                className="hidden lg:flex items-center gap-1.5 text-xs text-text-quaternary hover:text-text-secondary transition-colors"
                title="Documentation"
              >
                <BookOpen className="w-4 h-4" strokeWidth={1.5} />
                docs
              </button>
            </>
          )}

          {/* View-as indicator — visible when simulating a lower role */}
          {viewAs && (
            <>
              <span className="hidden lg:flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-2xs text-accent select-none">
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

          <div className="hidden lg:block w-px h-4 bg-surface-border" />

          {/* User menu */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="btn-ghost flex items-center gap-1"
              >
                <span className="relative">
                  <User className="w-4 h-4 text-accent/75" strokeWidth={1.5} />
                  {viewAs && <span className="lg:hidden absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />}
                </span>
                <span className="hidden lg:inline whitespace-nowrap">{user.displayName || user.username || user.userId}</span>
                <svg className="hidden lg:block w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                  <button
                    onClick={() => { setMenuOpen(false); if (!connected) window.location.reload(); else onToggleEventFeed?.(); }}
                    className="lg:hidden block w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                  >
                    {connected ? 'Events' : 'Reconnect events'}
                  </button>
                  {realIsBuilder && (
                    <button
                      onClick={() => { setMenuOpen(false); onToggleDocs?.(); }}
                      className="lg:hidden block w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover"
                    >
                      Docs
                    </button>
                  )}
                  {viewAs && (
                    <button
                      onClick={() => { setMenuOpen(false); clearViewAs(); }}
                      className="lg:hidden block w-full text-left px-3 py-2 text-xs text-accent hover:bg-surface-hover capitalize"
                    >
                      Exit {viewAs} view
                    </button>
                  )}
                  <div className="px-3 py-2 border-t border-surface-border/60">
                    <p className="text-2xs font-medium uppercase tracking-widest text-text-tertiary mb-1.5">Theme</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {allThemes.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => selectTheme(t.id)}
                          title={t.label}
                          aria-label={`${t.label} theme`}
                          className={`w-4 h-4 rounded-full transition-transform hover:scale-110 ${
                            theme === t.id ? 'ring-2 ring-offset-1 ring-surface-border' : ''
                          }`}
                          style={{ backgroundColor: t.swatch }}
                        />
                      ))}
                    </div>
                  </div>
                  {kioskSelectable && (
                    <div className="px-3 py-2 border-t border-surface-border/60">
                      <p className="text-2xs font-medium uppercase tracking-widest text-text-tertiary mb-1.5">Station queue</p>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            selectKioskRole(null);
                            navigate('/');
                          }}
                          className={`flex items-center gap-2 -mx-1 px-1 py-1 text-xs text-left rounded hover:bg-surface-hover ${!kioskRole ? 'text-accent' : 'text-text-secondary'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${!kioskRole ? 'bg-accent' : 'bg-surface-border'}`} />
                          <span className="truncate">Full dashboard</span>
                        </button>
                        {kioskTargets.map((r) => {
                          const detail = roleDetails?.roles?.find((d) => d.role === r);
                          const active = r === kioskRole;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => {
                                setMenuOpen(false);
                                selectKioskRole(r);
                                navigate(`/escalations/available?role=${encodeURIComponent(r)}&status=available`);
                              }}
                              className={`flex items-center gap-2 -mx-1 px-1 py-1 text-xs text-left rounded hover:bg-surface-hover ${active ? 'text-accent' : 'text-text-secondary'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-accent' : 'bg-surface-border'}`} />
                              <span className="truncate">{displayRoleTitle({ role: r, title: detail?.title })}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
