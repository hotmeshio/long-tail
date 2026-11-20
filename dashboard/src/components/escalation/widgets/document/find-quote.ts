/**
 * Find a quoted passage in a page's text layer. Matching ignores case and
 * runs of whitespace, and tries the passage's opening words when the whole
 * quote is not found (a model quote often differs near its end). The match
 * comes back as the share of each text run it covers, so the viewer can
 * paint exactly that part of the line.
 */
export interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface QuoteMatch {
  runIndex: number;
  /** Start and end of the match within the run, as fractions of its width. */
  from: number;
  to: number;
}

const OPENING_CHARS = 60;

/** The text as the search sees it, with the raw index each kept character came from. */
function flatten(runs: TextRun[]): { text: string; rawOf: number[]; starts: number[] } {
  const starts: number[] = [];
  let raw = '';
  for (const run of runs) {
    starts.push(raw.length);
    raw += `${run.str} `;
  }
  let text = '';
  const rawOf: number[] = [];
  let spaced = true;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!spaced) { text += ' '; rawOf.push(i); spaced = true; }
    } else {
      text += ch.toLowerCase();
      rawOf.push(i);
      spaced = false;
    }
  }
  return { text, rawOf, starts };
}

function normalizeQuote(quote: string): string {
  return quote.toLowerCase().replace(/\s+/g, ' ').trim();
}

function indexOfRun(starts: number[], rawIndex: number): number {
  let run = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= rawIndex) run = i;
  return run;
}

export function findQuote(runs: TextRun[], quote: string): QuoteMatch[] | null {
  const wanted = normalizeQuote(quote);
  if (wanted.length === 0 || runs.length === 0) return null;
  const { text, rawOf, starts } = flatten(runs);
  let at = text.indexOf(wanted);
  let length = wanted.length;
  if (at === -1 && wanted.length > OPENING_CHARS) {
    const opening = wanted.slice(0, OPENING_CHARS);
    at = text.indexOf(opening);
    length = opening.length;
  }
  if (at === -1) return null;
  const rawStart = rawOf[at];
  const rawEnd = rawOf[at + length - 1] + 1;
  const matches: QuoteMatch[] = [];
  for (let r = indexOfRun(starts, rawStart); r < runs.length && starts[r] < rawEnd; r++) {
    const size = Math.max(runs[r].str.length, 1);
    const from = Math.max(rawStart - starts[r], 0) / size;
    const to = Math.min(rawEnd - starts[r], runs[r].str.length) / size;
    if (to > from) matches.push({ runIndex: r, from, to });
  }
  return matches.length > 0 ? matches : null;
}
