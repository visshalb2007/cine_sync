import { test, expect } from '@playwright/test'
import { createRoomUser } from './helpers'

test.describe('Keyboard Shortcuts and Help Modal', () => {
  test('opens shortcuts modal via button and ?, executes playback hotkeys, and ignores typing in inputs', async ({ browser }) => {
    const user = await createRoomUser(browser, 'ShortcutsUser')
    const page = user.page

    const settingsBtn = page.locator('[data-testid="settings-btn"]')
    const shortcutsModal = page.locator('[data-testid="shortcuts-modal"]')
    const closeModalBtn = page.locator('[data-testid="close-shortcuts-modal-btn"]')

    // 1. Settings button opens shortcuts modal
    await expect(settingsBtn).toBeVisible()
    await settingsBtn.click()

    await expect(shortcutsModal).toBeVisible()
    await expect(shortcutsModal).toContainText('Space')
    await expect(shortcutsModal).toContainText('Rewind 10 seconds')
    await expect(shortcutsModal).toContainText('Forward 10 seconds')
    await expect(shortcutsModal).toContainText('Toggle Fullscreen')
    await expect(shortcutsModal).toContainText('Mute / Unmute')
    await expect(shortcutsModal).toContainText('Toggle Cinema Mode')
    await expect(shortcutsModal).toContainText('?')

    // 2. Close modal via close button
    await closeModalBtn.click()
    await expect(shortcutsModal).toBeHidden()

    // 3. Pressing '?' opens shortcuts modal
    await page.keyboard.press('?')
    await expect(shortcutsModal).toBeVisible()

    // Pressing Escape closes modal
    await page.keyboard.press('Escape')
    await expect(shortcutsModal).toBeHidden()

    // 4. Test hotkey 'm' for mute / unmute
    const initialMuted = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return v.muted
    })

    await page.keyboard.press('m')
    await expect.poll(async () => {
      return page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement
        return v.muted
      })
    }).toBe(!initialMuted)

    await page.keyboard.press('m')
    await expect.poll(async () => {
      return page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement
        return v.muted
      })
    }).toBe(initialMuted)

    // 5. Test seeking with ArrowRight / ArrowLeft
    // Load a sample video
    await page.locator('[data-testid="sample-sintel-btn"]').click()
    await page.waitForTimeout(300)

    await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      v.currentTime = 20
    })

    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => {
      return page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement
        return v.currentTime
      })
    }).toBeGreaterThan(25)

    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => {
      return page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement
        return v.currentTime
      })
    }).toBeLessThan(25)

    // 6. Ignore shortcuts while typing in inputs
    const chatInput = page.locator('[data-testid="chat-input"]')
    await chatInput.focus()
    await chatInput.type('m c ? ')

    // Verify modal did NOT open and cinema mode did NOT toggle
    await expect(shortcutsModal).toBeHidden()
    await expect(page.locator('body')).not.toHaveClass(/cinema-mode/)

    await user.context.close()
  })
})
