import { test, expect } from '@playwright/test'
import { createRoomUser, waitForParticipants, RoomUser } from './helpers'

test.describe('Watch party features: chat, reactions, playlist, polls', () => {
  let users: RoomUser[] = []

  test.afterEach(async () => {
    for (const u of users) {
      await u.context.close().catch(() => {})
    }
    users = []
  })

  test('chat, reactions, playlist operations, and poll lifecycle work seamlessly', async ({ browser }) => {
    // 1. Setup Alice (Host) and Bob (Participant)
    const alice = await createRoomUser(browser, 'Alice')
    const bob = await createRoomUser(browser, 'Bob', { roomCode: alice.roomCode })
    users.push(alice, bob)

    await waitForParticipants([alice.page, bob.page], 2)

    // ==========================================
    // 2. Chat Feature
    // ==========================================
    const aliceChatInput = alice.page.locator('[data-testid="chat-input"]')
    await aliceChatInput.fill('Hello from Alice!')
    await alice.page.locator('[data-testid="chat-send-btn"]').click()

    // Bob should see Alice's message
    const bobChatMsg = bob.page.locator('[data-testid="chat-messages"]')
    await expect(bobChatMsg).toContainText('Hello from Alice!')

    // Bob replies
    const bobChatInput = bob.page.locator('[data-testid="chat-input"]')
    await bobChatInput.fill('Hey Alice!')
    await bob.page.locator('[data-testid="chat-send-btn"]').click()

    // Alice should see Bob's reply
    const aliceChatMsg = alice.page.locator('[data-testid="chat-messages"]')
    await expect(aliceChatMsg).toContainText('Hey Alice!')

    // ==========================================
    // 3. Reactions Feature
    // ==========================================
    const fireEmojiBtn = alice.page.locator('[data-testid="emoji-btn"][data-emoji="🔥"]')
    await fireEmojiBtn.click()

    // Bob should see the floating reaction
    await expect(bob.page.locator('[data-testid="reaction-float"]')).toContainText('🔥', { timeout: 5000 })

    // ==========================================
    // 4. Playlist Feature (add, reorder, play, remove)
    // ==========================================
    await alice.page.locator('[data-testid="tab-playlist"]').click()
    await bob.page.locator('[data-testid="tab-playlist"]').click()

    // Alice adds item 1: Flower
    await alice.page.locator('[data-testid="playlist-title-input"]').fill('Flower Video')
    await alice.page.locator('[data-testid="playlist-url-input"]').fill('/media/flower.mp4')
    await alice.page.locator('[data-testid="playlist-add-btn"]').click()

    // Wait for item 1 to appear on both
    await expect(alice.page.locator('[data-testid="playlist-item"]')).toHaveCount(1)
    await expect(bob.page.locator('[data-testid="playlist-item"]')).toHaveCount(1)

    // Alice adds item 2: Sintel
    await alice.page.locator('[data-testid="playlist-title-input"]').fill('Sintel Trailer')
    await alice.page.locator('[data-testid="playlist-url-input"]').fill('/media/sintel-trailer.mp4')
    await alice.page.locator('[data-testid="playlist-add-btn"]').click()

    // Both should see 2 items
    await expect(alice.page.locator('[data-testid="playlist-item"]')).toHaveCount(2)
    await expect(bob.page.locator('[data-testid="playlist-item"]')).toHaveCount(2)

    // Verify initial order: Item 0 = Flower, Item 1 = Sintel
    const alicePlaylistTitles = alice.page.locator('[data-testid="playlist-item-title"]')
    await expect(alicePlaylistTitles.nth(0)).toHaveText('Flower Video')
    await expect(alicePlaylistTitles.nth(1)).toHaveText('Sintel Trailer')

    // Reorder: Alice moves Item 0 (Flower) down
    await alice.page.locator('[data-testid="playlist-down-btn"]').first().click()

    // Both should reflect new order: Item 0 = Sintel, Item 1 = Flower
    await expect(alicePlaylistTitles.nth(0)).toHaveText('Sintel Trailer', { timeout: 5000 })
    await expect(alicePlaylistTitles.nth(1)).toHaveText('Flower Video')

    const bobPlaylistTitles = bob.page.locator('[data-testid="playlist-item-title"]')
    await expect(bobPlaylistTitles.nth(0)).toHaveText('Sintel Trailer', { timeout: 5000 })
    await expect(bobPlaylistTitles.nth(1)).toHaveText('Flower Video')

    // Play item from playlist (Alice plays Sintel)
    await alice.page.locator('[data-testid="playlist-play-btn"]').first().click()

    // Both clients' video element should load Sintel
    await expect(alice.page.locator('[data-testid="video-element"]')).toHaveAttribute(
      'src',
      /\/media\/sintel-trailer\.mp4/,
      { timeout: 10000 }
    )
    await expect(bob.page.locator('[data-testid="video-element"]')).toHaveAttribute(
      'src',
      /\/media\/sintel-trailer\.mp4/,
      { timeout: 10000 }
    )

    // Remove item from playlist: Alice removes Flower (the 2nd item)
    await alice.page.locator('[data-testid="playlist-delete-btn"]').nth(1).click()

    // Both should see 1 item remaining (Sintel Trailer)
    await expect(alice.page.locator('[data-testid="playlist-item"]')).toHaveCount(1, { timeout: 5000 })
    await expect(bob.page.locator('[data-testid="playlist-item"]')).toHaveCount(1, { timeout: 5000 })
    await expect(alicePlaylistTitles.nth(0)).toHaveText('Sintel Trailer')

    // ==========================================
    // 5. Poll Feature (create, vote, close)
    // ==========================================
    await alice.page.locator('[data-testid="tab-poll"]').click()
    await bob.page.locator('[data-testid="tab-poll"]').click()

    // Alice creates a poll
    await alice.page.locator('[data-testid="poll-q-input"]').fill('Which genre should we watch next?')
    await alice.page.locator('[data-testid="poll-opts-input"]').fill('Sci-Fi, Comedy')
    await alice.page.locator('[data-testid="poll-create-btn"]').click()

    // Both clients see the poll question and options
    await expect(alice.page.locator('[data-testid="poll-question"]')).toHaveText('Which genre should we watch next?')
    await expect(bob.page.locator('[data-testid="poll-question"]')).toHaveText('Which genre should we watch next?')
    await expect(bob.page.locator('[data-testid="poll-option"]')).toHaveCount(2)

    // Bob votes for option 1 (Sci-Fi)
    const bobVoteBtns = bob.page.locator('[data-testid="poll-vote-btn"]')
    await bobVoteBtns.nth(0).click()

    // Alice votes for option 2 (Comedy)
    const aliceVoteBtns = alice.page.locator('[data-testid="poll-vote-btn"]')
    await aliceVoteBtns.nth(1).click()

    // Both should see 1 vote on each option
    const bobVoteCounts = bob.page.locator('[data-testid="poll-vote-count"]')
    await expect(bobVoteCounts.nth(0)).toHaveText('1 vote', { timeout: 5000 })
    await expect(bobVoteCounts.nth(1)).toHaveText('1 vote', { timeout: 5000 })

    // Alice closes the poll
    await alice.page.locator('[data-testid="poll-close-btn"]').click()

    // Both clients should see "Poll Closed" notice and voting buttons removed
    await expect(alice.page.locator('[data-testid="poll-closed-notice"]')).toBeVisible({ timeout: 5000 })
    await expect(bob.page.locator('[data-testid="poll-closed-notice"]')).toBeVisible({ timeout: 5000 })
    await expect(bob.page.locator('[data-testid="poll-vote-btn"]')).toHaveCount(0)
  })
})
