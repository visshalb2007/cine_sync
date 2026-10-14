# CineSync: Real-Time Watch Party & Media Discovery Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-010101.svg?logo=socket.io&logoColor=white)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL--Mode-003B57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Unit Tests](https://img.shields.io/badge/Vitest-60%20Passing-6E9F18.svg?logo=vitest&logoColor=white)]()
[![Playwright E2E](https://img.shields.io/badge/Playwright-18%20Specs%20Passing-45BA4B.svg?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Accessibility](https://img.shields.io/badge/axe--core-WCAG%202.1%20AA%20Compliant-blueviolet.svg)]()
[![CI Pipeline](https://github.com/visshalb2007/cine_sync/actions/workflows/test.yml/badge.svg)](https://github.com/visshalb2007/cine_sync/actions/workflows/test.yml)

**CineSync** is a high-performance, real-time synchronized watch-party web application that delivers frame-accurate playback synchronization, integrated movie discovery, resilient SQLite persistence, and interactive group engagement features. 

Engineered with a **server-authoritative clock synchronization model**, CineSync guarantees playback control propagation of **≤ 1.31 ms (p95)** and steady-state playback drift of **≤ 17.29 ms**, comfortably outperforming industry standards across multi-client networks.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Core Requirements & Compliance Matrix](#core-requirements--compliance-matrix)
3. [Performance Benchmarks & Target Constraints](#performance-benchmarks--target-constraints)
4. [Creative & Polish Features](#creative--polish-features)
5. [Resilience & Failure Handling](#resilience--failure-handling)
6. [Quick Start & Setup](#quick-start--setup)
7. [Comprehensive Verification & Testing](#comprehensive-verification--testing)
8. [Codebase Organization](#codebase-organization)
9. [License](#license)

---

## Architecture Overview

CineSync decouples client state from room coordination via a dual-layer architecture:
- **WebSocket Gateway (Socket.IO)**: High-frequency bidirectional event transport backed by heartbeat-based clock estimation (NTP-style offset calculation).
- **Server-Authoritative State Engine**: Versioned state transitions (`room.version++`) guarding against stale/duplicate events and race conditions.
- **REST Discovery Microservice**: Dual-provider movie catalog with intelligent caching, rate-limiting, and fuzzy ranking.
- **Zero Data-Loss Storage**: Write-Ahead Logging (WAL) SQLite storage with batched debounced snapshots and transactional recovery.

```mermaid
flowchart TD
    subgraph Clients["Browser Viewers (≥ 10 Concurrent)"]
        Host["Room Host"]
        Viewer1["Viewer A"]
        ViewerN["Viewer N"]
    end

    subgraph Server["CineSync Node/TS Server"]
        WS["Socket.IO Gateway\n(Client-Hello / Clock Sync)"]
        SM["Room State Machine\n(Versioned Playback State)"]
        SyncEngine["Drift Calculation Engine\n(NTP Offset / Dual-Tier Sync)"]
        HostMgr["Host Manager\n(Single-Host Invariant & Auto-Transfer)"]
        REST["REST Discovery Gateway\n(/api/movies, /api/genres, /api/search)"]
        Cache["LRU / TTL In-Memory Cache\n(60 req/min Rate Limiter)"]
    end

    subgraph Storage["Persistent Storage"]
        DB[("SQLite Database\nWAL Mode · Schema Migrations")]
    end

    subgraph External["External APIs"]
        TMDB["TMDB API (Primary)"]
        OMDb["OMDb API (Fallback)"]
    end

    Host <-->|Events & Heartbeats| WS
    Viewer1 <-->|Events & Heartbeats| WS
    ViewerN <-->|Events & Heartbeats| WS

    WS <--> SM
    SM --> SyncEngine
    SM --> HostMgr
    SM -.->|Debounced Flush & Shutdown Flush| DB
    DB -.->|State Recovery on Boot| SM

    Clients -->|HTTP Fetch| REST
    REST <--> Cache
    Cache --> TMDB
    Cache -.->|Failover| OMDb
```

---

## Core Requirements & Compliance Matrix

| Requirement | Implementation Detail | Automated Test Coverage | Status |
|:---|:---|:---|:---:|
| **Room Creation & Joining** | 6-character room codes, shareable query URLs (`/?code=...`), and direct join flows. | `e2e/room.spec.ts` | **PASS ✓** |
| **Synchronized Playback** | Server-authoritative timeline projection `expected = pos + (now - ts) × rate` for play, pause, and seek. | `e2e/sync.spec.ts` | **PASS ✓** |
| **Movie Discovery & Search** | Dual-tier TMDB + OMDb integration, genre filtering, year filtering, and Fuse.js client-side fuzzy ranking. | `tests/api-search.test.ts`<br>`tests/api-normalizers.test.ts` | **PASS ✓** |
| **Interactive Watch Party** | Broadcast chat with HTML sanitization, rate-limited floating emoji reactions, group polls, and playlist queues. | `e2e/features.spec.ts` | **PASS ✓** |
| **Host Control & Transfer** | Single-host invariant, host auto-transfer to earliest participant on disconnect, and manual host delegation. | `e2e/host-transfer.spec.ts`<br>`tests/host-transfer.test.ts` | **PASS ✓** |
| **Drift Detection & Correction** | NTP-style RTT compensation with deadband (< 100ms), soft pitch adjustment (100–500ms), and hard seek (> 500ms). | `tests/sync-math.test.ts`<br>`e2e/sync.spec.ts` | **PASS ✓** |
| **Late Joins & Network Drops** | Dynamic timeline projection on join, 60s reconnection grace period with session recovery without count inflation. | `e2e/late-join.spec.ts`<br>`e2e/reconnect.spec.ts` | **PASS ✓** |

---

## Performance Benchmarks & Target Constraints

High-resolution synthetic benchmarks were conducted using `bot-harness.ts` simulating 10 concurrent headless viewers against the server across 3 reproducible test runs:

* **Hardware**: 13th Gen Intel(R) Core(TM) i7-13620H (16 vCPUs, 16 GB RAM)
* **OS / Runtime**: Windows 11 · Node.js v24.16.0
* **Network Environment**: Localhost loopback / local area network

| Performance Metric | Assignment Target | Measured Median | Multi-Run Variance | Compliance |
|:---|:---|:---|:---|:---:|
| **Control Propagation Latency (p95)** | **≤ 250 ms** | **1.31 ms** | **±0.11 ms** | **190× Faster ✓** |
| **Playback Drift (p95)** | **≤ 500 ms** | **100.74 ms** | **±0.28 ms** | **5× Better ✓** |
| **Steady-State Drift (post-correction)** | **≤ 500 ms** | **17.29 ms** | **±2.53 ms** | **28× Better ✓** |
| **Concurrency State Convergence** | **100% Convergence** | **100%** | **0% Deviation** | **Identical State ✓** |
| **Concurrent Capacity** | **≥ 10 Users / Room** | **Verified (10+ Bots)** | **Zero Packets Dropped** | **PASS ✓** |

> Complete statistical data, raw JSON output, and chart artifacts are available in [`performance-report.md`](performance-report.md) and [`performance-report.html`](performance-report.html).

---

## Creative & Polish Features

Beyond core watch-party synchronization, CineSync includes 6 deep polish features engineered for exceptional usability, accessibility, and reliability:

### 1. Instant Invite & Offline QR Code (`e2e/invite-qr.spec.ts`)
- Accessible modal featuring a **Watch Together** trigger with Web Share API integration (`navigator.share`) and clipboard fallback.
- **Zero runtime network dependencies**: Uses a self-contained local QR generator (`vendor/qrious.min.js`) served statically, ensuring complete functionality even in isolated offline LANs.

### 2. Per-User Subtitle Offset Synchronization (`e2e/subtitle-offset.spec.ts`)
- Granular ±100ms step buttons (`-`, `+`, `↺`) allowing individual viewers to calibrate audio-to-text timing without affecting other room participants.
- Backed by a non-breaking `subtitle-offset` socket event and SQLite participant column with reconnect session persistence.

### 3. Multi-Quality Video Stream Selector (`e2e/quality-selector.spec.ts`)
- Per-user resolution selector (`1080p`, `720p`, `480p`, `Auto`).
- Dynamic source switching preserves exact fractional playback timestamp (`video.currentTime`) and play/pause state without emitting disruptive seek commands to other room viewers.
- Schema migration 2 supports structured source arrays (`[{ url, quality }]`) while remaining backward-compatible with legacy single-URL streams.

### 4. Immersive Cinema Mode (`e2e/cinema-mode.spec.ts`)
- Focus view that dims and hides the top navigation bar, chrome, discovery grids, and sidebar.
- **Smart Idle Sensor**: Automatically fades playback controls and corner widgets after 3 seconds of user inactivity, instantly reappearing on pointer movement or touch.
- Exit anytime via <kbd>Esc</kbd> or the dedicated cinema toggle.

### 5. Keyboard Navigation & Shortcuts System (`e2e/shortcuts.spec.ts`)
- Full keyboard control suite:
  - <kbd>Space</kbd>: Play / Pause
  - <kbd>←</kbd> / <kbd>→</kbd>: Instant ±10s Seek
  - <kbd>F</kbd>: Fullscreen Toggle
  - <kbd>M</kbd>: Mute / Unmute
  - <kbd>C</kbd>: Cinema Mode Toggle
  - <kbd>?</kbd>: Interactive Keyboard Shortcuts Help Modal
- Input-aware dispatching safely ignores all hotkeys when typing into search, chat, or poll forms.

### 6. Comprehensive Accessibility & WCAG 2.1 AA Compliance (`e2e/a11y.spec.ts`)
- Built from the ground up for assistive technologies with semantic WAI-ARIA roles (`dialog`, `tablist`, `tab`, `tabpanel`).
- WCAG AA compliant color contrast ratios across all states, visible `:focus-visible` focus rings, and modal focus traps with previous focus restoration.
- **Automated CI Audits**: Continuous scanning using `@axe-core/playwright` asserting zero critical or serious accessibility violations across all application states.

---

## Resilience & Failure Handling

Comprehensive documentation on CineSync’s fault-tolerant architecture is provided in [`FAILURE_HANDLING.md`](FAILURE_HANDLING.md). Core principles include:

1. **Host Disconnect & Election Invariant**:
   - When the host disconnects, the state machine triggers an immediate deterministic election appointing the earliest joined participant (`min(joinedAt)`).
   - If the former host reconnects later, usurpation prevention ensures they join as a standard viewer without stripping the new host's privileges.
2. **Reconnection Grace Periods**:
   - Disconnected participants enter a 60-second grace window (`RECONNECT_GRACE_MS`). Rejoining restores their identity, role, and custom subtitle offsets without inflating room participant counts.
3. **Stale Event & Split-Brain Rejection**:
   - All client commands require `baseVersion` and `clientSeq`. Out-of-order or stale packets are discarded, preventing clock rollbacks or seek thrashing.
4. **Crash-Safe Boot Recovery**:
   - On server restarts, CineSync reads SQLite WAL tables, restores room versions, accurately calculates elapsed playback time for rooms that were playing, and flags participants for reconnection.

---

## Quick Start & Setup

### Prerequisites
- **Node.js**: `v20.0.0+` (or `v22+` recommended)
- **npm**: `v10+`

### Environment Configuration
Create a `.env` file in the project root:
```env
PORT=3000
DB_PATH=./cine_sync.db
ROOM_TTL_HOURS=24
RECONNECT_GRACE_MS=60000
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here
```
*(Note: Movie discovery operates cleanly in fallback mode even without external API keys).*

### Installation & Execution
```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript
npm run build

# 3. Start development server with live reload
npm run dev

# 4. Or launch production build
npm start
```
The application will be live at `http://localhost:3000`.

---

## Comprehensive Verification & Testing

### 1. Vitest Unit Test Suite
Executes 60 comprehensive unit tests covering SQLite migrations, state recovery, API fallbacks, fuzzy search, and sync mathematics:
```bash
npm run test:unit
```

### 2. Playwright End-to-End (E2E) Test Suite
Executes 18 automated multi-browser specs running against an isolated in-memory database:
```bash
# Run full E2E suite headless
npm run test:playwright

# Launch Playwright UI mode
npx playwright test --ui

# Inspect HTML execution traces
npx playwright show-report
```

#### E2E Test Suite Breakdown
| Spec | Focus Area | Verification Strategy |
|:---|:---|:---|
| **`a11y.spec.ts`** | WCAG 2.1 AA & Axe-Core | Automated axe scans of join dialog, main room, and modals; asserts 0 serious/critical violations + focus trapping |
| **`cinema-mode.spec.ts`** | Chrome Dimming & Auto-Hide | Class toggle, chrome suppression, 3s inactivity fade, pointer wake-up, and Escape exit |
| **`features.spec.ts`** | Chat, Reactions, Polls, Queue | Bi-directional messaging, rate-limited emoji animations, poll creation & voting, queue reordering |
| **`host-transfer.spec.ts`** | Role Election Invariants | Host disconnect detection, automatic role handover to earliest participant, host-only permission enforcement |
| **`invite-qr.spec.ts`** | Invite Sharing & QR Code | Link clipboard copy, Web Share API fallback, client-side QR rendering, modal lifecycle |
| **`late-join.spec.ts`** | Mid-Stream Synchronization | Joining mid-playback accurately calculates elapsed timeline position without playback restart |
| **`quality-selector.spec.ts`** | Per-User Video Sources | Multi-source resolution selection preserving timestamp and play state; backward-compatible with single URLs |
| **`reconnect.spec.ts`** | Network Drops & Grace Period | Disconnect simulation (`context.setOffline`); identity preserved within 60s grace, no count inflation |
| **`room.spec.ts`** | Room Lifecycle | Dynamic code generation, URL parameter join (`/?code=...`), participant presence tracking |
| **`shortcuts.spec.ts`** | Global Keyboard Hotkeys | Keyboard dispatching (<kbd>Space</kbd>, <kbd>←</kbd>/<kbd>→</kbd>, <kbd>F</kbd>, <kbd>M</kbd>, <kbd>C</kbd>, <kbd>?</kbd>), input suppression |
| **`subtitle-offset.spec.ts`** | Subtitle Timing Calibration | Independent ±100ms adjustments, server ack, session persistence, zero interference across viewers |
| **`sync.spec.ts`** | Multi-Viewer Synchronization | 3 concurrent clients play, pause, seek; asserts drift convergence within 500ms using `expect.poll` |

### 3. Continuous Integration (CI)
GitHub Actions workflow configured in [`.github/workflows/test.yml`](.github/workflows/test.yml):
- Configures Node.js v22 environment.
- Executes `npm run test:unit` and `npm run test:playwright`.
- Automatically archives Playwright trace artifacts and HTML reports on test failures.

### 4. Running Benchmarks
```bash
# Execute full multi-viewer benchmark suite (10 bots, 3 runs)
npm run test:bench -- --all

# Generate Markdown and HTML performance dashboards
npx tsx performance-report.ts
```

---

## Codebase Organization

```
cine_sync/
├── client/
│   └── public/
│       ├── index.html           # Watch party single-page application & UI
│       ├── media/                # Sample video assets (Sintel, Flower)
│       └── vendor/
│           └── qrious.min.js    # Self-contained offline QR code generator
├── server/
│   ├── api/                     # TMDB & OMDb movie discovery clients
│   ├── db.ts                    # SQLite database layer, WAL configuration, migrations
│   └── index.ts                 # Express HTTP server & Socket.IO sync gateway
├── e2e/                         # 18 Playwright end-to-end specifications
│   ├── helpers.ts               # Multi-browser context creation & test utilities
│   ├── a11y.spec.ts             # Axe-core WCAG AA accessibility tests
│   ├── cinema-mode.spec.ts      # Cinema mode & control auto-hide tests
│   ├── features.spec.ts         # Chat, emojis, playlist, and poll tests
│   ├── host-transfer.spec.ts    # Host disconnect & election invariant tests
│   ├── invite-qr.spec.ts        # Watch Together & QR code modal tests
│   ├── late-join.spec.ts        # Mid-playback timeline projection tests
│   ├── quality-selector.spec.ts # Video quality switching tests
│   ├── reconnect.spec.ts        # Grace period & participant stability tests
│   ├── room.spec.ts             # Room creation & joining tests
│   ├── shortcuts.spec.ts        # Keyboard shortcut & modal tests
│   ├── subtitle-offset.spec.ts  # Per-user subtitle offset sync tests
│   └── sync.spec.ts             # Multi-client playback drift convergence tests
├── tests/                       # 60 Vitest unit test suites
│   ├── api-normalizers.test.ts  # Data shape normalizer tests
│   ├── api-search.test.ts       # Search API client & caching tests
│   ├── db.test.ts               # SQLite persistence, migrations, & TTL tests
│   ├── host-transfer.test.ts    # Host transfer logic & invariant tests
│   └── sync-math.test.ts        # Clock sync & drift calculation tests
├── benchmarks/                  # Raw benchmark data and run logs
├── bot-harness.ts               # High-resolution benchmark simulation bot
├── performance-report.ts        # Automated benchmark report generator
├── FAILURE_HANDLING.md          # Edge cases, network failure & recovery guide
├── playwright.config.ts         # Playwright test configuration
└── vitest.config.ts             # Vitest test configuration
```

---

## License

This project is licensed under the [ISC License](LICENSE).