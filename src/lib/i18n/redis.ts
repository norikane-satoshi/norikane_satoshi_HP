import 'server-only'
import { Redis } from '@upstash/redis'
import type { TranslationStore } from './service'

export function translationStore(): TranslationStore {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token || !process.env.GEMINI_API_KEY) {
    console.error('[PUBLIC_I18N_CONFIGURATION_MISSING]', {
      environment: process.env.VERCEL_ENV ?? 'local', redisUrl: Boolean(url), redisToken: Boolean(token), gemini: Boolean(process.env.GEMINI_API_KEY),
    })
    throw new Error('Public translation configuration missing')
  }
  const redis = new Redis({ url, token })
  return {
    get: <T>(key: string) => redis.get<T>(key),
    set: async (key, value, seconds) => { await redis.set(key, value, seconds === undefined ? {} : { ex: seconds }) },
    lock: async (key, value, seconds) => (await redis.set(key, value, { nx: true, ex: seconds })) === 'OK',
    unlock: async (key, value) => { await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [key], [value]) },
  }
}
