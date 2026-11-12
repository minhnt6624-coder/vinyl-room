import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Notice } from '../components/layout/Notice';
import { errorMessage } from '../lib/errors';
import { roomService } from '../services/roomService';
import type { RoomPreview } from '../types';
import { JoinRoomPage } from './JoinRoomPage';
import { ListeningRoomPage } from './ListeningRoomPage';

const HomeLink = () => (
  <Link to="/" className="btn btn-primary">
    Back to the start
  </Link>
);

/**
 * /r/:code. Looks the room up and shows the right screen: the room itself for
 * members, the join screen for newcomers, or why the room can't be entered.
 * Membership is decided by the database, never by anything stored locally.
 */
export function RoomGate() {
  const code = (useParams().code ?? '').toUpperCase();
  const [preview, setPreview] = useState<RoomPreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPreview(undefined);
    roomService
      .preview(code)
      .then(setPreview)
      .catch((e) => setError(errorMessage(e)));
  }, [code]);

  useEffect(load, [load]);

  if (error) {
    return (
      <Notice title="Couldn't open the room" body={error}>
        <button className="btn btn-primary" onClick={load}>
          Try again
        </button>
        <Link to="/" className="btn btn-ghost">
          Home
        </Link>
      </Notice>
    );
  }
  if (preview === undefined) return <Notice title="Finding the room" loading />;
  if (preview === null) {
    return (
      <Notice title="No room with that code" body={`Nothing is open at ${code}. Check the link, or ask the host for a new one.`}>
        <HomeLink />
      </Notice>
    );
  }
  if (preview.status === 'closed') {
    return (
      <Notice eyebrow={preview.name} title="This room has closed" body="The host ended the session. Thanks for listening.">
        <HomeLink />
      </Notice>
    );
  }
  if (preview.my_status === 'removed') {
    return (
      <Notice eyebrow={preview.name} title="You were removed from this room" body="The host removed you, so you can't rejoin with this browser.">
        <HomeLink />
      </Notice>
    );
  }
  if (preview.my_status === 'active') return <ListeningRoomPage roomId={preview.id} onGone={load} />;
  return <JoinRoomPage preview={preview} onJoined={load} />;
}
