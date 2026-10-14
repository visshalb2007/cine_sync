import { test, expect } from '@playwright/test'
import { createRoomUser, waitForParticipants, RoomUser } from './helpers'

test.describe('Client reconnection and grace period', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('client drops and returns within grace period keeping identity; drops and returns after grace period treated as new participant', async ({ browser }) => {
    // 1. Alice creates the room
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    // 2. Bob joins the room
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    await waitForParticipants([alice.page, bob.page], 2)

    // --- PART 1: Drop and return within grace period ---
    // Bob drops network connection
    await bob.context.setOffline(true)

    // Alice should see Bob marked as offline
    const bobRowOnAlice = alice.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Bob' })
    await expect(bobRowOnAlice).toHaveClass(/offline/, { timeout: 5000 })

    // Bob returns quickly within the 3s grace period
    await bob.context.setOffline(false)

    // Bob should reconnect and restore online status
    await expect(bobRowOnAlice).not.toHaveClass(/offline/, { timeout: 5000 })
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(2)

    // Bob retains his identity and state
    const bobRowOnBob = bob.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Bob' })
    await expect(bobRowOnBob.locator('[data-testid="badge-you"]')).toBeVisible({ timeout: 5000 })

    // --- PART 2: Drop and return after grace period has expired ---
    // Charlie joins the room
    const charlie = await createRoomUser(browser, 'Charlie', { roomCode: alice.roomCode })
    users.push(charlie)

    await waitForParticipants([alice.page, bob.page, charlie.page], 3)

    // Charlie drops connection
    await charlie.context.setOffline(true)

    // Alice sees Charlie marked offline
    const charlieRowOnAlice = alice.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Charlie' })
    await expect(charlieRowOnAlice).toHaveClass(/offline/, { timeout: 5000 })

    // Wait on condition for grace period cleanup: Charlie should be pruned from participants list (count becomes 2)
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(2, { timeout: 8000 })

    // Charlie returns after grace period has expired
    await charlie.context.setOffline(false)

    // Charlie reconnects and is treated as a new participant, rejoining the room
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(3, { timeout: 8000 })
    await expect(alice.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Charlie' })).toBeVisible()
    await expect(charlie.page.locator('[data-testid="participant-row"]').filter({ hasText: 'Charlie' }).locator('[data-testid="badge-you"]')).toBeVisible()
  })

  test('participant count does not increase beyond actual participants when disconnecting and rejoining', async ({ browser }) => {
    // 1. Alice creates the room
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    // Initial participant count should be 1
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(1)
    await expect(alice.page.locator('[data-testid="participant-count"]')).toHaveText('1')

    // 2. Bob joins the room
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    await waitForParticipants([alice.page, bob.page], 2)
    await expect(alice.page.locator('[data-testid="participant-count"]')).toHaveText('2')

    // 3. Bob disconnects (leaves by closing context)
    await bob.context.close()
    users = users.filter((u) => u !== bob)

    // Online count badge on Alice's page reflects 1
    await expect(alice.page.locator('[data-testid="participant-count"]')).toHaveText('1', { timeout: 8000 })

    // 4. Bob rejoins the same room
    const bobRejoined = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bobRejoined)

    // Crucial check: count must be 2, NOT 3 or more
    await waitForParticipants([alice.page, bobRejoined.page], 2)
    await expect(alice.page.locator('[data-testid="participant-count"]')).toHaveText('2')
    await expect(alice.page.locator('[data-testid="participant-row"]')).toHaveCount(2)
  })
})
