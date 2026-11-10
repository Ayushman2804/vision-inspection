// Inline stroke icons (no icon dependency). 24px grid, currentColor, 1.75 stroke.
function Svg({ size = 20, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconVideo = (p) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="13" height="12" rx="2" />
    <path d="M15.5 10.5 21 7.5v9l-5.5-3" />
  </Svg>
);

export const IconUpload = (p) => (
  <Svg {...p}>
    <path d="M12 15V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconHistory = (p) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconSignOut = (p) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 16.5 5.5 12 10 7.5" />
    <path d="M5.5 12H15" />
  </Svg>
);

/** Viewfinder over a surface: "inspect". */
export const IconScan = (p) => (
  <Svg {...p}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
    <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
    <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
    <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M8 12h8" />
  </Svg>
);

/** Stacked steel plates: inspections counted. */
export const IconStack = (p) => (
  <Svg {...p}>
    <path d="m12 3 9 4.5-9 4.5-9-4.5z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </Svg>
);

export const IconWarning = (p) => (
  <Svg {...p}>
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.7 2.7L16.5 9.5" />
  </Svg>
);

export const IconGauge = (p) => (
  <Svg {...p}>
    <path d="M4.2 17a9 9 0 1 1 15.6 0" />
    <path d="m12 13 4-4.5" />
    <circle cx="12" cy="13" r="1.2" />
  </Svg>
);

export const IconBars = (p) => (
  <Svg {...p}>
    <path d="M4 6h10" />
    <path d="M4 12h16" />
    <path d="M4 18h7" />
  </Svg>
);

export const IconTrend = (p) => (
  <Svg {...p}>
    <path d="M3 17.5 9 11l4 4 8-8.5" />
    <path d="M15 6.5h6v6" />
  </Svg>
);

export const IconBell = (p) => (
  <Svg {...p}>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </Svg>
);

export const IconResult = (p) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
);

/** Brand mark: a steel coil seen end-on. */
export const IconCoil = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
);

/*
 * The six NEU-DET defect classes as line drawings, for the drifting background.
 * Drawn on a 48px grid; they are decoration only.
 */
export const DEFECT_GLYPHS = {
  crazing: (
    <path d="M6 30 14 22l5 6 7-12 6 8 6-6 4 4M14 22l-3-8M26 16l2-9M32 24l2 12" />
  ),
  inclusion: <path d="M6 26c8-3 14 2 22-1s10-6 14-5M12 22c4 0 6 2 10 1" />,
  patches: (
    <path d="M12 14c6-6 16-4 20 2s6 14-2 18-18 2-21-4-3-10 3-16zM20 22c2-2 6-1 6 2s-4 4-6 2" />
  ),
  pitted_surface: (
    <>
      <circle cx="12" cy="14" r="2" />
      <circle cx="26" cy="11" r="1.5" />
      <circle cx="36" cy="20" r="2.5" />
      <circle cx="18" cy="28" r="1.5" />
      <circle cx="30" cy="32" r="2" />
      <circle cx="10" cy="36" r="1.2" />
    </>
  ),
  'rolled-in_scale': (
    <path d="M6 16h10l3 3h10l3-3h10M6 26h7l2 2h12l2-2h13M6 36h14l3-2h19" />
  ),
  scratches: <path d="M8 38 40 10M14 40 38 18M20 42l18-16" />,
};
