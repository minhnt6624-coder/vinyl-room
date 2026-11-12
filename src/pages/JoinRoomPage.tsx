import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Backdrop } from '../components/layout/Backdrop';
import { Logo } from '../components/layout/Logo';
import { Avatar } from '../components/participants/Avatar';
import { IdentityFields } from '../components/room/IdentityFields';
import { APP_NAME } from '../config';
import { errorMessage } from '../lib/errors';
import { loadIdentity, saveIdentity } from '../lib/identity';
import { roomService } from '../services/roomService';
import type { RoomPreview } from '../types';

/** The one screen between a shared link and the room. */
export function JoinRoomPage({ preview, onJoined }: { preview: RoomPreview; onJoined(): void }) {
  const [identity, setIdentity] = useState(loadIdentity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Join ${preview.name} · ${APP_NAME}`;
  }, [preview.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const clean = { name: identity.name.trim(), avatar: identity.avatar };
      await roomService.join(preview.room_code, clean.name, clean.avatar);
      saveIdentity(clean);
      onJoined();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const others = preview.member_count;

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />
      <header className="relative z-10 px-5 py-4 md:px-8">
        <Logo />
      </header>
      <main className="relative z-10 mx-auto w-full max-w-md flex-1 px-5 pb-12 pt-2">
        <div className="eyebrow mb-2 text-indigo">You're invited</div>
        <h1 className="break-words font-display text-4xl font-semibold leading-tight md:text-5xl">{preview.name}</h1>
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          {preview.host_name && (
            <>
              <Avatar avatar={preview.host_avatar} name={preview.host_name} size={24} />
              <span>Hosted by {preview.host_name}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{others === 1 ? '1 person listening' : `${others} people listening`}</span>
        </p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-6">
          <IdentityFields value={identity} onChange={setIdentity} autoFocus />
          {error && (
            <p className="border-l-2 border-vermilion py-1 pl-3 text-sm" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !identity.name.trim()}>
            {busy && <LoaderCircle size={16} className="animate-spin" />}
            Join the room
          </button>
          <p className="text-center text-xs text-ink-soft">No account needed. The host controls playback; you can add songs and react.</p>
        </form>
      </main>
    </div>
  );
}
