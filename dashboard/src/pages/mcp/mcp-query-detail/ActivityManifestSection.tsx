interface ActivityManifestSectionProps {
  manifest: any[];
}

export function ActivityManifestSection({ manifest }: ActivityManifestSectionProps) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Activity Manifest</h4>
      <div className="space-y-3">
        {manifest
          .filter((a: any) => a.tool_source !== 'trigger')
          .map((a: any) => {
            const hasArgs = a.tool_arguments && Object.keys(a.tool_arguments).length > 0;
            const hasMappings = a.input_mappings && Object.keys(a.input_mappings).length > 0;
            if (!hasArgs && !hasMappings) return null;
            return (
              <div key={a.activity_id} className="bg-surface-sunken rounded-md p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono text-text-tertiary">{a.activity_id}</span>
                  <span className="text-xs font-medium text-text-primary">{a.title}</span>
                  {a.mcp_tool_name && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary">{a.mcp_tool_name}</span>
                  )}
                </div>
                {hasMappings && (
                  <div className={hasArgs ? 'mb-3' : ''}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Runtime Wiring</p>
                    <div className="grid gap-1">
                      {Object.entries(a.input_mappings).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-2 text-xs">
                          <span className="font-mono text-text-secondary shrink-0">{k}</span>
                          <span className="text-text-tertiary shrink-0">&larr;</span>
                          <span className="font-mono text-accent/70">
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {hasArgs && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Discovery Reference</p>
                    <p className="text-[10px] text-text-tertiary mb-1.5">Values from the original execution, stored for context. Runtime values are determined by the wiring above.</p>
                    <div className="grid gap-1 opacity-60">
                      {Object.entries(a.tool_arguments).map(([k, v]) => {
                        const val = typeof v === 'string' ? v : JSON.stringify(v);
                        const isLong = val.length > 120;
                        return (
                          <div key={k} className="flex items-baseline gap-2 text-xs">
                            <span className="font-mono text-text-secondary shrink-0">{k}:</span>
                            {isLong ? (
                              <pre className="font-mono text-text-tertiary whitespace-pre-wrap break-all flex-1">{val}</pre>
                            ) : (
                              <span className="font-mono text-text-tertiary truncate">{val}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
