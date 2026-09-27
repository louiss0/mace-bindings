export type ExecutionGate = { run<T>(task: () => Promise<T>): Promise<T> }

/**
 * Bounds how many native evaluations run at once and queues the rest in
 * submission order. Koffi serves asynchronous calls from the libuv thread pool,
 * so without a gate an unbounded burst of evaluations would silently queue
 * inside the runtime instead of being visible as back pressure.
 */
export function createExecutionGate(limit: number): ExecutionGate {
  let running = 0
  const waiting: Array<() => void> = []

  const start = (task: () => void) => {
    if (running < limit) {
      running += 1
      task()
      return
    }
    waiting.push(() => {
      task()
    })
  }

  return {
    run: <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
      start(() => {
        task().then(
          (value) => {
            running -= 1
            waiting.shift()?.()
            resolve(value)
          },
          (failure: unknown) => {
            running -= 1
            waiting.shift()?.()
            reject(failure)
          },
        )
      })
    }),
  }
}
