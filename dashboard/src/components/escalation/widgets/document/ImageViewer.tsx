import { useState } from 'react';
import { useContainerSize } from '../../../../hooks/useContainerWidth';
import { FRAME_PAD, ViewerToolbar } from './ViewerToolbar';

/**
 * A scanned page or photo: fit to the frame, zoom, rotate a quarter turn at
 * a time, and scroll the zoomed image. The box the image occupies is sized
 * in layout (not by transform), so scrolling reaches every edge at any zoom
 * and rotation.
 */
export function ImageViewer({ url, name, heightClass, expiresAt, onRefresh, onError }: {
  url: string;
  name: string;
  heightClass: string;
  expiresAt?: string;
  onRefresh?: () => void;
  onError: () => void;
}) {
  const [frameRef, frame] = useContainerSize<HTMLDivElement>();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const quarter = rotation % 180 !== 0;
  const turnedW = natural ? (quarter ? natural.h : natural.w) : 0;
  const turnedH = natural ? (quarter ? natural.w : natural.h) : 0;
  const fit = natural && frame && frame.width > 0 && frame.height > 0
    ? Math.min(frame.width / turnedW, frame.height / turnedH, 1)
    : null;
  const scale = fit !== null ? fit * zoom : null;

  return (
    <div className="flex flex-col">
      <ViewerToolbar
        name={name}
        url={url}
        expiresAt={expiresAt}
        onRefresh={onRefresh}
        zoom={zoom}
        onZoom={setZoom}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
      />
      <div ref={frameRef} className={`${heightClass} overflow-auto`} style={{ padding: FRAME_PAD }} data-testid="document-image-frame">
        <div
          className="relative mx-auto"
          style={scale !== null ? { width: turnedW * scale, height: turnedH * scale } : undefined}
        >
          <img
            src={url}
            alt={name}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={onError}
            className={scale !== null ? 'absolute left-1/2 top-1/2 max-w-none' : 'max-w-full max-h-full object-contain mx-auto'}
            style={scale !== null && natural
              ? {
                  width: natural.w * scale,
                  height: natural.h * scale,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }
              : undefined}
            data-testid="document-image"
          />
        </div>
      </div>
    </div>
  );
}
