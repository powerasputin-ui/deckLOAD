import { cpSync, existsSync } from 'fs'

if (existsSync('.next/static')) {
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true, force: true })
}
if (existsSync('public')) {
  cpSync('public', '.next/standalone/public', { recursive: true, force: true })
}
