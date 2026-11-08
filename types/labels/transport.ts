/** A printable payload a transport carries. */
export type LabelTransportFormat = 'zpl' | 'pdf';

export interface LabelTransportJob {
  jobId: string;
  format: LabelTransportFormat;
  /** ZPL text or PDF bytes. */
  payload: string | Uint8Array;
  labelCount: number;
  /** The request's destination, passed through as given. */
  destination?: string;
}

export interface LabelTransportReceipt {
  accepted: boolean;
  detail?: string;
}

/**
 * A host-registered route from issued labels to a printer (a thermal printer
 * on the network, a print server, a file drop). Registered by name through
 * start({ labels: { transports } }).
 */
export interface LTLabelTransport {
  formats: LabelTransportFormat[];
  send(job: LabelTransportJob): Promise<LabelTransportReceipt>;
}
