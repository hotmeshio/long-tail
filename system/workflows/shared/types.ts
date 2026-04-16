export interface ServerInfo {
  name: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, any> | null;
  toolNames: string[];
  toolCount: number;
  slug: string;
}
