export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve with the first truthy value `check` returns, or throw after `ms`. */
export async function until<T>(check: () => T | undefined | null | false, ms = 500): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await sleep(2);
  }
  throw new Error('condition not met in time');
}
