import type { IPX } from 'ipx'
import logger from './logger'
import bucketService from './bucket'

const log = logger.withTag('externalCache')

// Builds a human-readable S3 key from source id and modifiers.
// Structure (HTTP):  {host-label}-{project}/{original-path-with-ext}/{modifiers}
// Structure (FS):    {path-with-ext}/{modifiers}
// Format is excluded from modifiers — it becomes the file extension via bucket.put.
function buildCacheKey(id: string, modifiers: Record<string, string> | undefined): string {
  const mods = modifiers ?? {}

  const modStr = Object.entries(mods)
    .filter(([k]) => k !== 'format' && k !== 'f')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}_${v}`)
    .join(',') || '_'

  const httpMatch = id.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+)$/)
  if (httpMatch) {
    const [, host, project, filePath] = httpMatch
    const hostParts = host.split('.')
    const hostLabel = hostParts.length > 2 ? hostParts[0] : host
    return `${hostLabel}-${project}/${filePath}/${modStr}`
  }

  // HTTP source with only one path segment
  const httpSimpleMatch = id.match(/^https?:\/\/([^/]+)\/(.+)$/)
  if (httpSimpleMatch) {
    const [, host, filePath] = httpSimpleMatch
    return `${host}/${filePath}/${modStr}`
  }

  // FS source
  const fsPath = id.startsWith('/') ? id.slice(1) : id
  return `${fsPath}/${modStr}`
}

function getModifierFormat(modifiers: Record<string, string> | undefined): string {
  return modifiers?.format ?? modifiers?.f ?? 'unknown'
}

type RetrieveExternalCacheProps = {
  id: string
  modifiers: Parameters<IPX>[1]
} & Awaited<ReturnType<ReturnType<IPX>['getSourceMeta']>>

export async function retrieveExternalCache({
  id,
  modifiers
}: RetrieveExternalCacheProps) {
  const key = buildCacheKey(id, modifiers)
  const format = getModifierFormat(modifiers)
  const cached = await bucketService.get({ name: key, format })

  if (!cached) {
    log.info(`skipped external cache: ${key}`)
    return
  }
  log.info(`retrieve external cache: ${key}`)
  return { format, ...cached }
}

export async function retrieveExternalCacheUrl({
  id,
  modifiers,
  mtime
}: RetrieveExternalCacheProps) {
  const key = buildCacheKey(id, modifiers)
  const format = getModifierFormat(modifiers)
  const url = await bucketService.getUrl({ name: key, format, sourceMtime: mtime })

  if (!url) {
    log.info(`skipped external cache url: ${key}`)
    return
  }
  log.info(`retrieve external cache url: ${key}`)
  return { url, format }
}

type UpdateExternalCacheProps = RetrieveExternalCacheProps & {
  data: Buffer | string
  format?: string
}
export async function updateExternalCache({
  id,
  modifiers,
  mtime,
  data
}: UpdateExternalCacheProps) {
  const key = buildCacheKey(id, modifiers)
  log.info(`update external cache: ${key}`)
  const format = getModifierFormat(modifiers)
  return bucketService.put({
    name: key,
    data: Buffer.isBuffer(data) ? data : Buffer.from(data),
    format,
    mtime: mtime ?? new Date(),
    sourceId: id,
    sourceModifiers: modifiers
  })
}
