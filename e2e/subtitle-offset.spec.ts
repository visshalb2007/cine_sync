import { test, expect } from '@playwright/test'
import { createRoomUser, RoomUser } from './helpers'

test.describe('Per-user Subtitle Offset', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('each user adjusts their own subtitle offset in 100ms steps without affecting others, persisting across reconnect', async ({ browser }) => {
    // 1. Alice creates room
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    // 2. Bob joins
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(bob)

    // 3. Verify initial display is 0ms for both
    await expect(alice.page.locator('[data-testid="sub-offset-display"]')).toHaveText('0ms')
    await expect(bob.page.locator('[data-testid="sub-offset-display"]')).toHaveText('0ms')

    // 4. Alice adjusts offset (+100ms twice -> +200ms)
    const alicePlusBtn = alice.page.locator('[data-testid="sub-offset-plus"]')
    await alicePlusBtn.click()
    await expect(alice.page.locator('[data-testid="sub-offset-display"]')).toHaveText('+100ms')
    await alicePlusBtn.click()
    await expect(alice.page.locator('[data-testid="sub-offset-display"]')).toHaveText('+200ms')

    // Verify Alice's client state
    const aliceOffset = await alice.page.evaluate(() => (window as any).__subtitleOffsetMs)
    expect(aliceOffset).toBe(200)

    // 5. Assert Bob is unaffected: still 0ms
    await expect(bob.page.locator('[data-testid="sub-offset-display"]')).toHaveText('0ms')
    const bobOffset = await bob.page.evaluate(() => (window as any).__subtitleOffsetMs)
    expect(bobOffset).toBe(0)

    // 6. Bob adjusts his offset to negative (-100ms twice -> -200ms)
    const bobMinusBtn = bob.page.locator('[data-testid="sub-offset-minus"]')
    await bobMinusBtn.click()
    await bobMinusBtn.click()
    await expect(bob.page.locator('[data-testid="sub-offset-display"]')).toHaveText('-200ms')

    // 7. Alice tests minus and reset
    const aliceMinusBtn = alice.page.locator('[data-testid="sub-offset-minus"]')
    await aliceMinusBtn.click()
    await expect(alice.page.locator('[data-testid="sub-offset-display"]')).toHaveText('+100ms')

    const aliceResetBtn = alice.page.locator('[data-testid="sub-offset-reset"]')
    await aliceResetBtn.click()
    await expect(alice.page.locator('[data-testid="sub-offset-display"]')).toHaveText('0ms')

    // 8. Test persistence: Bob reloads page to simulate reconnect
    await bob.page.reload()
    // Join room overlay re-appears with stored code and name
    await expect(bob.page.locator('[data-testid="join-room-btn"]')).toBeVisible()
    await bob.page.locator('[data-testid="join-room-btn"]').click()
    await expect(bob.page.locator('#joinOverlay')).toBeHidden()

    // Assert Bob's offset was restored from session storage / server snapshot
    await expect(bob.page.locator('[data-testid="sub-offset-display"]')).toHaveText('-200ms')
  })
})
