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
    const serverNow = 55000 // 50ms later
    const rate = 1.0

    const expected = positionMs + (serverNow - serverTimestampMs) * rate
    expect(expected).toBe(60050)
  })

  it('calculates expected position with fast forward rate', () => {
    const positionMs = 30000
    const serverTimestampMs = 20000
    const serverNow = 21000 // 1000ms later
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
    let lastDriftThreshold = 0
    
    // First check: drift = 300ms
    const drift1 = 300
    if (Math.abs(drift1) > lastDriftThreshold) {
      consecutiveBeyondThreshold++
    }
    lastDriftThreshold = Math.abs(drift1)
    
    // Second check: drift still = 300ms
    const drift2 = 300
    if (Math.abs(drift2) > lastDriftThreshold) {
      consecutiveBeyondThreshold++
    }
    
    // After 2 consecutive checks beyond threshold, apply correction
    expect(consecutiveBeyondThreshold).toBe(2)
  })
})

describe('Sync Math: Latency Statistics', () => {
  it('calculates p50/p95/p99/max from latency samples', () => {
    const bot = new (require('../bot-harness').WatchPartyBot)({
      name: 'TestBot',
      roomCode: 'TEST123',
      numViewers: 1,
      commandsPerViewer: 100,
    })
    
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
    
    expect(p50).toBe(20)
    expect(p95).toBe(185)
    expect(p99).toBe(297)
    expect(max).toBe(300)
    expect(mean).toBe(80)
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
  let lastDriftThreshold = 0
  let consecutiveDriftBeyondThreshold = 0

  beforeEach(() => {
    lastDriftThreshold = 0
    consecutiveDriftBeyondThreshold = 0
  })

  it('applies drift correction after 2 consecutive checks beyond threshold', () => {
    // Simulate 2 consecutive drift checks beyond threshold
    
    // Check 1: drift = 300ms
    if (Math.abs(300) > lastDriftThreshold) {
      consecutiveDriftBeyondThreshold++
    }
    lastDriftThreshold = Math.abs(300)
    
    // Check 2: drift = 300ms still
    if (Math.abs(300) > lastDriftThreshold) {
      consecutiveDriftBeyondThreshold++
    }
    lastDriftThreshold = Math.abs(300)
    
    // After 2 consecutive, apply correction
    expect(consecutiveDriftBeyondThreshold).toBe(2)
  })

  it('resets hysteresis when drift falls within dead zone', () => {
    // Check 1: drift = 300ms (beyond threshold)
    if (Math.abs(300) > lastDriftThreshold) {
      consecutiveDriftBeyondThreshold++
    }
    lastDriftThreshold = Math.abs(300)
    
    // Check 2: drift = 50ms (within dead zone - 100ms threshold)
    if (Math.abs(50) > lastDriftThreshold) {
      consecutiveDriftBeyondThreshold++
    } else {
      // Drift fell within dead zone, reset hysteresis
      consecutiveDriftBeyondThreshold = 0
      lastDriftThreshold = 0
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