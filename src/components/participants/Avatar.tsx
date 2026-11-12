import { spineColor } from '../../lib/format';

interface Props {
  avatar: string | null | undefined;
  name?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
}

export function Avatar({ avatar, name, size = 32, online, className = '' }: Props) {
  return (
    <span
      className={`relative inline-flex flex-none items-center justify-center rounded-full ring-2 ring-cream ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        lineHeight: 1,
        background: `color-mix(in srgb, ${spineColor(name ?? avatar ?? '?')} 32%, #fff7e6)`,
      }}
      title={name ?? undefined}
    >
      <span aria-hidden="true">{avatar || '🎧'}</span>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-cream ${online ? 'bg-moss' : 'bg-ink-soft/40'}`}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
