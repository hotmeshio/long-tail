/**
 * Structural validator for HotMesh YAML pipe syntax.
 *
 * HotMesh collation errors are silent at deploy time but catastrophic at
 * runtime — a single malformed @pipe in an activated workflow poisons the
 * engine's stream, causing every execution attempt to fail with a
 * collation-error until the database is wiped.
 *
 * This module provides:
 *   validatePipeStructure  — throws on any structurally invalid @pipe
 *   repairPipeStructure    — auto-repairs safe-to-fix patterns, then validates
 *
 * Call repairPipeStructure before storing or deploying any YAML.
 *
 * ## What constitutes a valid @pipe row
 *
 * An @pipe value is a YAML sequence. Each element (row) must be one of:
 *   1. A YAML sequence (array)          — operands row OR function call row
 *   2. A YAML mapping with '@pipe' key  — nested sub-pipe
 *
 * Invalid row types that cause collation errors:
 *   - A bare string:  '{@object.create}'     → must be ['{@object.create}']
 *   - A number/bool:  42, true               → must be wrapped in an array
 *   - A double-nested sequence: [[...]]      → row itself is an array of arrays
 */

import * as jsYaml from 'js-yaml';

// ── types ─────────────────────────────────────────────────────────────────────

export interface PipeViolation {
  path: string;
  rowIndex: number;
  rowValue: unknown;
  message: string;
  repairable: boolean;
}

// ── internal traversal ────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function collectPipeViolations(
  node: unknown,
  path: string,
  violations: PipeViolation[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectPipeViolations(item, `${path}[${i}]`, violations));
    return;
  }
  if (!isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}.${key}`;

    if (key === '@pipe') {
      if (!Array.isArray(value)) {
        violations.push({
          path: childPath,
          rowIndex: -1,
          rowValue: value,
          message: `@pipe value must be a sequence (array), got ${typeof value}`,
          repairable: false,
        });
        continue;
      }

      (value as unknown[]).forEach((row, i) => {
        if (Array.isArray(row)) {
          // Valid row — but check for double-nested arrays: [[...]]
          if (row.length > 0 && row.every((el) => Array.isArray(el))) {
            violations.push({
              path: childPath,
              rowIndex: i,
              rowValue: row,
              message: `row ${i} is a double-nested array (array of arrays) — each @pipe row must be a flat array`,
              repairable: false,
            });
          }
        } else if (isPlainObject(row) && '@pipe' in (row as Record<string, unknown>)) {
          // Valid nested sub-pipe — recurse into it
          collectPipeViolations(row, `${childPath}[${i}]`, violations);
        } else if (typeof row === 'string') {
          // '{@fn}' as bare string — repairable: wrap in array
          violations.push({
            path: childPath,
            rowIndex: i,
            rowValue: row,
            message: `row ${i} is a bare string "${row}" — must be an array row like ['${row}']`,
            repairable: true,
          });
        } else if (typeof row === 'number' || typeof row === 'boolean') {
          violations.push({
            path: childPath,
            rowIndex: i,
            rowValue: row,
            message: `row ${i} is a bare scalar ${JSON.stringify(row)} — must be wrapped in an array`,
            repairable: true,
          });
        } else {
          violations.push({
            path: childPath,
            rowIndex: i,
            rowValue: row,
            message: `row ${i} has unexpected type ${typeof row}`,
            repairable: false,
          });
        }
      });
    } else {
      collectPipeViolations(value, childPath, violations);
    }
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Parse the YAML and check every @pipe for structural violations.
 * Throws a descriptive error listing all violations if any are found.
 */
export function validatePipeStructure(yamlContent: string): void {
  let parsed: unknown;
  try {
    parsed = jsYaml.load(yamlContent);
  } catch (err: any) {
    throw new Error(`YAML parse error: ${err.message}`);
  }

  const violations: PipeViolation[] = [];
  collectPipeViolations(parsed, 'root', violations);

  if (violations.length > 0) {
    const detail = violations
      .map((v) => `  • ${v.path}[${v.rowIndex}]: ${v.message}`)
      .join('\n');
    throw new Error(
      `Malformed @pipe structure — ${violations.length} violation(s) detected. ` +
      `This YAML will cause HotMesh collation errors at runtime and must not be deployed.\n${detail}`,
    );
  }
}

/**
 * Auto-repair safe violations (bare strings/scalars → array rows), then
 * validate that no unfixable violations remain.
 *
 * Returns the repaired YAML string. Throws if unfixable violations exist.
 */
export function repairPipeStructure(yamlContent: string): string {
  let parsed: unknown;
  try {
    parsed = jsYaml.load(yamlContent);
  } catch (err: any) {
    throw new Error(`YAML parse error: ${err.message}`);
  }

  const repairCount = { n: 0 };
  repairNode(parsed, repairCount);

  if (repairCount.n > 0) {
    // Re-serialize — use lineWidth: -1 to prevent wrapping
    yamlContent = jsYaml.dump(parsed, { lineWidth: -1, noRefs: true, quotingType: "'" });
  }

  // Final validation pass — throws if unfixable violations remain
  validatePipeStructure(yamlContent);
  return yamlContent;
}

function repairNode(node: unknown, count: { n: number }): void {
  if (Array.isArray(node)) {
    node.forEach((item) => repairNode(item, count));
    return;
  }
  if (!isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '@pipe' && Array.isArray(value)) {
      const rows = value as unknown[];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (typeof row === 'string' || typeof row === 'number' || typeof row === 'boolean') {
          rows[i] = [row];
          count.n++;
        } else if (isPlainObject(row) && '@pipe' in (row as Record<string, unknown>)) {
          repairNode(row, count);
        } else if (Array.isArray(row)) {
          repairNode(row, count);
        }
      }
    } else {
      repairNode(value, count);
    }
  }
}
