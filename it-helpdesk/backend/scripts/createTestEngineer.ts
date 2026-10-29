import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/db/prisma.js'

const email = 'engineer.dev@it-helpdesk.local'

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  })

  if (existing) {
    if (existing.role !== 'engineer') {
      throw new Error('The reserved test engineer email already belongs to a non-engineer account; no changes made.')
    }
    console.log(`Test engineer already exists: ${email}`)
    return
  }

  const password = randomBytes(48).toString('base64url')
  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: {
      name: 'IT HelpDesk Engineer',
      email,
      password: passwordHash,
      role: 'engineer',
    },
    select: { id: true },
  })
  console.log(`Test engineer created: ${email}`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unable to create test engineer')
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())