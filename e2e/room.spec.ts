import { test, expect } from '@playwright/test'
import { createRoomUser, waitForParticipants, RoomUser } from './helpers'

test.describe('Room creation and joining', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('creates room, joins via invite link, and updates participant lists', async ({ browser }) => {
    // 1. Alice creates a room
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    expect(alice.roomCode).toBeTruthy()
    expect(alice.roomCode.length).toBeGreaterThan(0)

    // Alice should see 1 participant (herself) with YOU and HOST badges
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(1)
    await expect(alice.page.locator('[data-testid="badge-you"]')).toBeVisible()
    await expect(alice.page.locator('[data-testid="badge-host"]')).toBeVisible()
    await expect(alice.page.locator('[data-testid="participant-name"]')).toHaveText('Alice')

    // 2. Bob joins using the invite link
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    // Both should see 2 participants
    await waitForParticipants([alice.page, bob.page], 2)

    // On Bob's page, Bob is YOU, Alice is HOST
    const bobRows = bob.page.locator('[data-testid="participant-row"]')
    await expect(bobRows.filter({ hasText: 'Bob' }).locator('[data-testid="badge-you"]')).toBeVisible()
    await expect(bobRows.filter({ hasText: 'Alice' }).locator('[data-testid="badge-host"]')).toBeVisible()

    // 3. Charlie joins the room
    const charlie = await createRoomUser(browser, 'Charlie', { roomCode: alice.roomCode })
    users.push(charlie)

    // All three should see 3 participants
    await waitForParticipants([alice.page, bob.page, charlie.page], 3)

    // Verify all names appear on Alice's page
    const aliceRows = alice.page.locator('[data-testid="participant-row"]')
    await expect(aliceRows.filter({ hasText: 'Alice' })).toBeVisible()
    await expect(aliceRows.filter({ hasText: 'Bob' })).toBeVisible()
    await expect(aliceRows.filter({ hasText: 'Charlie' })).toBeVisible()
  })
})
