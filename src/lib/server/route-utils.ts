export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function pollUntil(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
