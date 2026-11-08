export const CLASS_NAMES = ['crazing', 'inclusion', 'patches', 'pitted_surface', 'rolled-in_scale', 'scratches'];

const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];

export const colorFor = (name) => PALETTE[Math.max(0, CLASS_NAMES.indexOf(name)) % PALETTE.length];

/** Draw detection boxes + labels onto a 2D context in image-pixel coordinates. */
export function drawDetections(ctx, detections, scale = 1) {
  ctx.lineWidth = Math.max(2, 2 * scale);
  ctx.font = `${Math.max(12, 13 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const d of detections) {
    const [x1, y1, x2, y2] = d.bbox;
    const color = colorFor(d.class_name);
    ctx.strokeStyle = color;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const label = `${d.class_name} ${(d.confidence * 100).toFixed(0)}%`;
    const w = ctx.measureText(label).width + 8;
    const h = Math.max(16, 17 * scale);
    const ly = y1 - h < 0 ? y1 : y1 - h;
    ctx.fillStyle = color;
    ctx.fillRect(x1, ly, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x1 + 4, ly + 2);
  }
}
