import Database from 'better-sqlite3'
import path from 'path'

export type Participant = {
  id: string
  name: string
  connected: boolean
  joinedAt: number
  leftAt?: number
  reactionHistory?: number[]
  subtitleOffsetMs?: number
}

export type VideoSource = {
  url: string
  quality: string
}

export type PlaylistItem = {
  id: string
  movieId: string
  title: string
  addedBy: string
  order: number
  sources?: VideoSource[]
}

export type PollOption = {
  id: string
  text: string
  votes?: string[]
}

export type Poll = {
  id: string
  question: string
  options: PollOption[]
  votes: Record<string, string>
  status: 'open' | 'closed'
  closesAt?: number
  addWinnerToPlaylist?: boolean
  createdAt?: number
}

export type ChatMessage = {
  userId: string
  name: string
  text: string
  serverTimestampMs: number
}

export type PlaybackState = {
  videoId: string
  status: 'playing' | 'paused' | 'ended'
  positionMs: number
  serverTimestampMs: number
  rate: number
  version: number
  playlist: PlaylistItem[]
}

export type Room = {
  id: string
  code: string
  hostId: string | null
  everyoneCanControl: boolean
  participants: Participant[]
  playbackState: PlaybackState
  version: number
  activePoll?: Poll | null
  polls?: Poll[]
  chatMessages?: ChatMessage[]
  createdAt?: number
  updatedAt?: number
}

interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          host_id TEXT,
          everyone_can_control INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS participants (
          id TEXT NOT NULL,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          connected INTEGER NOT NULL DEFAULT 1,
          joined_at INTEGER NOT NULL,
          left_at INTEGER,
          reaction_history TEXT,
          PRIMARY KEY (room_id, id)
        );

        CREATE TABLE IF NOT EXISTS playback_state (
          room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL,
          status TEXT NOT NULL,
          position_ms REAL NOT NULL,
          server_timestamp_ms INTEGER NOT NULL,
          rate REAL NOT NULL DEFAULT 1.0,
          version INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playlist (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          movie_id TEXT NOT NULL,
          title TEXT NOT NULL,
          added_by TEXT NOT NULL,
          item_order INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS polls (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          question TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          closes_at INTEGER,
          add_winner_to_playlist INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS poll_options (
          id TEXT NOT NULL,
          poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          PRIMARY KEY (poll_id, id)
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
          poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          option_id TEXT NOT NULL,
          PRIMARY KEY (poll_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          text TEXT NOT NULL,
          server_timestamp_ms INTEGER NOT NULL
        );

        -- Indexes on room_id and updated_at
        CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms(updated_at);
        CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);
        CREATE INDEX IF NOT EXISTS idx_playback_state_room_id ON playback_state(room_id);
        CREATE INDEX IF NOT EXISTS idx_playlist_room_id ON playlist(room_id);
        CREATE INDEX IF NOT EXISTS idx_polls_room_id ON polls(room_id);
        CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON poll_options(poll_id);
        CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(server_timestamp_ms);
      `)
    },
  },
  {
    version: 2,
    name: 'add_sources_to_playlist',
    up: (db) => {
      try {
        db.exec('ALTER TABLE playlist ADD COLUMN sources TEXT')
      } catch (e) {
        // column may already exist
      }
    },
  },
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)

  const currentVersionRow = db
    .prepare('SELECT MAX(version) as v FROM schema_version')
    .get() as { v: number | null } | undefined
  const currentVersion = currentVersionRow?.v ?? 0

  for (const m of migrations) {
    if (m.version > currentVersion) {
      const applyTx = db.transaction(() => {
        m.up(db)
        db.prepare(
          'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(m.version, m.name, Date.now())
      })
      applyTx()
    }
  }
}

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ||
    process.env.DB_PATH ||
    (process.env.VITEST ? ':memory:' : path.join(process.cwd(), 'cine_sync.db'))

  const db = new Database(resolvedPath)
  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  return db
}

export function saveRoom(db: Database.Database, room: Room): void {
  const saveTx = db.transaction(() => {
    const now = Date.now()
    const updatedAt = room.updatedAt || now
    const createdAt = room.createdAt || now

    // 1. Upsert rooms
    db.prepare(`
      INSERT INTO rooms (id, code, host_id, everyone_can_control, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        host_id = excluded.host_id,
        everyone_can_control = excluded.everyone_can_control,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(
      room.id,
      room.code,
      room.hostId,
      room.everyoneCanControl ? 1 : 0,
      room.version,
      createdAt,
      updatedAt
    )

    // 2. Upsert playback_state
    db.prepare(`
      INSERT INTO playback_state (room_id, video_id, status, position_ms, server_timestamp_ms, rate, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        video_id = excluded.video_id,
        status = excluded.status,
        position_ms = excluded.position_ms,
        server_timestamp_ms = excluded.server_timestamp_ms,
        rate = excluded.rate,
        version = excluded.version
    `).run(
      room.id,
      room.playbackState.videoId,
      room.playbackState.status,
      room.playbackState.positionMs,
      room.playbackState.serverTimestampMs,
      room.playbackState.rate,
      room.playbackState.version
    )

    // 3. Sync participants
    db.prepare('DELETE FROM participants WHERE room_id = ?').run(room.id)
    const insertParticipant = db.prepare(`
      INSERT INTO participants (id, room_id, name, connected, joined_at, left_at, reaction_history)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of room.participants) {
      insertParticipant.run(
        p.id,
        room.id,
        p.name,
        p.connected ? 1 : 0,
        p.joinedAt,
        p.leftAt || null,
        p.reactionHistory ? JSON.stringify(p.reactionHistory) : null
      )
    }

    // 4. Sync playlist
    db.prepare('DELETE FROM playlist WHERE room_id = ?').run(room.id)
    const insertPlaylist = db.prepare(`
      INSERT INTO playlist (id, room_id, movie_id, title, added_by, item_order, sources)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const playlist = room.playbackState.playlist || []
    playlist.forEach((item, idx) => {
      insertPlaylist.run(
        item.id,
        room.id,
        item.movieId,
        item.title,
        item.addedBy,
        typeof item.order === 'number' ? item.order : idx,
        item.sources ? JSON.stringify(item.sources) : null
      )
    })

    // 5. Sync polls
    const pollsToSave: Poll[] = []
    if (room.activePoll) pollsToSave.push(room.activePoll)
    if (room.polls) {
      for (const p of room.polls) {
        if (!pollsToSave.some((item) => item.id === p.id)) {
          pollsToSave.push(p)
        }
      }
    }

    for (const poll of pollsToSave) {
      db.prepare(`
        INSERT INTO polls (id, room_id, question, status, closes_at, add_winner_to_playlist, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          closes_at = excluded.closes_at,
          add_winner_to_playlist = excluded.add_winner_to_playlist
      `).run(
        poll.id,
        room.id,
        poll.question,
        poll.status,
        poll.closesAt || null,
        poll.addWinnerToPlaylist ? 1 : 0,
        poll.createdAt || now
      )

      db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(poll.id)
      const insertOption = db.prepare(
        'INSERT INTO poll_options (id, poll_id, text) VALUES (?, ?, ?)'
      )
      for (const opt of poll.options) {
        insertOption.run(opt.id, poll.id, opt.text)
      }

      db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(poll.id)
      const insertVote = db.prepare(
        'INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)'
      )
      if (poll.votes) {
        for (const [userId, optionId] of Object.entries(poll.votes)) {
          insertVote.run(poll.id, userId, optionId)
        }
      }
    }

    // 6. Sync chat messages if provided
    if (room.chatMessages && room.chatMessages.length > 0) {
      const existingCount = (
        db
          .prepare('SELECT COUNT(*) as count FROM chat_messages WHERE room_id = ?')
          .get(room.id) as { count: number }
      ).count

      if (existingCount === 0) {
        const insertChat = db.prepare(`
          INSERT INTO chat_messages (room_id, user_id, name, text, server_timestamp_ms)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const msg of room.chatMessages.slice(-500)) {
          insertChat.run(room.id, msg.userId, msg.name, msg.text, msg.serverTimestampMs)
        }
      }
    }
  })

  saveTx()
}

export function addChatMessage(
  db: Database.Database,
  roomId: string,
  msg: ChatMessage
): void {
  const insertTx = db.transaction(() => {
    const roomExists = db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId)
    if (!roomExists) {
      return
    }

    db.prepare(`
      INSERT INTO chat_messages (room_id, user_id, name, text, server_timestamp_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, msg.userId, msg.name, msg.text, msg.serverTimestampMs)

    // Cap chat messages at last 500
    db.prepare(`
      DELETE FROM chat_messages
      WHERE room_id = ? AND id NOT IN (
        SELECT id FROM chat_messages
        WHERE room_id = ?
        ORDER BY server_timestamp_ms DESC, id DESC
        LIMIT 500
      )
    `).run(roomId, roomId)
  })

  insertTx()
}

export function loadAllRooms(db: Database.Database, currentTimeMs?: number): Room[] {
  const roomRows = db
    .prepare('SELECT * FROM rooms ORDER BY created_at ASC')
    .all() as any[]
  const rooms: Room[] = []
  const now = currentTimeMs ?? Date.now()

  for (const r of roomRows) {
    // 1. Playback state
    const psRow = db
      .prepare('SELECT * FROM playback_state WHERE room_id = ?')
      .get(r.id) as any

    let playbackState: PlaybackState = {
      videoId: '',
      status: 'paused',
      positionMs: 0,
      serverTimestampMs: now,
      rate: 1.0,
      version: 0,
      playlist: [],
    }

    if (psRow) {
      let pos = psRow.position_ms
      let timestamp = psRow.server_timestamp_ms

      // If room was playing, compute correct elapsed position from stored timestamp
      if (psRow.status === 'playing') {
        const elapsed = (now - timestamp) * psRow.rate
        pos = Math.max(0, pos + elapsed)
        timestamp = now
      }

      playbackState = {
        videoId: psRow.video_id,
        status: psRow.status,
        positionMs: pos,
        serverTimestampMs: timestamp,
        rate: psRow.rate,
        version: psRow.version,
        playlist: [],
      }
    }

    // 2. Playlist
    const playlistRows = db
      .prepare('SELECT * FROM playlist WHERE room_id = ? ORDER BY item_order ASC')
      .all(r.id) as any[]
    playbackState.playlist = playlistRows.map((p) => {
      let sources: VideoSource[] | undefined
      if (p.sources) {
        try {
          sources = JSON.parse(p.sources)
        } catch (e) {}
      }
      return {
        id: p.id,
        movieId: p.movie_id,
        title: p.title,
        addedBy: p.added_by,
        order: p.item_order,
        sources,
      }
    })

    // 3. Participants: mark disconnected & set leftAt to now if not set
    const partRows = db
      .prepare('SELECT * FROM participants WHERE room_id = ?')
      .all(r.id) as any[]
    const participants: Participant[] = partRows.map((p) => ({
      id: p.id,
      name: p.name,
      connected: false,
      joinedAt: p.joined_at,
      leftAt: p.left_at || now,
      reactionHistory: p.reaction_history ? JSON.parse(p.reaction_history) : [],
    }))

    // 4. Polls
    const pollRows = db
      .prepare('SELECT * FROM polls WHERE room_id = ? ORDER BY created_at ASC')
      .all(r.id) as any[]
    const polls: Poll[] = []
    let activePoll: Poll | null = null

    for (const pRow of pollRows) {
      const optRows = db
        .prepare('SELECT * FROM poll_options WHERE poll_id = ?')
        .all(pRow.id) as any[]
      const voteRows = db
        .prepare('SELECT * FROM poll_votes WHERE poll_id = ?')
        .all(pRow.id) as any[]

      const votes: Record<string, string> = {}
      for (const v of voteRows) {
        votes[v.user_id] = v.option_id
      }

      const poll: Poll = {
        id: pRow.id,
        question: pRow.question,
        options: optRows.map((o) => ({ id: o.id, text: o.text })),
        votes,
        status: pRow.status,
        closesAt: pRow.closes_at || undefined,
        addWinnerToPlaylist: pRow.add_winner_to_playlist === 1,
        createdAt: pRow.created_at,
      }
      polls.push(poll)
      if (poll.status === 'open') {
        activePoll = poll
      }
    }

    // 5. Chat messages (capped at last 500)
    const chatRows = db
      .prepare(`
        SELECT user_id, name, text, server_timestamp_ms
        FROM chat_messages
        WHERE room_id = ?
        ORDER BY server_timestamp_ms ASC, id ASC
        LIMIT 500
      `)
      .all(r.id) as any[]

    const chatMessages: ChatMessage[] = chatRows.map((c) => ({
      userId: c.user_id,
      name: c.name,
      text: c.text,
      serverTimestampMs: c.server_timestamp_ms,
    }))

    rooms.push({
      id: r.id,
      code: r.code,
      hostId: r.host_id,
      everyoneCanControl: r.everyone_can_control === 1,
      participants,
      playbackState,
      version: r.version,
      activePoll,
      polls,
      chatMessages,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })
  }

  return rooms
}

export function deleteRoom(db: Database.Database, idOrCode: string): boolean {
  const info = db
    .prepare('DELETE FROM rooms WHERE id = ? OR code = ?')
    .run(idOrCode, idOrCode)
  return info.changes > 0
}

export function cleanupExpired(
  db: Database.Database,
  ttlMs: number,
  currentTimeMs?: number
): number {
  const cutoff = (currentTimeMs ?? Date.now()) - ttlMs
  const info = db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(cutoff)
  return info.changes
}
