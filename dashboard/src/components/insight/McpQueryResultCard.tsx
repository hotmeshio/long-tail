import type { McpQueryResult } from '../../api/insight';

interface McpQueryResultCardProps {
  result: McpQueryResult;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/**
 * Extract file paths from the result that look like managed storage files.
 * Searches strings recursively in the result object.
 */
function extractFilePaths(obj: unknown): string[] {
  const paths = new Set<string>();
  const walk = (val: unknown) => {
    if (typeof val === 'string') {
      // Match paths like /screenshots/hn.png or screenshots/hn.png
      const match = val.match(/^\/?[\w./-]+\.\w+$/);
      if (match && val.includes('/') && !val.startsWith('http')) {
        paths.add(val.replace(/^\/+/, ''));
      }
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val && typeof val === 'object') {
      Object.values(val).forEach(walk);
    }
  };
  walk(obj);
  return Array.from(paths);
}

function isImage(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

export function McpQueryResultCard({ result }: McpQueryResultCardProps) {
  const hasResult = result.result !== undefined && result.result !== null;
  const filePaths = extractFilePaths(result.result);
  // Also check the summary for file paths
  if (result.summary) {
    const summaryPaths = extractFilePaths(result.summary.split(/\s+/));
    filePaths.push(...summaryPaths.filter((p) => !filePaths.includes(p)));
  }

  const images = filePaths.filter(isImage);
  const otherFiles = filePaths.filter((p) => !isImage(p));

  return (
    <div className="mt-10">
      {/* Title */}
      <h3 className="text-xl font-medium text-text-primary">
        {result.title || 'Done'}
      </h3>

      {/* Summary */}
      {result.summary && (
        <p className="text-sm text-text-secondary leading-relaxed mt-3 mb-10">
          {result.summary}
        </p>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div className="mb-10 space-y-4">
          {images.map((imgPath) => (
            <div key={imgPath}>
              <a
                href={`/api/files/${imgPath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={`/api/files/${imgPath}`}
                  alt={imgPath}
                  className="max-w-full max-h-80 rounded-md border border-surface-border"
                />
              </a>
              <p className="text-[10px] text-text-tertiary mt-1 font-mono">{imgPath}</p>
            </div>
          ))}
        </div>
      )}

      {/* Other file links */}
      {otherFiles.length > 0 && (
        <div className="mb-10">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Files
          </h4>
          <div className="space-y-1">
            {otherFiles.map((fp) => (
              <a
                key={fp}
                href={`/api/files/${fp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-accent hover:underline font-mono"
              >
                {fp}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Raw result data */}
      {hasResult && (
        <div className="mb-10">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Result
          </h4>
          <pre className="text-[11px] text-text-secondary bg-surface-sunken border border-surface-border rounded-md p-4 overflow-x-auto max-h-60 whitespace-pre-wrap">
            {typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 mt-10 text-[10px] text-text-tertiary">
        <span>
          {result.tool_calls_made} tool call{result.tool_calls_made !== 1 ? 's' : ''}
        </span>
        <span>{(result.duration_ms / 1000).toFixed(1)}s</span>
        <span className="font-mono">{result.workflow_id}</span>
      </div>
    </div>
  );
}
