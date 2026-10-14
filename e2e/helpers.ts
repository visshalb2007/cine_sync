import { Browser, BrowserContext, Page, expect } from '@playwright/test'

export interface RoomUser {
  context: BrowserContext
  page: Page
  roomCode: string
  name: string
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function createRoomUser(
  browser: Browser,
  name: string,
  options?: { roomCode?: string; baseURL?: string }
): Promise<RoomUser> {
  const baseURL = options?.baseURL || 'http://localhost:3000'
  const context = await browser.newContext({
    permissions: [],
    viewport: { width: 1280, height: 720 },
  })

  const page = await context.newPage()
  const targetUrl = options?.roomCode ? `${baseURL}/?code=${options.roomCode}` : baseURL
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })

  // Fill in user name
  const nameInput = page.locator('[data-testid="name-input"]')
  await expect(nameInput).toBeVisible({ timeout: 10000 })
  await nameInput.fill(name)

  if (options?.roomCode) {
    const codeInput = page.locator('[data-testid="code-input"]')
    const currentValue = await codeInput.inputValue()
    if (!currentValue || currentValue.toUpperCase() !== options.roomCode.toUpperCase()) {
      await codeInput.fill(options.roomCode)
    }
    await page.locator('[data-testid="join-room-btn"]').click()
  } else {
    await page.locator('[data-testid="create-room-btn"]').click()
  }

  // Wait for join overlay to hide
  await expect(page.locator('#joinOverlay')).toBeHidden({ timeout: 10000 })
  await expect(page.locator('[data-testid="room-code"]')).toBeVisible({ timeout: 10000 })

  // Extract the room code
  const codeValEl = page.locator('[data-testid="room-code"] .code-value')
  const actualRoomCode = ((await codeValEl.textContent()) || '').trim()

  // Ensure video is muted in headless context to allow auto-playback
  await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    if (v) v.muted = true
  })

  return {
    context,
    page,
    roomCode: actualRoomCode || options?.roomCode || '',
    name,
  }
}

export async function getVideoState(page: Page) {
  return page.evaluate(() => {
    // Prefer the server-authoritative state exposed by the client for CI reliability.
    // In headless Chromium, video.currentTime may not advance even when status is
    // "playing" because hardware video decode is unavailable. window.__syncState
    // tracks the interpolated server position and is always accurate.
    const sync = (window as any).__syncState as {
      status: string; positionMs: number; paused: boolean; currentTime: number; videoId: string
    } | undefined

    const v = document.querySelector('video') as HTMLVideoElement | null

    if (sync) {
      return {
        currentTime: sync.currentTime,
        duration: v ? v.duration : 0,
        paused: sync.paused,
        readyState: v ? v.readyState : 0,
        src: v ? v.src : '',
        ended: sync.status === 'ended',
      }
    }

    return {
      currentTime: v ? v.currentTime : 0,
      duration: v ? v.duration : 0,
      paused: v ? v.paused : true,
      readyState: v ? v.readyState : 0,
      src: v ? v.src : '',
      ended: v ? v.ended : false,
    }
  })
}

/** Returns the raw window.__syncState from the page (null if not yet set). */
export async function getSyncState(page: Page) {
  return page.evaluate(() => {
    return (window as any).__syncState as {
      status: string; positionMs: number; paused: boolean; currentTime: number; videoId: string
    } | undefined
  })
}

export async function setVideo(page: Page, videoUrl: string) {
  const input = page.locator('[data-testid="set-video-input"]')
  await input.fill(videoUrl)
  await page.locator('[data-testid="set-video-btn"]').click()
  await expect(page.locator('[data-testid="video-element"]')).toHaveAttribute(
    'src',
    new RegExp(videoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    { timeout: 10000 }
  )
}

export async function waitForParticipants(pages: Page[], expectedCount: number, timeout = 10000) {
  for (const p of pages) {
    await expect(p.locator('[data-testid="participant-row"]')).toHaveCount(expectedCount, {
      timeout,
    })
  }
}

export async function expectConvergedPlayback(
  pages: Page[],
  options?: { expectedPaused?: boolean; maxDriftSeconds?: number; timeout?: number }
) {
  const maxDrift = options?.maxDriftSeconds ?? 0.5
  const timeout = options?.timeout ?? 10000

  await expect
    .poll(
      async () => {
        const states = await Promise.all(pages.map((p) => getVideoState(p)))
        if (options?.expectedPaused !== undefined) {
          const allMatchExpected = states.every((s) => s.paused === options.expectedPaused)
          if (!allMatchExpected) return false
        } else {
          const firstPaused = states[0].paused
          const allSamePaused = states.every((s) => s.paused === firstPaused)
          if (!allSamePaused) return false
        }

        const times = states.map((s) => s.currentTime)
        const minTime = Math.min(...times)
        const maxTime = Math.max(...times)
        const drift = maxTime - minTime
        return drift <= maxDrift
      },
      {
        message: `Expected all ${pages.length} clients to converge within ${maxDrift}s`,
        timeout,
        intervals: [100, 200, 300],
      }
    )
    .toBe(true)
}
