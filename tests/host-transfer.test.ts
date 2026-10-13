import { describe, it, expect } from 'vitest'
import { selectNextHost, isHost } from '../server/index'
import type { Room, Participant } from '../server/db'

describe('Host Management & Auto-Transfer', () => {
  describe('selectNextHost', () => {
    it('elects the earliest connected participant (smallest joinedAt) when host leaves', () => {
      const participants: Participant[] = [
        { id: 'host-1', name: 'Alice', connected: false, joinedAt: 1000 },
        { id: 'user-2', name: 'Bob', connected: true, joinedAt: 3000 },
        { id: 'user-3', name: 'Charlie', connected: true, joinedAt: 2000 }, // joined before Bob
        { id: 'user-4', name: 'Dave', connected: true, joinedAt: 4000 },
      ]

      const next = selectNextHost(participants, 'host-1')
      expect(next).not.toBeNull()
      expect(next?.id).toBe('user-3')
      expect(next?.name).toBe('Charlie')
    })

    it('ignores disconnected participants even if they joined earlier', () => {
      const participants: Participant[] = [
        { id: 'host-1', name: 'Alice', connected: false, joinedAt: 1000 },
        { id: 'user-offline', name: 'Bob', connected: false, joinedAt: 1500 }, // earliest but offline
        { id: 'user-online', name: 'Charlie', connected: true, joinedAt: 2500 },
      ]

      const next = selectNextHost(participants, 'host-1')
      expect(next).not.toBeNull()
      expect(next?.id).toBe('user-online')
      expect(next?.name).toBe('Charlie')
    })

    it('returns null if no connected participants remain in room', () => {
      const participants: Participant[] = [
        { id: 'host-1', name: 'Alice', connected: false, joinedAt: 1000 },
        { id: 'user-2', name: 'Bob', connected: false, joinedAt: 2000 },
      ]

      const next = selectNextHost(participants, 'host-1')
      expect(next).toBeNull()
    })

    it('breaks ties deterministically using participant id if joinedAt is identical', () => {
      const participants: Participant[] = [
        { id: 'user-z', name: 'Zoe', connected: true, joinedAt: 2000 },
        { id: 'user-a', name: 'Adam', connected: true, joinedAt: 2000 },
      ]

      const next = selectNextHost(participants, null)
      expect(next?.id).toBe('user-a')
    })

    it('excludes the leaving host even if their connected flag is not yet updated', () => {
      const participants: Participant[] = [
        { id: 'host-1', name: 'Alice', connected: true, joinedAt: 1000 },
        { id: 'user-2', name: 'Bob', connected: true, joinedAt: 2000 },
      ]

      const next = selectNextHost(participants, 'host-1')
      expect(next?.id).toBe('user-2')
    })
  })

  describe('isHost', () => {
    const mockRoom: Room = {
      id: 'r-1',
      code: 'TEST01',
      hostId: 'host-socket-1',
      everyoneCanControl: false,
      participants: [
        { id: 'host-socket-1', name: 'Alice', connected: true, joinedAt: 1000 },
        { id: 'user-socket-2', name: 'Bob', connected: true, joinedAt: 2000 },
      ],
      playbackState: {
        videoId: 'sintel',
        status: 'playing',
        positionMs: 0,
        serverTimestampMs: Date.now(),
        rate: 1.0,
        version: 1,
        playlist: [],
      },
      version: 1,
    }

    it('returns true for socket matching hostId', () => {
      expect(isHost(mockRoom, 'host-socket-1')).toBe(true)
    })

    it('returns true for persistent userId matching hostId', () => {
      expect(isHost(mockRoom, 'other-socket', 'host-socket-1')).toBe(true)
    })

    it('returns false for non-host socketId and userId', () => {
      expect(isHost(mockRoom, 'user-socket-2')).toBe(false)
      expect(isHost(mockRoom, 'user-socket-2', 'user-socket-2')).toBe(false)
    })

    it('returns false if hostId is null', () => {
      const roomWithoutHost: Room = { ...mockRoom, hostId: null }
      expect(isHost(roomWithoutHost, 'host-socket-1')).toBe(false)
    })
  })

  describe('Single Host Invariant', () => {
    it('guarantees only one participant is identified as host', () => {
      const room: Room = {
        id: 'r-2',
        code: 'TEST02',
        hostId: 'socket-alice',
        everyoneCanControl: false,
        participants: [
          { id: 'socket-alice', name: 'Alice', connected: true, joinedAt: 1000 },
          { id: 'socket-bob', name: 'Bob', connected: true, joinedAt: 2000 },
          { id: 'socket-charlie', name: 'Charlie', connected: true, joinedAt: 3000 },
        ],
        playbackState: {
          videoId: 'sintel',
          status: 'playing',
          positionMs: 0,
          serverTimestampMs: Date.now(),
          rate: 1.0,
          version: 1,
          playlist: [],
        },
        version: 1,
      }

      const hosts = room.participants.filter((p) => isHost(room, p.id))
      expect(hosts).toHaveLength(1)
      expect(hosts[0].id).toBe('socket-alice')

      // Manual transfer to Bob
      room.hostId = 'socket-bob'
      const hostsAfterTransfer = room.participants.filter((p) => isHost(room, p.id))
      expect(hostsAfterTransfer).toHaveLength(1)
      expect(hostsAfterTransfer[0].id).toBe('socket-bob')
      expect(isHost(room, 'socket-alice')).toBe(false)
      expect(isHost(room, 'socket-bob')).toBe(true)

      // Host leaves: Bob disconnects, earliest participant (Alice, joinedAt 1000) becomes host
      const nextHost = selectNextHost(room.participants, 'socket-bob')
      expect(nextHost).not.toBeNull()
      room.hostId = nextHost!.id

      const hostsAfterDisconnect = room.participants.filter((p) => isHost(room, p.id))
      expect(hostsAfterDisconnect).toHaveLength(1)
      expect(hostsAfterDisconnect[0].id).toBe('socket-alice')
    })
  })
})
