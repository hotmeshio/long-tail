import { loggerRegistry } from '../../../services/logger';
import { getStorageBackend } from '../../../services/storage';

export async function saveScreenshot(page: import('playwright').Page, filePath: string, fullPage: boolean) {
  const backend = getStorageBackend();
  const localPath = await backend.getLocalPath(filePath);
  await page.screenshot({ path: localPath, fullPage });
  const { size } = await backend.commitLocalPath(filePath, localPath);
  loggerRegistry.info(`[lt-mcp:playwright-cli] screenshot: ${filePath} (${size} bytes)`);
  return { path: filePath, size_bytes: size };
}

export function errorResult(message: string, code: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code, ...details }) }],
    isError: true,
  };
}
