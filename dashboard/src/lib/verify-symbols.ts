/**
 * On-screen code check: rasterize each preview page and decode it with the
 * browser's BarcodeDetector (Chrome), then compare with the codes each
 * symbol was drawn from. Browsers without the detector skip the check.
 */

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type DetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

export interface SymbolCheck {
  expected: number;
  decoded: number;
  missing: string[];
}

const FORMATS = ['code_128', 'qr_code', 'data_matrix'];
const RASTER_SCALE = 8;

export function canVerifySymbols(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

async function rasterize(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  const viewBox = svg.viewBox.baseVal;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewBox.width * RASTER_SCALE);
  canvas.height = Math.round(viewBox.height * RASTER_SCALE);
  const image = new Image();
  const markup = new XMLSerializer().serializeToString(svg);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Decode every page under `container` and report codes the browser could not read back. */
export async function verifySymbols(container: HTMLElement): Promise<SymbolCheck | null> {
  if (!canVerifySymbols()) return null;
  const Detector = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
  const detector = new Detector({ formats: FORMATS });
  const expected = new Set<string>();
  const decoded = new Set<string>();
  for (const svg of Array.from(container.querySelectorAll<SVGSVGElement>('svg.lt-print-page'))) {
    svg.querySelectorAll('[data-code]').forEach((el) => expected.add(el.getAttribute('data-code')!));
    const found = await detector.detect(await rasterize(svg));
    for (const code of found) decoded.add(code.rawValue);
  }
  const missing = [...expected].filter((code) => !decoded.has(code));
  return { expected: expected.size, decoded: expected.size - missing.length, missing };
}
