import { test, expect } from '@playwright/test'
import { createRoomUser } from './helpers'

test.describe('Cinema Mode feature', () => {
  test('toggles cinema mode, dims chrome, auto-hides controls after 3s, and exits on Escape', async ({ browser }) => {
    const user = await createRoomUser(browser, 'CinemaUser')
    const page = user.page

    const cinemaBtn = page.locator('[data-testid="cinema-mode-btn"]')
    const cornerCinemaBtn = page.locator('[data-testid="cinema-mode-corner-btn"]')
    const sidebar = page.locator('#sidebar')
    const topNavbar = page.locator('.top-navbar')
    const controlsArea = page.locator('.player-controls-area')

    await expect(cinemaBtn).toBeVisible()
    await expect(sidebar).toBeVisible()
    await expect(topNavbar).toBeVisible()

    // 1. Toggle Cinema Mode ON via button click
    await cinemaBtn.click()

    // Body should now have cinema-mode class
    await expect(page.locator('body')).toHaveClass(/cinema-mode/)

    // Sidebar and top navigation should be hidden
    await expect(sidebar).toBeHidden()
    await expect(topNavbar).toBeHidden()

    // 2. Controls auto-hide after 3 seconds of inactivity
    // Initially controls are visible
    await expect(controlsArea).toBeVisible()

    // Wait for the 3s inactivity timeout to trigger cinema-idle
    await expect.poll(async () => {
      return page.evaluate(() => document.body.classList.contains('cinema-idle'))
    }, { timeout: 6000, intervals: [250] }).toBe(true)

    // Verify controls fade out to 0 opacity when idle
    await expect.poll(async () => {
      return parseFloat(await controlsArea.evaluate((el) => window.getComputedStyle(el).opacity))
    }).toBeLessThanOrEqual(0.05)

    // 3. Mouse movement restores controls and clears cinema-idle
    await page.mouse.move(300, 300)
    await expect.poll(async () => {
      return page.evaluate(() => document.body.classList.contains('cinema-idle'))
    }).toBe(false)

    await expect.poll(async () => {
      return parseFloat(await controlsArea.evaluate((el) => window.getComputedStyle(el).opacity))
    }).toBeGreaterThanOrEqual(0.9)

    // 4. Pressing Escape exits Cinema Mode
    await page.keyboard.press('Escape')
    await expect(page.locator('body')).not.toHaveClass(/cinema-mode/)
    await expect(sidebar).toBeVisible()
    await expect(topNavbar).toBeVisible()

    // 5. Shortcut key 'c' toggles Cinema Mode ON and OFF
    await page.keyboard.press('c')
    await expect(page.locator('body')).toHaveClass(/cinema-mode/)

    await page.keyboard.press('c')
    await expect(page.locator('body')).not.toHaveClass(/cinema-mode/)

    // 6. Corner button toggles Cinema Mode
    await cornerCinemaBtn.click()
    await expect(page.locator('body')).toHaveClass(/cinema-mode/)

    await cornerCinemaBtn.click()
    await expect(page.locator('body')).not.toHaveClass(/cinema-mode/)

    await user.context.close()
  })
})
