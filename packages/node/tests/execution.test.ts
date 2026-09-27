import { expect, test } from 'vitest'

import { createExecutionGate } from '../src/execution.ts'

/** Resolves after `release` settles so the test controls when a slot frees. */
function deferred() {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  return { pending, release }
}

test('runs no more tasks at once than the gate allows', async () => {
  const gate = createExecutionGate(2)
  const running = { count: 0, peak: 0 }
  const slots = Array.from({ length: 5 }, () => deferred())

  const evaluations = slots.map(({ pending, release }) => gate.run(async () => {
    running.count += 1
    running.peak = Math.max(running.peak, running.count)
    await pending
    running.count -= 1
    return release
  }))

  expect(running.peak).toBe(2)
  for (const { release } of slots) release()
  await Promise.all(evaluations)
})

test('starts queued tasks in the order they were submitted', async () => {
  const gate = createExecutionGate(1)
  const started: number[] = []
  const first = deferred()

  const evaluations = [0, 1, 2].map((index) => gate.run(async () => {
    started.push(index)
    if (index === 0) await first.pending
    return index
  }))

  expect(started).toEqual([0])
  first.release()
  await expect(Promise.all(evaluations)).resolves.toEqual([0, 1, 2])
})

test('frees the slot when a task rejects', async () => {
  const gate = createExecutionGate(1)
  const failure = gate.run(async () => { throw new Error('evaluation failed') })
  await expect(failure).rejects.toThrow('evaluation failed')
  await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered')
})
