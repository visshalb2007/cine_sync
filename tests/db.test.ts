import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDatabase,
  saveRoom,
  loadAllRooms,
  deleteRoom,
  cleanupExpired,
  addChatMessage,
  runMigrations,
  type Room,
  type Participant,
  type PlaylistItem,
  type Poll,
  type ChatMessage,
} from '../server/db'
import {
  rooms,
  dirtyRooms,
  markRoomDirty,
  flushDirtyRooms,
  flushDirtyRoomsSync,
  runTtlCleanup,
  db as serverDb,
  resetServerDbForTests,
} from '../server/index'

describe('SQLite Persistence & Migrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
    resetServerDbForTests()
  })

  it('applies migrations and creates schema_version table and all required tables', () => {
    const versionRow = db
      .prepare('SELECT MAX(version) as v, name FROM schema_version')
      .get() as { v: number; name: string }

    expect(versionRow).toBeDefined()
    expect(versionRow.v).toBe(2)
    expect(versionRow.name).toBe('add_sources_to_playlist')

    // Verify all required tables exist
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((t) => t.name)

    expect(tables).toContain('rooms')
    expect(tables).toContain('participants')
    expect(tables).toContain('playback_state')
    expect(tables).toContain('playlist')
    expect(tables).toContain('polls')
    expect(tables).toContain('poll_options')
    expect(tables).toContain('poll_votes')
    expect(tables).toContain('chat_messages')

    // Verify indexes exist
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[]
    ).map((i) => i.name)

    expect(indexes).toContain('idx_rooms_updated_at')
    expect(indexes).toContain('idx_participants_room_id')
    expect(indexes).toContain('idx_playback_state_room_id')
    expect(indexes).toContain('idx_playlist_room_id')
    expect(indexes).toContain('idx_polls_room_id')
    expect(indexes).toContain('idx_chat_messages_room_id')
  })

  it('enforces foreign key ON DELETE CASCADE across all child tables', () => {
    const room: Room = {
      id: 'room-cascade-test',
      code: 'CASC01',
      hostId: 'user-1',
      everyoneCanControl: true,
      participants: [
        { id: 'user-1', name: 'Alice', connected: true, joinedAt: 1000 },
      ],
      playbackState: {
        videoId: 'video-1',
        status: 'paused',
        positionMs: 1000,
        serverTimestampMs: 1000,
        rate: 1.0,
        version: 1,
        playlist: [
          { id: 'pl-1', movieId: 'm-1', title: 'Movie 1', addedBy: 'user-1', order: 0 },
        ],
      },
      version: 1,
      activePoll: {
        id: 'poll-1',
        question: 'Best movie?',
        options: [
          { id: 'opt-1', text: 'Option A' },
          { id: 'opt-2', text: 'Option B' },
        ],
        votes: { 'user-1': 'opt-1' },
        status: 'open',
      },
      chatMessages: [
        { userId: 'user-1', name: 'Alice', text: 'Hi', serverTimestampMs: 1000 },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }

    saveRoom(db, room)

    // Verify row counts in child tables before deletion
    expect(db.prepare('SELECT COUNT(*) as c FROM participants WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) as c FROM playback_state WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) as c FROM playlist WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) as c FROM polls WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) as c FROM poll_options WHERE poll_id = ?').get('poll-1')).toEqual({ c: 2 })
    expect(db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE poll_id = ?').get('poll-1')).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 1 })

    // Delete the room
    const deleted = deleteRoom(db, 'room-cascade-test')
    expect(deleted).toBe(true)

    // Verify all child records cascaded
    expect(db.prepare('SELECT COUNT(*) as c FROM participants WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM playback_state WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM playlist WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM polls WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM poll_options WHERE poll_id = ?').get('poll-1')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE poll_id = ?').get('poll-1')).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ?').get('room-cascade-test')).toEqual({ c: 0 })
  })
})

describe('Room Restart & Full State Recovery', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('creates a room, mutates it, rebuilds from DB on restart, and asserts full equality', () => {
    const originalRoom: Room = {
      id: 'room-alpha',
      code: 'ALPHA1',
      hostId: 'alice-id',
      everyoneCanControl: false,
      version: 0,
      createdAt: 1000000,
      updatedAt: 1000000,
      participants: [
        {
          id: 'alice-id',
          name: 'Alice',
          connected: true,
          joinedAt: 1000000,
          reactionHistory: [1000100, 1000200],
        },
        {
          id: 'bob-id',
          name: 'Bob',
          connected: true,
          joinedAt: 1000500,
          reactionHistory: [1000600],
        },
      ],
      playbackState: {
        videoId: 'matrix-1999',
        status: 'paused',
        positionMs: 45000,
        serverTimestampMs: 1000000,
        rate: 1.25,
        version: 0,
        playlist: [
          { id: 'p1', movieId: 'm1', title: 'The Matrix', addedBy: 'alice-id', order: 0 },
          { id: 'p2', movieId: 'm2', title: 'Inception', addedBy: 'bob-id', order: 1 },
          { id: 'p3', movieId: 'm3', title: 'Interstellar', addedBy: 'alice-id', order: 2 },
        ],
      },
      activePoll: {
        id: 'poll-fav',
        question: 'Which next?',
        options: [
          { id: 'opt-1', text: 'Blade Runner' },
          { id: 'opt-2', text: 'Dune' },
        ],
        votes: { 'alice-id': 'opt-2', 'bob-id': 'opt-1' },
        status: 'open',
        addWinnerToPlaylist: true,
        createdAt: 1000000,
      },
      chatMessages: [
        { userId: 'alice-id', name: 'Alice', text: 'Welcome everyone!', serverTimestampMs: 1000100 },
        { userId: 'bob-id', name: 'Bob', text: 'Hey Alice!', serverTimestampMs: 1000200 },
      ],
    }

    // Save initial room
    saveRoom(db, originalRoom)

    // Mutate the room: increment version, change playlist order, add vote
    const mutatedRoom: Room = {
      ...originalRoom,
      version: 7,
      updatedAt: 1005000,
      playbackState: {
        ...originalRoom.playbackState,
        version: 7,
        positionMs: 60000,
        playlist: [
          // Reordered playlist: p3, p1, p2
          { id: 'p3', movieId: 'm3', title: 'Interstellar', addedBy: 'alice-id', order: 0 },
          { id: 'p1', movieId: 'm1', title: 'The Matrix', addedBy: 'alice-id', order: 1 },
          { id: 'p2', movieId: 'm2', title: 'Inception', addedBy: 'bob-id', order: 2 },
        ],
      },
      activePoll: {
        ...originalRoom.activePoll!,
        votes: { 'alice-id': 'opt-2', 'bob-id': 'opt-2' }, // bob changed vote
      },
    }

    saveRoom(db, mutatedRoom)

    // Simulate Server Restart: call loadAllRooms
    const restartTime = 1010000
    const restoredRooms = loadAllRooms(db, restartTime)

    expect(restoredRooms.length).toBe(1)
    const restored = restoredRooms[0]

    // 1. Identity & Config Equality
    expect(restored.id).toBe('room-alpha')
    expect(restored.code).toBe('ALPHA1')
    expect(restored.hostId).toBe('alice-id')
    expect(restored.everyoneCanControl).toBe(false)
    expect(restored.version).toBe(7)

    // 2. Playback State Equality (paused keeps position)
    expect(restored.playbackState.videoId).toBe('matrix-1999')
    expect(restored.playbackState.status).toBe('paused')
    expect(restored.playbackState.positionMs).toBe(60000)
    expect(restored.playbackState.rate).toBe(1.25)
    expect(restored.playbackState.version).toBe(7)

    // 3. Playlist Order Equality
    expect(restored.playbackState.playlist.length).toBe(3)
    expect(restored.playbackState.playlist[0].id).toBe('p3')
    expect(restored.playbackState.playlist[0].title).toBe('Interstellar')
    expect(restored.playbackState.playlist[0].order).toBe(0)
    expect(restored.playbackState.playlist[1].id).toBe('p1')
    expect(restored.playbackState.playlist[1].title).toBe('The Matrix')
    expect(restored.playbackState.playlist[1].order).toBe(1)
    expect(restored.playbackState.playlist[2].id).toBe('p2')
    expect(restored.playbackState.playlist[2].title).toBe('Inception')
    expect(restored.playbackState.playlist[2].order).toBe(2)

    // 4. Poll & Votes Equality
    expect(restored.activePoll).toBeDefined()
    expect(restored.activePoll!.id).toBe('poll-fav')
    expect(restored.activePoll!.question).toBe('Which next?')
    expect(restored.activePoll!.options.length).toBe(2)
    expect(restored.activePoll!.votes).toEqual({ 'alice-id': 'opt-2', 'bob-id': 'opt-2' })
    expect(restored.activePoll!.addWinnerToPlaylist).toBe(true)

    // 5. Participants Marked Disconnected on Restart
    expect(restored.participants.length).toBe(2)
    for (const p of restored.participants) {
      expect(p.connected).toBe(false)
      expect(p.leftAt).toBeDefined()
    }
    const alice = restored.participants.find((p) => p.id === 'alice-id')
    expect(alice?.reactionHistory).toEqual([1000100, 1000200])

    // 6. Chat Messages Restored
    expect(restored.chatMessages?.length).toBe(2)
    expect(restored.chatMessages?.[0].text).toBe('Welcome everyone!')
    expect(restored.chatMessages?.[1].text).toBe('Hey Alice!')
  })

  it('correctly calculates elapsed playback position when room was playing before restart', () => {
    const now = 2000000
    const playingRoom: Room = {
      id: 'room-play',
      code: 'PLAY01',
      hostId: 'h1',
      everyoneCanControl: true,
      version: 3,
      participants: [],
      playbackState: {
        videoId: 'sintel.mp4',
        status: 'playing',
        positionMs: 30000, // was at 30 seconds
        serverTimestampMs: now - 10000, // 10 seconds ago
        rate: 1.5, // 1.5x speed
        version: 3,
        playlist: [],
      },
    }

    saveRoom(db, playingRoom)

    // Restoring at time `now`:
    // elapsed time = 10000 ms * 1.5 rate = 15000 ms
    // expected position = 30000 + 15000 = 45000 ms
    const restored = loadAllRooms(db, now)[0]

    expect(restored.playbackState.status).toBe('playing')
    expect(restored.playbackState.positionMs).toBe(45000)
    expect(restored.playbackState.serverTimestampMs).toBe(now)
    expect(restored.playbackState.rate).toBe(1.5)
  })

  it('persists and restores playlist items with multi-quality sources', () => {
    const room: Room = {
      id: 'room-sources',
      code: 'SRC001',
      hostId: 'h1',
      everyoneCanControl: true,
      version: 1,
      participants: [],
      playbackState: {
        videoId: 'sintel.mp4',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: 1000,
        rate: 1.0,
        version: 1,
        playlist: [
          {
            id: 'item-1',
            movieId: 'sintel.mp4',
            title: 'Sintel Trailer',
            addedBy: 'h1',
            order: 0,
            sources: [
              { url: '/media/sintel-1080p.mp4', quality: '1080p' },
              { url: '/media/sintel-720p.mp4', quality: '720p' },
              { url: '/media/sintel-480p.mp4', quality: '480p' },
            ],
          },
        ],
      },
    }

    saveRoom(db, room)
    const restored = loadAllRooms(db, 2000)
    expect(restored.length).toBe(1)
    expect(restored[0].playbackState.playlist.length).toBe(1)
    const item = restored[0].playbackState.playlist[0]
    expect(item.sources).toBeDefined()
    expect(item.sources?.length).toBe(3)
    expect(item.sources?.[0].quality).toBe('1080p')
    expect(item.sources?.[1].quality).toBe('720p')
  })
})

describe('Chat Message History Capping', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('caps chat history to the latest 500 messages per room', () => {
    const room: Room = {
      id: 'chat-room',
      code: 'CHAT01',
      hostId: 'user-chat',
      everyoneCanControl: true,
      version: 1,
      participants: [{ id: 'user-chat', name: 'Chatter', connected: true, joinedAt: 1000 }],
      playbackState: {
        videoId: 'video.mp4',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: 1000,
        rate: 1.0,
        version: 1,
        playlist: [],
      },
    }

    saveRoom(db, room)

    // Insert 550 chat messages
    const baseTime = 10000
    for (let i = 1; i <= 550; i++) {
      addChatMessage(db, 'chat-room', {
        userId: 'user-chat',
        name: 'Chatter',
        text: `Message ${i}`,
        serverTimestampMs: baseTime + i * 10,
      })
    }

    const rowCount = (
      db
        .prepare('SELECT COUNT(*) as count FROM chat_messages WHERE room_id = ?')
        .get('chat-room') as { count: number }
    ).count

    expect(rowCount).toBe(500)

    // Verify oldest 50 were deleted and newest 500 remain (51 to 550)
    const messages = db
      .prepare('SELECT text FROM chat_messages WHERE room_id = ? ORDER BY server_timestamp_ms ASC')
      .all('chat-room') as { text: string }[]

    expect(messages.length).toBe(500)
    expect(messages[0].text).toBe('Message 51')
    expect(messages[messages.length - 1].text).toBe('Message 550')

    // Also verify loadAllRooms loads exactly 500 messages
    const restored = loadAllRooms(db)
    expect(restored[0].chatMessages?.length).toBe(500)
  })
})

describe('TTL Inactivity Cleanup', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('cleans up rooms inactive for more than TTL hours and preserves active rooms', () => {
    const now = 50000000
    const oneHourMs = 3600000
    const ttlMs = 24 * oneHourMs // 24 hours

    // Room 1: Active 2 hours ago (within 24h TTL)
    const activeRoom: Room = {
      id: 'active-room',
      code: 'ACTV01',
      hostId: 'u1',
      everyoneCanControl: true,
      version: 1,
      participants: [],
      playbackState: {
        videoId: 'v1',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: now,
        rate: 1,
        version: 1,
        playlist: [],
      },
      updatedAt: now - 2 * oneHourMs,
    }

    // Room 2: Inactive for 30 hours (exceeds 24h TTL)
    const expiredRoom: Room = {
      id: 'expired-room',
      code: 'EXPR01',
      hostId: 'u2',
      everyoneCanControl: true,
      version: 1,
      participants: [],
      playbackState: {
        videoId: 'v2',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: now,
        rate: 1,
        version: 1,
        playlist: [],
      },
      updatedAt: now - 30 * oneHourMs,
    }

    saveRoom(db, activeRoom)
    saveRoom(db, expiredRoom)

    expect(loadAllRooms(db, now).length).toBe(2)

    // Run cleanup
    const deletedCount = cleanupExpired(db, ttlMs, now)
    expect(deletedCount).toBe(1)

    const remaining = loadAllRooms(db, now)
    expect(remaining.length).toBe(1)
    expect(remaining[0].code).toBe('ACTV01')
  })

  it('runTtlCleanup removes expired rooms from both in-memory Map and SQLite', () => {
    const now = Date.now()
    const oneHourMs = 3600000

    // Set custom TTL to 12 hours via env
    process.env.ROOM_TTL_HOURS = '12'

    const freshRoom: Room = {
      id: 'fresh-room',
      code: 'FRSH01',
      hostId: 'u1',
      everyoneCanControl: true,
      version: 1,
      participants: [],
      playbackState: {
        videoId: 'v1',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: now,
        rate: 1,
        version: 1,
        playlist: [],
      },
      updatedAt: now - 2 * oneHourMs,
    }

    const staleRoom: Room = {
      id: 'stale-room',
      code: 'STAL01',
      hostId: 'u2',
      everyoneCanControl: true,
      version: 1,
      participants: [],
      playbackState: {
        videoId: 'v2',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: now,
        rate: 1,
        version: 1,
        playlist: [],
      },
      updatedAt: now - 15 * oneHourMs,
    }

    // Add to in-memory map
    rooms.set(freshRoom.code, freshRoom)
    rooms.set(staleRoom.code, staleRoom)

    // Save to db
    saveRoom(db, freshRoom)
    saveRoom(db, staleRoom)

    expect(rooms.has('STAL01')).toBe(true)

    // Run TTL cleanup
    runTtlCleanup()

    expect(rooms.has('STAL01')).toBe(false)
    expect(rooms.has('FRSH01')).toBe(true)

    // Cleanup env
    delete process.env.ROOM_TTL_HOURS
    rooms.delete('FRSH01')
  })
})

describe('Debounced Save & Graceful Shutdown Flush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches rapid mutations and writes to DB via flushDirtyRoomsSync on shutdown', () => {
    const testRoom: Room = {
      id: 'burst-room',
      code: 'BURST1',
      hostId: 'host-1',
      everyoneCanControl: true,
      version: 1,
      participants: [{ id: 'host-1', name: 'Host', connected: true, joinedAt: 1000 }],
      playbackState: {
        videoId: 'fast.mp4',
        status: 'paused',
        positionMs: 0,
        serverTimestampMs: 1000,
        rate: 1.0,
        version: 1,
        playlist: [],
      },
      createdAt: 1000,
      updatedAt: 1000,
    }

    rooms.set(testRoom.code, testRoom)
    markRoomDirty(testRoom.code)

    expect(dirtyRooms.has('BURST1')).toBe(true)

    // Rapid burst of 10 mutations
    for (let i = 2; i <= 10; i++) {
      testRoom.version = i
      testRoom.playbackState.positionMs = i * 1000
      markRoomDirty(testRoom.code)
    }

    expect(dirtyRooms.has('BURST1')).toBe(true)

    // Synchronous flush (as triggered by SIGINT/SIGTERM)
    flushDirtyRoomsSync()

    expect(dirtyRooms.size).toBe(0)

    // Verify room state in DB reflects latest mutation (version 10, position 10000)
    const saved = loadAllRooms(serverDb).find((r) => r.code === 'BURST1')
    expect(saved).toBeDefined()
    expect(saved?.version).toBe(10)
    expect(saved?.playbackState.positionMs).toBe(10000)

    // Clean up
    rooms.delete('BURST1')
    deleteRoom(serverDb, 'burst-room')
  })
})
