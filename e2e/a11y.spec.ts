import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createRoomUser } from './helpers'

test.describe('Accessibility (WCAG AA & axe-core)', () => {
  test('initial join overlay screen has no critical or serious accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#joinOverlay')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (seriousOrCritical.length > 0) {
      console.error('Join overlay violations:', JSON.stringify(seriousOrCritical, null, 2))
    }

    expect(seriousOrCritical).toEqual([])
  })

  test('main watch party room screen has no critical or serious accessibility violations', async ({ browser }) => {
    const user = await createRoomUser(browser, 'A11yUser')
    const page = user.page

    await expect(page.locator('#joinOverlay')).toBeHidden()
    await expect(page.locator('#video')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (seriousOrCritical.length > 0) {
      console.error('Main room violations:', JSON.stringify(seriousOrCritical, null, 2))
    }

    expect(seriousOrCritical).toEqual([])
    await user.context.close()
  })

  test('invite / QR modal has no critical or serious accessibility violations', async ({ browser }) => {
    const user = await createRoomUser(browser, 'InviteA11yUser')
    const page = user.page

    // Open invite modal
    await page.locator('[data-testid="watch-together-btn"]').click()
    const inviteModal = page.locator('[data-testid="invite-modal"]')
    await expect(inviteModal).toBeVisible()

    const results = await new AxeBuilder({ page })
      .include('#inviteModal')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (seriousOrCritical.length > 0) {
      console.error('Invite modal violations:', JSON.stringify(seriousOrCritical, null, 2))
    }

    expect(seriousOrCritical).toEqual([])
    await user.context.close()
  })

  test('keyboard shortcuts modal has no critical or serious accessibility violations', async ({ browser }) => {
    const user = await createRoomUser(browser, 'ShortcutsA11yUser')
    const page = user.page

    // Open shortcuts modal
    await page.locator('[data-testid="settings-btn"]').click()
    const shortcutsModal = page.locator('[data-testid="shortcuts-modal"]')
    await expect(shortcutsModal).toBeVisible()

    const results = await new AxeBuilder({ page })
      .include('#shortcutsModal')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (seriousOrCritical.length > 0) {
      console.error('Shortcuts modal violations:', JSON.stringify(seriousOrCritical, null, 2))
    }

    expect(seriousOrCritical).toEqual([])
    await user.context.close()
  })

  test('modals trap focus within the dialog and restore focus upon dismissal', async ({ browser }) => {
    const user = await createRoomUser(browser, 'FocusTrapUser')
    const page = user.page

    const settingsBtn = page.locator('[data-testid="settings-btn"]')
    await settingsBtn.focus()
    await settingsBtn.click()

    const shortcutsModal = page.locator('[data-testid="shortcuts-modal"]')
    await expect(shortcutsModal).toBeVisible()

    // Focus is trapped within modal
    const closeBtn = page.locator('[data-testid="close-shortcuts-modal-btn"]')
    await expect(closeBtn).toBeFocused()

    // Tabbing should cycle inside modal
    await page.keyboard.press('Tab')
    const activeInside = await page.evaluate(() => {
      const modal = document.getElementById('shortcutsModal')
      return modal?.contains(document.activeElement)
    })
    expect(activeInside).toBe(true)

    // Press Escape to dismiss modal
    await page.keyboard.press('Escape')
    await expect(shortcutsModal).toBeHidden()

    // Focus should be restored to settingsBtn
    await expect(settingsBtn).toBeFocused()

    await user.context.close()
  })
})
