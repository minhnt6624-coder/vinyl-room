const MESSAGES: Record<string, string> = {
  VR_NOT_CONFIGURED: 'This app is not connected to a Supabase project yet.',
  VR_AUTH_FAILED: 'Could not start a guest session. Check that anonymous sign-ins are enabled in Supabase.',
  VR_NOT_AUTHENTICATED: 'Your session expired. Reload the page to continue.',
  VR_NOT_MEMBER: 'You are not in this room.',
  VR_NOT_HOST: 'Only the host can do that.',
  VR_NOT_ALLOWED: "You can't do that.",
  VR_NOT_FOUND: 'That item is no longer there.',
  VR_ROOM_NOT_FOUND: 'No room with that code.',
  VR_ROOM_CLOSED: 'This room has been closed.',
  VR_ROOM_FULL: 'This room is full.',
  VR_REMOVED: 'The host removed you from this room.',
  VR_HOST_CANNOT_LEAVE: 'The host closes the room instead of leaving it.',
  VR_INVALID_NAME: 'Please enter a name.',
  VR_INVALID_INPUT: 'That value is not valid.',
  VR_INVALID_TRACK: "That track can't be added.",
  VR_REQUESTS_DISABLED: 'The host has paused song requests.',
  VR_DUPLICATE: 'That song is already in the queue.',
  VR_TOO_MANY_REQUESTS: 'You already have 10 songs waiting. Let a few play first.',
  VR_TOO_MANY_ROOMS: 'You have 5 open rooms. Close one before opening another.',
  VR_QUEUE_FULL: 'The queue is full.',
  VR_RATE_LIMITED: 'Slow down a little, then try again.',
  VR_SEARCH_NOT_CONFIGURED: 'Search is not set up on this server yet. Paste a YouTube link instead.',
  VR_SEARCH_QUOTA: "Search has reached today's YouTube limit. Paste a YouTube link instead.",
  VR_SEARCH_FAILED: 'Search is unavailable right now. Paste a YouTube link instead.',
  VR_LYRICS_FAILED: "Couldn't load the lyrics right now.",
  VR_TRACK_LOOKUP_FAILED: "Couldn't read that link. Check that it points to a single, public track.",
  VR_NETWORK: 'Connection problem. Check your network and try again.',
};

export class AppError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(MESSAGES[code] ?? detail ?? 'Something went wrong. Try again.');
    this.code = code;
    this.name = 'AppError';
  }

  static from(err: unknown): AppError {
    if (err instanceof AppError) return err;
    const raw = String((err as { message?: string })?.message ?? err ?? '');
    const code = raw.match(/VR_[A-Z_]+/)?.[0];
    if (code) return new AppError(code);
    if (/failed to fetch|networkerror|load failed/i.test(raw)) return new AppError('VR_NETWORK');
    return new AppError('VR_UNKNOWN', import.meta.env.DEV ? raw : undefined);
  }
}

export const errorMessage = (err: unknown) => AppError.from(err).message;
