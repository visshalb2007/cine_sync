import { test, expect } from '@playwright/test'
import { createRoomUser, setVideo, waitForParticipants, expectConvergedPlayback, RoomUser } from './helpers'

test.describe('Host auto-transfer on disconnect', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('host disconnects, host auto-transfers to earliest participant, and new host controls playback', async ({ browser }) => {
    // 1. Alice creates the room (Host 1)
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    // 2. Bob joins (Earliest next participant)
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    // 3. Charlie joins
    const charlie = await createRoomUser(browser, 'Charlie', { roomCode: alice.roomCode })
    users.push(charlie)

    await waitForParticipants([alice.page, bob.page, charlie.page], 3)

    // 4. Alice sets video
    await setVideo(alice.page, '/media/sintel-trailer.mp4')
    await expect(bob.page.locator('[data-testid="video-element"]')).toHaveAttribute(
      'src',
      /\/media\/sintel-trailer\.mp4/,
      { timeout: 10000 }
    )

    // 5. Alice restricts controls to Host-only
    const controlToggle = alice.page.locator('[data-testid="control-toggle"]')
    await expect(controlToggle).toBeChecked()
    await controlToggle.uncheck()
    await expect(alice.page.locator('[data-testid="control-note"]')).toContainText('host-only control')
    await expect(bob.page.locator('[data-testid="control-note"]')).toContainText('Host-only control')

    // 6. Alice (host) disconnects
    await alice.context.close()
    // Remove alice from users array so afterEach won't error on already-closed context
    users = users.filter((u) => u.name !== 'Alice')

    // 7. Auto-transfer: Bob should become the new Host (since Bob joined before Charlie)
    const bobParticipantRow = bob.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Bob' })
    await expect(bobParticipantRow.locator('[data-testid="badge-host"]')).toBeVisible({ timeout: 10000 })
    await expect(bob.page.locator('[data-testid="control-note"]')).toContainText('You are host')

    // Charlie should see Bob as the host
    const charlieBobRow = charlie.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Bob' })
    await expect(charlieBobRow.locator('[data-testid="badge-host"]')).toBeVisible({ timeout: 10000 })

    // 8. Bob (as new host) starts playback
    await bob.page.locator('[data-testid="play-pause-btn"]').click()

    // Assert both Bob and Charlie converge on playing
    await expectConvergedPlayback([bob.page, charlie.page], {
      expectedPaused: false,
      maxDriftSeconds: 0.5,
    })

    // 9. Bob pauses playback
    await bob.page.locator('[data-testid="play-pause-btn"]').click()

    await expectConvergedPlayback([bob.page, charlie.page], {
      expectedPaused: true,
      maxDriftSeconds: 0.3,
    })
  })
})
