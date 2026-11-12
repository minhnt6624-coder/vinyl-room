import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Backdrop } from '../components/layout/Backdrop';
import { Logo } from '../components/layout/Logo';
import { Choice, IdentityFields } from '../components/room/IdentityFields';
import { APP_NAME } from '../config';
import { errorMessage } from '../lib/errors';
import { loadIdentity, saveIdentity } from '../lib/identity';
import { roomService } from '../services/roomService';
import type { RequestMode, Visibility } from '../types';

export function CreateRoomPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState(loadIdentity);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [requestMode, setRequestMode] = useState<RequestMode>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Create a room · ${APP_NAME}`;
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const clean = { name: identity.name.trim(), avatar: identity.avatar };
      const res = await roomService.create({ name, visibility, requestMode, displayName: clean.name, avatar: clean.avatar });
      saveIdentity(clean);
      navigate(`/r/${res.room_code}`, { state: { justCreated: true } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />
      <header className="relative z-10 px-5 py-4 md:px-8">
        <Logo />
      </header>
      <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-5 pb-12 pt-2">
        <div className="eyebrow mb-2 text-indigo">New room</div>
        <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">Open a listening room</h1>
        <p className="mt-2 text-ink-soft">You host and control playback. Guests join with a link and add songs.</p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-7">
          <label className="block">
            <span className="eyebrow mb-2 block">Room name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Friday night records" autoFocus required />
          </label>

          <IdentityFields value={identity} onChange={setIdentity} />

          <Choice<Visibility>
            legend="Who can find it"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Private', hint: 'Only people with the link or code.' },
              { value: 'public', label: 'Public', hint: 'Also listed on the home page.' },
            ]}
          />
          <Choice<RequestMode>
            legend="Song requests"
            value={requestMode}
            onChange={setRequestMode}
            options={[
              { value: 'auto', label: 'Add straight to the queue', hint: 'Requests join the queue right away.' },
              { value: 'approval', label: 'I approve each one', hint: 'Requests wait for your OK first.' },
            ]}
          />

          {error && (
            <p className="border-l-2 border-vermilion py-1 pl-3 text-sm" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link to="/" className="btn btn-ghost">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !identity.name.trim()}>
              {busy && <LoaderCircle size={16} className="animate-spin" />}
              Create room
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
