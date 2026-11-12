import { useEffect, useState, type ReactNode } from 'react';
import { providerList } from '../../services/providers';
import type { RoomActions, RoomState } from '../../types';
import { SharePanel } from './SharePanel';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-b border-line py-3.5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-soft">{hint}</span>
      </span>
      <span className="relative mt-0.5 flex-none">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block h-6 w-11 rounded-full bg-ink/20 transition-colors peer-checked:bg-indigo peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm">
      <dt className="eyebrow text-ink-soft">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function AboutRoom({ state, actions }: { state: RoomState; actions: RoomActions }) {
  const { room, members, queue, me } = state;
  const isHost = me.role === 'host';
  const host = members.find((m) => m.role === 'host');
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.name]);

  const saveName = () => {
    const next = name.trim();
    if (next && next !== room.name) actions.updateSettings({ name: next });
    else setName(room.name);
  };

  return (
    <div className="flex flex-col gap-8 pb-4">
      <SharePanel code={room.room_code} roomName={room.name} />

      <dl>
        <Fact label="Host">
          {host ? `${host.avatar} ${host.display_name}` : 'Unknown'}
        </Fact>
        <Fact label="Opened">{new Date(room.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Fact>
        <Fact label="Visibility">{room.visibility === 'public' ? 'Public, listed on the home page' : 'Private, link or code only'}</Fact>
        <Fact label="Requests">
          {!room.allow_requests ? 'Paused by the host' : room.request_mode === 'auto' ? 'Go straight to the queue' : 'Host approves each one'}
        </Fact>
        <Fact label="Records played">{queue.filter((q) => q.status === 'played').length}</Fact>
      </dl>

      {isHost && (
        <section>
          <h3 className="eyebrow border-b-[1.5px] border-ink pb-2">Host settings</h3>
          <label className="block border-b border-line py-3.5">
            <span className="mb-1.5 block text-sm font-medium">Room name</span>
            <input
              className="field"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <Toggle label="Guests can request songs" hint="Turn off to pause new requests." checked={room.allow_requests} onChange={(v) => actions.updateSettings({ allow_requests: v })} />
          <Toggle
            label="Approve requests first"
            hint="Requests wait for your OK before joining the queue."
            checked={room.request_mode === 'approval'}
            onChange={(v) => actions.updateSettings({ request_mode: v ? 'approval' : 'auto' })}
          />
          <Toggle label="Allow the same song twice" hint="Off: a song already in the queue can't be added again." checked={room.allow_duplicates} onChange={(v) => actions.updateSettings({ allow_duplicates: v })} />
          <Toggle label="List on the home page" hint="Public rooms can be found without the link." checked={room.visibility === 'public'} onChange={(v) => actions.updateSettings({ visibility: v ? 'public' : 'private' })} />
        </section>
      )}

      <section>
        <h3 className="eyebrow border-b-[1.5px] border-ink pb-2">Music sources</h3>
        <ul>
          {providerList.map((p) => (
            <li key={p.id} className="border-b border-line py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{p.label}</span>
                <span className={`eyebrow !text-[10px] ${p.capabilities.syncedPlayback ? 'text-moss' : 'text-ink-soft'}`}>
                  {p.capabilities.syncedPlayback ? 'Synced playback' : 'Embed only'}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{p.playbackNote}</p>
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <button className="btn btn-danger" onClick={actions.closeRoom}>
          Close room for everyone
        </button>
      ) : (
        <button className="btn btn-danger" onClick={actions.leaveRoom}>
          Leave room
        </button>
      )}
    </div>
  );
}
