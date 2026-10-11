# CineSync: Watch Party Application

## Overview

CineSync is a real-time watch party application that allows multiple users to synchronously watch videos together. Server-authoritative room state ensures consistent playback across all clients, with WebSocket-based low-latency communication for control propagation.

## Architecture

```
Browser clients ⇄ WebSocket gateway ⇄ Room Manager (one state machine per room)
                                        ├─ Playback service
                                        ├─ Chat / reactions
                                        ├─ Playlist / polls
                                        └─ Persistence (rooms, playlists, polls)
REST: /rooms, /movies, /search
REST handles room creation, movie browsing, and search.
WebSocket handles everything real-time.
```

## Features

### Core Features

- **Room Creation & Join**: Create rooms with 6-char codes, join by code or invitation link
- **Playback Control**: Play/pause/seek with server-authoritative state
- **Clock Sync**: NTP-style offset measurement with 30s re-sync heartbeat
- **Drift Correction**: Three-tier system (dead zone <100ms, soft correction 100-500ms, hard seek >500ms)
- **Reconnection**: Exponential backoff with jitter, 60s grace period, host auto-transfer
- **Host Transfer**: Manual and automatic host transfer on disconnect

### Social Features

- **Shared Playlist**: Add/remove/reorder videos, auto-advance on end
- **Live Chat**: Server-timestamped, sanitized, rate-limited
- **Emoji Reactions**: Rate-limited (3 per 15s per user), floating animations
- **Group Polls**: Create votes, one vote per user, close by timer or manually, optional add-winner-to-playlist

### Sync Design

- **Server-authoritative room state**: One source of truth for concurrency, late joins, reconnects
- **Playback as timeline**: `expected = positionMs + (serverNow - serverTimestampMs) × rate` while playing
- **Commands**: `PLAY`, `PAUSE`, `SEEK(t)`, `CHANGE_VIDEO` with `clientSeq` and `baseVersion`
- **Drift detection**: Every 1-2s, compare actual `currentTime` to `expected`, apply correction based on magnitude

## Getting Started

### Prerequisites

- Node.js v20+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/visshalb2007/cine_sync.git
cd cine_sync

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server
npm run dev

# Open client
# Open client/public/index.html in a browser
```

### Running

```bash
# Development mode (auto-reload)
npm run dev

# Production build
npm run build
# Then: node dist/server/index.js
```

## Stages Completed

| Stage | Feature |
|-------|---------|
| 1 | Repo setup, TypeScript config, server skeleton with WebSocket gateway |
| 2 | Clock sync (NTP-style offset, 30s re-sync heartbeats) |
| 3 | PlaybackState timeline type and STATE_UPDATE broadcasts |
| 4 | Play/Pause commands with baseVersion validation |
| 5 | Seek with timeline position reconciliation |
| 6 | Late join snapshot (playback state, playlist, chat, participants) |
| 7 | Drift detection & correction (hysteresis, 3-tier thresholds) |
| 8 | Reconnection (exponential backoff, session tokens, grace period) |
| 9 | Host transfer logic (auto-transfer on host leave) |
| 10 | Emoji reactions with rate limiting |
| 11 | Shared playlist (add/remove/reorder with versioned updates) |
| 12 | Group polls (create/vote/close, optional add winner to playlist) |
| 13 | E2E test infrastructure (Playwright, bot harness) |
| 14 | Unit tests for sync math and drift state machine |
| 15 | Integration tests for room lifecycle and concurrency |
| 16 | Performance benchmark harness (p50/p95/p99 statistics) |
| 17 | Failure scenario testing (netem, disconnects, concurrent actions) |
| 18 | Performance report generation (latency tables, drift results) |
| 19 | Failure-handling document (all scenarios vs observed behavior) |

## Test Infrastructure

### Unit Tests

- `tests/sync-math.test.ts`: Expected position calculation, drift thresholds, latency statistics
- Tests core synchronization formulas and hysteresis logic

### Integration Tests

- `tests/int-test.ts`: Room lifecycle, late join, concurrent commands, host transfer, reconnection
- Tests end-to-end room flows with multiple browser contexts

### Failure Scenario Tests

- `tests/failure-test.ts`: Network faults, disconnects, browser throttling, concurrent actions, server scenarios
- Tests resilience to various fault conditions

### Performance Benchmark

- `bot-harness.ts`: Command sending with timing measurement
- Reports p50/p95/p99/max latency over configurable command counts
- Compares against design targets (p95 ≤ 250ms LAN, drift ≤ 500ms)

### Performance Reports

- `performance-report.ts`: Generates HTML/Markdown reports from benchmark output
- Includes latency tables, drift results, test conditions documentation

## Performance Targets

| Metric | Target | Description |
|--------|--------|-------------|
| Control propagation p95 (LAN) | ≤250 ms | Low-latency bidirectional WebSocket |
| Post-correction drift | ≤500 ms | After drift correction algorithm |
| Command rate | ≥10 users per room | Load-tested at 10, 25, 50 users |
| Drift check interval | 2 seconds | Balanced responsiveness vs. CPU |
| Hysteresis checks | 2 consecutive | Prevents oscillation |

## Failure Scenarios Documented

See `FAILURE_HANDLING.md` for complete list of failure scenarios, expected behaviors, and observed results during testing.

## License

ISC License

## Acknowledgments

- Design document and spec provided by user
- TypeScript + Node.js + Socket.IO stack
- Inspiration from real-time collaboration tools