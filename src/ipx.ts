import { negotiate } from '@fastify/accept-negotiator'
import { decode } from 'ufo'
import getEtag from 'etag'
import {
  defineEventHandler,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  createError,
  H3Event,
  H3Error,
  send,
  sendRedirect,
  appendResponseHeader,
  getResponseHeader
} from 'h3'
import type { IPX } from 'ipx'
import {
  retrieveExternalCache,
  retrieveExternalCacheUrl,
  updateExternalCache
} from './services/externalCache'

const MODIFIER_SEP = /[&,]/g
const MODIFIER_VAL_SEP = /[:=_]/

import { IPX_FS_DIR } from './services/env'
import logger from './services/logger'
import {
  processWithDedup,
  scheduleBackgroundProcess,
  buildDedupKey,
  warnIfSlowTransform
} from './services/processor'

export function createIPXH3Handler(ipx: IPX) {
  const _handler = async (event: H3Event) => {
    if (/^\/favicon.(svg|ico)$/i.exec(event.path)) {
      return handleFavicon(event)
    }

    const { id, modifiers } = await getIdAndModifiesFromEvent(event)
    const img = ipx(id, modifiers)
    const sourceMeta = await img.getSourceMeta()

    // Send CSP headers to prevent XSS
    sendResponseHeaderIfNotSet(event, 'content-security-policy', "default-src 'none'")

    if (sourceMeta.mtime) {
      sendResponseHeaderIfNotSet(event, 'last-modified', sourceMeta.mtime.toUTCString())

      const _ifModifiedSince = getRequestHeader(event, 'if-modified-since')
      if (_ifModifiedSince && new Date(_ifModifiedSince) >= sourceMeta.mtime) {
        setResponseStatus(event, 304)
        return send(event)
      }
    }

    if (typeof sourceMeta.maxAge === 'number') {
      sendResponseHeaderIfNotSet(
        event,
        'cache-control',
        `max-age=${+sourceMeta.maxAge}, public, s-maxage=${+sourceMeta.maxAge}`
      )
    }

    if (isHttpUrl(id)) {
      // Cache hit — proxy the S3 response so CF caches content at the ipx URL (not a visible redirect)
      const cachedUrl = await retrieveExternalCacheUrl({ id, modifiers, ...sourceMeta })
      if (cachedUrl) {
        logger.withTag('cache').debug(`hit: ${id}`)
        const upstream = await fetch(cachedUrl.url)
        if (!upstream.ok) throw new Error(`S3 fetch failed: ${upstream.status}`)
        sendResponseHeaderIfNotSet(event, 'content-type', `image/${cachedUrl.format}`)
        return upstream.body
      }

      // Cache miss — schedule background transform, serve raw source immediately
      logger.withTag('cache').info(`miss, serving raw: ${id}`)
      scheduleBackgroundProcess(img, id, modifiers, sourceMeta)
      setNoCacheHeaders(event)
      return sendRedirect(event, id, 307)
    }

    // FS sources — sync path: process, stream, and cache
    const cachedData = await retrieveExternalCache({ id, modifiers, ...sourceMeta })

    let data: Buffer | string
    let format = ''
    let isOwner = false

    if (cachedData) {
      data = cachedData.data
      format = cachedData.format
    } else {
      const processed = await processWithDedup(buildDedupKey(id, modifiers), img)
      const { queueMs, processMs } = processed
      warnIfSlowTransform(queueMs, processMs, id, modifiers)
      data = processed.result.data
      if (processed.result.format)
        format = processed.result.format
      isOwner = processed.isOwner
    }

    const etag = cachedData?.etag ?? getEtag(data)
    sendResponseHeaderIfNotSet(event, 'etag', etag)

    if (etag && getRequestHeader(event, 'if-none-match') === etag) {
      setResponseStatus(event, 304)
      return send(event)
    }

    if (format) {
      sendResponseHeaderIfNotSet(event, 'content-type', `image/${format}`)
    }

    if (!cachedData && isOwner) {
      await updateExternalCache({
        id,
        modifiers,
        mtime: sourceMeta.mtime,
        maxAge: sourceMeta.maxAge,
        data,
        format
      })
    }

    return data
  }

  return defineEventHandler(async (event) => {
    try {
      return await _handler(event)
    } catch (_error: unknown) {
      const error = createError(_error as H3Error)
      logger.withTag('error').error(`[${error.statusCode}] ${error.message} — ${event.path}`)

      const rawUrl = extractRawSourceUrl(event.path)
      if (rawUrl) {
        logger.withTag('fallback').warn(`error recovery, serving raw: ${rawUrl}`)
        setNoCacheHeaders(event)
        return sendRedirect(event, rawUrl, 307)
      }

      setResponseStatus(event, error.statusCode, error.statusMessage)
      return {
        error: {
          message: `[${error.statusCode}] [${
            error.statusMessage ?? 'IPX_ERROR'
          }] ${error.message}`
        }
      }
    }
  })
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function setNoCacheHeaders(event: H3Event): void {
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'cloudflare-cdn-cache-control', 'no-store')
}

function extractRawSourceUrl(path: string): string | undefined {
  try {
    const [, ...idSegments] = path.slice(1).split('/')
    const id = safeString(decode(idSegments.join('/')))
    if (isHttpUrl(id)) return id
  } catch {}
  return undefined
}

function sendResponseHeaderIfNotSet(event: H3Event, name: string, value: any) {
  if (!getResponseHeader(event, name)) {
    setResponseHeader(event, name, value)
  }
}

function autoDetectFormat(acceptHeader: string, animated: boolean) {
  if (animated) {
    const acceptMime = negotiate(acceptHeader, ['image/webp', 'image/gif'])
    return acceptMime?.split('/')[1] ?? 'gif'
  }
  const acceptMime = negotiate(acceptHeader, [
    'image/avif',
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/heif',
    'image/gif'
  ])
  return acceptMime?.split('/')[1] ?? 'jpeg'
}

function safeString(input: string) {
  return JSON.stringify(input)
    .replace(/(^")|("$)/g, '')
    .replace(/\\+/g, '\\')
    .replace(/\\"/g, '"')
}

async function handleFavicon(event: H3Event) {
  const path = `${IPX_FS_DIR}${event.path}`
  const file = Bun.file(path)
  if (!file) {
    throw createError({
      statusCode: 404,
      statusText: `IPX_FILE_NOT_FOUND`,
      message: `File not found: ${path}`
    })
  }
  sendResponseHeaderIfNotSet(event, 'content-type', file.type)
  return Buffer.from(await file.arrayBuffer())
}

async function getIdAndModifiesFromEvent(event: H3Event) {
  const [modifiersString = '', ...idSegments] = event.path
    .slice(1 /* leading slash */)
    .split('/')

  // Proxies and browsers normalize `//` → `/` in paths, so `https://host`
  // arrives as `https:/host`. Restore the double slash if stripped.
  const rawId = idSegments.join('/').replace(/^(https?):\/([^/])/, '$1://$2')
  const id = safeString(decode(rawId))

  if (!modifiersString) {
    throw createError({
      statusCode: 400,
      statusText: `IPX_MISSING_MODIFIERS`,
      message: `Modifiers are missing: ${id}`
    })
  }
  if (!id || id === '/') {
    throw createError({
      statusCode: 400,
      statusText: `IPX_MISSING_ID`,
      message: `Resource id is missing: ${event.path}`
    })
  }

  const modifiers: Record<string, string> = Object.create(null)

  if (modifiersString !== '_') {
    for (const p of modifiersString.split(MODIFIER_SEP)) {
      const [key, ...values] = p.split(MODIFIER_VAL_SEP)
      modifiers[safeString(key)] = values
        .map((v) => safeString(decode(v)))
        .join('_')
    }
  }

  const mFormat = modifiers.f || modifiers.format
  if (mFormat === 'auto') {
    const acceptHeader = getRequestHeader(event, 'accept') ?? ''
    const autoFormat = autoDetectFormat(
      acceptHeader,
      !!(modifiers.a || modifiers.animated)
    )
    delete modifiers.f
    delete modifiers.format
    if (autoFormat) {
      modifiers.format = autoFormat
      appendResponseHeader(event, 'vary', 'Accept')
    }
  }
  return { id, modifiers }
}
