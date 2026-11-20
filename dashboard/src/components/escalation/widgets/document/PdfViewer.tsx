import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainerWidth } from '../../../../hooks/useContainerWidth';
import { openPdf, type PDFDocumentProxy, type RenderTask } from './pdf-loader';
import { FRAME_PAD, ViewerToolbar } from './ViewerToolbar';
import { findQuote } from './find-quote';
import { findQuotePage, highlightRects, pageRuns, type HighlightRect } from './pdf-text';
import { useRegisterDocument, type DocumentTarget } from '../../resolver-form/document-pane';

const PAGE_GAP = 12;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PDFDocumentProxy; ratio: number; baseWidth: number }
  | { status: 'error'; message: string };

/**
 * One page: a placeholder sized to the page until it nears the viewport,
 * then a canvas painted at device resolution. Leaving the neighborhood keeps
 * the paint; a zoom or rotation repaints only the pages in view.
 */
function PdfPage({ doc, pageNumber, scale, rotation, ratio, baseWidth, root, onVisible, highlight }: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  ratio: number;
  baseWidth: number;
  root: HTMLElement | null;
  onVisible: (page: number) => void;
  /** A quoted passage to paint on this page. */
  highlight?: string;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const width = Math.round(baseWidth * scale);
  const height = Math.round(width * ratio);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const nearby = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root, rootMargin: '150% 0px' });
    const centered = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) onVisible(pageNumber); }, { root, threshold: 0.5 });
    nearby.observe(el);
    centered.observe(el);
    return () => { nearby.disconnect(); centered.disconnect(); };
  }, [root, pageNumber, onVisible]);

  useEffect(() => {
    if (!near) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const unit = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: width / unit.width, rotation });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      task = page.render({ canvasContext: context, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [near, doc, pageNumber, width, rotation]);

  const [rects, setRects] = useState<HighlightRect[]>([]);
  useEffect(() => {
    if (!highlight) { setRects([]); return; }
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const unit = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: width / unit.width, rotation });
      const runs = await pageRuns(page);
      const matches = findQuote(runs, highlight);
      if (!cancelled) setRects(matches ? highlightRects(runs, matches, (r) => viewport.convertToViewportRectangle(r)) : []);
    })().catch(() => { if (!cancelled) setRects([]); });
    return () => { cancelled = true; };
  }, [highlight, doc, pageNumber, width, rotation]);

  return (
    <div
      ref={holderRef}
      data-page={pageNumber}
      className="relative mx-auto bg-surface-sunken shadow-sm"
      style={{ width, minHeight: height }}
    >
      {near && <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} role="img" />}
      {rects.map((r, i) => (
        <div
          key={i}
          aria-hidden
          data-testid="document-highlight"
          className="absolute pointer-events-none rounded-sm bg-status-pending-graphic/35"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}

/**
 * A PDF read in place: continuous pages, fit to the frame's width, with
 * paging, zoom and rotation. The document loads once per stored file; a
 * re-signed link for the same file keeps the open document and its scroll.
 */
export function PdfViewer({ url, identity, name, heightClass, expiresAt, onRefresh, locator }: {
  url: string;
  /** Stable across re-signed links: the storage key when there is one. */
  identity: string;
  name: string;
  heightClass: string;
  expiresAt?: string;
  onRefresh?: () => void;
  /** How list items address this document: its field key and the sources it answers to. */
  locator?: { key: string; sources: string[] };
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [measureRef, frameWidth] = useContainerWidth<HTMLDivElement>();
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    let alive = true;
    let destroy: (() => Promise<void>) | null = null;
    setState({ status: 'loading' });
    (async () => {
      try {
        const opened = await openPdf(urlRef.current);
        destroy = opened.destroy;
        if (!alive) { void opened.destroy(); return; }
        const first = await opened.doc.getPage(1);
        const unit = first.getViewport({ scale: 1 });
        if (alive) setState({ status: 'ready', doc: opened.doc, ratio: unit.height / unit.width, baseWidth: unit.width });
      } catch (err) {
        if (alive) setState({ status: 'error', message: err instanceof Error ? err.message : 'The document could not be read' });
      }
    })();
    return () => { alive = false; void destroy?.(); };
  }, [identity]);

  const setFrameRefs = useCallback((node: HTMLDivElement | null) => {
    setFrame(node);
    measureRef(node);
  }, [measureRef]);

  const onVisible = useCallback((n: number) => setPage(n), []);

  const goToPage = (n: number) => {
    if (state.status !== 'ready' || !frame) return;
    const target = Math.min(Math.max(n, 1), state.doc.numPages);
    const el = frame.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (el) frame.scrollTo({ top: el.offsetTop - FRAME_PAD, behavior: 'smooth' });
    setPage(target);
  };

  const [highlight, setHighlight] = useState<{ page: number; quote: string } | null>(null);
  const pending = useRef<DocumentTarget | null>(null);
  const go = useCallback(async (target: DocumentTarget) => {
    if (state.status !== 'ready') { pending.current = target; return; }
    let page = target.page;
    let quote: string | undefined;
    if (target.quote) {
      const found = await findQuotePage(state.doc, target.quote, target.page).catch(() => null);
      if (found !== null && (page === undefined || found === page)) { page = found; quote = target.quote; }
    }
    setHighlight(page !== undefined && quote ? { page, quote } : null);
    if (page !== undefined) goToPage(page);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useRegisterDocument(locator, go);
  useEffect(() => {
    if (state.status === 'ready' && pending.current) { const target = pending.current; pending.current = null; void go(target); }
  }, [state, go]);

  const quarter = rotation % 180 !== 0;
  const ready = state.status === 'ready' ? state : null;
  const pageRatio = ready ? (quarter ? 1 / ready.ratio : ready.ratio) : 1;
  const turnedBase = ready ? (quarter ? ready.baseWidth * ready.ratio : ready.baseWidth) : 1;
  const usable = Math.max((frameWidth ?? 640) - FRAME_PAD * 2, 120);
  const scale = (usable / turnedBase) * zoom;

  return (
    <div className="flex flex-col">
      <ViewerToolbar
        name={name}
        url={url}
        expiresAt={expiresAt}
        onRefresh={onRefresh}
        zoom={zoom}
        onZoom={setZoom}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
        {...(ready ? { page, pageCount: ready.doc.numPages, onPage: goToPage } : {})}
      />
      <div
        ref={setFrameRefs}
        className={`${heightClass} overflow-auto bg-surface`}
        style={{ padding: FRAME_PAD }}
        data-testid="document-pdf"
      >
        {state.status === 'loading' && (
          <p className="text-xs text-text-tertiary py-8 text-center" role="status">Loading {name}…</p>
        )}
        {state.status === 'error' && (
          <div className="py-8 text-center space-y-2" role="alert">
            <p className="text-xs text-status-error">{state.message}</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:text-accent-hover">
              Open {name} in a new tab
            </a>
          </div>
        )}
        {ready && (
          <div className="flex flex-col" style={{ gap: PAGE_GAP }}>
            {Array.from({ length: ready.doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={ready.doc}
                pageNumber={i + 1}
                scale={scale}
                rotation={rotation}
                ratio={pageRatio}
                baseWidth={turnedBase}
                root={frame}
                onVisible={onVisible}
                highlight={highlight?.page === i + 1 ? highlight.quote : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
