import { consola } from 'consola'
import { CONSOLA_LEVEL } from './env'

consola.level = CONSOLA_LEVEL
const logger = consola.withTag('ipx-server')
logger.withTag('logger').info(`logging level: ${CONSOLA_LEVEL}`)
export default logger
