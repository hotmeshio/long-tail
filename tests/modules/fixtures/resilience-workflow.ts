/** A workflow with no activities: it completes as soon as the engine runs it. */
export async function resilienceEcho(name: string): Promise<string> {
  return `echo:${name}`;
}
