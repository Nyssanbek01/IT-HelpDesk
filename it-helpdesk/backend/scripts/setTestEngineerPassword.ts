import 'dotenv/config'
import { StringDecoder } from 'node:string_decoder'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/db/prisma.js'

const email = 'engineer.dev@it-helpdesk.local'

function readHidden(label: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) {
    return Promise.reject(new Error('Run this command in an interactive terminal.'))
  }

  process.stdout.write(label)
  input.setRawMode(true)
  input.resume()
  const decoder = new StringDecoder('utf8')

  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      input.removeListener('data', onData)
      input.setRawMode(false)
      process.stdout.write('\n')
    }
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('Password input cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
        } else if (character >= ' ') {
          value += character
        }
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } })
  if (!user || user.role !== 'engineer') {
    throw new Error('Dedicated test engineer account is missing; run engineer:create-test-account first.')
  }

  const password = await readHidden('New test engineer password (min 8 characters): ')
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long.')
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must not exceed 72 UTF-8 bytes.')
  }
  const confirmation = await readHidden('Confirm password: ')
  if (password !== confirmation) {
    throw new Error('Passwords do not match.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.update({ where: { id: user.id }, data: { password: passwordHash } })
  console.log(`Local password updated for ${email}; secret was not displayed.`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unable to set test engineer password')
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())