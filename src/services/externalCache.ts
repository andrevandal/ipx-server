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

function inferFormatFromSource(id: string): string {
  const ext = id.split('?')[0].split('.').pop()?.toLowerCase()
  if (!ext) return 'unknown'
  if (ext === 'jpg') return 'jpeg'
  return ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif', 'heif'].includes(ext) ? ext : 'unknown'
}

// Resolve the cache format: explicit modifier wins, then source URL extension, then 'unknown'.
// Note: f_auto is already resolved to a concrete format before this is called.
function resolveFormat(id: string, modifiers: Record<string, string> | undefined): string {
  return modifiers?.format ?? modifiers?.f ?? inferFormatFromSource(id)
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
  const format = resolveFormat(id, modifiers)
  const cached = await bucketService.get({ name: key, format })

  if (!cached) {
    log.debug(`skipped external cache: ${key}`)
    return
  }
  log.debug(`retrieve external cache: ${key}`)
  return { format, ...cached }
}

export async function retrieveExternalCacheUrl({
  id,
  modifiers,
  mtime
}: RetrieveExternalCacheProps) {
  const key = buildCacheKey(id, modifiers)
  const format = resolveFormat(id, modifiers)
  const url = await bucketService.getUrl({ name: key, format, sourceMtime: mtime })

  if (!url) {
    log.debug(`skipped external cache url: ${key}`)
    return
  }
  log.debug(`retrieve external cache url: ${key}`)
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
  data,
  format: formatOverride
}: UpdateExternalCacheProps) {
  const key = buildCacheKey(id, modifiers)
  log.debug(`update external cache: ${key}`)
  const format = formatOverride || resolveFormat(id, modifiers)
  return bucketService.put({
    name: key,
    data: Buffer.isBuffer(data) ? data : Buffer.from(data),
    format,
    mtime: mtime ?? new Date(),
    sourceId: id,
    sourceModifiers: modifiers
  })
}
