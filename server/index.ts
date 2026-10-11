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
  socket.on('join-room', ({ roomCode, name, sessionToken }: { roomCode: string; name: string; sessionToken?: string }) => {
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
          playlist: [],
        },
        version: 0,
      }
      rooms.set(newCode, room)
      console.log('Created new room:', newCode)
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
        io.to(roomCode).emit('participants-update', {
          participants: room.participants,
          roomCode,
        })

        // Send snapshot resume from current version
        socket.join(roomCode)
        ;(socket as any).roomCode = roomCode
        socket.emit('room-snapshot-resume', {
          playbackState: room.playbackState,
          version: room.version,
        })
        
        console.log(`Participant ${name} reconnected within grace period`)
        return
      }
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
    ;(socket as any).sessionToken = socket.id // session token is the socket id

    // Broadcast updated participant list
    io.to(roomCode).emit('participants-update', {
      participants: room.participants,
      roomCode,
    })

    // Send snapshot to new participant
    socket.emit('room-snapshot', {
      playbackState: room.playbackState,
      playlist: room.playbackState.playlist,
      activePoll: null,
      chatMessages: [],
      participants: room.participants,
    })

    console.log(`Participant ${name} joined room ${roomCode}, total: ${room.participants.length}`)
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
      io.to(foundRoom.code).emit('participants-update', {
        participants: foundRoom.participants,
        code: foundRoom.code,
      })
      
      // Send snapshot resume from current version
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      socket.emit('room-snapshot-resume', {
        playbackState: foundRoom.playbackState,
        version: foundRoom.version,
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
      io.to(foundRoom.code).emit('participants-update', {
        participants: foundRoom.participants,
        code: foundRoom.code,
      })
      
      // Send full snapshot
      socket.join(foundRoom.code)
      ;(socket as any).roomCode = foundRoom.code
      socket.emit('room-snapshot', {
        playbackState: foundRoom.playbackState,
        playlist: foundRoom.playbackState.playlist,
        activePoll: null,
        chatMessages: [],
        participants: foundRoom.participants,
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

    // Only host can add videos
    if (room.hostId !== userId && room.hostId !== socket.id) {
      socket.emit('error', { message: 'Only host can add videos' })
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

    // Only host can remove videos
    if (room.hostId !== userId && room.hostId !== socket.id) {
      socket.emit('error', { message: 'Only host can remove videos' })
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

    // Only host can reorder playlist
    if (room.hostId !== userId && room.hostId !== socket.id) {
      socket.emit('error', { message: 'Only host can reorder playlist' })
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
    io.to(roomCode).emit('participants-update', {
      participants: room.participants,
      roomCode,
    })

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