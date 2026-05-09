import { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { useDocList, useDocContent } from '../../api/docs';
import { useDocHistory, parseDocsHash, buildDocsHash } from './docs-drawer-history';
import { MarkdownContent, DocTree } from './docs-drawer-tree';

// ── Drawer ────────────────────────────────────────────────────────────────────

export function DocsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const { data: docList } = useDocList();
  const history = useDocHistory();
  const { data: docContent, isLoading } = useDocContent(history.current?.path ?? null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll to anchor after content loads
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (pendingAnchor && docContent?.content && scrollRef.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`#${CSS.escape(pendingAnchor)}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setPendingAnchor(null);
      });
    }
  }, [pendingAnchor, docContent]);

  // Read hash and navigate — on mount and on hashchange
  const navigateFromHash = useCallback(() => {
    const parsed = parseDocsHash(window.location.hash);
    const targetPath = parsed?.path ?? 'README.md';
    if (history.current?.path !== targetPath) {
      history.navigate(targetPath, scrollRef);
    }
    if (parsed?.anchor) setPendingAnchor(parsed.anchor);
  }, [history]);

  // Sync URL hash outward when current doc changes (skip during initial load)
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!open || !history.current) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const newHash = buildDocsHash(history.current.path);
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
    }
  }, [open, history.current?.path]);

  // Listen for external hash changes (user edits URL bar)
  useEffect(() => {
    if (!open) return;
    const onHashChange = () => {
      if (window.location.hash.startsWith('#docs')) {
        navigateFromHash();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [open, navigateFromHash]);

  const handleNavigate = useCallback((path: string, anchor?: string) => {
    if (anchor) setPendingAnchor(anchor);
    history.navigate(path, scrollRef);
  }, [history]);

  const handleSidebarSelect = useCallback((path: string) => {
    history.navigate(path, scrollRef);
  }, [history]);

  const handleBack = useCallback(() => {
    history.goBack(scrollRef);
  }, [history]);

  const handleForward = useCallback(() => {
    history.goForward(scrollRef);
  }, [history]);

  const handleAnchorClick = useCallback(() => {
    history.pushScrollPosition(scrollRef);
  }, [history]);

  // Mount → animate in, load from hash or default to README
  useEffect(() => {
    if (open) {
      initialLoadRef.current = true;
      navigateFromHash();
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  const mounted = open || visible;
  if (!mounted) return null;

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      history.reset();
    }, 200);
  };

  const selectedPath = history.current?.path ?? null;
  const canGoBack = history.backStack.length > 0;
  const canGoForward = history.forwardStack.length > 0;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 transition-opacity duration-200 ${visible && open ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div className={`relative ml-auto w-[40vw] min-w-[800px] max-w-[90vw] h-full bg-surface-raised border-l border-surface-border flex flex-col shadow-xl transition-transform duration-200 ease-out ${visible && open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={handleBack}
              disabled={!canGoBack}
              className={`p-0.5 transition-colors ${canGoBack ? 'text-text-tertiary hover:text-text-primary' : 'text-surface-border cursor-default'}`}
              title="Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleForward}
              disabled={!canGoForward}
              className={`p-0.5 transition-colors ${canGoForward ? 'text-text-tertiary hover:text-text-primary' : 'text-surface-border cursor-default'}`}
              title="Forward"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <BookOpen className="w-4 h-4 text-accent ml-1" strokeWidth={1.5} />
            <span className="text-sm font-medium text-text-primary">Documentation</span>
          </div>
          <button onClick={handleClose} className="p-1 text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-surface-border overflow-y-auto py-2">
            {docList?.docs ? (
              <DocTree docs={docList.docs} selected={selectedPath} onSelect={handleSidebarSelect} />
            ) : (
              <div className="px-3 py-2 text-xs text-text-tertiary">Loading...</div>
            )}
          </div>

          {/* Content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
            {!selectedPath ? (
              <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
                <ChevronRight className="w-5 h-5 mb-2" />
                <p className="text-xs">Select a document</p>
              </div>
            ) : isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-6 bg-surface-sunken rounded w-48" />
                <div className="h-4 bg-surface-sunken rounded w-full" />
                <div className="h-4 bg-surface-sunken rounded w-3/4" />
              </div>
            ) : docContent?.content ? (
              <MarkdownContent
                content={docContent.content}
                currentPath={selectedPath}
                onNavigate={handleNavigate}
                onAnchorClick={handleAnchorClick}
              />
            ) : (
              <p className="text-xs text-text-tertiary">Document not found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
