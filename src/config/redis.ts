import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  maxRetriesPerRequest: 3,
})

redis.on('connect', () => console.log('Redis connected'))
redis.on('error', (err) => console.error('Redis error', err))
redis.on('reconnecting', () => console.log('Redis reconnecting...'))
