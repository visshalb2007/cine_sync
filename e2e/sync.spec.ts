import { test, expect } from '@playwright/test'
import { createRoomUser, setVideo, waitForParticipants, expectConvergedPlayback, getSyncState, RoomUser } from './helpers'

test.describe('Playback synchronization across multiple clients', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('3 clients play, pause, and seek from host converging within tolerance', async ({ browser }) => {
    // 1. Host creates room
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    // 2. Bob and Charlie join
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    const charlie = await createRoomUser(browser, 'Charlie', { roomCode: alice.roomCode })
    users.push(bob, charlie)

    const allPages = [alice.page, bob.page, charlie.page]
    await waitForParticipants(allPages, 3)

    // 3. Host sets video
    await setVideo(alice.page, '/media/sintel-trailer.mp4')

    // Wait for all clients to load the video source
    for (const p of [bob.page, charlie.page]) {
      await expect(p.locator('[data-testid="video-element"]')).toHaveAttribute(
        'src',
        /\/media\/sintel-trailer\.mp4/,
        { timeout: 10000 }
      )
    }

    // 4. Host plays
    await alice.page.locator('[data-testid="play-pause-btn"]').click()

    // Assert all clients converge on playing state (server-authoritative via __syncState)
    await expectConvergedPlayback(allPages, { expectedPaused: false, maxDriftSeconds: 0.5 })

    // Verify server-tracked time is advancing
    await expect
      .poll(async () => {
        const state = await getSyncState(bob.page)
        return state?.currentTime ?? 0
      }, { timeout: 10000 })
      .toBeGreaterThan(0.5)

    // 5. Host pauses
    await alice.page.locator('[data-testid="play-pause-btn"]').click()

    // Assert all clients converge on paused state
    await expectConvergedPlayback(allPages, { expectedPaused: true, maxDriftSeconds: 0.3 })

    const pausedState = await getSyncState(alice.page)
    const pausedTime = pausedState?.currentTime ?? 0

    // 6. Host seeks forward (+10s)
    await alice.page.locator('[data-testid="seek-fwd-btn"]').click()

    // Assert all clients converge after seek
    await expectConvergedPlayback(allPages, { expectedPaused: true, maxDriftSeconds: 0.5 })

    await expect
      .poll(async () => {
        const state = await getSyncState(charlie.page)
        return state?.currentTime ?? 0
      }, { timeout: 10000 })
      .toBeGreaterThanOrEqual(pausedTime + 8)

    // 7. Host plays again from new seek position
    await alice.page.locator('[data-testid="play-pause-btn"]').click()

    await expectConvergedPlayback(allPages, { expectedPaused: false, maxDriftSeconds: 0.5 })
  })
})
