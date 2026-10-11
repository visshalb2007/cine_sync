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
  console.log('PASS join: room', snap.roomCode, 'participants', snap.participants.length);

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

  const chB = once(b, 'state-update');
  a.emit('change-video', { videoId: 'https://example.com/v.mp4', clientSeq: 3, baseVersion: upd.version, userId: a.id });
  const ch = await chB;
  if (ch.playbackState.videoId !== 'https://example.com/v.mp4') throw new Error('change-video not applied');
  console.log('PASS change-video propagates');

  const rB = once(b, 'reaction');
  a.emit('reaction', { emoji: '🔥', clientSeq: 4, baseVersion: ch.version, userId: a.id });
  await rB;
  console.log('PASS reaction broadcast');

  console.log('ALL SMOKE TESTS PASSED');
} finally {
  a.disconnect();
  b.disconnect();
}
