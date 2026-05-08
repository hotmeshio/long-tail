/**
 * Deterministic color assignment for workflow type names.
 *
 * Maps any string to a consistent color from a curated 24-color palette.
 * The same type name always produces the same color across the entire UI.
 * Uses a simple hash to distribute names evenly across the palette.
 *
 * Each entry provides:
 *   text  — icon and text color (Tailwind class)
 *   bg    — subtle background tint (Tailwind class)
 */

const PALETTE: Array<{ text: string; bg: string }> = [
  { text: 'text-rose-400',     bg: 'bg-rose-400/[0.08]' },
  { text: 'text-pink-400',     bg: 'bg-pink-400/[0.08]' },
  { text: 'text-fuchsia-400',  bg: 'bg-fuchsia-400/[0.08]' },
  { text: 'text-purple-400',   bg: 'bg-purple-400/[0.08]' },
  { text: 'text-violet-400',   bg: 'bg-violet-400/[0.08]' },
  { text: 'text-indigo-400',   bg: 'bg-indigo-400/[0.08]' },
  { text: 'text-blue-400',     bg: 'bg-blue-400/[0.08]' },
  { text: 'text-sky-400',      bg: 'bg-sky-400/[0.08]' },
  { text: 'text-cyan-400',     bg: 'bg-cyan-400/[0.08]' },
  { text: 'text-teal-400',     bg: 'bg-teal-400/[0.08]' },
  { text: 'text-emerald-400',  bg: 'bg-emerald-400/[0.08]' },
  { text: 'text-green-400',    bg: 'bg-green-400/[0.08]' },
  { text: 'text-lime-400',     bg: 'bg-lime-400/[0.08]' },
  { text: 'text-yellow-400',   bg: 'bg-yellow-400/[0.08]' },
  { text: 'text-amber-400',    bg: 'bg-amber-400/[0.08]' },
  { text: 'text-orange-400',   bg: 'bg-orange-400/[0.08]' },
  { text: 'text-red-400',      bg: 'bg-red-400/[0.08]' },
  { text: 'text-stone-400',    bg: 'bg-stone-400/[0.08]' },
  { text: 'text-rose-300',     bg: 'bg-rose-300/[0.08]' },
  { text: 'text-violet-300',   bg: 'bg-violet-300/[0.08]' },
  { text: 'text-sky-300',      bg: 'bg-sky-300/[0.08]' },
  { text: 'text-teal-300',     bg: 'bg-teal-300/[0.08]' },
  { text: 'text-amber-300',    bg: 'bg-amber-300/[0.08]' },
  { text: 'text-pink-300',     bg: 'bg-pink-300/[0.08]' },
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function typeColor(typeName: string): { text: string; bg: string } {
  return PALETTE[hash(typeName) % PALETTE.length];
}
