// Runs a command with what it prints going both to the console and to a log
// file — what `command 2>&1 | tee file` did, without a shell pipe: Bun's
// shell on Windows passed nothing through one (the console stayed silent and
// server.log empty — the audit check of 2026-11-01).
//
//   bun scripts/logged.js <log file> <command> [args ...]
//
// The command is started directly, not through a shell: `bun` is found on
// the PATH on every system.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const [logPath, command, ...args] = process.argv.slice(2)
if (!logPath || !command) {
  console.error('usage: bun scripts/logged.js <log file> <command> [args ...]')
  process.exit(2)
}

const log = createWriteStream(logPath)
const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] })
for (const [from, to] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  from.on('data', (chunk) => {
    to.write(chunk)
    log.write(chunk)
  })
}
// Stopping this script stops the command, and waits for it: what it prints
// last reaches the log.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', (err) => {
  console.error(`${command}: ${err.message}`)
  log.end(() => process.exit(1))
})
child.on('close', (code) => log.end(() => process.exit(code ?? 1)))
