import type { ReactNode } from 'react';

/** A vinyl disc. Fills its parent; `label` is drawn on the centre label. */
export function Disc({ spinning = false, label }: { spinning?: boolean; label?: ReactNode }) {
  return (
    <div className={`disc ${spinning ? 'is-spinning' : ''}`}>
      <div className="disc-spin">
        <div className="disc-label">{label}</div>
        <div className="disc-hole" />
      </div>
    </div>
  );
}

export function Equalizer({ on, className = '' }: { on: boolean; className?: string }) {
  return (
    <span className={`eq ${on ? 'is-on' : ''} ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
