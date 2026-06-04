/// <reference types="vite/client" />

/**
 * NATS WebSocket connection configuration.
 *
 * The dashboard receives NATS connection details at runtime from the server
 * via /api/settings and /api/nats-credentials. These build-time constants
 * are only used as a last resort if the server doesn't provide values.
 */
export const NATS_WS_URL: string | null = null;
export const NATS_TOKEN: string | null = null;
export const NATS_SUBJECT_PREFIX = 'lt.events';
