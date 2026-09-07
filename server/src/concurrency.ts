/** Runs `worker` over `items` with at most `limit` in flight at once. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  async function runNext(): Promise<void> {
    const index = next
    next += 1
    if (index >= items.length) return
    await worker(items[index], index)
    await runNext()
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  await Promise.all(runners)
}
