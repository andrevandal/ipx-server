export const CONSOLA_LEVEL = process.env?.CONSOLA_LEVEL
  ? Number(process.env?.CONSOLA_LEVEL)
  : 3
export const NODE_ENV = process.env?.NODE_ENV
export const IPX_FS_DIR = process.env?.IPX_FS_DIR ?? './public'
export const IPX_FS_MAX_AGE = process.env?.IPX_FS_MAX_AGE
  ? parseInt(process.env?.IPX_FS_MAX_AGE)
  : 0
export const IPX_HTTP_DOMAINS = process.env?.IPX_HTTP_DOMAINS
  ? process.env?.IPX_HTTP_DOMAINS.split(',')
  : []
export const IPX_HTTP_MAX_AGE = process.env?.IPX_HTTP_MAX_AGE
  ? parseInt(process.env?.IPX_HTTP_MAX_AGE)
  : 0

export const S3_ENDPOINT = process.env?.S3_ENDPOINT
  ? process.env?.S3_ENDPOINT
  : 'https://s3.amazonaws.com'

export const S3_PORT = process.env?.S3_PORT
  ? parseInt(process.env?.S3_PORT)
  : 9000

export const S3_USE_SSL = process.env?.S3_USE_SSL
  ? process.env?.S3_USE_SSL === 'true'
  : true

export const S3_ACCESS_KEY = process.env?.S3_ACCESS_KEY
export const S3_SECRET_KEY = process.env?.S3_SECRET_KEY
export const S3_BUCKET = process.env?.S3_BUCKET
