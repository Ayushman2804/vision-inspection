import { useEffect, useRef } from 'react';
import { drawDetections } from '../draw.js';

// Render at a fixed width so labels stay the same on-screen size whatever the
// source resolution is (NEU-DET images are only 200px wide).
const TARGET_WIDTH = 900;

/** Renders an image with detection boxes drawn on top. */
export default function BBoxCanvas({ src, detections }) {
  const ref = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const k = TARGET_WIDTH / img.naturalWidth;
      canvas.width = TARGET_WIDTH;
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const scaled = detections.map((d) => ({ ...d, bbox: d.bbox.map((v) => v * k) }));
      drawDetections(ctx, scaled, 1.4);
    };
    img.src = src;
  }, [src, detections]);

  return <canvas ref={ref} className="bbox-canvas" />;
}
