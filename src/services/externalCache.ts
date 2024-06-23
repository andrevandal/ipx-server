import type { IPX } from 'ipx'
import logger from './logger'
import { hash } from './crypto'
import bucketService from './bucket'

const log = logger.withTag('externalCache')

const cacheKey = (keys: Record<string, any>) => hash(JSON.stringify(keys))

type RetriveExternalCacheProps = {
  id: string
  modifiers: Parameters<IPX>[1]
} & Awaited<ReturnType<ReturnType<IPX>['getSourceMeta']>>
export async function retriveExternalCache({
  id,
  modifiers,
  mtime,
  maxAge
}: RetriveExternalCacheProps) {
  const key = cacheKey({
    id,
    modifiers,
    mtime,
    maxAge
  })
  const format = modifiers?.format ?? modifiers?.f ?? 'unknown'
  const cached = await bucketService.get({
    name: key,
    format
  })

  if (!cached) {
    log.info(`skipped external cache: ${key}`)
    return
  }
  log.info(`retrive external cache: ${key}`)
  return {
    format,
    ...cached
  }
}

type UpdateExternalCacheProps = RetriveExternalCacheProps & {
  etag?: string
  data: Buffer | string
  format?: string
}
export async function updateExternalCache({
  id,
  modifiers,
  mtime,
  maxAge,
  etag,
  data
}: UpdateExternalCacheProps) {
  const key = cacheKey({
    id,
    modifiers,
    mtime,
    maxAge
  })
  log.info(`update external cache: ${key}`)
  const format = modifiers?.format ?? modifiers?.f ?? 'unknown'
  return bucketService.put({
    name: key,
    data: Buffer.isBuffer(data) ? data : Buffer.from(data),
    format,
    mtime: mtime ?? new Date(),
    sourceId: id,
    sourceModifiers: modifiers
  })
}
