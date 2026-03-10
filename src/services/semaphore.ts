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
    slots++
    queue.shift()?.()
  }
  return { acquire, release }
}