// Rename the product here (and the <title> in index.html).
export const APP_NAME = 'Vinyl Room';
export const APP_TAGLINE = 'Now listening together';

export const REACTIONS = [
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'fire', emoji: '🔥', label: 'Fire' },
  { type: 'vibe', emoji: '🎵', label: 'Vibe' },
  { type: 'funny', emoji: '😂', label: 'Funny' },
  { type: 'clap', emoji: '👏', label: 'Clap' },
] as const;

export const AVATARS = ['🦊', '🐼', '🦉', '🐸', '🐙', '🦁', '🐰', '🐻', '🦄', '🐳', '🌵', '🍄', '🌙', '⭐', '🎧', '🎷'];

export const roomUrl = (code: string) => `${window.location.origin}/r/${code}`;
