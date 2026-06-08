/**
 * MCP exposure configuration — controls which tools are visible
 * when long-tail acts as an MCP server for external clients.
 *
 * Set once at startup from startConfig.mcp.exposure.
 * Read by the /mcp endpoint handler on each request.
 */

export interface ExposureConfig {
  readOnly?: boolean;
  hideAiWhenUnavailable?: boolean;
  allowServers?: string[];
  denyServers?: string[];
}

let _exposure: ExposureConfig | undefined;

export function setExposureConfig(config?: ExposureConfig): void {
  _exposure = config;
}

export function getExposureConfig(): ExposureConfig | undefined {
  return _exposure;
}
