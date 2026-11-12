import { Headphones, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useNow } from '../../hooks/useNow';
import { expectedPosition, formatTime, spineColor } from '../../lib/format';
import { getProvider } from '../../services/providers';
import type { PlayerHandle, QueueItem, Room, RoomActions } from '../../types';
import { Artwork } from '../vinyl/Artwork';
import { Disc } from '../vinyl/Disc';

interface Props {
  room: Room;
  item: QueueItem | null;
  isHost: boolean;
  hasUpNext: boolean;
  clockOffset: number;
  player: PlayerHandle;
  actions: RoomActions;
}

/**
 * The floating player. It shows the room's shared playback state; only the
 * host gets transport controls. Volume is always local to this listener.
 */
export function PlayerBar({ room, item, isHost, hasUpNext, clockOffset, player, actions }: Props) {
  const playing = room.playback_status === 'playing';
  const provider = item ? getProvider(item.track.provider) : null;
  const synced = provider?.capabilities.syncedPlayback ?? false;

  useNow(500, playing && synced); // repaint the progress bar while the record turns
  const [scrub, setScrub] = useState<number | null>(null);

  const duration = item ? (provider!.getDuration(item.track) ?? player.duration) : null;
  const position = item && synced ? Math.min(expectedPosition(room, clockOffset), duration ?? Infinity) : 0;
  const shown = scrub ?? position;
  const fill = duration ? `${Math.min(100, (shown / duration) * 100)}%` : '0%';
  const canSeek = isHost && synced && Boolean(duration);

  const commitScrub = () => {
    if (scrub !== null) {
      actions.seek(scrub);
      setScrub(null);
    }
  };

  const canPlay = isHost && (item ? synced : hasUpNext);
  const audible = !player.muted && player.volume > 0;

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[26px] px-3 py-2 md:flex-nowrap md:gap-x-4 md:px-4">
      {/* what is on */}
      <div className="flex min-w-0 flex-1 items-center gap-3 md:w-52 md:flex-none">
        <div className="h-11 w-11 flex-none" style={{ '--c': item ? spineColor(item.track.id) : '#b89f7a' } as CSSProperties}>
          <Disc spinning={playing && Boolean(item)} label={item ? <Artwork track={item.track} showText={false} /> : undefined} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item ? item.track.title : 'Nothing on the turntable'}</div>
          <div className="eyebrow truncate !text-[10px] text-ink-soft">
            {item ? `${item.track.artist ?? provider!.label} · ${provider!.label}` : hasUpNext ? (isHost ? 'Press play to start' : 'Waiting for the host') : 'Add a record to begin'}
          </div>
        </div>
      </div>

      {/* transport: host only */}
      {player.needsGesture ? (
        <button className="pill !h-10 flex-none !bg-indigo !text-white" onClick={player.startAudio}>
          <Headphones size={16} /> {isHost ? 'Start audio' : 'Join listening'}
        </button>
      ) : isHost ? (
        <div className="flex flex-none items-center">
          <button className="icon-btn" onClick={actions.previous} disabled={!item} aria-label="Previous">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            className="icon-btn !h-11 !w-11 bg-ink text-cream hover:!bg-ink/85"
            onClick={actions.togglePlay}
            disabled={!canPlay}
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            title={item && !synced ? `${provider!.label} can't be controlled by the room` : undefined}
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-px" />}
          </button>
          <button className="icon-btn" onClick={actions.next} disabled={!item} aria-label="Next record">
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>
      ) : (
        <div className="eyebrow flex flex-none items-center gap-2 rounded-full bg-ink/5 px-3 py-2 !text-[10px] text-ink-soft" title="The host controls playback for the room">
          {playing ? <Play size={11} fill="currentColor" /> : <Pause size={11} fill="currentColor" />}
          {room.playback_status === 'idle' ? 'Host is choosing' : playing ? 'Host is playing' : 'Host paused'}
        </div>
      )}

      {/* progress */}
      <div className="order-last flex basis-full items-center gap-2.5 md:order-none md:min-w-0 md:flex-1 md:basis-0">
        {item && !synced ? (
          <p className="w-full truncate text-xs text-ink-soft">Embed only. Press play in the {provider!.label} player. Not synced by the room.</p>
        ) : (
          <>
            <span className="w-9 flex-none text-right text-[11px] tabular-nums text-ink-soft">{formatTime(item ? shown : null)}</span>
            <input
              type="range"
              className="range"
              style={{ '--fill': fill } as CSSProperties}
              min={0}
              max={duration ?? 1}
              step={1}
              value={Math.floor(shown)}
              disabled={!canSeek}
              aria-label={canSeek ? 'Seek' : 'Playback progress'}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitScrub}
              onKeyUp={commitScrub}
              onBlur={commitScrub}
            />
            <span className="w-9 flex-none text-[11px] tabular-nums text-ink-soft">{formatTime(item ? duration : null)}</span>
          </>
        )}
      </div>

      {/* volume: local to this listener */}
      <div className="flex flex-none items-center gap-1">
        <button className="icon-btn" onClick={player.toggleMute} aria-label={audible ? 'Mute (only for you)' : 'Unmute'} aria-pressed={!audible}>
          {audible ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <input
          type="range"
          className="range hidden !w-20 lg:block"
          style={{ '--fill': `${player.muted ? 0 : player.volume}%` } as CSSProperties}
          min={0}
          max={100}
          value={player.muted ? 0 : player.volume}
          aria-label="Your volume"
          onChange={(e) => player.setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
