# CineSync: Watch Party Application

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-black.svg)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL--Mode-003B57.svg)](https://www.sqlite.org/)
[![Tests](https://img.shields.io/badge/Tests-59%20Passing-brightgreen.svg)]()

CineSync is a synchronized watch-party platform with server-authoritative playback, low-latency WebSocket synchronization, movie discovery, SQLite persistence, and multi-viewer host management.

---

## Architecture

```
Browser Clients ⇄ WebSocket Gateway ⇄ Room Manager (one state machine per room)
                                        ├─ Playback Service (timeline sync & drift correction)
                                        ├─ Host Management (single-host invariant & auto-transfer)
                                        ├─ Chat & Emoji Reactions (rate-limited)
                                        ├─ Shared Playlist & Interactive Polls
                                        └─ SQLite Persistence (WAL mode, debounced snapshots)
REST Gateway ⇄ Movie Discovery (/api/search, /api/genres, /api/movies)
               ├─ TMDB API Client (with in-memory LRU/TTL cache)
               └─ OMDb Fallback Client
```

---

## Key Features

### 1. Synchronized Playback & Clock Sync
- **Server-Authoritative Room State**: A single source of truth managing versioned room state mutations (`room.version++`).
- **Timeline-Based Calculation**: `expected = positionMs + (serverNow - serverTimestampMs) × rate`.
- **NTP-Style Clock Synchronization**: Offset computation with periodic 30s resynchronization heartbeats.
- **Dual-Tier Drift Correction**:
  - **Dead zone (< 100 ms)**: No correction needed.
  - **Soft correction (100–500 ms)**: Seamless stepwise playback rate adjustment (`0.95x` / `1.05x`).
  - **Hard seek (> 500 ms)**: Two consecutive checks trigger a hard seek to authoritative position.

### 2. Host Management & Transfer Invariants
- **Earliest Participant Rule on Disconnect**: When the host leaves/disconnects, host controls automatically and immediately transfer to the earliest connected participant (smallest `joinedAt` timestamp).
- **Strict Single-Host Invariant**: Exactly one participant holds the host status and host badge at any given time.
- **Manual Host Transfer with Confirmation**: The current host can transfer host controls to any connected participant, protected by an explicit confirmation prompt.
- **Usurpation Prevention**: Disconnected former hosts rejoining within or after the grace period reconnect as standard participants without overriding the newly elected host.

### 3. Movie Discovery & Shared Playlist
- **Dual-Provider Discovery**: Integrated TMDB and OMDb APIs with normalized data models and automated OMDb fallback.
- **Caching & Rate Limiting**: 10-minute in-memory LRU/TTL cache and 60 req/min IP-based rate limiting.
- **Client-Side Discovery UI**: Search input with 300ms debounce, Fuse.js fuzzy re-ranking, genre filtering, year filtering, and responsive poster grid.
- **One-Click Playlist Integration**: Instant addition to the room's shared playlist via synchronized WebSocket events.

### 4. Zero Data-Loss SQLite Persistence
- **better-sqlite3 with WAL Mode**: Crash-resilient persistence with migration versioning.
- **Relational Schema**: Normalized tables for `rooms`, `participants`, `playback_state`, `playlist`, `polls`, `poll_options`, `poll_votes`, and `chat_messages`.
- **Debounced Snapshots**: Background dirty-room flushing debounced to prevent event loop blocking, with a 5-second dirty snapshot timer.
- **Graceful Shutdown**: Synchronous dirty room flush on `SIGINT` / `SIGTERM`.
- **Boot Recovery**: Restores versions, recalculates elapsed positions for playing rooms, and initiates reconnect grace periods for disconnected participants.
- **TTL Room Cleanup**: Automated hourly cleanup for rooms inactive beyond `ROOM_TTL_HOURS` (default 24h).

### 5. Social & Interactive Features
- **Live Chat**: Real-time room chat with server timestamps, HTML sanitization, and history capped at the last 500 messages.
- **Emoji Reactions**: Floating reaction animations with rate limiting (3 reactions per 15s per user).
- **Interactive Group Polls**: Real-time multi-option voting with optional auto-add of the winning video to the playlist upon closure.

---

## Performance & Benchmark Results

High-resolution benchmark verification using `bot-harness.ts` simulating 10 concurrent viewers against the synchronization server across 3 runs with prior warmup:

**Environment**: 13th Gen Intel(R) Core(TM) i7-13620H (16 vCPUs, 16 GB RAM) | Windows 11 | Node v24.16.0 | Localhost

| Objective | Target Threshold | Measured Median | Multi-Run Variance | Status |
|:---|:---|:---|:---|:---|
| **Control Propagation Latency (p95)** | **≤ 250 ms** | **1.31 ms** | **0.012 (std dev: ±0.11 ms)** | **PASS ✓** |
| **Viewer Playback Drift (p95)** | **≤ 500 ms** | **100.74 ms** | **0.080 (std dev: ±0.28 ms)** | **PASS ✓** |
| **Steady-State Drift (post-correction)** | **≤ 500 ms** | **17.29 ms** | **6.421 (std dev: ±2.53 ms)** | **PASS ✓** |
| **Concurrency State Convergence** | **100% convergence** | **100%** | **0 (100% across all runs)** | **PASS ✓** |

Detailed reports available in [`performance-report.md`](performance-report.md), [`performance-report.html`](performance-report.html), and [`FAILURE_HANDLING.md`](FAILURE_HANDLING.md).

---

## Getting Started

### Prerequisites
- Node.js v20+
- npm or yarn

### Environment Setup
Create a `.env` file in the root directory:
```env
PORT=3000
DB_PATH=./cine_sync.db
ROOM_TTL_HOURS=24
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here
```

### Installation & Run

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start development server (auto-reloads on file change)
npm run dev

# Start production server
npm start
```
The application will be accessible at `http://localhost:3000`.

---

## Testing & Benchmarks

### Unit Tests
Run the Vitest unit test suite (59 passing tests across 5 suites):
```bash
npm run test:unit
```

### Running Benchmarks
Run high-resolution multi-viewer benchmarks via CLI:
```bash
# 1. Latency Benchmark (10 viewers, 100 commands, 3 runs)
npm run test:bench -- --scenario latency --viewers 10 --commands 100

# 2. Playback Drift Benchmark (10 viewers, 500 checks, 3 runs)
npm run test:bench -- --scenario drift --viewers 10 --commands 500

# 3. Concurrency & Convergence Benchmark (10 viewers, 200 commands, 3 runs)
npm run test:bench -- --scenario concurrency --viewers 10 --commands 200

# Run all scenarios sequentially and save raw JSON to benchmarks/results/
npm run test:bench -- --all
```

### Generating Performance Reports
Generate HTML and Markdown reports from benchmark results:
```bash
npx tsx performance-report.ts
```
Outputs:
- `performance-report.html`
- `performance-report.md`

---

## Failure Handling

Refer to [`FAILURE_HANDLING.md`](FAILURE_HANDLING.md) for documentation on:
- Socket drop & reconnection grace periods
- Stale and duplicate command rejection
- Video buffering and drift recovery
- Server crash recovery with SQLite WAL mode
- Multi-run benchmark stability and variance analysis

---

## License

ISC License