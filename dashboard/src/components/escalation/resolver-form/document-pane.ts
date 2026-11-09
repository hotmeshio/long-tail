import { createContext, useContext } from 'react';

/** Set inside a split form's document pane; `fill` when one document has the pane to itself. */
export const DocumentPaneContext = createContext<{ fill: boolean } | null>(null);

export function useDocumentPane(): { fill: boolean } | null {
  return useContext(DocumentPaneContext);
}
