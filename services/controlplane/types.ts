/** Type definitions for the control plane service. */

export interface ControlPlaneApp {
  appId: string;
  version: string;
}

export interface StreamStats {
  pending: number;
  processed: number;
  byStream: Array<{ stream_type: 'engine' | 'worker'; stream_name: string; count: number }>;
}
