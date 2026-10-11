// Smoke test: join -> snapshot -> play -> state-update -> chat echo -> change-video.
// Run: npx tsx smoke.mjs  (server must be running on :3000)
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function once(sock, ev, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), timeoutMs);
    sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

const a = io(BASE, { transports: ['websocket'] });
const b = io(BASE, { transports: ['websocket'] });
try {
  a.emit('join-room', { roomCode: '', name: 'SmokeHost' });
  const snap = await once(a, 'room-snapshot');
  if (!snap.roomCode) throw new Error('snapshot missing roomCode');
  if (!snap.playbackState.videoId) throw new Error('new room has no default video');
  console.log('PASS join: room', snap.roomCode, 'participants', snap.participants.length);
  console.log('PASS default shared video:', snap.playbackState.videoId.slice(0, 60) + '...');

  b.emit('join-room', { roomCode: snap.roomCode, name: 'SmokeGuest' });
  const snapB = await once(b, 'room-snapshot');
  if (snapB.roomCode !== snap.roomCode) throw new Error('guest joined wrong room');
  console.log('PASS second join same room');

  const updB = once(b, 'state-update');
  a.emit('play-pause', { status: 'playing', clientSeq: 1, baseVersion: snap.version });
  const upd = await updB;
  if (upd.playbackState.status !== 'playing') throw new Error('play not applied');
  console.log('PASS play propagates to guest, version', upd.version);

  const chatB = once(b, 'chat-message');
  a.emit('chat-message', { text: 'hello <b>world</b>', clientSeq: 2, baseVersion: upd.version, userId: a.id });
  const chat = await chatB;
  if (chat.text !== 'hello world') throw new Error('chat sanitize failed: ' + chat.text);
  console.log('PASS chat echo + sanitize:', JSON.stringify(chat.text));

  // Guest (non-host) can pause: everyoneCanControl defaults to true.
  // Guest saw version 1 via the earlier broadcast, so it is not stale.
  const pauseA = once(a, 'state-update');
  b.emit('play-pause', { status: 'paused', clientSeq: 1, baseVersion: upd.version });
  const paused = await pauseA;
  if (paused.playbackState.status !== 'paused') throw new Error('guest pause not applied');
  console.log('PASS guest pause works (everyone can control), version', paused.version);

  // Host restricts to host-only: guest commands rejected
  const setB = once(b, 'room-settings');
  a.emit('toggle-control', { open: false, userId: a.id });
  const settings = await setB;
  if (settings.everyoneCanControl !== false) throw new Error('toggle-control not applied');
  console.log('PASS host toggled host-only control');
  const errB = once(b, 'error');
  b.emit('play-pause', { status: 'playing', clientSeq: 2, baseVersion: paused.version });
  const err = await errB;
  if (!/host/i.test(err.message)) throw new Error('guest command not rejected: ' + JSON.stringify(err));
  console.log('PASS guest rejected under host-only:', err.message);
  const setB2 = once(b, 'room-settings');
  a.emit('toggle-control', { open: true, userId: a.id });
  await setB2;
  console.log('PASS host re-opened control');

  // Stale command is rejected WITH resync info, and the client recovers:
  // the next command with the fresh version is accepted.
  const staleErr = once(b, 'error');
  b.emit('play-pause', { status: 'playing', clientSeq: 99, baseVersion: 0 });
  const stale = await staleErr;
  if (typeof stale.version !== 'number' || !stale.playbackState) {
    throw new Error('stale error missing resync info: ' + JSON.stringify(stale));
  }
  console.log('PASS stale rejected with resync info, version', stale.version);
  // Collect b's updates in a queue so in-flight broadcasts can't be
  // misattributed to the wrong command.
  const bUpdates = [];
  b.on('state-update', (d) => bUpdates.push(d));
  async function waitForUpdate(pred, what) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const i = bUpdates.findIndex(pred);
      if (i >= 0) return bUpdates.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error('timeout waiting for ' + what);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  b.emit('play-pause', { status: 'playing', clientSeq: 100, baseVersion: stale.version });
  const rec = await waitForUpdate((d) => d.playbackState.status === 'playing', 'recovery play');
  console.log('PASS recovered with fresh version, version', rec.version);

  a.emit('change-video', { videoId: 'https://example.com/v.mp4', clientSeq: 3, baseVersion: rec.version, userId: a.id });
  const ch = await waitForUpdate((d) => d.playbackState.videoId === 'https://example.com/v.mp4', 'change-video');
  console.log('PASS change-video propagates');

  a.emit('set-rate', { rate: 1.5, clientSeq: 5, baseVersion: ch.version });
  const rated = await waitForUpdate((d) => d.playbackState.rate === 1.5, 'set-rate');
  console.log('PASS set-rate syncs to room, version', rated.version);
  const badRate = once(a, 'error');
  a.emit('set-rate', { rate: 9, clientSeq: 6, baseVersion: rated.version });
  const badErr = await badRate;
  if (!/0\.25.*2\.5/.test(badErr.message)) throw new Error('bad rate not rejected: ' + JSON.stringify(badErr));
  console.log('PASS invalid rate rejected:', badErr.message);

  const rB = once(b, 'reaction');
  a.emit('reaction', { emoji: '🔥', clientSeq: 4, baseVersion: rated.version, userId: a.id });
  await rB;
  console.log('PASS reaction broadcast');

  // Host transfer: guest becomes host and can toggle control
  const setA = once(a, 'room-settings');
  a.emit('transfer-host', { userId: b.id });
  const transferred = await setA;
  if (transferred.hostId !== b.id) throw new Error('host transfer failed: ' + JSON.stringify(transferred));
  console.log('PASS host transferred to guest');
  const setA2 = once(a, 'room-settings');
  b.emit('toggle-control', { open: false, userId: b.id });
  const toggled = await setA2;
  if (toggled.everyoneCanControl !== false) throw new Error('new host cannot toggle');
  console.log('PASS new host controls room');

  console.log('ALL SMOKE TESTS PASSED');
} finally {
  a.disconnect();
  b.disconnect();
}
