/**
 * Image Tools MCP Server — local image processing via sharp.
 *
 * Registers image activities as MCP tools so they can be
 * discovered and called by the Pipeline Designer.
 *
 * This is an example of how to build a custom MCP server
 * that wraps your own activities as tools and publishes
 * events to the topic bus after each operation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerMcpTool } from '../../services/mcp/register-tool';
import { eventRegistry } from '../../lib/events';
import type { LTEvent } from '../../types/events';
import * as image from '../activities/image';

/**
 * Publish a fire-and-forget image event to the topic bus.
 * Agents subscribed to `image.*` will react automatically.
 */
function publishImageEvent(
  topic: string,
  data: Record<string, any>,
): void {
  // A custom (non-system) event: just the minimal envelope + data. No workflow
  // fields — those belong only to system.workflow.* families. eventRegistry
  // mints the id.
  const event: LTEvent = {
    type: topic,
    source: 'image-tools',
    data,
    timestamp: new Date().toISOString(),
  };
  eventRegistry.publish(event).catch(() => {});
}

export function createImageToolsServer(): McpServer {
  const server = new McpServer({ name: 'image-tools', version: '1.0.0' });

  registerMcpTool(server,
    'get_image_info',
    'Get image metadata: dimensions, format, file size, megapixels.',
    { path: z.string().describe('Path to the image file') },
    async ({ path }: any) => {
      const result = await image.getImageInfo({ path });
      publishImageEvent('image.info', { path, ...result });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'resize_image',
    'Resize an image. Preserves aspect ratio by default.',
    {
      path: z.string().describe('Path to the image file'),
      width: z.number().optional().describe('Target width in pixels'),
      height: z.number().optional().describe('Target height in pixels'),
      fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).optional().describe('How to fit the image'),
      output_path: z.string().optional().describe('Output path (defaults to input_resized.ext)'),
    },
    async (args: any) => {
      const result = await image.resizeImage(args);
      publishImageEvent('image.resized', { ...result, path: args.path, output_path: args.output_path });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'crop_image',
    'Crop a rectangular region from an image.',
    {
      path: z.string().describe('Path to the image file'),
      left: z.number().describe('Left offset in pixels'),
      top: z.number().describe('Top offset in pixels'),
      width: z.number().describe('Crop width in pixels'),
      height: z.number().describe('Crop height in pixels'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.cropImage(args);
      publishImageEvent('image.cropped', { path: args.path, output_path: args.output_path });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'rotate_image',
    'Rotate an image by a given angle (degrees, counter-clockwise).',
    {
      path: z.string().describe('Path to the image file'),
      angle: z.number().describe('Rotation angle in degrees'),
      background: z.string().optional().describe('Background color for exposed areas (hex, e.g. #ffffff)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.rotateImage(args);
      publishImageEvent('image.rotated', { path: args.path, output_path: args.output_path, angle: args.angle });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'flip_image',
    'Flip an image horizontally or vertically.',
    {
      path: z.string().describe('Path to the image file'),
      direction: z.enum(['horizontal', 'vertical']).describe('Flip direction'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.flipImage(args);
      publishImageEvent('image.flipped', { path: args.path, output_path: args.output_path, direction: args.direction });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'grayscale_image',
    'Convert an image to grayscale.',
    {
      path: z.string().describe('Path to the image file'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.grayscaleImage(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'grayscale' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'blur_image',
    'Apply Gaussian blur to an image.',
    {
      path: z.string().describe('Path to the image file'),
      sigma: z.number().optional().describe('Blur intensity (default: 3)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.blurImage(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'blur' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'adjust_image',
    'Adjust brightness and saturation. Values > 1 increase, < 1 decrease.',
    {
      path: z.string().describe('Path to the image file'),
      brightness: z.number().optional().describe('Brightness multiplier (default: 1.0)'),
      saturation: z.number().optional().describe('Saturation multiplier (default: 1.0)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.adjustImage(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'adjust' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'compress_image',
    'Compress an image to reduce file size.',
    {
      path: z.string().describe('Path to the image file'),
      quality: z.number().optional().describe('Quality 1-100 (default: 80)'),
      format: z.enum(['jpeg', 'png', 'webp']).optional().describe('Output format (default: jpeg)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.compressImage(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'compress', format: args.format });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'convert_format',
    'Convert an image to a different format.',
    {
      path: z.string().describe('Path to the image file'),
      format: z.enum(['jpeg', 'png', 'webp', 'avif', 'tiff']).describe('Target format'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.convertFormat(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'convert', format: args.format });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'add_border',
    'Add a solid-color border around an image.',
    {
      path: z.string().describe('Path to the image file'),
      width: z.number().describe('Border width in pixels'),
      color: z.string().optional().describe('Border color (hex, default: #000000)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.addBorder(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'border' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  registerMcpTool(server,
    'pixelate_image',
    'Apply a pixelation/mosaic effect to an image.',
    {
      path: z.string().describe('Path to the image file'),
      block_size: z.number().optional().describe('Pixel block size (default: 10)'),
      output_path: z.string().optional().describe('Output path'),
    },
    async (args: any) => {
      const result = await image.pixelateImage(args);
      publishImageEvent('image.converted', { path: args.path, output_path: args.output_path, operation: 'pixelate' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}
