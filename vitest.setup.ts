import '@testing-library/jest-dom'
import { Storage } from 'happy-dom'

// Node 25 and later have a localStorage of their own — undefined unless the
// process is given a --localstorage-file, and a real file shared between
// runs when it is — and vitest's happy-dom environment then leaves Node's in
// place of the page's: window.localStorage was undefined, and a test that
// saves anything failed on a newer Node only. So every test file gets a
// fresh page storage, on any Node: happy-dom's, just as its window makes
// one — set without reading Node's, which warns on every read. A test that
// wants its own still stubs it.
Object.defineProperty(globalThis, 'localStorage', { value: new Storage(), configurable: true, writable: true, enumerable: true })
