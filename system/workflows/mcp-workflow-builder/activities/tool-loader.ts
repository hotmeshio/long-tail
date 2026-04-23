import { readFile } from 'fs/promises';
import { join } from 'path';

import { loadToolsFromServers } from '../../shared/tool-loader';
import { toolServerMap, toolDefCache } from './caches';

export async function loadBuilderTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  return loadToolsFromServers(tags, { toolServerMap, toolDefCache }, { logPrefix: 'workflowBuilder' });
}

/**
 * Load a specific section from the activity-types reference file.
 * Returns the markdown for the requested activity type (await, signal, interrupt).
 * Returns empty string if the section or file is not found.
 */
export async function loadReferenceSection(
  section: 'await' | 'signal' | 'interrupt',
): Promise<string> {
  try {
    const refPath = join(__dirname, '..', 'reference', 'activity-types.md');
    const content = await readFile(refPath, 'utf-8');

    // Extract the section between ## <name> and the next ## or end of file
    const sectionHeader = `## ${section}`;
    const startIdx = content.indexOf(sectionHeader);
    if (startIdx === -1) return '';

    const afterHeader = content.indexOf('\n', startIdx);
    const nextSection = content.indexOf('\n## ', afterHeader + 1);
    const endIdx = nextSection === -1 ? content.length : nextSection;

    return content.slice(startIdx, endIdx).trim();
  } catch {
    return '';
  }
}
