import { test, expect } from '@playwright/test'
import { createRoomUser } from './helpers'

test.describe('Per-user video quality selection', () => {
  test('quality dropdown switches source while preserving position and state, and stays per-user', async ({ browser }) => {
    // 1. Host creates room
    const host = await createRoomUser(browser, 'HostUser')
    const roomCode = host.roomCode

    // 2. Client joins room
    const client = await createRoomUser(browser, 'ClientUser', { roomCode })

    // 3. Load sample video with multiple qualities (Sintel)
    await host.page.locator('[data-testid="sample-sintel-btn"]').click()

    // Verify both participants see video loaded
    const hostQuality = host.page.locator('[data-testid="quality-select"]')
    const clientQuality = client.page.locator('[data-testid="quality-select"]')

    await expect(hostQuality).toBeVisible()
    await expect(clientQuality).toBeVisible()

    // Sintel sample provides 1080p, 720p, 480p
    await expect.poll(async () => {
      const options = await hostQuality.locator('option').allTextContents()
      return options
    }).toEqual(['1080p', '720p', '480p'])

    // Host starts playback and seeks to ~2 seconds
    await host.page.locator('[data-testid="play-pause-btn"]').click()
    await host.page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      if (v) v.currentTime = 2.0
    })

    // Wait a brief moment to ensure playback is progressing
    await host.page.waitForTimeout(300)

    // User 1 switches quality to 720p
    const posBefore = await host.page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return v ? v.currentTime : 0
    })

    await hostQuality.selectOption('720p')

    // Verify Host's video src updated to include ?q=720p
    await expect.poll(async () => {
      return host.page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement
        return v ? v.src : ''
      })
    }).toContain('q=720p')

    // Verify Host's playback position was preserved
    const posAfter = await host.page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return v ? v.currentTime : 0
    })
    expect(Math.abs(posAfter - posBefore)).toBeLessThan(1.5)

    // Verify Client's video src was NOT affected by Host's local quality switch (stays 1080p / default)
    const clientSrc = await client.page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement
      return v ? v.src : ''
    })
    expect(clientSrc).not.toContain('q=720p')

    // 4. Test backward-compatibility: load single-url video (flower)
    await host.page.locator('[data-testid="sample-flower-btn"]').click()

    await expect.poll(async () => {
      return hostQuality.locator('option').allTextContents()
    }).toEqual(['Auto'])

    expect(await hostQuality.inputValue()).toBe('Auto')

    // Cleanup
    await host.context.close()
    await client.context.close()
  })

  test('playlist items with custom sources populate quality options', async ({ browser }) => {
    const host = await createRoomUser(browser, 'PlaylistHost')
    const roomCode = host.roomCode

    // Add item with sources directly to playlist
    await host.page.evaluate(() => {
      const win = window as any
      const s = win._socket || win.socket
      if (s) {
        s.emit('add-video', {
          movieId: '/media/sintel-trailer.mp4',
          title: 'Custom Multi-Quality Video',
          clientSeq: 1,
          baseVersion: 0,
          userId: s.id,
          sources: [
            { url: '/media/sintel-trailer.mp4?res=4k', quality: '4K UHD' },
            { url: '/media/sintel-trailer.mp4?res=1080', quality: '1080p HD' },
            { url: '/media/sintel-trailer.mp4?res=360', quality: '360p SD' },
          ],
        })
      }
    })

    // Switch to playlist tab to see playlist items
    await host.page.locator('[data-testid="tab-playlist"]').click()

    // Click on playlist item's play button
    const playlistItem = host.page.locator('[data-testid="playlist-item"]').first()
    await expect(playlistItem).toBeVisible()
    await playlistItem.locator('[data-testid="playlist-play-btn"]').click()

    const qualitySelect = host.page.locator('[data-testid="quality-select"]')
    await expect.poll(async () => {
      return qualitySelect.locator('option').allTextContents()
    }).toEqual(['4K UHD', '1080p HD', '360p SD'])

    await host.context.close()
  })
})
