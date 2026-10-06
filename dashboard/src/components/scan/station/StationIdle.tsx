import { ScanBarcode } from 'lucide-react';

/**
 * The station at rest: large, calm typography. The station is named for the
 * logged-in account. Before a badge, it asks for one; with a badge live, it
 * asks for the next item.
 */
export function StationIdle({ stationName, primedName }: { stationName: string; primedName?: string | null }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-24">
      <ScanBarcode className="w-10 h-10 text-accent-muted mb-8" strokeWidth={1} />
      <h1 className="text-3xl font-light text-text-primary tracking-tight">{stationName}</h1>
      <div className="w-16 border-t border-surface-border my-8" />
      {primedName ? (
        <>
          <p className="text-lg text-text-secondary">Scan the next item</p>
          <p className="text-sm text-text-tertiary mt-2">Badged in as {primedName}</p>
        </>
      ) : (
        <>
          <p className="text-lg text-text-secondary">Scan your badge to begin</p>
          <p className="text-sm text-text-tertiary mt-2">or scan an item</p>
        </>
      )}
    </div>
  );
}
