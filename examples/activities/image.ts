/**
 * Image processing activities — uses storage backend for file I/O.
 *
 * Downloads from storage (MinIO/S3) → processes with sharp → writes back.
 * Each function is a standalone activity that can be:
 *   - Called from a workflow via proxyActivities
 *   - Exposed as an MCP tool via the image-tools server
 */

import sharp from 'sharp';
import * as path from 'path';
import { getStorageBackend } from '../../lib/storage';

/** Read a file from storage into a Buffer */
async function readFromStorage(key: string): Promise<Buffer> {
  const { data } = await getStorageBackend().read(key);
  return data;
}

/** Write a Buffer to storage */
async function writeToStorage(key: string, data: Buffer): Promise<{ size: number }> {
  const result = await getStorageBackend().write(key, data);
  return { size: result.size };
}

function resolveOutput(inputPath: string, suffix: string, outputPath?: string): string {
  if (outputPath) return outputPath;
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  return `${dir}/${base}_${suffix}${ext}`;
}

export async function getImageInfo(input: { path: string }): Promise<{
  width: number; height: number; format: string;
  size: number; channels: number; megapixels: number;
}> {
  const buf = await readFromStorage(input.path);
  const meta = await sharp(buf).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'unknown',
    size: buf.length,
    channels: meta.channels ?? 0,
    megapixels: Math.round(((meta.width ?? 0) * (meta.height ?? 0)) / 1_000_000 * 100) / 100,
  };
}

export async function resizeImage(input: {
  path: string; width?: number; height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  output_path?: string;
}): Promise<{ output: string; width: number; height: number }> {
  const out = resolveOutput(input.path, 'resized', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf)
    .resize(input.width, input.height, { fit: input.fit || 'inside' })
    .toBuffer({ resolveWithObject: true });
  await writeToStorage(out, result.data);
  return { output: out, width: result.info.width, height: result.info.height };
}

export async function cropImage(input: {
  path: string; left: number; top: number;
  width: number; height: number; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'cropped', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf)
    .extract({ left: input.left, top: input.top, width: input.width, height: input.height })
    .toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function rotateImage(input: {
  path: string; angle: number; background?: string; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'rotated', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf)
    .rotate(input.angle, { background: input.background || '#00000000' })
    .toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function flipImage(input: {
  path: string; direction: 'horizontal' | 'vertical'; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'flipped', input.output_path);
  const buf = await readFromStorage(input.path);
  let img = sharp(buf);
  img = input.direction === 'horizontal' ? img.flop() : img.flip();
  const result = await img.toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function grayscaleImage(input: {
  path: string; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'grayscale', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf).grayscale().toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function blurImage(input: {
  path: string; sigma?: number; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'blurred', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf).blur(input.sigma || 3).toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function adjustImage(input: {
  path: string; brightness?: number; saturation?: number;
  output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'adjusted', input.output_path);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf)
    .modulate({
      brightness: input.brightness ?? 1,
      saturation: input.saturation ?? 1,
    })
    .toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function compressImage(input: {
  path: string; quality?: number; format?: 'jpeg' | 'png' | 'webp';
  output_path?: string;
}): Promise<{ output: string; size: number }> {
  const fmt = input.format || 'jpeg';
  const ext = fmt === 'jpeg' ? '.jpg' : `.${fmt}`;
  const out = input.output_path || resolveOutput(input.path, 'compressed').replace(/\.[^.]+$/, ext);
  const quality = input.quality ?? 80;

  const buf = await readFromStorage(input.path);
  let img = sharp(buf);
  if (fmt === 'jpeg') img = img.jpeg({ quality });
  else if (fmt === 'webp') img = img.webp({ quality });
  else if (fmt === 'png') img = img.png({ compressionLevel: Math.round((100 - quality) / 10) });

  const result = await img.toBuffer();
  const { size } = await writeToStorage(out, result);
  return { output: out, size };
}

export async function convertFormat(input: {
  path: string; format: 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff';
  output_path?: string;
}): Promise<{ output: string }> {
  const ext = input.format === 'jpeg' ? '.jpg' : `.${input.format}`;
  const out = input.output_path || input.path.replace(/\.[^.]+$/, ext);
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf).toFormat(input.format).toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function addBorder(input: {
  path: string; width: number; color?: string; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'bordered', input.output_path);
  const w = input.width;
  const buf = await readFromStorage(input.path);
  const result = await sharp(buf)
    .extend({ top: w, bottom: w, left: w, right: w, background: input.color || '#000000' })
    .toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}

export async function pixelateImage(input: {
  path: string; block_size?: number; output_path?: string;
}): Promise<{ output: string }> {
  const out = resolveOutput(input.path, 'pixelated', input.output_path);
  const buf = await readFromStorage(input.path);
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 100;
  const h = meta.height ?? 100;
  const block = input.block_size || 10;
  const result = await sharp(buf)
    .resize(Math.ceil(w / block), Math.ceil(h / block), { kernel: 'nearest' })
    .resize(w, h, { kernel: 'nearest' })
    .toBuffer();
  await writeToStorage(out, result);
  return { output: out };
}
