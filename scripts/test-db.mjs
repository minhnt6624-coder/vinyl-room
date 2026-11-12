// Runs every migration against an in-process Postgres (PGlite) and walks the
// acceptance scenario at the database level, including the permission checks.
// No Supabase project or Docker needed:  npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'supabase', 'migrations');

const db = new PGlite();

// Minimal stand-ins for what a Supabase project provides out of the box.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create publication supabase_realtime;
`);

for (const file of readdirSync(migrationsDir).sort()) {
  await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  console.log(`migrated  ${file}`);
}

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

async function newUser() {
  const id = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

// Run SQL the way a signed-in browser would: as role "authenticated" with a JWT subject.
async function as(uid, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
const rpc = async (uid, fn, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await as(uid, `select public.${fn}(${ph}) as r`, args);
  return res.rows[0].r;
};
async function rejects(promise, code, label) {
  try {
    await promise;
    ok(false, `${label} (expected ${code}, but it succeeded)`);
  } catch (e) {
    ok(String(e.message).includes(code), `${label} -> ${code}${String(e.message).includes(code) ? '' : ` (got: ${e.message})`}`);
  }
}
const state = (uid, roomId) => rpc(uid, 'get_room_state', [roomId]);
const VIDEO = ['dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk', 'JGwWNGJdvx8'];

const A = await newUser(); // host
const B = await newUser(); // guest
const C = await newUser(); // guest
const D = await newUser(); // outsider

console.log('\n1-4  create and join');
const created = await rpc(A, 'create_room', ['Sunday Crate', 'private', 'auto', 'Ana', '🦊']);
const roomId = created.room_id;
ok(/^[A-HJ-NP-Z2-9]{6}$/.test(created.room_code), `room code generated (${created.room_code})`);
const preview = await rpc(B, 'get_room_preview', [created.room_code.toLowerCase()]);
ok(preview.name === 'Sunday Crate' && preview.host_name === 'Ana' && preview.my_status === null, 'guest sees join preview by code');
const joinB = await rpc(B, 'join_room', [created.room_code, '  Binh  ', '🐼']);
const joinC = await rpc(C, 'join_room', [created.room_code, 'Chi', '🦉']);
ok(joinB.role === 'guest' && joinC.role === 'guest', 'B and C join as guests');
ok((await state(A, roomId)).members.length === 3, 'host sees three members');
ok((await state(B, roomId)).me.display_name === 'Binh', 'display name is trimmed');
ok((await rpc(D, 'get_room_preview', ['ZZZZZZ'])) === null, 'unknown code returns no room');

console.log('\n5-8  request and shared queue');
const req1 = await rpc(B, 'request_track', [roomId, 'youtube', VIDEO[0], 'Song One', 'Artist', null, 'https://evil.example/x.jpg', 212]);
ok(req1.status === 'approved', 'auto mode: request goes straight to the queue');
let sA = await state(A, roomId);
let sC = await state(C, roomId);
ok(sA.queue.length === 1 && sA.queue[0].requester_name === 'Binh', 'host sees the request with requester name');
ok(sC.queue.length === 1 && sC.queue[0].track.title === 'Song One', 'other guest sees the same queue');
ok(sA.queue[0].track.artwork_url === `https://i.ytimg.com/vi/${VIDEO[0]}/hqdefault.jpg`, 'artwork url is derived server-side, client value ignored');
ok(sA.queue[0].track.external_url === `https://www.youtube.com/watch?v=${VIDEO[0]}`, 'external url is derived server-side');
await rejects(rpc(C, 'request_track', [roomId, 'youtube', VIDEO[0], 'Song One again']), 'VR_DUPLICATE', 'duplicate request blocked');
await rejects(rpc(B, 'request_track', [roomId, 'youtube', 'not-an-id', 'Bad']), 'VR_INVALID_TRACK', 'malformed track id rejected');
await rpc(C, 'request_track', [roomId, 'youtube', VIDEO[1], 'Song Two']);
await rpc(B, 'request_track', [roomId, 'youtube', VIDEO[2], 'Song Three']);

console.log('\n9-10 host playback');
await rejects(rpc(B, 'set_playback', [roomId, 'playing', 0]), 'VR_NOT_HOST', 'guest cannot start playback');
await rejects(rpc(B, 'play_next', [roomId, null]), 'VR_NOT_HOST', 'guest cannot skip');
await rpc(A, 'set_playback', [roomId, 'playing', 0]);
sC = await state(C, roomId);
const first = sC.queue.find((q) => q.status === 'playing');
ok(first?.track.title === 'Song One' && sC.room.current_item_id === first.id, 'play on an idle room starts the first record');
ok(sC.room.playback_status === 'playing' && sC.room.playback_started_at !== null, 'guest sees playing state with a start timestamp');
await rpc(A, 'set_playback', [roomId, 'paused', 42.5]);
sC = await state(C, roomId);
ok(sC.room.playback_status === 'paused' && sC.room.playback_position === 42.5 && sC.room.playback_started_at === null, 'pause stores the position');
await rpc(A, 'set_playback', [roomId, 'playing', 42.5]);

console.log('\n11-12 reactions');
ok((await rpc(C, 'toggle_reaction', [first.id, 'love'])).active === true, 'C reacts with love');
await rpc(B, 'toggle_reaction', [first.id, 'love']);
await rpc(B, 'toggle_reaction', [first.id, 'fire']);
sA = await state(A, roomId);
const reacted = sA.queue.find((q) => q.id === first.id);
ok(reacted.reaction_counts.love === 2 && reacted.reaction_counts.fire === 1, 'everyone sees counts love=2 fire=1');
ok(reacted.my_reactions.length === 0, "host's own reactions are empty");
ok((await state(C, roomId)).queue.find((q) => q.id === first.id).my_reactions[0] === 'love', "C's own reaction is flagged");
ok((await rpc(C, 'toggle_reaction', [first.id, 'love'])).active === false, 'reacting again removes it');
ok((await state(A, roomId)).queue.find((q) => q.id === first.id).reaction_counts.love === 1, 'count drops back to 1');
await rejects(rpc(D, 'toggle_reaction', [first.id, 'love']), 'VR_NOT_MEMBER', 'outsider cannot react');
await rejects(
  (async () => { for (let i = 0; i < 40; i++) await rpc(C, 'toggle_reaction', [first.id, 'clap']); })(),
  'VR_RATE_LIMITED', 'reaction spam is rate limited',
);

console.log('\n13-14 skip');
await rpc(A, 'play_next', [roomId, first.id]);
sA = await state(A, roomId);
const second = sA.queue.find((q) => q.status === 'playing');
ok(second?.track.title === 'Song Two', 'skip: next approved record becomes current');
ok(sA.queue.find((q) => q.id === first.id).status === 'played', 'previous record is marked played');
ok(sA.room.playback_position === 0 && sA.room.playback_status === 'playing', 'timeline restarts at 0');
await rpc(A, 'play_next', [roomId, first.id]);
ok((await state(A, roomId)).room.current_item_id === second.id, 'stale skip (old expected track) is a no-op');
await rpc(A, 'play_previous', [roomId]);
sA = await state(A, roomId);
ok(sA.room.current_item_id === first.id, 'previous: steps back to the last played record');
ok(sA.queue.filter((q) => q.status === 'approved')[0].track.title === 'Song Two', '...and the skipped-from record is next again');
await rpc(A, 'play_next', [roomId, null]);

console.log('\nqueue management');
await rpc(A, 'request_track', [roomId, 'youtube', VIDEO[3], 'Song Four']);
let upcoming = (await state(A, roomId)).queue.filter((q) => q.status === 'approved');
ok(upcoming.map((q) => q.track.title).join() === 'Song Three,Song Four', 'upcoming order is by position');
await rejects(rpc(B, 'reorder_queue', [roomId, upcoming.map((q) => q.id).reverse()]), 'VR_NOT_HOST', 'guest cannot reorder');
await rpc(A, 'reorder_queue', [roomId, upcoming.map((q) => q.id).reverse()]);
upcoming = (await state(C, roomId)).queue.filter((q) => q.status === 'approved');
ok(upcoming.map((q) => q.track.title).join() === 'Song Four,Song Three', 'host reorder is visible to guests');
const three = upcoming.find((q) => q.track.title === 'Song Three');
await rejects(rpc(C, 'cancel_request', [three.id]), 'VR_NOT_ALLOWED', "guest cannot cancel someone else's request");
await rejects(rpc(C, 'remove_queue_item', [three.id]), 'VR_NOT_HOST', 'guest cannot remove from queue');
await rpc(B, 'cancel_request', [three.id]);
ok(!(await state(A, roomId)).queue.some((q) => q.id === three.id), 'guest cancels their own request');

console.log('\napproval mode');
await rejects(rpc(B, 'update_room_settings', [roomId, null, null, 'approval', null, null]), 'VR_NOT_HOST', 'guest cannot change settings');
await rpc(A, 'update_room_settings', [roomId, null, null, 'approval', null, null]);
const pend = await rpc(B, 'request_track', [roomId, 'youtube', VIDEO[2], 'Song Three']);
ok(pend.status === 'pending', 'approval mode: guest request is pending');
await rejects(rpc(B, 'review_request', [pend.item_id, true]), 'VR_NOT_HOST', 'guest cannot approve');
await rpc(A, 'review_request', [pend.item_id, true]);
ok((await state(B, roomId)).queue.find((q) => q.id === pend.item_id).status === 'approved', 'host approval moves it to the queue');
const pend2 = await rpc(C, 'request_track', [roomId, 'spotify', '4cOdK2wGLETKBW3PvgPWqT', 'Spotify Song', null, null, 'https://i.scdn.co/image/abc']);
await rpc(A, 'review_request', [pend2.item_id, false]);
ok(!(await state(C, roomId)).queue.some((q) => q.id === pend2.item_id), 'rejected request leaves the queue');
await rpc(A, 'update_room_settings', [roomId, null, null, null, false, null]);
await rejects(rpc(C, 'request_track', [roomId, 'youtube', VIDEO[0], 'Song One']), 'VR_REQUESTS_DISABLED', 'requests can be switched off for guests');

console.log('\nrow level security');
ok((await as(D, 'select * from public.rooms')).rows.length === 0, 'outsider reads no rooms');
ok((await as(D, 'select * from public.queue_items')).rows.length === 0, 'outsider reads no queue items');
ok((await as(D, 'select * from public.room_members')).rows.length === 0, 'outsider reads no members');
ok((await as(D, 'select * from public.tracks')).rows.length === 0, 'outsider reads no tracks');
ok((await as(B, 'select * from public.rooms')).rows.length === 1, 'member reads their room');
ok((await as(B, 'select * from public.queue_items')).rows.length > 0, 'member reads the queue');
await rejects(as(B, `update public.rooms set host_id = $1`, [B]), 'permission denied', 'direct UPDATE on rooms is denied');
await rejects(as(B, `insert into public.queue_items (room_id, track_id, position) select $1, id, 1 from public.tracks limit 1`, [roomId]), 'permission denied', 'direct INSERT into queue is denied');
await rejects(as(B, 'select * from public.rate_limits'), 'permission denied', 'rate_limits is not readable');
await rejects(as(null, `select public.get_room_preview('${created.room_code}')`), 'permission denied', 'signed-out (anon) role cannot call RPCs');
await rejects(as(B, `select public._set_current($1, null)`, [roomId]), 'permission denied', 'internal helpers are not callable');
await rejects(state(D, roomId), 'VR_NOT_MEMBER', 'outsider cannot load room state');

console.log('\n15   reconnect, removal, close');
await rpc(B, 'leave_room', [roomId]);
await rejects(state(B, roomId), 'VR_NOT_MEMBER', 'after leaving, state is no longer readable');
await rpc(B, 'join_room', [created.room_code, 'Binh', '🐼']);
const back = await state(B, roomId);
ok(back.room.current_item_id !== null && back.queue.length > 0 && back.me.id === joinB.member_id, 'rejoining recovers the full room state with the same member id');
await rejects(rpc(B, 'remove_member', [joinC.member_id]), 'VR_NOT_HOST', 'guest cannot remove members');
await rpc(A, 'remove_member', [joinC.member_id]);
await rejects(rpc(C, 'join_room', [created.room_code, 'Chi', '🦉']), 'VR_REMOVED', 'removed guest cannot rejoin');
ok((await as(C, 'select status from public.room_members')).rows[0]?.status === 'removed', 'removed guest can still see their own (removed) membership');
await rejects(rpc(B, 'close_room', [roomId]), 'VR_NOT_HOST', 'guest cannot close the room');
await rpc(A, 'close_room', [roomId]);
const closed = await state(B, roomId);
ok(closed.room.status === 'closed' && closed.room.playback_status === 'idle', 'closing stops playback and marks the room closed');
await rejects(rpc(D, 'join_room', [created.room_code, 'Dan', '🐸']), 'VR_ROOM_CLOSED', 'closed room cannot be joined');

console.log('\nserver clock');
const before = Date.now();
const pong = await rpc(B, 'server_time');
const after = Date.now();
ok(typeof pong.receive_ms === 'number' && typeof pong.send_ms === 'number', 'server_time returns receive and send times in ms');
ok(pong.send_ms >= pong.receive_ms, 'send time is not before receive time');
ok(pong.receive_ms >= before - 1000 && pong.send_ms <= after + 1000, 'times are epoch milliseconds, close to now');
await rejects(as(null, 'select public.server_time()'), 'permission denied', 'signed-out (anon) role cannot read the server clock');

console.log('\nrealtime publication');
const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
ok(pub.rows.map((r) => r.tablename).join() === 'queue_items,room_members,rooms', 'rooms, room_members and queue_items are published');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed ? 1 : 0);
