import { ChevronLeft, ChevronRight, Crown, ExternalLink, Play, Plus, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Backdrop } from '../components/layout/Backdrop';
import { Logo } from '../components/layout/Logo';
import { Notice } from '../components/layout/Notice';
import { Sheet } from '../components/layout/Sheet';
import { LyricsDock, type LyricsMode } from '../components/lyrics/LyricsDock';
import { Avatar } from '../components/participants/Avatar';
import { AvatarStack, MemberList } from '../components/participants/Participants';
import { PlayerBar } from '../components/player/PlayerBar';
import { Screen } from '../components/player/Screen';
import { QueuePanel } from '../components/queue/QueuePanel';
import { FloatingReactions } from '../components/reactions/FloatingReactions';
import { ReactionBar } from '../components/reactions/ReactionBar';
import { AboutRoom } from '../components/room/AboutRoom';
import { SharePanel } from '../components/room/SharePanel';
import { SearchPanel } from '../components/search/SearchPanel';
import { VinylShelf } from '../components/vinyl/VinylShelf';
import { APP_NAME, APP_TAGLINE } from '../config';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import { useRoom } from '../hooks/useRoom';
import { useToast } from '../hooks/useToast';
import { errorMessage } from '../lib/errors';
import { expectedPosition, shelfOrder } from '../lib/format';
import { getProvider } from '../services/providers';
import { playbackService } from '../services/playbackService';
import { queueService } from '../services/queueService';
import { reactionService } from '../services/reactionService';
import { roomService } from '../services/roomService';
import type { QueueItem, RoomActions } from '../types';

type Panel = 'library' | 'queue' | 'about' | 'people' | 'share' | null;

function statusLabel(item: QueueItem, upNextIndex: number, playing: boolean): string {
  switch (item.status) {
    case 'playing':
      return playing ? 'Now playing' : 'On the turntable, paused';
    case 'approved':
      return upNextIndex === 0 ? 'Up next' : `In the queue · ${upNextIndex + 1}`;
    case 'pending':
      return 'Waiting for the host';
    default:
      return 'Played earlier';
  }
}

export function ListeningRoomPage({ roomId, onGone }: { roomId: string; onGone(): void }) {
  const { state, phase, error, connection, onlineIds, clockOffset, clockCalibrated, refetch } = useRoom(roomId);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated);
  const [panel, setPanel] = useState<Panel>(justCreated ? 'share' : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>('closed');

  const room = state?.room ?? null;
  const queue = state?.queue ?? [];
  const isHost = state?.me.role === 'host';
  const playing = room?.playback_status === 'playing';

  const shelf = useMemo(() => shelfOrder(queue), [queue]);
  const current = useMemo(() => queue.find((q) => q.status === 'playing') ?? null, [queue]);
  const upNext = useMemo(() => shelf.filter((q) => q.status === 'approved'), [shelf]);
  const pendingCount = queue.filter((q) => q.status === 'pending').length;

  // Actions read the newest state through a ref, so they stay stable across renders.
  const live = useRef({ state, clockOffset });
  live.current = { state, clockOffset };

  const actions = useMemo<RoomActions>(() => {
    const fail = (e: unknown) => toast(errorMessage(e), 'error');
    // Realtime will deliver the change too; refetching here just makes the
    // person who acted see it without waiting for the round trip.
    const run = (p: Promise<unknown>, done?: string) => {
      p.then(() => {
        if (done) toast(done, 'success');
        void refetch();
      }).catch(fail);
    };
    const theRoom = () => live.current.state?.room;

    return {
      async requestTrack(candidate) {
        try {
          const res = await queueService.request(roomId, candidate);
          toast(res.status === 'pending' ? 'Sent to the host for approval' : `Added "${candidate.title}" to the queue`, 'success');
          void refetch();
          return true;
        } catch (e) {
          fail(e);
          return false;
        }
      },
      approve: (id) => run(queueService.review(id, true), 'Request approved'),
      reject: (id) => run(queueService.review(id, false)),
      cancel: (id) => run(queueService.cancel(id), 'Request withdrawn'),
      remove: (id) => run(queueService.remove(id)),
      reorder: (ids) => run(queueService.reorder(roomId, ids)),
      playItem: (id) => run(playbackService.playItem(id)),
      next: () => run(playbackService.next(roomId, theRoom()?.current_item_id ?? null)),
      previous: () => run(playbackService.previous(roomId)),
      togglePlay() {
        const r = theRoom();
        if (!r) return;
        if (r.playback_status === 'playing') run(playbackService.set(roomId, 'paused', expectedPosition(r, live.current.clockOffset)));
        else run(playbackService.set(roomId, 'playing', r.playback_position));
      },
      seek(seconds) {
        const r = theRoom();
        if (r?.current_item_id) run(playbackService.set(roomId, r.playback_status === 'playing' ? 'playing' : 'paused', seconds));
      },
      react: (id, type) => run(reactionService.toggle(id, type)),
      updateSettings: (patch) => run(roomService.updateSettings(roomId, patch)),
      removeMember(memberId) {
        const who = live.current.state?.members.find((m) => m.id === memberId)?.display_name ?? 'this person';
        if (window.confirm(`Remove ${who} from the room? Their waiting requests go too, and they can't rejoin.`)) {
          run(roomService.removeMember(memberId), `${who} was removed`);
        }
      },
      closeRoom() {
        if (!window.confirm('Close the room for everyone? This ends the session and cannot be undone.')) return;
        roomService
          .close(roomId)
          .then(() => {
            toast('Room closed', 'success');
            navigate('/');
          })
          .catch(fail);
      },
      leaveRoom() {
        roomService
          .leave(roomId)
          .then(() => navigate('/'))
          .catch(fail);
      },
    };
  }, [roomId, toast, refetch, navigate]);

  const player = usePlaybackSync({
    room,
    item: current,
    isHost,
    clockOffset,
    clockCalibrated,
    onHostPlayback: (status, position) => {
      playbackService.set(roomId, status, position).catch(() => {});
    },
    onEnded: (itemId) => {
      playbackService
        .next(roomId, itemId)
        .then(() => refetch())
        .catch(() => {});
    },
    onDuration: (itemId, seconds) => {
      playbackService.reportDuration(itemId, seconds).catch(() => {});
    },
    onPlayerError: (message) => toast(message, 'error'),
  });

  // The shelf follows the turntable: when a new record starts, bring it forward.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId) setSelectedId(currentId);
  }, [currentId]);

  // Keep the selection on a record that still exists.
  useEffect(() => {
    if (shelf.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!shelf.some((q) => q.id === selectedId)) {
      setSelectedId((current ?? upNext[0] ?? shelf[shelf.length - 1]).id);
    }
  }, [shelf, selectedId, current, upNext]);

  // Tell the host when a request is waiting for them.
  const seenPending = useRef<number | null>(null);
  useEffect(() => {
    if (!state) return;
    if (isHost && seenPending.current !== null && pendingCount > seenPending.current) toast('A new request is waiting for your approval');
    seenPending.current = pendingCount;
  }, [state, isHost, pendingCount, toast]);

  useEffect(() => {
    if (phase === 'removed') onGone();
  }, [phase, onGone]);

  const roomName = room?.name;
  useEffect(() => {
    if (roomName) document.title = `${roomName} · ${APP_NAME}`;
  }, [roomName]);

  if (phase === 'error') {
    return (
      <Notice title="Couldn't load the room" body={error ?? undefined}>
        <button className="btn btn-primary" onClick={() => void refetch()}>
          Try again
        </button>
        <Link to="/" className="btn btn-ghost">
          Home
        </Link>
      </Notice>
    );
  }
  if (!state || !room) return <Notice title="Opening the room" loading />;
  if (room.status === 'closed') {
    return (
      <Notice eyebrow={room.name} title="This room has closed" body="The host ended the session. Thanks for listening.">
        <Link to="/" className="btn btn-primary">
          Back to the start
        </Link>
      </Notice>
    );
  }

  const selected = shelf.find((q) => q.id === selectedId) ?? null;
  const selectedIndex = selected ? shelf.indexOf(selected) : -1;
  const step = (by: number) => {
    const next = shelf[selectedIndex + by];
    if (next) setSelectedId(next.id);
  };
  const canRequest = isHost || room.allow_requests;
  const openLibrary = () => setPanel('library');
  const close = () => setPanel(null);
  // Lyrics need a record on the turntable. Below xl they open as a sheet, and
  // full screen covers the window, so <main> then rises above the player bar.
  const lyricsShown = current ? lyricsMode : 'closed';
  const mainLayer = lyricsShown === 'full' ? 'z-50' : lyricsShown === 'open' ? 'z-50 xl:z-10' : 'z-10';

  const tabs: { id: Exclude<Panel, 'people' | 'share' | null> | 'now'; label: string }[] = [
    { id: 'now', label: 'Now playing' },
    { id: 'library', label: 'Music library' },
    { id: 'queue', label: pendingCount && isHost ? `Queue · ${pendingCount}` : 'Queue' },
    { id: 'about', label: 'About room' },
  ];

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop />

      <header className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 md:grid-cols-[1fr_auto_1fr] md:gap-3 pt-3 md:px-8 md:pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <Logo hideNameOnMobile />
          <span
            className={`eyebrow hidden items-center gap-1.5 !text-[10px] lg:inline-flex ${connection === 'live' ? 'text-moss' : 'text-vermilion'}`}
            role="status"
          >
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${connection === 'live' ? '' : 'animate-pulse'}`} />
            {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </span>
        </div>
        <div className="min-w-0 text-center">
          <h1 className="truncate font-display text-2xl font-semibold leading-tight md:text-3xl">{room.name}</h1>
          <div className="eyebrow !text-[10px] text-ink-soft">{APP_TAGLINE}</div>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 md:gap-2">
          <AvatarStack members={state.members} onlineIds={onlineIds} onClick={() => setPanel('people')} />
          <button className="icon-btn md:!hidden" onClick={() => setPanel('share')} aria-label="Share room">
            <Share2 size={18} />
          </button>
          <button className="pill !hidden !h-10 md:!inline-flex" onClick={() => setPanel('share')}>
            <Share2 size={15} /> <span className="eyebrow">Share</span>
          </button>
          <span className="relative hidden lg:inline-flex" title={`${state.me.display_name}${isHost ? ' (host)' : ''}`}>
            <Avatar avatar={state.me.avatar} name={state.me.display_name} size={36} />
            {isHost && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo text-white" aria-label="You are the host">
                <Crown size={10} />
              </span>
            )}
          </span>
        </div>
      </header>

      <nav className="relative z-10 mt-3 flex justify-center px-3" aria-label="Room">
        <div className="tabs max-w-full overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-pressed={t.id === 'now' ? panel === null : panel === t.id}
              onClick={() => {
                if (t.id === 'now') {
                  close();
                  if (current) setSelectedId(current.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } else setPanel(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {connection === 'reconnecting' && (
        <p className="eyebrow relative z-10 mt-2 text-center !text-[10px] text-vermilion lg:hidden" role="status">
          Reconnecting…
        </p>
      )}

      <main className={`relative flex flex-1 flex-col ${mainLayer}`}>
        <div className="relative h-[clamp(220px,40dvh,460px)] flex-none">
          <VinylShelf items={shelf} selectedId={selectedId} onSelect={setSelectedId} currentId={currentId} isPlaying={playing} onEmptyAction={openLibrary} />
          {shelf.length > 1 && (
            <>
              <button
                className="icon-btn card absolute left-2 top-1/2 z-10 -translate-y-1/2 md:left-6"
                onClick={() => step(-1)}
                disabled={selectedIndex <= 0}
                aria-label="Browse to the previous record on the shelf"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className={`icon-btn card absolute right-2 top-1/2 z-10 -translate-y-1/2 md:right-6 ${lyricsShown === 'open' ? 'xl:right-[340px]' : ''}`}
                onClick={() => step(1)}
                disabled={selectedIndex >= shelf.length - 1}
                aria-label="Browse to the next record on the shelf"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>

        <section className="ground flex-1 px-5 pb-44 pt-6 md:pb-32" aria-live="polite">
          <div className="relative mx-auto max-w-xl text-center">
            {selected ? (
              <>
                <div className="eyebrow text-indigo">{statusLabel(selected, upNext.indexOf(selected), playing)}</div>
                <h2 className="mt-2 line-clamp-2 font-display text-3xl font-semibold leading-tight md:text-4xl">{selected.track.title}</h2>
                <p className="mt-1 truncate text-ink-soft">
                  {[selected.track.artist ?? 'Unknown artist', selected.track.album].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar avatar={selected.requester_avatar} name={selected.requester_name} size={18} className="!ring-0" />
                    Requested by {selected.requested_by === state.me.id ? 'you' : (selected.requester_name ?? 'someone')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <a href={selected.track.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-indigo hover:underline">
                    {getProvider(selected.track.provider).label} <ExternalLink size={11} />
                  </a>
                </p>
                <div className="mt-4">
                  <ReactionBar item={selected} onReact={(t) => actions.react(selected.id, t)} />
                </div>
                {isHost && selected.id !== currentId && selected.status !== 'pending' && (
                  <button className="btn btn-ghost mt-4" onClick={() => actions.playItem(selected.id)}>
                    <Play size={15} fill="currentColor" /> Play this now
                  </button>
                )}
                {isHost && selected.status === 'pending' && (
                  <div className="mt-4 flex justify-center gap-2">
                    <button className="btn btn-primary" onClick={() => actions.approve(selected.id)}>
                      Approve
                    </button>
                    <button className="btn btn-danger" onClick={() => actions.reject(selected.id)}>
                      Reject
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="font-display text-3xl font-semibold md:text-4xl">The crate is empty</h2>
                <p className="mx-auto mt-2 max-w-sm text-ink-soft">
                  {canRequest ? 'Add the first record and it appears on the shelf for everyone.' : 'The host has paused song requests for now.'}
                </p>
                {canRequest && (
                  <button className="btn btn-primary mt-5" onClick={openLibrary}>
                    <Plus size={16} /> Add a record
                  </button>
                )}
              </>
            )}
          </div>
          <LyricsDock mode={lyricsMode} onMode={setLyricsMode} room={room} item={current} next={upNext[0] ?? null} clockOffset={clockOffset} playerDuration={player.duration}>
            <Screen item={current} player={player} />
          </LyricsDock>
        </section>
      </main>

      {/* Search, one thumb away on phones. */}
      <button className="pill fixed bottom-[128px] right-3 z-30 !bg-indigo !text-white md:!hidden" onClick={openLibrary} aria-label="Search and add a song">
        <Plus size={18} /> <span className="eyebrow">Add</span>
      </button>

      <div className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 md:inset-x-5 md:bottom-5 xl:right-[335px]">
        <div className="mx-auto max-w-3xl">
          <PlayerBar room={room} item={current} isHost={isHost} hasUpNext={upNext.length > 0} clockOffset={clockOffset} player={player} actions={actions} lyricsOpen={lyricsShown !== 'closed'} onToggleLyrics={() => setLyricsMode((m) => (m === 'closed' ? 'open' : 'closed'))} />
        </div>
      </div>

      <FloatingReactions queue={queue} />

      <Sheet open={panel === 'library'} onClose={close} title="Music library" eyebrow="Find a record">
        <SearchPanel queue={queue} canRequest={canRequest} needsApproval={!isHost && room.request_mode === 'approval'} allowDuplicates={room.allow_duplicates} onRequest={actions.requestTrack} />
      </Sheet>
      <Sheet open={panel === 'queue'} onClose={close} title="Queue" eyebrow={room.name}>
        <QueuePanel queue={queue} meId={state.me.id} isHost={isHost} isPlaying={playing} actions={actions} onAdd={openLibrary} />
      </Sheet>
      <Sheet open={panel === 'about'} onClose={close} title="About this room" eyebrow={room.name}>
        <AboutRoom state={state} actions={actions} />
      </Sheet>
      <Sheet open={panel === 'people'} onClose={close} title="In the room" eyebrow={`${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}`}>
        <MemberList members={state.members} onlineIds={onlineIds} meId={state.me.id} isHost={isHost} onRemove={actions.removeMember} />
      </Sheet>
      <Sheet open={panel === 'share'} onClose={close} title="Invite people" eyebrow={justCreated ? 'Your room is open' : room.name}>
        <SharePanel code={room.room_code} roomName={room.name} />
      </Sheet>
    </div>
  );
}
