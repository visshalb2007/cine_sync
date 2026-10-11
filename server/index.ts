import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'

const app = express()
const httpServer = createServer(app)
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
}

type Room = {
  id: string
  code: string
  hostId: string | null
  participants: Participant[]
  playbackState: {
    videoId: string
    status: 'playing' | 'paused' | 'ended'
    positionMs: number
    serverTimestampMs: number
    rate: number
    version: number
  }
  version: number
}

const rooms = new Map<string, Room>()

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

  // Join room by code
  socket.on('join-room', ({ roomCode, name }: { roomCode: string; name: string }) => {
    let room = rooms.get(roomCode)
    if (!room) {
      // Create new room
      const newCode = Math.random().toString(36).substring(2, 8).toUpperCase()
      room = {
        id: socket.id,
        code: newCode,
        hostId: socket.id,
        participants: [],
        playbackState: {
          videoId: '',
          status: 'paused',
          positionMs: 0,
          serverTimestampMs: Date.now(),
          rate: 1,
          version: 0,
        },
        version: 0,
      }
      rooms.set(newCode, room)
      console.log('Created new room:', newCode)
    }

    // Add participant
    const participant: Participant = {
      id: socket.id,
      name,
      connected: true,
      joinedAt: Date.now(),
    }
    room.participants.push(participant)

    // Set as host if first participant
    if (room.participants.length === 1) {
      room.hostId = socket.id
    }

    socket.join(roomCode)
    ;(socket as any).roomCode = roomCode

    // Broadcast updated participant list
    io.to(roomCode).emit('participants-update', {
      participants: room.participants,
      roomCode,
    })

    // Send snapshot to new participant
    socket.emit('room-snapshot', {
      playbackState: room.playbackState,
      playlist: [],
      activePoll: null,
      chatMessages: [],
      participants: room.participants,
    })

    console.log(`Participant ${name} joined room ${roomCode}, total: ${room.participants.length}`)
  })

  // Handle playback commands
  socket.on('play-pause', ({ status, baseVersion, clientSeq }: { status: string; baseVersion: number; clientSeq: number }) => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    // Validate baseVersion
    if (room.version !== baseVersion) {
      socket.emit('error', { message: 'Stale version, please reconnect state' })
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
      socket.emit('error', { message: 'Stale version' })
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

  socket.on('disconnect', () => {
    const roomCode = (socket as any).roomCode
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (!room) return

    room.participants = room.participants.filter((p) => p.id !== socket.id)
    io.to(roomCode).emit('participants-update', {
      participants: room.participants,
      roomCode,
    })

    // If host disconnects, mark for auto-transfer
    if (room.hostId === socket.id) {
      room.hostId = null // Will be transferred after grace period
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