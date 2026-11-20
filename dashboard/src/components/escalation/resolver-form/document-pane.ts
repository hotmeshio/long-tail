import { createContext, useContext, useEffect, useRef } from 'react';

/** Set inside a split form's document pane; `fill` when one document has the pane to itself. */
export const DocumentPaneContext = createContext<{ fill: boolean } | null>(null);

export function useDocumentPane(): { fill: boolean } | null {
  return useContext(DocumentPaneContext);
}

/** Where in a document an item points: a page, a quoted passage, or both. */
export interface DocumentTarget {
  page?: number;
  quote?: string;
}

interface Registration {
  key: string;
  sources: string[];
  go: (target: DocumentTarget) => void;
}

/**
 * The form's documents, addressable by what they show. A viewer registers
 * itself; a list item that points at a page or a quote asks the registry to
 * take its document there. An item that names no document uses the first one.
 */
export interface DocumentLocator {
  register(entry: Omit<Registration, 'go'>, go: Registration['go']): () => void;
  locate(file: string | undefined, target: DocumentTarget): boolean;
}

export function createDocumentLocator(): DocumentLocator {
  const entries: Registration[] = [];
  return {
    register(entry, go) {
      const registration = { ...entry, go };
      entries.push(registration);
      return () => {
        const at = entries.indexOf(registration);
        if (at >= 0) entries.splice(at, 1);
      };
    },
    locate(file, target) {
      if (target.page === undefined && target.quote === undefined) return false;
      const match = file === undefined ? entries[0] : entries.find((e) => e.key === file || e.sources.includes(file));
      if (!match) return false;
      match.go(target);
      return true;
    },
  };
}

export const DocumentLocatorContext = createContext<DocumentLocator | null>(null);

export function useDocumentLocator(): DocumentLocator | null {
  return useContext(DocumentLocatorContext);
}

/** Register a viewer with the form's locator for as long as it is mounted; nothing when it names no entry. */
export function useRegisterDocument(entry: { key: string; sources: string[] } | undefined, go: (target: DocumentTarget) => void): void {
  const locator = useDocumentLocator();
  const latest = useRef(go);
  latest.current = go;
  const key = entry?.key;
  const sourceKey = entry?.sources.join('|') ?? '';
  useEffect(() => {
    if (!locator || key === undefined) return undefined;
    return locator.register({ key, sources: sourceKey ? sourceKey.split('|') : [] }, (target) => latest.current(target));
  }, [locator, key, sourceKey]);
}
