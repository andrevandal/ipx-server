import * as Minio from 'minio'

import {
  S3_ENDPOINT,
  S3_PORT,
  S3_USE_SSL,
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_BUCKET,
  NODE_ENV
} from './env'
import { createError } from 'h3'
import logger from './logger'

const log = logger.withTag('bucket')

const client =
  S3_ACCESS_KEY && S3_SECRET_KEY && S3_BUCKET
    ? new Minio.Client({
        endPoint: S3_ENDPOINT,
        port: S3_PORT,
        useSSL: S3_USE_SSL,
        accessKey: S3_ACCESS_KEY,
        secretKey: S3_SECRET_KEY
      })
    : null

if (client && NODE_ENV === 'test') {
  client.traceOn(process.stdout)
}
type UploadProps = {
  name: string
  data: Buffer
  mtime: Date
  format: string
  sourceId: string
  sourceModifiers?: Record<string, any>
}
async function put({
  name,
  data,
  format,
  mtime,
  sourceId,
  sourceModifiers
}: UploadProps) {
  log.debug(`put: ${name}`)
  if (!client || !S3_BUCKET) {
    return
  }
  const exists = await client.bucketExists(S3_BUCKET)
  if (!exists) {
    await client.makeBucket(S3_BUCKET, 'us-east-1')
  }
  const metaData = {
    'Content-Type': `image/${format}`,
    'Last-Modified': mtime.toUTCString(),
    sourceId: sourceId,
    sourceModifiers: Array.from(Object.entries(sourceModifiers ?? {}))
      .map((el) => el.join(':'))
      .join('|')
  }
  const response = await client.putObject(
    S3_BUCKET,
    `${name}.${format}`,
    data,
    data.length,
    metaData
  )
  log.debug(`put: ${name}`, `done: ${response.etag}`)
  return response.etag
}
type GetProps = {
  name: string
  format: string
}
async function get(params: GetProps) {
  let localLog = log.withTag('get')
  localLog.debug(`${params.name}`)
  if (!client || !S3_BUCKET) {
    return
  }
  const exists = await client.bucketExists(S3_BUCKET).catch((err) => {
    localLog.withTag('exists').error(err)
  })

  if (!exists) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Bucket not found'
    })
  }

  const { etag, lastModified, metaData } =
    (await client
      .statObject(S3_BUCKET, `${params.name}.${params.format}`)
      .catch((err) => {
        let localLog = logger.withTag('statObject')
        localLog.debug(`name: ${params.name}.${params.format}`, S3_BUCKET)
        if (err instanceof Error) {
          if (!err.message.includes('Not Found')) {
            localLog.error(err)
          }
        }
        return undefined
      })) ?? {}

  localLog.debug(
    `etag: ${etag} lastModified: ${lastModified} metaData: ${JSON.stringify(metaData)}`
  )

  if (!etag || !lastModified || !metaData) {
    localLog.debug(`no stat info found for: ${params.name}.${params.format}`)
    return
  }

  const response = await client
    .getObject(S3_BUCKET, `${params.name}.${params.format}`)
    .catch((err) => {
      localLog.withTag('getObject').error(err)
      return undefined
    })
  if (!response) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found'
    })
  }

  const sink = new Bun.ArrayBufferSink()

  for await (const chunk of response) {
    sink.write(chunk)
  }

  const data = sink.end() as ArrayBuffer

  return {
    etag,
    lastModified: metaData?.lastModified
      ? new Date(metaData.lastModified)
      : lastModified,
    data: Buffer.from(data)
  }
}

type GetUrlProps = {
  name: string
  format: string
  sourceMtime?: Date
  expirySeconds?: number
}
async function getUrl({ name, format, sourceMtime, expirySeconds = 3600 }: GetUrlProps) {
  const localLog = log.withTag('getUrl')
  localLog.debug(`${name}.${format}`)
  if (!client || !S3_BUCKET) return undefined

  const objectName = `${name}.${format}`
  const stat = await client
    .statObject(S3_BUCKET, objectName)
    .catch((err) => {
      if (err instanceof Error && !err.message.includes('Not Found'))
        localLog.error(err)
      return undefined
    })

  if (!stat) return undefined

  // Validate freshness: if source has changed since we cached, treat as miss
  if (sourceMtime && stat.metaData?.['last-modified']) {
    const cachedMtime = new Date(stat.metaData['last-modified'])
    if (cachedMtime.getTime() !== sourceMtime.getTime()) {
      localLog.info(`stale: ${objectName}`)
      return undefined
    }
  }

  return client.presignedGetObject(S3_BUCKET, objectName, expirySeconds)
}

const bucketService = {
  put,
  get,
  getUrl
}

export default bucketService
