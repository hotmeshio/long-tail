import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SignatureWidget } from '../SignatureWidget';

// jsdom has no canvas 2D context — stub the minimum surface the widget touches.
function stubCanvas(canvas: HTMLCanvasElement, displayWidth: number, displayHeight: number) {
  const calls: Array<{ op: string; x?: number; y?: number }> = [];
  const ctx = {
    lineWidth: 0,
    lineCap: '',
    strokeStyle: '',
    beginPath: () => calls.push({ op: 'beginPath' }),
    moveTo: (x: number, y: number) => calls.push({ op: 'moveTo', x, y }),
    lineTo: (x: number, y: number) => calls.push({ op: 'lineTo', x, y }),
    stroke: () => calls.push({ op: 'stroke' }),
    clearRect: () => calls.push({ op: 'clearRect' }),
    drawImage: () => calls.push({ op: 'drawImage' }),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: displayWidth, height: displayHeight,
    right: displayWidth, bottom: displayHeight, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,x');
  return calls;
}

describe('SignatureWidget', () => {
  it('holds its natural document width — the pad container caps at 25rem', () => {
    render(<SignatureWidget fieldKey="sign_off" value="" onChange={vi.fn()} />);
    const wrapper = document.querySelector('canvas')!.parentElement!;
    expect(wrapper.className).toContain('max-w-[25rem]');
  });

  it('scales pointer coordinates into the 400x150 backing store', () => {
    render(<SignatureWidget fieldKey="sign_off" value="" onChange={vi.fn()} />);
    const canvas = document.querySelector('canvas')! as HTMLCanvasElement;
    // Displayed at half the backing width: a pointer at CSS x=100 must land
    // at store x=200 — without scaling the ink drifts from the cursor.
    const calls = stubCanvas(canvas, 200, 75);
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 30 });
    fireEvent.mouseMove(canvas, { clientX: 150, clientY: 50 });
    const moveTo = calls.find((c) => c.op === 'moveTo');
    const lineTo = calls.find((c) => c.op === 'lineTo');
    expect(moveTo).toMatchObject({ x: 200, y: 60 });
    expect(lineTo).toMatchObject({ x: 300, y: 100 });
  });

  it('renders its label and required marker', () => {
    render(<SignatureWidget fieldKey="sign_off" value="" onChange={vi.fn()} isRequired />);
    expect(screen.getByText('Sign Off')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });
});
