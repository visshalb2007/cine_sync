interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * In-memory LRU/TTL cache.
 * - TTL defaults to 10 minutes (600,000 ms).
 * - Evicts least-recently-used entry when maxSize is reached.
 */
export class SimpleCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  private ttlMs: number
  private maxSize: number

  constructor(ttlMs: number = 10 * 60 * 1000, maxSize: number = 500) {
    this.ttlMs = ttlMs
    this.maxSize = maxSize
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    // Refresh LRU position by re-inserting at tail of Map iteration order
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, customTtlMs?: number): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey)
      }
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + (customTtlMs ?? this.ttlMs),
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
