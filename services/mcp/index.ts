import type { LTMcpAdapter } from '../../types/mcp';

/**
 * Singleton registry for the MCP adapter.
 *
 * Follows the same pattern as telemetryRegistry (single adapter):
 * - register(adapter) — set the MCP adapter
 * - connect()         — start server + connect clients
 * - disconnect()      — stop server + disconnect clients
 * - clear()           — reset (for tests)
 *
 * The built-in adapter manages both the Human Queue MCP server
 * and client connections to external MCP servers.
 */
class LTMcpRegistry {
  private adapter: LTMcpAdapter | null = null;
  private connected = false;

  register(adapter: LTMcpAdapter): void {
    this.adapter = adapter;
  }

  async connect(): Promise<void> {
    if (this.connected || !this.adapter) return;
    await this.adapter.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.disconnect();
    this.connected = false;
  }

  clear(): void {
    this.adapter = null;
    this.connected = false;
  }

  get hasAdapter(): boolean {
    return this.adapter !== null;
  }

  get current(): LTMcpAdapter | null {
    return this.adapter;
  }
}

export const mcpRegistry = new LTMcpRegistry();
