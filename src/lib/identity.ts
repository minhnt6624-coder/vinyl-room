import { AVATARS } from '../config';

export interface Identity {
  name: string;
  avatar: string;
}

const KEY = 'vr.identity';

// A convenience only: remembers what this browser typed last time so joining
// another room is one tap. The room's real member record lives in the database.
export function loadIdentity(): Identity {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Identity> | null;
    if (raw && typeof raw.name === 'string' && typeof raw.avatar === 'string' && AVATARS.includes(raw.avatar)) {
      return { name: raw.name.slice(0, 24), avatar: raw.avatar };
    }
  } catch {
    /* storage blocked or corrupt: fall through */
  }
  return { name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] };
}

export function saveIdentity(identity: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* storage blocked: nothing to remember */
  }
}
