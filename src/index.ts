import { listen } from 'listhen'
import logger from './services/logger'
import { createApp, toNodeListener } from 'h3'
import { createIPX, ipxFSStorage, ipxHttpStorage } from 'ipx'
import { createIPXH3Handler } from './ipx'

import {
  IPX_HTTP_DOMAINS,
  IPX_HTTP_MAX_AGE,
  IPX_FS_DIR,
  IPX_FS_MAX_AGE
} from './services/env'

const log = logger.withTag('app')
log.info(`IPX server is starting...`)

const ipx = createIPX({
  storage: ipxFSStorage({
    dir: IPX_FS_DIR,
    maxAge: IPX_FS_MAX_AGE
  }),
  httpStorage: ipxHttpStorage({
    domains: IPX_HTTP_DOMAINS,
    maxAge: IPX_HTTP_MAX_AGE
  })
})

const app = createApp({
  onRequest(event) {
    log.info(`Request: ${event.node.req.method} ${event.node.req.url}`)
  }
})
app.use('/', createIPXH3Handler(ipx))
listen(toNodeListener(app), { showURL: false })
log.success('Ready.')
