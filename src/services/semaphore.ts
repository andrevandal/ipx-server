export function createSemaphore(slots: number) {
  const queue: (() => void)[] = []
  const acquire = () => {
    if (slots > 0) {
      slots--
      return Promise.resolve()
    }
    return new Promise<void>((res) => queue.push(res))
  }
  const release = () => {
    const next = queue.shift()
    if (next) next()
    else slots++
  }
  return { acquire, release }
}