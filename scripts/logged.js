// Runs a command with what it prints going both to the console and to a log
// file — what `command 2>&1 | tee file` did, without a shell pipe: Bun's
// shell on Windows passed nothing through one (the console stayed silent and
// server.log empty — the audit check of 2026-11-01).
//
//   bun scripts/logged.js <log file> [NAME=value ...] <command> [args ...]
//
// NAME=value pairs before the command are set for it, the same on every
// system and under any script runner (`NAME=value command` is shell syntax
// cmd.exe doesn't know). The command is started directly, not through a
// shell. `bun` is the Bun running this script: where Bun came from npm,
// `bun` on the PATH is a .cmd shim, which can't be started without a shell
// (ENOENT on Windows — the repository analysis of 2026-11-02).
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const [logPath, ...rest] = process.argv.slice(2)
const env = { ...process.env }
while (rest.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) {
  const pair = rest.shift()
  const at = pair.indexOf('=')
  env[pair.slice(0, at)] = pair.slice(at + 1)
}
const [command, ...args] = rest
if (!logPath || !command) {
  console.error('usage: bun scripts/logged.js <log file> [NAME=value ...] <command> [args ...]')
  process.exit(2)
}

const log = createWriteStream(logPath)
const child = spawn(command === 'bun' ? process.execPath : command, args, { env, stdio: ['inherit', 'pipe', 'pipe'] })
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
