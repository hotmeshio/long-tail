/**
 * Kitchen Sink Activities
 *
 * Each function is a side effect wrapped as a durable activity.
 * When proxied via Durable.workflow.proxyActivities(), each call
 * becomes a checkpointed step — cached on replay, retried on failure.
 *
 * Use these as a starting point for your own activities.
 */

/** Simple greeting — the most basic activity possible. */
export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

/** Simulate an API call that fetches data from an external source. */
export async function fetchData(
  key: string,
): Promise<{ key: string; value: string; fetchedAt: string }> {
  // In production, this would call a real API.
  return {
    key,
    value: `data-for-${key}`,
    fetchedAt: new Date().toISOString(),
  };
}

/** Transform and merge data from multiple sources. */
export async function transformData(input: {
  greeting: string;
  dataA: { key: string; value: string };
  dataB: { key: string; value: string };
}): Promise<{ summary: string; merged: Record<string, string> }> {
  return {
    summary: `${input.greeting} Merged ${input.dataA.key} + ${input.dataB.key}.`,
    merged: {
      [input.dataA.key]: input.dataA.value,
      [input.dataB.key]: input.dataB.value,
    },
  };
}

/** Simulate sending a notification (email, Slack, webhook, etc). */
export async function notifyComplete(summary: {
  status: string;
  result: any;
}): Promise<{ notified: boolean; timestamp: string }> {
  // In production, this would call a notification service.
  return {
    notified: true,
    timestamp: new Date().toISOString(),
  };
}
