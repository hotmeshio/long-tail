/// <reference types="vite/client" />

/**
 * NATS WebSocket connection configuration.
 *
 * Override via environment variables:
 * - VITE_NATS_WS_URL: WebSocket endpoint (default: ws://localhost:9222)
 * - VITE_NATS_TOKEN: Authentication token (default: dev_api_secret)
 */
export const NATS_WS_URL = import.meta.env.VITE_NATS_WS_URL || 'ws://localhost:9222';
export const NATS_TOKEN = import.meta.env.VITE_NATS_TOKEN || 'dev_api_secret';
export const NATS_SUBJECT_PREFIX = 'lt.events';
