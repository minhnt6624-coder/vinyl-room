const BOKEH = [
  { left: '8%', top: '12%', size: 26, delay: 0 },
  { left: '22%', top: '34%', size: 14, delay: -5 },
  { left: '64%', top: '22%', size: 18, delay: -9 },
  { left: '86%', top: '44%', size: 30, delay: -3 },
  { left: '44%', top: '8%', size: 12, delay: -12 },
];

/** Soft morning light: pale sky, a blurred sun, a few motes, paper grain. */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-sun" />
      {BOKEH.map((b, i) => (
        <span
          key={i}
          className="backdrop-bokeh"
          style={{ left: b.left, top: b.top, width: b.size, height: b.size, animationDelay: `${b.delay}s` }}
        />
      ))}
      <div className="grain" />
    </div>
  );
}
