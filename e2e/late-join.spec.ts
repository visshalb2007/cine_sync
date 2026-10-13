import { test, expect } from '@playwright/test'
import { createRoomUser, setVideo, getVideoState, expectConvergedPlayback, RoomUser } from './helpers'

test.describe('Late join synchronization', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('a client joins mid-playback and lands at the correct position', async ({ browser }) => {
    // 1. Host creates room and sets a video
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    await setVideo(alice.page, '/media/sintel-trailer.mp4')

    // 2. Host starts playback
    await alice.page.locator('[data-testid="play-pause-btn"]').click()

    // 3. Wait until playback has advanced for at least 3 seconds
    await expect
      .poll(async () => {
        const state = await getVideoState(alice.page)
        return !state.paused && state.currentTime > 3
      }, { timeout: 15000 })
      .toBe(true)

    // 4. Bob joins mid-playback
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    // Wait for Bob's video element to load the source
    await expect(bob.page.locator('[data-testid="video-element"]')).toHaveAttribute(
      'src',
      /\/media\/sintel-trailer\.mp4/,
      { timeout: 10000 }
    )

    // 5. Assert Bob lands mid-playback and converges with Alice within tolerance
    await expectConvergedPlayback([alice.page, bob.page], {
      expectedPaused: false,
      maxDriftSeconds: 0.5,
      timeout: 10000,
    })

    // Assert Bob's currentTime is well past the beginning (not 0)
    const bobState = await getVideoState(bob.page)
    expect(bobState.currentTime).toBeGreaterThan(2.5)
  })
})
