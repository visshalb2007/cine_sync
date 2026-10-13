import { Request, Response, NextFunction } from 'express'

export interface RateLimiterOptions {
  windowMs: number
  max: number
  message?: string
}

export function createIpRateLimiter(options: RateLimiterOptions) {
  const ipRequests = new Map<string, number[]>()

  // Periodically clean up stale records every 2 minutes
  const interval = setInterval(() => {
    const now = Date.now()
    for (const [ip, timestamps] of ipRequests.entries()) {
      const valid = timestamps.filter((t) => now - t < options.windowMs)
      if (valid.length === 0) ipRequests.delete(ip)
      else ipRequests.set(ip, valid)
    }
  }, 2 * 60 * 1000)

  if (typeof interval.unref === 'function') {
    interval.unref()
  }

  const limiter = (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1'

    const now = Date.now()
    const timestamps = (ipRequests.get(ip) || []).filter((t) => now - t < options.windowMs)

    if (timestamps.length >= options.max) {
      res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000))
      return res.status(429).json({
        error: options.message || 'Too many requests, please try again later',
      })
    }

    timestamps.push(now)
    ipRequests.set(ip, timestamps)

    res.setHeader('X-RateLimit-Limit', options.max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - timestamps.length))

    next()
  }

  // Helper method for resetting state in tests
  limiter.reset = () => {
    ipRequests.clear()
  }

  return limiter
}
