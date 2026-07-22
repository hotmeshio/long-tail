import { useNavigate } from 'react-router-dom';
import { Server, ExternalLink } from 'lucide-react';

interface ServerNameProps {
  name: string;
  serverId?: string;
  /** Strip the common "long-tail-" prefix for display */
  short?: boolean;
}

/**
 * Universal MCP server name display. Monospace with a subtle Server icon.
 * When `serverId` is provided, hovering reveals a nav icon and clicking
 * navigates to the server config page.
 */
export function ServerName({ name, serverId, short = true }: ServerNameProps) {
  const navigate = useNavigate();
  const display = short ? name.replace(/^long-tail-/, '') : name;

  if (serverId) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); navigate(`/mcp/servers/${serverId}`); }}
        className="group/srv inline-flex items-center gap-1 text-2xs font-mono text-text-tertiary hover:text-accent transition-colors"
        title={name}
      >
        <Server className="w-2.5 h-2.5 shrink-0 text-text-quaternary group-hover/srv:text-accent" strokeWidth={1.5} />
        {display}
        <ExternalLink className="w-2 h-2 shrink-0 invisible group-hover/srv:visible text-accent" strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-2xs font-mono text-text-tertiary" title={name}>
      <Server className="w-2.5 h-2.5 shrink-0 text-text-quaternary" strokeWidth={1.5} />
      {display}
    </span>
  );
}
