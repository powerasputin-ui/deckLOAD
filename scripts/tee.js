// `tee`, which Windows doesn't have: what the server prints goes to the
// console and to the log file named first, as `bun run dev` and `bun run
// start` used to do with the system `tee`.
import { createWriteStream } from 'fs'

const log = createWriteStream(process.argv[2])
process.stdin.on('data', (chunk) => {
  process.stdout.write(chunk)
  log.write(chunk)
})
process.stdin.on('end', () => log.end())
