export interface BotConfig {
  name: string
  roomCode: string
  numViewers: number
  commandsPerViewer: number
  scenario: 'latency' | 'drift' | 'concurrency' | 'all'
  commands?: number
  runs?: number
  thinkTimeMs?: number
  packetLoss?: number
  addedLatencyMs?: number
}

export interface CommandRecord {
  command: 'PLAY' | 'PAUSE' | 'SEEK' | 'CHANGE_VIDEO' | 'SET_RATE'
  tSend: number
  tRecv?: number
  positionMs?: number
  baseVersion?: number
  clientSeq: number
  viewerId: string
  error?: string
}

export interface LatencyStats {
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
  min: number
  count: number
  failures?: number
  errorRate?: number
}

export interface DriftStats {
  p50: number
  p95: number
  p99: number
  max: number
  min: number
  mean: number
  count: number
  maxBeforeCorrection: number
  steadyState: number
}

export interface ConcurrencyStats {
  totalCommands: number
  successful: number
  conflictsRejected: number
  converged: boolean
  finalVersion: number
  p50: number
  p95: number
  max: number
}