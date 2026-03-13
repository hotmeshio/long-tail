import { SectionLabel } from '../../../components/common/SectionLabel';

export function VersionHistory({
  versionsData,
  searchParams,
  setSearchParams,
  currentVersion,
  viewingVersion,
}: {
  versionsData: any;
  searchParams: URLSearchParams;
  setSearchParams: (v: URLSearchParams) => void;
  currentVersion: number;
  viewingVersion: number | null;
}) {
  return (
    <div>
      <SectionLabel className="mb-3">Version History</SectionLabel>
      <div className="space-y-1">
        {versionsData.versions.map((v: any) => {
          const isCurrent = v.version === currentVersion;
          const isViewing = viewingVersion === v.version;
          return (
            <button
              key={v.version}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (isCurrent) next.delete('version');
                else next.set('version', String(v.version));
                setSearchParams(next);
              }}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isViewing
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
              }`}
            >
              <span className="font-mono font-medium">v{v.version}</span>
              {isCurrent && <span className="text-text-tertiary ml-1">(current)</span>}
              {v.change_summary && (
                <p className="text-[10px] text-text-tertiary truncate mt-0.5">{v.change_summary}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
