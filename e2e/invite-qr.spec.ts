import { test, expect } from '@playwright/test'
import { createRoomUser, RoomUser } from './helpers'

test.describe('Invite Link and QR Code Modal', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('Watch Together button copies link, generates QR code, and manages modal lifecycle', async ({ browser }) => {
    // Grant clipboard permissions to context
    const alice = await createRoomUser(browser, 'Alice')
    users.push(alice)

    const page = alice.page

    // 1. Verify "Watch Together" button is present and visible
    const watchTogetherBtn = page.locator('[data-testid="watch-together-btn"]')
    await expect(watchTogetherBtn).toBeVisible()

    // 2. Click "Watch Together" to open the modal
    await watchTogetherBtn.click()

    // 3. Modal should appear with proper accessibility attributes
    const modal = page.locator('[data-testid="invite-modal"]')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveAttribute('role', 'dialog')
    await expect(modal).toHaveAttribute('aria-modal', 'true')

    // 4. Invite link input should contain the room code
    const linkInput = page.locator('[data-testid="invite-link-input"]')
    await expect(linkInput).toBeVisible()
    const inputValue = await linkInput.inputValue()
    expect(inputValue).toContain(alice.roomCode)

    // 5. QR Code canvas should be rendered and have positive dimensions
    const qrCanvas = page.locator('[data-testid="invite-qr-canvas"]')
    await expect(qrCanvas).toBeVisible()
    const box = await qrCanvas.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(50)
    expect(box!.height).toBeGreaterThan(50)

    // 6. Click Copy Link inside modal
    const copyBtn = page.locator('[data-testid="copy-invite-link-btn"]')
    await copyBtn.click()
    const shareNotice = page.locator('[data-testid="invite-share-notice"]')
    await expect(shareNotice).toBeVisible()

    // 7. Test closing via Escape key
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()

    // 8. Re-open via clicking room code box
    await page.locator('[data-testid="room-code"]').click()
    await expect(modal).toBeVisible()

    // 9. Close via close button
    const closeBtn = page.locator('[data-testid="close-invite-modal-btn"]')
    await closeBtn.click()
    await expect(modal).toBeHidden()
  })
})
