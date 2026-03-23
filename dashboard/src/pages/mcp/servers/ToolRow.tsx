import type { McpToolManifest } from '../../../api/types';

export function ToolRow({
  tool,
  onTry,
}: {
  tool: McpToolManifest;
  onTry: () => void;
}) {
  const paramCount = Object.keys(tool.inputSchema?.properties ?? {}).length;

  return (
    <tr
      onClick={onTry}
      className="cursor-pointer row-hover"
    >
      <td className="pl-14 pr-6 py-2">
        <code className="text-xs font-mono text-accent-primary">{tool.name}</code>
      </td>
      <td className="px-6 py-2">
        <span className="text-xs text-text-secondary line-clamp-1">
          {tool.description || '\u2014'}
        </span>
      </td>
      <td className="px-6 py-2 text-right">
        <span className="text-xs text-text-tertiary">
          {paramCount} param{paramCount !== 1 ? 's' : ''}
        </span>
      </td>
      <td className="px-6 py-2 w-16">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTry();
          }}
          className="text-[10px] text-accent-primary hover:underline"
        >
          Try
        </button>
      </td>
    </tr>
  );
}
