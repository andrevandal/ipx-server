const hasher = new Bun.CryptoHasher('sha256')

export function hash(input: string) {
  return hasher.update(input).digest('hex')
}
