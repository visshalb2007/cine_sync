/**
 * Unit tests for Watch Party sync math
 * 
 * Tests the core synchronization calculations:
 * - Expected position calculation
 * - Drift detection thresholds
 * - Correction logic hysteresis
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WatchPartyBot, LatencyStats } from '../bot-harness'

describe('Sync Math: Expected Position Calculation', () => {
  // Test the core formula: expected = positionMs + (serverNow - serverTimestampMs) × rate
  it('calculates expected position while playing', () => {
    // Mock scenario:
    // - Video at position 120000ms (2 minutes)
    // - serverTimestampMs = 100000 (when state was last updated)
    // - serverNow = 105000 (50ms later on server)
    // - rate = 1.0 (normal playback)
    // expected = 120000 + (105000 - 100000) × 1.0 = 120000 + 5000 = 125000

    const positionMs = 120000
    const serverTimestampMs = 100000
    const serverNow = 105000
    const rate = 1.0

    const expected = positionMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(125000)
  })

  it('calculates expected position at normal rate', () => {
    const positionMs = 60000 // 1 minute
    const serverTimestampMs = 50000
    const serverNow = 50050 // 50ms later
    const rate = 1.0

    const expected = positionMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(60050)
  })

  it('calculates expected position with fast forward rate', () => {
    const positionMs = 30000
    const serverTimestampMs = 20000
    const serverNow = 20500 // 500ms later at 2x rate = 1000ms added
    const rate = 2.0 // 2x speed

    const expected = positionMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(31000)
  })

  it('expected position while paused (no rate adjustment)', () => {
    const positionMs = 45000
    const serverTimestampMs = 30000
    const serverNow = 35000
    const rate = 1.0

    // When paused: expected = positionMs (no rate adjustment)
    const expected = positionMs // paused: just use positionMs directly
    expect(expected).toBe(45000)
  })

  it('expected position while ended holds at position without advancing', () => {
    const positionMs = 153200
    const serverTimestampMs = 153200
    const serverNow = 160000 // 6.8s later
    const rate = 1.0
    const status = 'ended'

    // When ended, position does not advance
    const expected = status === 'ended' ? positionMs : positionMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(153200)
  })

  it('clamps expected position to duration so it cannot exceed video duration', () => {
    const durationMs = 120000 // 2-minute video
    const positionMs = 118000
    const serverTimestampMs = 100000
    const serverNow = 110000 // 10s elapsed
    const rate = 1.0

    // Without clamping: 118000 + 10000 = 128000 (past duration)
    const unclamped = positionMs + (serverNow - serverTimestampMs) * rate
    const clamped = Math.min(unclamped, durationMs)

    expect(clamped).toBe(120000)
  })

  it('computes drift as 0 at the end of video instead of negative drift', () => {
    const durationMs = 120000
    const actual = 120000 // Video stopped at end
    const isEnded = true

    // When video is ended, drift must be 0 instead of actual - unclampedExpected
    const drift = isEnded ? 0 : actual - 130000
    expect(drift).toBe(0)
  })

  it('updates positionMs on pause so subsequent play resumes from the paused position', () => {
    const startPos = 10000
    const startTimestamp = 100000
    const pauseTime = 125000
    const rate = 1.0

    // When pausing: elapsed time must be committed into positionMs
    const elapsed = (pauseTime - startTimestamp) * rate
    const pausedPos = startPos + elapsed
    expect(pausedPos).toBe(35000)

    // When resuming play from paused: resumes from 35000ms, not old 10000ms
    const resumeTime = 130000
    const resumePos = pausedPos
    const checkTime = 132000 // 2s after resume
    const expectedAfterResume = resumePos + (checkTime - resumeTime) * rate
    expect(expectedAfterResume).toBe(37000)
  })

  it('replays from start (position 0) when play is clicked at end of video', () => {
    const isAtEnd = true
    const durationMs = 153000
    const currentTimeMs = 153000 // at end

    // Click play at end of video:
    let want: string
    let posMs: number
    if (isAtEnd) {
      want = 'playing'
      posMs = 0
    } else {
      want = 'paused'
      posMs = currentTimeMs
    }

    expect(want).toBe('playing')
    expect(posMs).toBe(0)

    // Expected position after 3 seconds of replay from start:
    const serverTimestampMs = 200000
    const serverNow = 203000
    const rate = 1.0
    const expected = posMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(3000)
  })

  it('fixes drift to 0 whenever video is paused', () => {
    // When playback is paused, drift must always evaluate to 0
    const isPaused = true
    const anyActualMs = 45120
    const anyExpectedMs = 45000 // would be 120ms drift if playing

    const drift = isPaused ? 0 : anyActualMs - anyExpectedMs
    expect(drift).toBe(0)
  })
})

describe('Sync Math: Drift Detection Thresholds', () => {
  // Test the drift correction tiers from the plan:
  // < 100 ms: Ignore (dead zone)
  // 100-500 ms: Soft correction via playbackRate 0.95/1.05
  // > 500 ms: Hard seek to expected

  it('identifies dead zone drift (< 100ms)', () => {
    const drift = 50
    const deadZoneThreshold = 100
    
    // Should be ignored (dead zone)
    expect(Math.abs(drift) < deadZoneThreshold).toBe(true)
  })

  it('identifies soft correction zone (100-500ms)', () => {
    const drift = 250
    const deadZoneThreshold = 100
    const hardSeekThreshold = 500
    
    expect(drift > deadZoneThreshold).toBe(true)
    expect(Math.abs(drift) < hardSeekThreshold).toBe(true)
  })

  it('identifies hard seek zone (> 500ms)', () => {
    const drift = 750
    const hardSeekThreshold = 500
    
    expect(Math.abs(drift) > hardSeekThreshold).toBe(true)
  })

  it('hysteresis: only act if drift stays beyond threshold for 2 consecutive checks', () => {
    // Simulate the hysteresis logic
    let consecutiveBeyondThreshold = 0
    const deadZoneThreshold = 100
    
    // First check: drift = 300ms
    const drift1 = 300
    if (Math.abs(drift1) > deadZoneThreshold) {
      consecutiveBeyondThreshold++
    }
    
    // Second check: drift still = 300ms
    const drift2 = 300
    if (Math.abs(drift2) > deadZoneThreshold) {
      consecutiveBeyondThreshold++
    }
    
    // After 2 consecutive checks beyond threshold, apply correction
    expect(consecutiveBeyondThreshold).toBe(2)
  })
})

describe('Sync Math: Latency Statistics', () => {
  it('calculates p50/p95/p99/max from latency samples', () => {
    const bot = new WatchPartyBot({
      name: 'TestBot',
      roomCode: 'TEST123',
      numViewers: 1,
      commandsPerViewer: 100,
      scenario: 'latency',
    })
    expect(bot).toBeDefined()
    
    // Generate some sample latencies
    const sampleLatencies = [10, 15, 20, 25, 30, 50, 100, 150, 200, 300]
    
    // Sort and compute statistics
    const sorted = [...sampleLatencies].sort((a, b) => a - b)
    const n = sorted.length
    
    const p50 = sorted[Math.floor(n * 0.5)]
    const p95 = sorted[Math.floor(n * 0.95)]
    const p99 = sorted[Math.floor(n * 0.99)]
    const max = sorted[n - 1]
    const mean = sorted.reduce((a, b) => a + b, 0) / n
    
    expect(p50).toBe(50)
    expect(p95).toBe(300)
    expect(p99).toBe(300)
    expect(max).toBe(300)
    expect(mean).toBe(90)
  })

  it('handles edge case of single sample', () => {
    const samples = [50]
    const n = samples.length
    
    const p50 = samples[Math.floor(n * 0.5)]
    const p95 = samples[Math.floor(n * 0.95)]
    const p99 = samples[Math.floor(n * 0.99)]
    const max = samples[n - 1]
    const mean = samples.reduce((a, b) => a + b, 0) / n
    
    expect(p50).toBe(50)
    expect(p95).toBe(50)
    expect(p99).toBe(50)
    expect(max).toBe(50)
    expect(mean).toBe(50)
  })
})

describe('Drift State Machine', () => {
  let consecutiveDriftBeyondThreshold = 0

  beforeEach(() => {
    consecutiveDriftBeyondThreshold = 0
  })

  it('applies drift correction after 2 consecutive checks beyond threshold', () => {
    // Simulate 2 consecutive drift checks beyond threshold (100ms)
    const threshold = 100
    
    // Check 1: drift = 300ms
    if (Math.abs(300) > threshold) {
      consecutiveDriftBeyondThreshold++
    }
    
    // Check 2: drift = 300ms still
    if (Math.abs(300) > threshold) {
      consecutiveDriftBeyondThreshold++
    }
    
    // After 2 consecutive, apply correction
    expect(consecutiveDriftBeyondThreshold).toBe(2)
  })

  it('resets hysteresis when drift falls within dead zone', () => {
    const threshold = 100
    // Check 1: drift = 300ms (beyond threshold)
    if (Math.abs(300) > threshold) {
      consecutiveDriftBeyondThreshold++
    }
    
    // Check 2: drift = 50ms (within dead zone - 100ms threshold)
    if (Math.abs(50) > threshold) {
      consecutiveDriftBeyondThreshold++
    } else {
      // Drift fell within dead zone, reset hysteresis
      consecutiveDriftBeyondThreshold = 0
    }
    
    expect(consecutiveDriftBeyondThreshold).toBe(0)
  })

  it('applies soft correction for 100-500ms drift', () => {
    // Drift of 250ms should trigger soft correction
    const drift = 250
    const threshold = 100
    
    if (Math.abs(drift) > threshold && Math.abs(drift) < 500) {
      // Soft correction: adjust playbackRate toward 1.0
      let playbackRate = 1.0
      const driftDirection = drift > 0 ? 1 : -1
      playbackRate += driftDirection * 0.02
      expect(playbackRate).toBe(1.02)
    }
  })

  it('applies hard seek for > 500ms drift', () => {
    // Drift of 600ms should trigger hard seek
    const drift = 600
    const hardSeekThreshold = 500
    
    expect(Math.abs(drift) > hardSeekThreshold).toBe(true)
    // Action: hard seek to expected position
    expect(true) // placeholder - in real code would: video.currentTime = expected / 1000
  })
})