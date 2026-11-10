import { Link, useLocation } from 'react-router';
import { DEFECT_GLYPHS, IconScan } from './Icons.jsx';

// Fixed positions (percent of the viewport) so the field looks the same on every load.
const DRIFT = [
  ['crazing', 8, 14, 64, 0],
  ['scratches', 78, 9, 72, -18],
  ['pitted_surface', 46, 30, 56, -40],
  ['patches', 88, 52, 80, -7],
  ['inclusion', 22, 62, 60, -29],
  ['rolled-in_scale', 62, 78, 76, -51],
  ['crazing', 34, 90, 52, -12],
  ['scratches', 4, 82, 58, -33],
  ['pitted_surface', 70, 36, 48, -60],
  ['patches', 18, 34, 44, -22],
];

/**
 * Faint outlines of the six NEU-DET defect classes drifting behind the content.
 * Decoration only: hidden from assistive tech, ignores the pointer, and holds still
 * when the user prefers reduced motion.
 */
export function DefectField() {
  return (
    <div className="defect-field" aria-hidden="true">
      {DRIFT.map(([name, x, y, size, delay], k) => (
        <svg
          key={k}
          className={`glyph g${k % 3}`}
          viewBox="0 0 48 48"
          width={size}
          height={size}
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {DEFECT_GLYPHS[name]}
        </svg>
      ))}
    </div>
  );
}

/** Floating shortcut to the main action. Hidden on the page it opens. */
export function InspectFab() {
  const { pathname } = useLocation();
  if (pathname === '/upload') return null;
  return (
    <Link to="/upload" className="fab" aria-label="Inspect an image">
      <IconScan size={24} />
      <span className="fab-label">Inspect an image</span>
    </Link>
  );
}
