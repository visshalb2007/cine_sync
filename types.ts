export interface BotConfig {
  name: string
  roomCode: string
  numViewers: number
  commandsPerViewer: number
  scenario: 'latency' | 'drift' | 'concurrency'
  thinkTimeMs?: number
  packetLoss?: number
  addedLatencyMs?: number
}

export interface CommandRecord {
  command: 'PLAY' | 'PAUSE' | 'SEEK' | 'CHANGE_VIDEO'
  tSend: number
  tRecv?: number
  positionMs?: number
  baseVersion?: number
  clientSeq: number
  viewerId: string
}

export interface LatencyStats {
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
  min: number
  count: number
}