import type { Request, Response, NextFunction } from 'express'

interface RateLimitConfig {
  windowMs: number    // Time window in milliseconds
  maxRequests: number // Max requests per window
  message?: string
}

interface TokenBucketConfig {
  capacity: number        // Max tokens
  refillRate: number      // Tokens added per second
  tokensPerRequest: number
  message?: string
}

interface RateLimiterInstance {
  middleware: () => (req: Request, res: Response, next: NextFunction) => void
  reset: () => void
}

// Simple in-memory sliding window rate limiter
export function createRateLimiter(config: RateLimitConfig): RateLimiterInstance {
  const requests = new Map<string, number[]>()

  function cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of requests) {
      const valid = timestamps.filter(t => now - t < config.windowMs)
      if (valid.length === 0) {
        requests.delete(key)
      } else {
        requests.set(key, valid)
      }
    }
  }

  // Cleanup every minute
  const interval = setInterval(cleanup, 60_000)
  interval.unref?.()

  return {
    middleware() {
      return (req: Request, res: Response, next: NextFunction) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown'
        const now = Date.now()
        const timestamps = (requests.get(key) || []).filter(t => now - t < config.windowMs)

        if (timestamps.length >= config.maxRequests) {
          const retryAfter = Math.ceil((timestamps[0] + config.windowMs - now) / 1000)
          res.set('Retry-After', String(retryAfter))
          res.status(429).json({
            error: config.message || 'Too many requests',
            retryAfter
          })
          return
        }

        timestamps.push(now)
        requests.set(key, timestamps)
        next()
      }
    },
    reset() {
      requests.clear()
    }
  }
}

// Token bucket rate limiter (for burst-friendly endpoints)
export function createTokenBucketLimiter(config: TokenBucketConfig): RateLimiterInstance {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>()

  return {
    middleware() {
      return (req: Request, res: Response, next: NextFunction) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown'
        const now = Date.now()
        let bucket = buckets.get(key)

        if (!bucket) {
          bucket = { tokens: config.capacity, lastRefill: now }
          buckets.set(key, bucket)
        }

        // Refill tokens
        const elapsed = (now - bucket.lastRefill) / 1000
        bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsed * config.refillRate)
        bucket.lastRefill = now

        if (bucket.tokens < config.tokensPerRequest) {
          const waitTime = Math.ceil((config.tokensPerRequest - bucket.tokens) / config.refillRate)
          res.set('Retry-After', String(waitTime))
          res.status(429).json({
            error: config.message || 'Too many requests',
            retryAfter: waitTime
          })
          return
        }

        bucket.tokens -= config.tokensPerRequest
        next()
      }
    },
    reset() {
      buckets.clear()
    }
  }
}

// Preset configurations
export const presets = {
  // General: 200 requests per minute
  general: {
    windowMs: 60_000,
    maxRequests: 200,
    message: 'Too many requests, please try again later'
  } as RateLimitConfig,

  // API: 100 requests per minute
  api: {
    windowMs: 60_000,
    maxRequests: 100,
    message: 'API rate limit exceeded'
  } as RateLimitConfig,

  // Strict (auth): 20 requests per minute
  strict: {
    windowMs: 60_000,
    maxRequests: 20,
    message: 'Too many authentication attempts, please wait'
  } as RateLimitConfig,
}
