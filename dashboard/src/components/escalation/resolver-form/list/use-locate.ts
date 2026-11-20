import { useCallback } from 'react';
import { readLocator } from '../../../../lib/x-lt-list';
import { useDocumentLocator } from '../document-pane';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Takes the form's document to where a list item points: the page and quoted
 * passage its `x-lt-locate` names. Undefined when the list declares no
 * locator or the form has no document, so a control attaches nothing. An item
 * without a page or quote does nothing.
 */
export function useLocateItem(fieldSchema: Record<string, unknown> | undefined): ((item: unknown) => void) | undefined {
  const locator = useDocumentLocator();
  const spec = readLocator(fieldSchema);
  const { file, page: pageKey, quote: quoteKey } = spec ?? {};
  const locate = useCallback((item: unknown) => {
    if (!locator || !isRecord(item)) return;
    const rawPage = pageKey ? Number(item[pageKey]) : NaN;
    const rawQuote = quoteKey ? item[quoteKey] : undefined;
    locator.locate(file, {
      page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : undefined,
      quote: typeof rawQuote === 'string' && rawQuote.trim() ? rawQuote : undefined,
    });
  }, [locator, file, pageKey, quoteKey]);
  return locator && spec ? locate : undefined;
}
