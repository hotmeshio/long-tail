/** HotMesh appId: letters and digits only (no dashes, no underscores). Must start with a letter. */
export const NAMESPACE_RE = /^[a-z][a-z0-9]*$/;

export function validateNamespace(value: string): string | null {
  if (!value) return 'Namespace is required';
  if (value.includes('-') || value.includes('_')) return 'Only letters and numbers allowed — no dashes or underscores';
  if (!NAMESPACE_RE.test(value)) {
    if (!/^[a-z]/.test(value)) return 'Must start with a lowercase letter';
    return 'Only lowercase letters and numbers allowed';
  }
  return null;
}

export function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const STEP_LABELS = ['Namespace', 'Tool', 'Tags'] as const;
