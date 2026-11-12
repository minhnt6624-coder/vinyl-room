import { ArrowRight, Users } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Backdrop } from '../components/layout/Backdrop';
import { Logo } from '../components/layout/Logo';
import { Disc } from '../components/vinyl/Disc';
import { APP_NAME, APP_TAGLINE } from '../config';
import { isSupabaseConfigured } from '../lib/supabase';
import { roomService } from '../services/roomService';
import type { PublicRoom } from '../types';

/** Accepts a bare code or a pasted room link. */
function parseCode(input: string): string | null {
  const fromLink = input.match(/\/r\/([A-Za-z0-9]{6})(?:[/?#]|$)/)?.[1];
  const code = (fromLink ?? input.replace(/\s+/g, '')).toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);

  useEffect(() => {
    document.title = APP_NAME;
    if (!isSupabaseConfigured) return;
    let alive = true;
    roomService
      .listPublic()
      .then((r) => alive && setRooms(r))
      .catch(() => alive && setRooms([])); // the list is a nicety; the page works without it
    return () => {
      alive = false;
    };
  }, []);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCode(code);
    if (parsed) navigate(`/r/${parsed}`);
    else setCodeError(true);
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />
      <header className="relative z-10 flex items-center justify-between px-5 py-4 md:px-8">
        <Logo />
        <span className="eyebrow hidden text-ink-soft sm:inline">{APP_TAGLINE}</span>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-10 px-5 pb-10 pt-4 md:grid-cols-[1.1fr_0.9fr] md:px-8">
        <div>
          <div className="eyebrow mb-4 text-indigo">A shared listening room</div>
          <h1 className="font-display text-5xl font-semibold leading-[0.98] md:text-7xl">
            Bring a record.
            <br />
            <em className="font-medium">Everyone hears it together.</em>
          </h1>
          <p className="mt-5 max-w-md text-ink-soft">
            Open a room, share the link, and let friends add songs to one queue. You play it; they hear the same moment you do. No accounts.
          </p>

          {!isSupabaseConfigured && (
            <p className="mt-6 max-w-md border-l-2 border-vermilion py-1 pl-3 text-sm" role="alert">
              This app isn't connected to a Supabase project yet. Copy <code>.env.example</code> to <code>.env.local</code>, fill in the two values and restart. The README has the steps.
            </p>
          )}

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-start">
            <Link to="/new" className="btn btn-primary !min-h-[52px] flex-none">
              Create a room <ArrowRight size={16} />
            </Link>
            <form onSubmit={join} className="min-w-0 flex-1 sm:max-w-xs" noValidate>
              <div className="flex">
                <input
                  className="field !h-[52px] min-w-0 flex-1 uppercase tracking-[0.2em] placeholder:normal-case placeholder:tracking-normal"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError(false);
                  }}
                  placeholder="Room code or link"
                  aria-label="Room code or link"
                  aria-invalid={codeError}
                  aria-describedby={codeError ? 'code-error' : undefined}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="btn btn-ghost !min-h-[52px] flex-none border-l-0" disabled={!code.trim()}>
                  Join
                </button>
              </div>
              {codeError && (
                <p id="code-error" className="mt-2 text-sm text-vermilion">
                  Room codes are 6 letters and numbers, like K7M2PQ.
                </p>
              )}
            </form>
          </div>
        </div>

        {/* One record, half out of its sleeve. */}
        <div className="relative mx-auto hidden aspect-square w-full max-w-[380px] md:block" style={{ '--c': '#b5553c' } as CSSProperties} aria-hidden="true">
          <div className="absolute left-[36%] top-[17%] aspect-square w-[64%]">
            <Disc spinning />
          </div>
          <div className="absolute left-0 top-[14%] aspect-square w-[72%] -rotate-2 overflow-hidden rounded-[3px] shadow-float">
            <div className="art-fallback">
              <div className="art-fallback-title">Side A</div>
              <div className="art-fallback-artist">{APP_NAME}</div>
            </div>
          </div>
        </div>
      </main>

      {rooms && rooms.length > 0 && (
        <section className="ground relative z-10 px-5 py-8 md:px-8" aria-labelledby="open-rooms">
          <div className="relative mx-auto max-w-6xl">
            <h2 id="open-rooms" className="eyebrow border-b-[1.5px] border-ink pb-2">
              Open rooms
            </h2>
            <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <li key={r.room_code}>
                  <Link to={`/r/${r.room_code}`} className="group flex items-center gap-4 border-b border-line py-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-2xl font-semibold leading-tight group-hover:text-indigo">{r.name}</span>
                      <span className="block truncate text-xs text-ink-soft">{r.now_playing ? `Playing: ${r.now_playing}` : 'Nothing playing yet'}</span>
                    </span>
                    <span className="eyebrow flex flex-none items-center gap-1.5 text-ink-soft">
                      <Users size={13} /> {r.member_count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
