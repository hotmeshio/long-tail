/**
 * Custom topic declarations for example MCP servers.
 *
 * These topics are registered in the topic catalog at startup so they
 * appear in the dashboard, can be browsed with schema documentation,
 * and can be subscribed to by agents.
 *
 * When an image tool processes an image, it publishes to the matching
 * topic. Any agent subscribed to `image.*` (or a specific topic like
 * `image.resized`) will react automatically.
 */

import type { LTTopicConfig } from '../types/startup';

const imageSchema = (description: string, extraProps: Record<string, any> = {}) => ({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Source image path' },
    output_path: { type: 'string', description: 'Output image path' },
    ...extraProps,
  },
});

export const EXAMPLE_TOPICS: LTTopicConfig[] = [
  {
    topic: 'image.info',
    description: 'Image metadata was retrieved (dimensions, format, file size).',
    category: 'app',
    payload_schema: imageSchema('Image info retrieved', {
      width: { type: 'number' },
      height: { type: 'number' },
      format: { type: 'string' },
      size: { type: 'number', description: 'File size in bytes' },
    }),
    example_payload: { path: '/images/photo.jpg', width: 1920, height: 1080, format: 'jpeg', size: 245760 },
    tags: ['image', 'metadata'],
  },
  {
    topic: 'image.resized',
    description: 'An image was resized.',
    category: 'app',
    payload_schema: imageSchema('Image resized', {
      width: { type: 'number' },
      height: { type: 'number' },
    }),
    example_payload: { path: '/images/photo.jpg', output_path: '/images/photo_resized.jpg', width: 800, height: 600 },
    tags: ['image', 'transform'],
  },
  {
    topic: 'image.cropped',
    description: 'A rectangular region was cropped from an image.',
    category: 'app',
    payload_schema: imageSchema('Image cropped'),
    example_payload: { path: '/images/photo.jpg', output_path: '/images/photo_cropped.jpg' },
    tags: ['image', 'transform'],
  },
  {
    topic: 'image.rotated',
    description: 'An image was rotated.',
    category: 'app',
    payload_schema: imageSchema('Image rotated', {
      angle: { type: 'number', description: 'Rotation angle in degrees' },
    }),
    example_payload: { path: '/images/photo.jpg', output_path: '/images/photo_rotated.jpg', angle: 90 },
    tags: ['image', 'transform'],
  },
  {
    topic: 'image.flipped',
    description: 'An image was flipped horizontally or vertically.',
    category: 'app',
    payload_schema: imageSchema('Image flipped', {
      direction: { type: 'string', description: 'horizontal or vertical' },
    }),
    example_payload: { path: '/images/photo.jpg', output_path: '/images/photo_flipped.jpg', direction: 'horizontal' },
    tags: ['image', 'transform'],
  },
  {
    topic: 'image.converted',
    description: 'An image was converted to a different format or had filters applied (grayscale, blur, adjust, compress, pixelate, border).',
    category: 'app',
    payload_schema: imageSchema('Image converted/filtered', {
      operation: { type: 'string', description: 'Operation performed (grayscale, blur, compress, convert, border, pixelate, adjust)' },
      format: { type: 'string', description: 'Output format (when applicable)' },
    }),
    example_payload: { path: '/images/photo.jpg', output_path: '/images/photo.webp', operation: 'convert', format: 'webp' },
    tags: ['image', 'transform'],
  },
];
