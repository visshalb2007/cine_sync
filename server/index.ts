import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'
import path from 'path'
import fs from 'fs'
import { loadEnv } from './env'
import { searchMovies, getMovies, getTmdbGenres } from './api/tmdb'
import { createIpRateLimiter } from './api/rateLimiter'
import {
  createDatabase,
  saveRoom,
  loadAllRooms,
  cleanupExpired,
  addChatMessage,
  deleteRoom,
  type Room,
  type Participant,
  type PlaybackState,
  type PlaylistItem,
  type Poll,
  type PollOption,
  type ChatMessage,
} from './db'

loadEnv()

const app = express()
const httpServer = createServer(app)

// Serve the client HTML/JS so http://localhost:3000 just works.
// Works both via tsx (server/...) and compiled output (dist/server/...).
const clientDirCandidates = [
  path.join(__dirname, '..', 'client', 'public'),
  path.join(__dirname, '..', '..', 'client', 'public'),
  path.join(process.cwd(), 'client', 'public'),
]
const clientDir =
  clientDirCandidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) ??
  clientDirCandidates[0]
app.use(express.static(clientDir))

// Serve fuse.js library for client-side fuzzy re-ranking
app.get('/vendor/fuse.mjs', (_req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'fuse.js', 'dist', 'fuse.mjs'),
    path.join(__dirname, '..', '..', 'node_modules', 'fuse.js', 'dist', 'fuse.mjs'),
    path.join(process.cwd(), 'node_modules', 'fuse.js', 'dist', 'fuse.mjs'),
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (found) {
    res.setHeader('Content-Type', 'application/javascript')
    return res.sendFile(found)
  }
  res.status(404).json({ error: 'fuse.js not found' })
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: Date.now() })
})
app.get('/', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
})

// Movie discovery rate limiter: 60 req/min per IP
export const movieApiLimiter = createIpRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests, please try again later',
})

// GET /api/genres - returns list of movie genres
app.get('/api/genres', movieApiLimiter, async (_req, res) => {
  try {
    const genres = await getTmdbGenres()
    res.json({ genres })
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve genres' })
  }
})

// GET /api/search?q=&genre=&year=&page= - search movies with query validation and rate limiting
app.get('/api/search', movieApiLimiter, async (req, res) => {
  try {
    const qRaw = req.query.q
    if (typeof qRaw !== 'string' || !qRaw.trim()) {
      return res.status(400).json({ error: 'Query parameter "q" is required and cannot be empty' })
    }
    const q = qRaw.trim()

    let yearNum: number | undefined
    if (req.query.year !== undefined && req.query.year !== '') {
      const yearStr = String(req.query.year).trim()
      const parsed = Number(yearStr)
      if (!/^\d{4}$/.test(yearStr) || isNaN(parsed) || parsed < 1888 || parsed > 2100) {
        return res.status(400).json({
          error: 'Invalid year parameter: must be a 4-digit year between 1888 and 2100',
        })
      }
      yearNum = parsed
    }

    let pageNum: number = 1
    if (req.query.page !== undefined && req.query.page !== '') {
      const pageStr = String(req.query.page).trim()
      const parsed = Number(pageStr)
      if (!/^\d+$/.test(pageStr) || isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          error: 'Invalid page parameter: must be a positive integer',
        })
      }
      pageNum = parsed
    }

    const genre =
      typeof req.query.genre === 'string' && req.query.genre.trim()
        ? req.query.genre.trim()
        : undefined

    const result = await searchMovies({
      query: q,
      genre,
      year: yearNum,
      page: pageNum,
    })

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to search movies' })
  }
})

// GET /api/movies?genre=&page= - browse/discover movies by genre with page validation
app.get('/api/movies', movieApiLimiter, async (req, res) => {
  try {
    let pageNum: number = 1
    if (req.query.page !== undefined && req.query.page !== '') {
      const pageStr = String(req.query.page).trim()
      const parsed = Number(pageStr)
      if (!/^\d+$/.test(pageStr) || isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          error: 'Invalid page parameter: must be a positive integer',
        })
      }
      pageNum = parsed
    }

    const genre =
      typeof req.query.genre === 'string' && req.query.genre.trim()
        ? req.query.genre.trim()
        : undefined

    const result = await getMovies({
      genre,
      page: pageNum,
    })

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to discover movies' })
  }
})

// Resolve bare video ids (legacy + playlist entries) to streamable URLs.
app.get('/watch/:id', (req, res) => {
  const id = String(req.params.id ?? '')
  if (/^https?:\/\//i.test(id)) return res.redirect(id)
  const sample = SAMPLES[id]
  if (sample) return res.redirect(sample.url)
  // Allow media filenames (e.g. flower.mp4) without path traversal
  if (/^[A-Za-z0-9._-]+\.mp4$/i.test(id)) {
    const file = path.join(clientDir, 'media', path.basename(id))
    if (fs.existsSync(file)) return res.redirect(`/media/${path.basename(id)}`)
  }
  // For discovered movie items without direct media files, redirect to sample video so stream plays
  if (SAMPLES.sintel) return res.redirect(SAMPLES.sintel.url)
  res.status(404).json({ error: 'unknown video id', samples: Object.keys(SAMPLES) })
})
app.get('/api/samples', (_req, res) => {
  res.json(SAMPLES)
})
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: process.env.SOCKET_PING_INTERVAL ? Number(process.env.SOCKET_PING_INTERVAL) : 25000,
  pingTimeout: process.env.SOCKET_PING_TIMEOUT ? Number(process.env.SOCKET_PING_TIMEOUT) : 20000,
})

const PORT = process.env.PORT || 3000

let _db: ReturnType<typeof createDatabase> | null = null

export function getServerDb(): ReturnType<typeof createDatabase> {
  if (!_db) {
    _db = createDatabase()
  }
  return _db
}

export function resetServerDbForTests(): void {
  if (_db) {
    try {
      _db.close()
    } catch (e) {}
    _db = null
  }
}

export const db: ReturnType<typeof createDatabase> = new Proxy({} as ReturnType<typeof createDatabase>, {
  get(_target, prop, receiver) {
    return Reflect.get(getServerDb(), prop, receiver)
  },
})
export const rooms = new Map<string, Room>()
export const dirtyRooms = new Set<string>()
let saveDebounceTimer: NodeJS.Timeout | null = null
const gracePeriod = process.env.RECONNECT_GRACE_MS ? Number(process.env.RECONNECT_GRACE_MS) : 60000 // default 60 seconds

export function markRoomDirty(roomCode: string): void {
  dirtyRooms.add(roomCode)
  if (!saveDebounceTimer) {
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null
      flushDirtyRooms()
    }, 200)
  }
}

export function flushDirtyRooms(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
    saveDebounceTimer = null
  }
  if (dirtyRooms.size === 0) return

  const codes = Array.from(dirtyRooms)
  dirtyRooms.clear()
  for (const code of codes) {
    const room = rooms.get(code)
    if (room) {
      try {
        room.updatedAt = Date.now()
        saveRoom(db, room)
      } catch (err) {
        console.error(`Failed to save room ${code}:`, err)
      }
    }
  }
}

export function flushDirtyRoomsSync(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
    saveDebounceTimer = null
  }
  if (dirtyRooms.size === 0) return

  const codes = Array.from(dirtyRooms)
  dirtyRooms.clear()
  for (const code of codes) {
    const room = rooms.get(code)
    if (room) {
      try {
        room.updatedAt = Date.now()
        saveRoom(db, room)
      } catch (err) {
        console.error(`Failed to save room ${code} during sync flush:`, err)
      }
    }
  }
}

export function runTtlCleanup(): number {
  const ttlHours = parseFloat(process.env.ROOM_TTL_HOURS || '24') || 24
  const ttlMs = ttlHours * 60 * 60 * 1000
  const cutoff = Date.now() - ttlMs

  for (const [code, room] of rooms.entries()) {
    const updatedAt = room.updatedAt || room.createdAt || 0
    if (updatedAt < cutoff) {
      rooms.delete(code)
      dirtyRooms.delete(code)
    }
  }

  return cleanupExpired(db, ttlMs)
}

export function initRoomsFromDb(): void {
  try {
    const loaded = loadAllRooms(db)
    for (const r of loaded) {
      rooms.set(r.code, r)
      // For disconnected participants, schedule grace period to clear offline users
      r.participants.forEach((p) => {
        if (!p.connected) {
          setTimeout(() => {
            const currentRoom = rooms.get(r.code)
            if (!currentRoom) return
            const part = currentRoom.participants.find((item) => item.id === p.id)
            if (part && !part.connected) {
              currentRoom.participants = currentRoom.participants.filter((item) => item.id !== p.id)
              io.to(currentRoom.code).emit('participants-update', roomInfo(currentRoom))
              markRoomDirty(currentRoom.code)
            }
          }, gracePeriod)
        }
      })

      // Start reconnect grace period for host transfer if host is disconnected
      if (r.hostId) {
        const origHostId = r.hostId
        setTimeout(() => {
          const currentRoom = rooms.get(r.code)
          if (!currentRoom) return
          const currentHost = currentRoom.participants.find((p) => p.id === origHostId)
          if (!currentHost || !currentHost.connected) {
            const nextHost = selectNextHost(currentRoom.participants, origHostId)
            if (nextHost) {
              currentRoom.hostId = nextHost.id
              io.to(currentRoom.code).emit('host-transfer', {
                newHostId: currentRoom.hostId,
                previousHostId: origHostId,
                newHostName: nextHost.name,
              })
              io.to(currentRoom.code).emit('participants-update', roomInfo(currentRoom))
              io.to(currentRoom.code).emit('room-settings', {
                everyoneCanControl: currentRoom.everyoneCanControl,
                hostId: currentRoom.hostId,
              })
              markRoomDirty(currentRoom.code)
            }
          }
        }, gracePeriod)
      }
    }
    console.log(`Restored ${loaded.length} rooms from database.`)
  } catch (err) {
    console.error('Failed to load rooms from database:', err)
  }
}

// Restore rooms on boot & background intervals (only when not in test runner)
if (!process.env.VITEST) {
  initRoomsFromDb()

  // Periodic snapshot every 5s for dirty rooms only
  const snapshotInterval = setInterval(() => {
    if (dirtyRooms.size > 0) {
      flushDirtyRooms()
    }
  }, 5000)
  snapshotInterval.unref()

  // Hourly TTL cleanup
  const ttlInterval = setInterval(() => {
    runTtlCleanup()
  }, 60 * 60 * 1000)
  ttlInterval.unref()
}

export function handleShutdown(signal: string): void {
  console.log(`Received ${signal}, flushing dirty rooms and closing database...`)
  try {
    flushDirtyRoomsSync()
    if (_db) {
      _db.close()
      _db = null
    }
    console.log('Database closed.')
  } catch (err) {
    console.error('Error during shutdown:', err)
  }
  if (!process.env.VITEST) {
    process.exit(0)
  }
}

if (!process.env.VITEST) {
  process.on('SIGINT', () => handleShutdown('SIGINT'))
  process.on('SIGTERM', () => handleShutdown('SIGTERM'))
}

// Who may issue control commands? Host always; everyone else only when the
// room's "everyone can control" toggle is on (default true).
export function isHost(room: Room, socketId: string, userId?: string): boolean {
  return room.hostId === socketId || (userId != null && room.hostId === userId)
}

export function selectNextHost(
  participants: Participant[],
  excludeHostId?: string | null
): Participant | null {
  const eligible = participants
    .filter((p) => p.id !== excludeHostId && p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  return eligible.length > 0 ? eligible[0] : null
}

function canControl(room: Room, socketId: string, userId?: string): boolean {
  if (room.everyoneCanControl) return true
  return isHost(room, socketId, userId)
}

// Shared room metadata included in snapshots and participant broadcasts
function roomInfo(room: Room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    everyoneCanControl: room.everyoneCanControl,
    participants: room.participants,
    version: room.version,
  }
}

// Built-in sample videos, served same-origin from client/public/media/
// (fetch with `npm run fetch-media`). Same-origin + local disk means rooms
// always have something playable: no third-party hosts, no CORS/range issues.
const SAMPLES: Record<string, { title: string; url: string }> = {
  flower: { title: 'Flower (sample)', url: '/media/flower.mp4' },
  sintel: { title: 'Sintel trailer', url: '/media/sintel-trailer.mp4' },
}
const DEFAULT_VIDEO = SAMPLES.flower.url

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  // Clock sync: client sends CLIENT_HELLO after connect
  socket.on('client-hello', ({ clientTime }: { clientTime: number }) => {
    const serverTime = Date.now()
    const roundTrip = clientTime - serverTime // client sent time, server receives

    // Store the offset for this connection
    ;(socket as any).clockOffset = -roundTrip / 2 // serverTime ≈ clientTime + offset
    ;(socket as any).lastSyncAt = serverTime

    // Send sync ack with server time and computed offset
    socket.emit('sync-ack', {
      serverTime,
      offset: (socket as any).clockOffset,
    })
  })

  // Join room by code. Empty code = create a new room.
  socket.on('join-room', ({ roomCode, name, sessionToken }: { roomCode: string; name: string; sessionToken?: string }) => {
    const cleanName = String(name ?? '').slice(0, 40) || 'Anonymous'
    const wantCode = String(roomCode ?? '').trim().toUpperCase()
    let room = wantCode ? rooms.get(wantCode) : undefined
    if (!room) {
      // Create new room: reuse a caller-supplied code when it looks valid,
      // otherwise generate one. This keeps invite links working.
      const code =
        wantCode && /^[A-Z0-9]{4,8}$/.test(wantCode)
          ? wantCode
          : Math.random().toString(36).substring(2, 8).toUpperCase()
      room = {
        id: `room_${code}_${Date.now()}`,
        code,
        hostId: socket.id,
        everyoneCanControl: true,
        participants: [],
        playbackState: {
          videoId: DEFAULT_VIDEO,
          status: 'paused',
          positionMs: 0,
          serverTimestampMs: Date.now(),
          rate: 1,
          version: 0,
          playlist: [],
        },
        version: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      rooms.set(code, room)
      saveRoom(db, room)
      console.log('Created new room:', code)
    }

    const token = sessionToken || socket.id

    // 1. Check if this exact socket is already registered in the room
    const sameSocket = room.participants.find((p) => p.id === socket.id)
    if (sameSocket) {
      sameSocket.name = cleanName
      sameSocket.connected = true
      sameSocket.leftAt = undefined
      if (sessionToken) (sameSocket as any).sessionToken = sessionToken

      if (room.hostId === null) {
        room.hostId = socket.id
      }
      markRoomDirty(room.code)
      socket.join(room.code)
      ;(socket as any).roomCode = room.code
      ;(socket as any).sessionToken = token

      io.to(room.code).emit('participants-update', roomInfo(room))
      socket.emit('room-snapshot', {
        ...roomInfo(room),
        playbackState: room.playbackState,
        playlist: room.playbackState.playlist,
        activePoll: room.activePoll || null,
        chatMessages: room.chatMessages || [],
      })
      return
    }

    // 2. Check if this is a reconnection of an existing session or disconnected participant with same name
    const existingParticipant = room.participants.find((p) => {
      if (sessionToken && ((p as any).sessionToken === sessionToken || p.id === sessionToken)) {
        return true
      }
      if (!p.connected) {
        if (sessionToken && p.id === sessionToken) return true
        if (cleanName.toLowerCase() !== 'anonymous' && p.name.toLowerCase() === cleanName.toLowerCase()) {
          return true
        }
      }
      return false
    })

    if (existingParticipant) {
      const timeSinceLeft = existingParticipant.leftAt ? Date.now() - existingParticipant.leftAt : 0
      const isWithinGrace = !existingParticipant.leftAt || timeSinceLeft < gracePeriod

      if (isWithinGrace) {
        // Restore participant
        const oldId = existingParticipant.id
        existingParticipant.id = socket.id
        existingParticipant.name = cleanName
        existingParticipant.connected = true
        existingParticipant.leftAt = undefined
        if (sessionToken) (existingParticipant as any).sessionToken = sessionToken

        if (room.hostId === null || room.hostId === oldId) {
          room.hostId = socket.id
        }

        // Clean up any other duplicate entries in room.participants
        room.participants = room.participants.filter(
          (p) =>
            p === existingParticipant ||
            (p.id !== socket.id &&
              (!sessionToken || (p as any).sessionToken !== sessionToken) &&
              (p.connected || p.name.toLowerCase() !== cleanName.toLowerCase()))
        )

        markRoomDirty(room.code)
        socket.join(room.code)
        ;(socket as any).roomCode = room.code
        ;(socket as any).sessionToken = token

        // Broadcast updated participant list
        io.to(room.code).emit('participants-update', roomInfo(room))

        // Send snapshot resume from current version with full room data
        socket.emit('room-snapshot-resume', {
          ...roomInfo(room),
          playbackState: room.playbackState,
          playlist: room.playbackState.playlist,
          activePoll: room.activePoll || null,
          chatMessages: room.chatMessages || [],
        })

        console.log(`Participant ${cleanName} reconnected within grace period`)
        return
      } else {
        // Grace period expired, treat as new join: remove the old disconnected participant
        room.participants = room.participants.filter((p) => p !== existingParticipant)
      }
    }

    // 3. Ensure no duplicate disconnected entries for this user / session exist
    room.participants = room.participants.filter(
      (p) =>
        p.id !== socket.id &&
        (!sessionToken || (p as any).sessionToken !== sessionToken) &&
        (p.connected || (cleanName.toLowerCase() !== 'anonymous' && p.name.toLowerCase() !== cleanName.toLowerCase()))
    )

    // 4. Add participant
    const participant: Participant = {
      id: socket.id,
      name: cleanName,
      connected: true,
      joinedAt: Date.now(),
    }
    if (sessionToken) (participant as any).sessionToken = sessionToken
    room.participants.push(participant)

    // Set as host if first connected participant or no host
    if (room.participants.filter((p) => p.connected).length === 1 || !room.hostId) {
      room.hostId = socket.id
    }

    markRoomDirty(room.code)
    socket.join(room.code)
    ;(socket as any).roomCode = room.code
    ;(socket as any).sessionToken = token

    // Broadcast updated participant list
    io.to(room.code).emit('participants-update', roomInfo(room))

    // Send snapshot to new participant
    socket.emit('room-snapshot', {
      ...roomInfo(room),
      playbackState: room.playbackState,
      playlist: room.playbackState.playlist,
      activePoll: room.activePoll || null,
      chatMessages: room.chatMessages || [],
    })

    console.log(`Participant ${cleanName} joined room ${room.code}, total: ${room.participants.length}`)
  })

  // Handle reconnect event
  socket.on('reconnect-request', ({ sessionToken, lastVersion }: { sessionToken: string; lastVersion: number }) => {
    const socketId = sessionToken // session token is socket id

    // Find the room this socket was in
    let foundRoom: Room | null = null
    let foundParticipantIndex = -1

    for (const [, room] of rooms) {
      const participantIdx = room.participants.findIndex((p) => p.id === socketId)
      if (participantIdx >= 0) {
        foundRoom = room
        foundParticipantIndex = participantIdx
        break
      }
    }

    if (!foundRoom) {
      socket.emit('error', { message: 'Room not found' })
      return
    }

    const participant = foundRoom.participants[foundParticipantIndex]

    // Check if within grace period
    if (participant.leftAt && Date.now() - participant.leftAt < gracePeriod) {
      // Restore participant
      const oldId = participant.id
      participant.id = socket.id
      participant.connected = true
      participant.leftAt = undefined

      if (foundRoom.hostId === null || foundRoom.hostId === oldId) {
        foundRoom.hostId = socket.id
      }
      markRoomDirty(foundRoom.code)

      // Broadcast updated participant list
      io.to(foundRoom.code).emit('participants-update', roomInfo(foundRoom))

      // Send snapshot resume from current version
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      ;(socket as any).sessionToken = socket.id
      socket.emit('room-snapshot-resume', {
        ...roomInfo(foundRoom),
        playbackState: foundRoom.playbackState,
        playlist: foundRoom.playbackState.playlist,
        activePoll: foundRoom.activePoll || null,
        chatMessages: foundRoom.chatMessages || [],
      })

      console.log(`Participant ${socketId} reconnected within grace period`)
    } else {
      // Grace period expired, treat as new join
      // Remove old participant and add new one
      foundRoom.participants = foundRoom.participants.filter((p) => p.id !== socketId)
      const newParticipant: Participant = {
        id: socket.id,
        name: participant.name,
        connected: true,
        joinedAt: Date.now(),
      }
      foundRoom.participants.push(newParticipant)
      markRoomDirty(foundRoom.code)

      // Broadcast updated participant list
      io.to(foundRoom.code).emit('participants-update', roomInfo(foundRoom))

      // Send full snapshot
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      ;(socket as any).sessionToken = socket.id
      socket.emit('room-snapshot', {
        ...roomInfo(foundRoom),
        playbackState: foundRoom.playbackState,
        playlist: foundRoom.playbackState.playlist,
        activePoll: foundRoom.activePoll || null,
        chatMessages: foundRoom.chatMessages || [],
      })

      console.log(`Participant ${socketId} re-joined after grace period expired`)
    }
  })

  // Handle playback commands
  socket.on('play-pause', ({ status, baseVersion, clientSeq, positionMs }: { status: string; baseVersion: number; clientSeq: number; positionMs?: number }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion. Include current state so the sender can resync
    // instead of staying stale forever.
    if (room.version !== baseVersion) {
      socket.emit('error', {
        message: 'Stale version, resynced to latest state',
        version: room.version,
        playbackState: room.playbackState,
        clientSeq,
      })
      return
    }

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can control playback right now', clientSeq })
      return
    }

    const now = Date.now()
    if (typeof positionMs === 'number' && isFinite(positionMs) && positionMs >= 0) {
      room.playbackState.positionMs = positionMs
    } else if (room.playbackState.status === 'playing') {
      const elapsed = (now - room.playbackState.serverTimestampMs) * (room.playbackState.rate || 1)
      room.playbackState.positionMs = Math.max(0, room.playbackState.positionMs + elapsed)
    }

    if (status === 'playing' && (room.playbackState.status === 'ended' || (typeof positionMs === 'number' && positionMs === 0))) {
      room.playbackState.positionMs = 0
    }

    room.playbackState.status = status as 'playing' | 'paused' | 'ended'
    room.playbackState.serverTimestampMs = now
    room.version++
    markRoomDirty(roomCode)
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
      clientSeq,
      senderSocketId: socket.id,
    })
  })

  socket.on('seek', ({ positionMs, baseVersion, clientSeq }: { positionMs: number; baseVersion: number; clientSeq: number }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (room.version !== baseVersion) {
      socket.emit('error', {
        message: 'Stale version, resynced to latest state',
        version: room.version,
        playbackState: room.playbackState,
        clientSeq,
      })
      return
    }

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can control playback right now', clientSeq })
      return
    }

    room.playbackState.positionMs = positionMs
    room.playbackState.serverTimestampMs = Date.now()
    room.version++
    markRoomDirty(roomCode)
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
      clientSeq,
      senderSocketId: socket.id,
    })
  })

  socket.on('change-video', ({ videoId, clientSeq, baseVersion, userId }: { videoId: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (room.version !== baseVersion) {
      socket.emit('error', {
        message: 'Stale version',
        version: room.version,
        playbackState: room.playbackState,
        clientSeq,
      })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can change the video right now', clientSeq })
      return
    }

    room.playbackState.videoId = String(videoId ?? '').slice(0, 500)
    room.playbackState.status = 'paused'
    room.playbackState.positionMs = 0
    room.playbackState.serverTimestampMs = Date.now()
    room.version++
    markRoomDirty(roomCode)
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
      clientSeq,
      senderSocketId: socket.id,
    })
  })

  socket.on('set-rate', ({ rate, baseVersion, clientSeq }: { rate: number; baseVersion: number; clientSeq: number }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (room.version !== baseVersion) {
      socket.emit('error', {
        message: 'Stale version, resynced to latest state',
        version: room.version,
        playbackState: room.playbackState,
        clientSeq,
      })
      return
    }

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can change playback speed right now', clientSeq })
      return
    }

    const now = Date.now()
    if (room.playbackState.status === 'playing') {
      const elapsed = (now - room.playbackState.serverTimestampMs) * (room.playbackState.rate || 1)
      room.playbackState.positionMs = Math.max(0, room.playbackState.positionMs + elapsed)
    }

    const validRates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    const clampedRate = validRates.includes(rate) ? rate : 1.0

    room.playbackState.rate = clampedRate
    room.playbackState.serverTimestampMs = now
    room.version++
    markRoomDirty(roomCode)
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
      clientSeq,
      senderSocketId: socket.id,
    })
  })

  socket.on('reaction', ({ emoji, baseVersion, clientSeq, userId }: { emoji: string; baseVersion: number; clientSeq: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    // Rate limit: max 3 reactions per 15 seconds per user
    const participant = room.participants.find((p) => p.id === userId)
    if (participant) {
      const now = Date.now()
      const recentReactions = (participant.reactionHistory || []).filter(
        (ts: number) => now - ts < 15000
      )
      if (recentReactions.length >= 3) {
        socket.emit('error', { message: 'Rate limited: max 3 reactions per 15 seconds' })
        return
      }
      ;(participant.reactionHistory ||= []).push(now)
    }

    io.to(roomCode).emit('reaction', {
      emoji,
      userId,
      serverTimestampMs: Date.now(),
    })
  })

  // Per-user subtitle offset
  socket.on('subtitle-offset', ({ offsetMs }: { offsetMs: number }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return
    const room = rooms.get(roomCode)
    if (!room) return

    if (typeof offsetMs !== 'number' || !isFinite(offsetMs)) return
    const clampedOffset = Math.max(-30000, Math.min(30000, Math.round(offsetMs)))

    const participant = room.participants.find((p) => p.id === socket.id)
    if (participant) {
      participant.subtitleOffsetMs = clampedOffset
    }

    socket.emit('subtitle-offset-ack', { offsetMs: clampedOffset })
  })

  socket.on('chat-message', ({ text, clientSeq, baseVersion, userId }: { text: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Basic sanitization + length cap (strip HTML tags, cap 500 chars)
    const clean = String(text ?? '').replace(/<[^>]*>/g, '').slice(0, 500).trim()
    if (!clean) return

    // Rate limit: max 5 messages per 10s per sender
    const now = Date.now()
    const history = ((socket as any).chatHistory ?? []) as number[]
    const recent = history.filter((ts: number) => now - ts < 10000)
    if (recent.length >= 5) {
      socket.emit('error', { message: 'Rate limited: max 5 messages per 10 seconds' })
      return
    }
    recent.push(now)
    ;(socket as any).chatHistory = recent

    const sender = room.participants.find((p) => p.id === socket.id)
    const chatMsg: ChatMessage = {
      userId: socket.id,
      name: sender ? sender.name : 'Anonymous',
      text: clean,
      serverTimestampMs: now,
    }
    room.chatMessages = room.chatMessages || []
    room.chatMessages.push(chatMsg)
    if (room.chatMessages.length > 500) {
      room.chatMessages = room.chatMessages.slice(-500)
    }
    addChatMessage(db, room.id, chatMsg)

    io.to(roomCode).emit('chat-message', chatMsg)
  })

  // Handle playlist commands
  socket.on('add-video', ({ movieId, title, clientSeq, baseVersion, userId }: { movieId: string; title: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can add videos right now' })
      return
    }

    const newPlaylistItem: PlaylistItem = {
      id: Math.random().toString(36).substring(2, 9),
      movieId,
      title,
      addedBy: userId,
      order: room.playbackState.playlist.length,
    }

    const newPlaylist = [...room.playbackState.playlist, newPlaylistItem]
    
    io.to(roomCode).emit('playlist-update', {
      playlist: newPlaylist,
      version: room.version + 1,
    })

    room.version++
    room.playbackState.playlist = newPlaylist
    markRoomDirty(roomCode)
  })

  socket.on('remove-video', ({ itemId, clientSeq, baseVersion, userId }: { itemId: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can remove videos right now' })
      return
    }

    const newPlaylist = room.playbackState.playlist.filter((item: PlaylistItem) => item.id !== itemId)
    
    io.to(roomCode).emit('playlist-update', {
      playlist: newPlaylist,
      version: room.version + 1,
    })

    room.version++
    room.playbackState.playlist = newPlaylist
    markRoomDirty(roomCode)
  })

socket.on('reorder-playlist', ({ itemIds, clientSeq, baseVersion, userId }: { itemIds: string[]; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can reorder the playlist right now' })
      return
    }

    // Reorder playlist maintaining items not in the list at the end
    const currentPlaylist = room.playbackState.playlist
    const itemMap = new Map(currentPlaylist.map((item: PlaylistItem) => [item.id, item]))
    const reorderedItems = itemIds.map((id: string) => itemMap.get(id)).filter((item): item is PlaylistItem => item !== undefined)
    const remainingItems = currentPlaylist.filter((item: PlaylistItem) => !itemIds.includes(item.id))
    const newPlaylist = [...reorderedItems, ...remainingItems]

    io.to(roomCode).emit('playlist-update', {
      playlist: newPlaylist,
      version: room.version + 1,
    })

    room.version++
    room.playbackState.playlist = newPlaylist
    markRoomDirty(roomCode)
  })

  // Handle poll commands
  socket.on('create-poll', ({ question, options, addWinnerToPlaylist }: { question: string; options: string[]; addWinnerToPlaylist?: boolean }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can create polls right now' })
      return
    }

    const poll: Poll = {
      id: Math.random().toString(36).substring(2, 9),
      question,
      options: options.map((opt) => ({ id: Math.random().toString(36).substring(2, 6), text: opt, votes: [] })),
      votes: {},
      status: 'open',
      closesAt: addWinnerToPlaylist ? Date.now() + 60000 : undefined, // close after 1 min if adding to playlist
      addWinnerToPlaylist,
      createdAt: Date.now(),
    }

    room.activePoll = poll
    room.polls = room.polls || []
    room.polls.push(poll)
    markRoomDirty(roomCode)

    io.to(roomCode).emit('poll-update', {
      poll,
      type: 'create',
    })
  })

  socket.on('vote-poll', ({ pollId, optionId, clientSeq, baseVersion, userId }: { pollId: string; optionId: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    const poll = (room.polls || []).find((p) => p.id === pollId) || (room.activePoll?.id === pollId ? room.activePoll : null)
    if (poll) {
      poll.votes = poll.votes || {}
      poll.votes[userId] = optionId
      markRoomDirty(roomCode)
    }

    io.to(roomCode).emit('poll-update', {
      type: 'vote',
      pollId,
      optionId,
      userId,
    })
  })

  socket.on('close-poll', ({ pollId, clientSeq, baseVersion, userId }: { pollId: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can close polls right now' })
      return
    }

    const poll = (room.polls || []).find((p) => p.id === pollId) || (room.activePoll?.id === pollId ? room.activePoll : null)
    if (poll) {
      poll.status = 'closed'
      if (room.activePoll?.id === pollId) {
        room.activePoll = null
      }
      markRoomDirty(roomCode)
    }

    io.to(roomCode).emit('poll-update', {
      type: 'close',
      pollId,
    })
  })

  // Host-only toggle: whether everyone or only the host may control playback
  socket.on('toggle-control', ({ open, userId }: { open: boolean; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (!isHost(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can change room controls' })
      return
    }

    room.everyoneCanControl = open !== false
    markRoomDirty(roomCode)
    io.to(roomCode).emit('room-settings', {
      everyoneCanControl: room.everyoneCanControl,
      hostId: room.hostId,
    })
  })

  // Manual host transfer by current host (requires explicit confirmation on client)
  socket.on('transfer-host', ({ newHostId, userId }: { newHostId: string; userId?: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (!isHost(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can transfer host controls' })
      return
    }

    if (!newHostId || newHostId === room.hostId) {
      return
    }

    const targetParticipant = room.participants.find((p) => p.id === newHostId && p.connected)
    if (!targetParticipant) {
      socket.emit('error', { message: 'Participant not found or disconnected' })
      return
    }

    const previousHostId = room.hostId
    room.hostId = newHostId
    markRoomDirty(roomCode)

    io.to(roomCode).emit('host-transfer', {
      newHostId: room.hostId,
      previousHostId,
      newHostName: targetParticipant.name,
    })
    io.to(roomCode).emit('participants-update', roomInfo(room))
    io.to(roomCode).emit('room-settings', {
      everyoneCanControl: room.everyoneCanControl,
      hostId: room.hostId,
    })
    console.log(`Host transferred from ${previousHostId} to ${room.hostId} (${targetParticipant.name}) in room ${roomCode}`)
  })

  socket.on('disconnect', () => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Mark participant as disconnected
    let participantFound = false
    room.participants.forEach((p) => {
      if (p.id === socket.id) {
        p.connected = false
        p.leftAt = Date.now()
        participantFound = true
      }
    })

    if (!participantFound) return

    // If host disconnects, automatically transfer host to the earliest connected participant
    if (room.hostId === socket.id) {
      const nextHost = selectNextHost(room.participants, socket.id)
      if (nextHost) {
        room.hostId = nextHost.id
        io.to(roomCode).emit('host-transfer', {
          newHostId: room.hostId,
          previousHostId: socket.id,
          newHostName: nextHost.name,
        })
        console.log(`Host disconnected from room ${roomCode}. Auto-transferred to earliest participant ${nextHost.name} (${room.hostId})`)
      } else {
        room.hostId = null
      }
      io.to(roomCode).emit('room-settings', {
        everyoneCanControl: room.everyoneCanControl,
        hostId: room.hostId,
      })
    }

    io.to(roomCode).emit('participants-update', roomInfo(room))
    markRoomDirty(roomCode)

    // Schedule cleanup after grace period
    setTimeout(() => {
      const currentRoom = rooms.get(roomCode)
      if (!currentRoom) return

      const wasDisconnected = currentRoom.participants.some((item) => item.id === socket.id && !item.connected)
      if (wasDisconnected) {
        currentRoom.participants = currentRoom.participants.filter((item) => !(item.id === socket.id && !item.connected))
        if (currentRoom.hostId === socket.id || currentRoom.hostId === null) {
          const nextHost = selectNextHost(currentRoom.participants)
          if (nextHost) {
            currentRoom.hostId = nextHost.id
            io.to(roomCode).emit('host-transfer', {
              newHostId: currentRoom.hostId,
              previousHostId: socket.id,
              newHostName: nextHost.name,
            })
            io.to(roomCode).emit('room-settings', {
              everyoneCanControl: currentRoom.everyoneCanControl,
              hostId: currentRoom.hostId,
            })
          } else {
            currentRoom.hostId = null
          }
        }
        io.to(roomCode).emit('participants-update', roomInfo(currentRoom))
        markRoomDirty(roomCode)
      }
    }, gracePeriod)

    console.log(`Client disconnected from room ${roomCode}`)
  })
})

// Periodic clock re-sync every 30 seconds
const serverTimeTimer = setInterval(() => {
  io.emit('server-time', { serverTime: Date.now() })
}, 30000)
serverTimeTimer.unref()

if (!process.env.VITEST) {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  }).on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is already in use, assuming server is running.`)
    } else {
      console.error(err)
    }
  })
}

export { app, httpServer, io }
