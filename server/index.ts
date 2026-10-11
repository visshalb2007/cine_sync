import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'
import path from 'path'
import fs from 'fs'

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
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: Date.now() })
})
app.get('/', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
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
})

const PORT = process.env.PORT || 3000

type Participant = {
  id: string
  name: string
  connected: boolean
  joinedAt: number
  leftAt?: number
  reactionHistory?: number[]
}

type PlaylistItem = {
  id: string
  movieId: string
  title: string
  addedBy: string
  order: number
}

type Room = {
  id: string
  code: string
  hostId: string | null
  everyoneCanControl: boolean
  participants: Participant[]
  playbackState: {
    videoId: string
    status: 'playing' | 'paused' | 'ended'
    positionMs: number
    serverTimestampMs: number
    rate: number
    version: number
    playlist: PlaylistItem[]
  }
  version: number
}

const rooms = new Map<string, Room>()
const gracePeriod = 60000 // 60 seconds

// Who may issue control commands? Host always; everyone else only when the
// room's "everyone can control" toggle is on (default true).
function canControl(room: Room, socketId: string, userId?: string): boolean {
  if (room.everyoneCanControl) return true
  return room.hostId === socketId || (userId != null && room.hostId === userId)
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
  bbb: { title: 'Big Buck Bunny trailer', url: '/media/bbb-trailer.mp4' },
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
        id: socket.id,
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
      }
      rooms.set(code, room)
      console.log('Created new room:', code)
    }

    // Check if this is a reconnection with existing session
    const existingParticipant = room.participants.find((p) => p.id === socket.id)
    
    if (existingParticipant && existingParticipant.leftAt) {
      // Reconnect within grace period
      const timeSinceLeft = Date.now() - existingParticipant.leftAt
      if (timeSinceLeft < gracePeriod) {
        // Restore participant
        existingParticipant.connected = true
        existingParticipant.leftAt = undefined
        existingParticipant.joinedAt = Date.now() - (existingParticipant.joinedAt - (existingParticipant.leftAt ? existingParticipant.leftAt - existingParticipant.joinedAt : 0))
        
        // Broadcast updated participant list
        io.to(room.code).emit('participants-update', roomInfo(room))

        // Send snapshot resume from current version
        socket.join(room.code)
        ;(socket as any).roomCode = room.code
        socket.emit('room-snapshot-resume', {
          ...roomInfo(room),
          playbackState: room.playbackState,
        })

        console.log(`Participant ${cleanName} reconnected within grace period`)
        return
      }
    }

    // Add participant
    const participant: Participant = {
      id: socket.id,
      name: cleanName,
      connected: true,
      joinedAt: Date.now(),
    }
    room.participants.push(participant)

    // Set as host if first participant
    if (room.participants.length === 1) {
      room.hostId = socket.id
    }

    socket.join(room.code)
    ;(socket as any).roomCode = room.code
    ;(socket as any).sessionToken = socket.id // session token is the socket id

    // Broadcast updated participant list
    io.to(room.code).emit('participants-update', roomInfo(room))

    // Send snapshot to new participant
    socket.emit('room-snapshot', {
      ...roomInfo(room),
      playbackState: room.playbackState,
      playlist: room.playbackState.playlist,
      activePoll: null,
      chatMessages: [],
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
      participant.connected = true
      participant.leftAt = undefined
      
      // Broadcast updated participant list
      io.to(foundRoom.code).emit('participants-update', roomInfo(foundRoom))

      // Send snapshot resume from current version
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      socket.emit('room-snapshot-resume', {
        ...roomInfo(foundRoom),
        playbackState: foundRoom.playbackState,
      })
      
      console.log(`Participant ${socketId} reconnected within grace period`)
    } else {
      // Grace period expired, treat as new join
      // Remove old participant and add new one
      foundRoom.participants = foundRoom.participants.filter((p) => p.id !== socketId)
      const newParticipant: Participant = {
        id: socketId,
        name: participant.name,
        connected: true,
        joinedAt: Date.now(),
      }
      foundRoom.participants.push(newParticipant)
      
      // Broadcast updated participant list
      io.to(foundRoom.code).emit('participants-update', roomInfo(foundRoom))

      // Send full snapshot
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      socket.emit('room-snapshot', {
        ...roomInfo(foundRoom),
        playbackState: foundRoom.playbackState,
        playlist: foundRoom.playbackState.playlist,
        activePoll: null,
        chatMessages: [],
      })
      
      console.log(`Participant ${socketId} re-joined after grace period expired`)
    }
  })

  // Handle playback commands
  socket.on('play-pause', ({ status, baseVersion, clientSeq }: { status: string; baseVersion: number; clientSeq: number }) => {
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
      })
      return
    }

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can control playback right now' })
      return
    }

    room.playbackState.status = status as 'playing' | 'paused' | 'ended'
    room.playbackState.serverTimestampMs = Date.now()
    room.version++
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
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
      })
      return
    }

    if (!canControl(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can control playback right now' })
      return
    }

    room.playbackState.positionMs = positionMs
    room.playbackState.serverTimestampMs = Date.now()
    room.version++
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
    })
  })

  socket.on('change-video', ({ videoId, clientSeq, baseVersion, userId }: { videoId: string; clientSeq: number; baseVersion: number; userId: string }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version' })
      return
    }

    if (!canControl(room, socket.id, userId)) {
      socket.emit('error', { message: 'Only the host can change the video right now' })
      return
    }

    room.playbackState.videoId = String(videoId ?? '').slice(0, 500)
    room.playbackState.status = 'paused'
    room.playbackState.positionMs = 0
    room.playbackState.serverTimestampMs = Date.now()
    room.version++
    io.to(roomCode).emit('state-update', {
      playbackState: room.playbackState,
      version: room.version,
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
    io.to(roomCode).emit('chat-message', {
      userId: socket.id,
      name: sender ? sender.name : 'Anonymous',
      text: clean,
      serverTimestampMs: now,
    })
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
  })

  // Handle poll commands
  type PollOption = { id: string; text: string; votes: string[] }
  type Poll = { id: string; question: string; options: PollOption[]; votes: Record<string, string>; status: 'open' | 'closed'; closesAt?: number; addWinnerToPlaylist?: boolean }
  
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
    }

    // Store poll in a temporary way - we'll need to persist this
    // For now, just broadcast the poll creation
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

    // Find and update poll - we need to store polls per room
    // For now, just acknowledge the vote
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

    if (room.hostId !== socket.id && room.hostId !== userId) {
      socket.emit('error', { message: 'Only the host can change room controls' })
      return
    }

    room.everyoneCanControl = open !== false
    io.to(roomCode).emit('room-settings', {
      everyoneCanControl: room.everyoneCanControl,
      hostId: room.hostId,
    })
  })

  socket.on('disconnect', () => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Mark participant as disconnected
    const participant = room.participants.find((p) => p.id === socket.id)
    if (participant) {
      participant.connected = false
      participant.leftAt = Date.now()
    }

    room.participants = room.participants.filter((p) => p.id !== socket.id)
    io.to(roomCode).emit('participants-update', roomInfo(room))

    // If host disconnects, mark for auto-transfer after grace period
    if (room.hostId === socket.id) {
      room.hostId = null // Will be transferred after grace period
      // Start grace period timer for host transfer
      setTimeout(() => {
        // Find longest-connected non-host participant
        const nonHostParticipants = room.participants.filter((p) => p.id !== room.hostId && p.connected).sort((a, b) => b.joinedAt - a.joinedAt)
        if (nonHostParticipants.length > 0) {
          room.hostId = nonHostParticipants[0].id
          io.to(roomCode).emit('host-transfer', {
            newHostId: room.hostId,
          })
          console.log(`Host auto-transferred to ${room.hostId}`)
        }
      }, gracePeriod)
    }

    console.log(`Client disconnected from room ${roomCode}`)
  })
})

// Periodic clock re-sync every 30 seconds
setInterval(() => {
  io.emit('server-time', { serverTime: Date.now() })
}, 30000)

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
