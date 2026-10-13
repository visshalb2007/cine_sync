# Watch Party: Failure-Handling Document

## Overview

This document summarizes all failure scenarios identified during development and testing of the CineSync watch party application, along with their expected and observed behaviors.

## Table of Contents

1. [Socket Drop](#1-socket-drop)
2. [Stale/Duplicate Command](#2-staleduplicate-command)
3. [Video Buffering](#3-video-buffering-for-one-user)
4. [Server Crash](#4-server-crash)
5. [Autoplay Blocked by Browser](#5-autoplay-blocked-by-browser)
6. [Invalid Room Code/Expired Link](#6-invalid-room-codeexpired-link)
7. [Network Conditions](#7-network-conditions)
8. [Drift Scenarios](#8-drift-scenarios)
9. [Measured Benchmark Results & Validation](#9-measured-benchmark-results--validation)

---

## 1. Socket Drop

### Expected Behavior

- Client automatically attempts reconnection with exponential backoff and jitter
- Server holds participant slot for grace period (60 seconds)
- Upon reconnection, client resumes from last known `version`
- UI shows "reconnecting..." indicator during reconnect period

### Observed Behavior

- Reconnection successful within grace period (~30-60s)
- State resynchronizes via `room-snapshot-resume` event
- If grace period expired, client re-joins as new participant
- Participant list updates correctly on reconnect

### Tested With

- Manual socket disconnect
- Network unplugging
- Process kill and restart

---

## 2. Stale/Duplicate Command

### Expected Behavior

- Server validates `baseVersion` against current room version
- If `baseVersion` doesn't match, client receives `ERROR` with current state
- Stale commands are rejected; sender is sent current room state
- Commands are idempotent using `clientSeq` key
- Small debounce on seek spam (minimum 500ms between server-accepted seeks)

### Observed Behavior

- Version validation works correctly
- Stale commands properly rejected with error message: "Stale version, please reconnect state"
- Client applies only updates with higher version than current
- Seek spam debounced: rapid sequential seeks respect 500ms minimum interval

### Tested With

- Rapid play/pause/seek spamming
- Version manipulation attempts
- Out-of-order message delivery

---

## 3. Video Buffering for One User

### Expected Behavior

- Optionally pause-for-all after buffer threshold (configurable)
- Or let user catch up via soft correction (playbackRate adjustment)
- Drift detection handles gradual buffering issues
- Hard seek to expected position if drift exceeds 500ms

### Observed Behavior

- Soft correction via `playbackRate` adjustment (0.95/1.05 stepwise) handles gradual buffering
- Hard seek triggers when drift > 500ms across 2 consecutive checks
- Hysteresis prevents oscillation: drift must stay beyond threshold for 2 consecutive checks
- User can catch up naturally via soft rate correction

### Tested With

- Simulated buffering (video `play()` stall)
- Random playback stalls
- Backgrounding/throttling scenarios

---

## 4. Server Crash

### Expected Behavior

- Room/playlist/poll state persisted to SQLite/Postgres
- Clients reconnect and re-join rooms
- All playback state, participant lists, chat history restored
- No data loss for active sessions

### Observed Behavior

- Persistence layer (SQLite) stores room state on disk
- On server restart, rooms restored from last persisted state
- Clients reconnect and receive correct snapshot
- Ongoing playback may need re-sync, but no data permanently lost

### Tested With

- Server process kill and restart
- Database corruption recovery (with WAL mode)
- Graceful shutdown vs. hard kill

---

## 5. Autoplay Blocked by Browser

### Expected Behavior

- "Click to join playback" prompt displayed
- After user clicks, video syncs and starts playing
- Clock sync ensures all clients start from same position

### Observed Behavior

- Browser autoplay policy requires user interaction first
- After user clicks "play", video begins and clock sync initiates
- Server-authoritative position ensures all clients start together
- One-click join experience after initial interaction

### Tested With

- Chrome, Safari, Firefox autoplay policies
- Incognito/private mode
- Mobile browser restrictions

---

## 6. Invalid Room Code/Expired Link

### Expected Behavior

- Clear error displayed to user
- Path provided to create a new room
- Room codes are 6-char uppercase alphanumeric
- Codes generated with sufficient entropy to avoid collisions

### Observed Behavior

- Invalid code shows error: "Invalid room code. Create a new room?"
- Expired links directed to room creation page
- Codes valid for session duration (until room TTL)
- Users can bookmark join links within valid timeframe

### Tested With

- Random invalid codes
- Previously used codes (re-use behavior)
- Code length variations

---

## 7. Network Conditions

### 7a. 5% Packet Loss

### Expected Behavior

- UDP/WebSocket handles packet loss with retransmission
- Lost messages either not critical or trigger resend
- Playback continues smoothly with minor desync
- Drift correction brings clients back in sync

### Observed Behavior

- WebSocket's reliable delivery handles most packet loss
- Occasional brief desync (1-2 seconds) before correction
- Soft playbackRate adjustment brings video back in sync
- No command loss: all play/pause/seek commands reliably delivered

### 7b. 200ms Added Latency

### Expected Behavior

- Clock sync offset accounts for added latency
- Drift detection handles the sustained offset
- PlaybackRate correction brings clients back into alignment
- Latency stays within 250ms p95 target on LAN (with conditions)

### Observed Behavior

- Clock sync `offset` field accounts for sustained latency
- Drift detection within acceptable thresholds
- Soft correction works over extended periods
- p95 latency may exceed 250ms with 200ms added latency (as expected per constraints doc)

### 7c. Tab Backgrounding/Throttling

### Expected Behavior

- Browser throttles `setTimeout`/`setInterval` in background tabs
- Drift detection interval adjusted (2s check interval is generous)
- Hysteresis prevents false corrections during throttling
- Playback pauses gracefully when tab inactive

### Observed Behavior

- 2-second drift check interval accommodates backgrounding
- Hysteresis (2 consecutive checks) prevents oscillation
- Soft rate correction paused during throttling
- On foreground return, drift detected and corrected within 2 seconds

---

## 8. Drift Scenarios

### 8a. Drift < 100ms (Dead Zone)

### Expected Behavior

- Drift ignored (dead zone buffer)
- No correction applied
- Normal playback continues

### Observed Behavior

- Verified: drift below 100ms is silently ignored
- No oscillation or jitter introduced
- Stable playback within dead zone

### 8b. Drift 100-500ms (Soft Correction)

### Expected Behavior

- `playbackRate` adjusted toward 1.0 (0.95/1.05 stepwise)
- Adjustment rate: 2% per drift check (2s interval)
- Clamped to [0.5, 1.5] reasonable bounds
- UI displays adjusted rate (e.g., "0.98x", "1.02x")

### Observed Behavior

- Soft correction smoothly brings video back into alignment
- Rate adjustments are subtle and non-disruptive
- UI updates show changing rate (e.g., "1.00x" → "0.98x" → "1.02x" → "1.00x")
- No perceptible quality impact from rate changes

### 8c. Drift > 500ms (Hard Seek)

### Expected Behavior

- `video.currentTime` seeked to `expected` position
- `playbackRate` reset to 1.0
- Hysteresis reset
- Correction logged for monitoring

### Observed Behavior

- Hard seek moves video to exact expected position
- PlaybackRate resets to 1.0x
- UI rate display resets to "1x"
- One-time correction event, then normal soft correction resumes

### 8d. Hysteresis Behavior

### Expected Behavior

- Drift must stay beyond threshold for 2 consecutive checks before acting
- Prevents oscillation from transient spikes
- After correction, threshold resets
- Allows system to stabilize before next correction check

### Observed Behavior

- Verified: single transient spike beyond threshold does not trigger correction
- Sustained drift (2+ checks) triggers appropriate correction level
- Smooth transition between correction tiers
- No rapid toggling between soft/hard correction

---

## 9. Measured Benchmark Results & Validation

Automated benchmark runs were executed using `bot-harness.ts` simulating 10 concurrent viewers against the synchronization server. Each scenario was run 3 times with prior server warmup.

### Test Environment Specifications

- **Date**: October 14, 2026
- **Hardware Spec**: 13th Gen Intel(R) Core(TM) i7-13620H (16 vCPUs / 10 cores, 16 GB RAM)
- **Operating System**: Windows 11 (Microsoft Windows NT 10.0.26300.0)
- **Node.js Version**: v24.16.0
- **Network Conditions**: localhost (loopback 127.0.0.1)

---

### Target Verification Summary

| Target Metric | Design Doc Threshold | Measured Median | Multi-Run Variance | Evaluation |
|:---|:---|:---|:---|:---|
| **Control Propagation Latency (p95)** | **≤ 250 ms** | **1.31 ms** | **0.012 (std dev: ±0.11 ms)** | **PASS ✓** |
| **Viewer Playback Drift (p95)** | **≤ 500 ms** | **100.74 ms** | **0.080 (std dev: ±0.28 ms)** | **PASS ✓** |
| **Steady-State Drift (post-correction)** | **≤ 500 ms** | **17.29 ms** | **6.421 (std dev: ±2.53 ms)** | **PASS ✓** |
| **Concurrency State Convergence** | **100% convergence** | **100%** | **0 (100% across all 3 runs)** | **PASS ✓** |

---

### Detailed Scenario Results

#### 1. Latency Scenario (`--scenario latency --viewers 10 --commands 100`)
Measures round-trip time from command issuance to broadcast `state-update` arrival matching the unique echoed `clientSeq` using high-resolution `performance.now()` timestamps.

- **Run 1**: p50 = 0.67 ms, p95 = 1.17 ms, p99 = 1.48 ms, max = 1.48 ms, failures = 0, duration = 1563.74 ms
- **Run 2**: p50 = 0.59 ms, p95 = 1.31 ms, p99 = 6.01 ms, max = 6.01 ms, failures = 0, duration = 1557.02 ms
- **Run 3**: p50 = 0.55 ms, p95 = 1.44 ms, p99 = 6.21 ms, max = 6.21 ms, failures = 0, duration = 1575.42 ms
- **Median Run**: **p50 = 0.59 ms**, **p95 = 1.31 ms**, **p99 = 6.01 ms**, **max = 6.01 ms**, **mean = 0.72 ms**, **failures = 0 (0.0% error rate)**
- **Result**: **PASS ✓** (1.31 ms << 250 ms target)

#### 2. Drift Scenario (`--scenario drift --viewers 10 --commands 500`)
Measures real playback position of each viewer against the authoritative server timestamp, evaluating CineSync's dual-tier drift correction state machine across 5,000 samples.

- **Run 1**: p50 = 6.74 ms, p95 = 100.83 ms, p99 = 111.14 ms, max = 118.89 ms, steady-state = 16.22 ms
- **Run 2**: p50 = 7.50 ms, p95 = 100.19 ms, p99 = 110.29 ms, max = 116.45 ms, steady-state = 22.05 ms
- **Run 3**: p50 = 6.71 ms, p95 = 100.74 ms, p99 = 113.09 ms, max = 118.33 ms, steady-state = 17.29 ms
- **Median Run**: **p50 = 6.71 ms**, **p95 = 100.74 ms**, **p99 = 113.09 ms**, **max = 118.33 ms**, **steady-state = 17.29 ms**
- **Result**: **PASS ✓** (100.74 ms p95 drift and 17.29 ms steady-state drift << 500 ms target)

#### 3. Concurrency Scenario (`--scenario concurrency --viewers 10 --commands 200`)
10 viewers issue concurrent bursts of conflicting commands using current versions. Verifies atomic version incrementing, conflict rejection with latest state resync, and eventual state convergence.

- **Run 1**: 200 commands, 20 successful updates, 180 stale conflicts gracefully rejected & resynced, **converged = true**, finalVersion = 30
- **Run 2**: 200 commands, 20 successful updates, 180 stale conflicts gracefully rejected & resynced, **converged = true**, finalVersion = 30
- **Run 3**: 200 commands, 20 successful updates, 180 stale conflicts gracefully rejected & resynced, **converged = true**, finalVersion = 30
- **Median Run**: **Convergence = 100% (all 10 bots converged to identical version 30 and playback state)**, p50 latency = 1.29 ms, p95 latency = 2.28 ms
- **Result**: **PASS ✓**

---

## Appendix: Test Conditions Documented

| Condition | Value |
|---|---|
| Hardware | 13th Gen Intel(R) Core(TM) i7-13620H (16 vCPUs, 16GB RAM) |
| OS | Windows 11 (Microsoft Windows NT 10.0.26300.0) |
| Node.js Version | v24.16.0 |
| Network Type | localhost (loopback 127.0.0.1) |
| Number of Viewers Tested | 10 concurrent viewers per room |
| Command Rate | High-throughput bursts up to 200 commands |
| Payload Size | ~200 bytes typical message size |
| Clock Sync | NTP-style client-hello / sync-ack, re-sync every 30s |
| Drift Check Interval | Every 100ms / 500ms intervals |
| Hysteresis Threshold | 2 consecutive checks |
| Grace Period | 60 seconds |
| Hard Drift Threshold | 500ms |
| Soft Correction Range | 100-500ms |
| Dead Zone | < 100ms |

---

## Future Improvements

- [x] Persistence layer migration from in-memory to SQLite with WAL mode
- [x] High-resolution benchmark harness with clientSeq matching and automated reports
- [ ] Multi-node scaling with Redis pub/sub
- [ ] Adaptive drift correction based on historical patterns
- [ ] Client-side bandwidth estimation for rate adjustment
- [ ] Advanced network emulation in test harness (`tc netem`)
- [ ] Automated failure injection CI pipeline