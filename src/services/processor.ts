import type { IPX } from 'ipx'

import { IPX_MAX_CONCURRENT } from './env'
import logger from './logger'
import { createSemaphore } from './semaphore'
import { updateExternalCache } from './externalCache'

const semaphore = createSemaphore(IPX_MAX_CONCURRENT)
const log = logger.withTag('processor')

type ProcessResult = Awaited<ReturnType<ReturnType<IPX>['process']>>
export type SourceMeta = Awaited<ReturnType<ReturnType<IPX>['getSourceMeta']>>

const inFlight = new Map<string, Promise<ProcessResult>>()

export async function processWithDedup(
  key: string,
  img: ReturnType<IPX>
): Promise<{ result: ProcessResult; isOwner: boolean; queueMs: number; processMs: number }> {
  const existing = inFlight.get(key)
  if (existing) {
    return { result: await existing, isOwner: false, queueMs: 0, processMs: 0 }
  }

  let queueMs = 0
  let processMs = 0

  const promise = (async () => {
    const t0 = performance.now()
    await semaphore.acquire()
    queueMs = performance.now() - t0
    const t1 = performance.now()
    try {
      return await img.process()
    } finally {
      processMs = performance.now() - t1
      semaphore.release()
    }
  })()

  inFlight.set(key, promise)
  try {
    const result = await promise
    return { result, isOwner: true, queueMs, processMs }
  } finally {
    inFlight.delete(key)
  }
}

// Starts processing in the background if not already in-flight.
// On completion, writes the result to S3 cache.
// Safe to call without awaiting — errors are logged, never thrown.
export function scheduleBackgroundProcess(
  img: ReturnType<IPX>,
  id: string,
  modifiers: Record<string, string>,
  sourceMeta: SourceMeta
) {
  const dedupKey = `${id}:${JSON.stringify(modifiers)}`
  if (inFlight.has(dedupKey)) {
    log.info(`already in-flight, skipping: ${id}`)
    return
  }

  log.info(`scheduling background transform: ${id} ${JSON.stringify(modifiers)}`)

  processWithDedup(dedupKey, img)
    .then(async ({ result, isOwner, queueMs, processMs }) => {
      const totalMs = queueMs + processMs
      if (totalMs > 20_000)
        logger.withTag('perf').warn(`slow transform (queue: ${(queueMs / 1000).toFixed(1)}s, process: ${(processMs / 1000).toFixed(1)}s): ${id} ${JSON.stringify(modifiers)}`)
      else
        log.info(`transform complete (${(totalMs / 1000).toFixed(1)}s): ${id}`)
      if (isOwner)
        await updateExternalCache({
          id,
          modifiers,
          mtime: sourceMeta.mtime,
          data: result.data
        })
    })
    .catch((err) =>
      log.error(`transform failed: ${err instanceof Error ? err.message : err} — ${id}`)
    )
}
