import Redis from 'ioredis'

// Only create Redis client if REDIS_URL is provided
// This prevents connection errors in local/serverless environments
const redisUrl = process.env.REDIS_URL

export const redis = redisUrl
  ? new Redis(redisUrl, {
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
    })
  : null

if (redis) {
  redis.on('connect', () => console.log('Redis connected'))
  redis.on('error', (err) => console.error('Redis error', err))
  redis.on('reconnecting', () => console.log('Redis reconnecting...'))
} else {
  console.log('Redis: No REDIS_URL configured - running without Redis')
}

// Helper function to safely use redis
export const getRedis = () => redis
