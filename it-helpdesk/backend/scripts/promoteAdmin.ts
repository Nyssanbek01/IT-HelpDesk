import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { prisma } from '../src/db/prisma.js'

const prompt = createInterface({ input: stdin, output: stdout })

async function main() {
  const email = (await prompt.question('Existing user email to promote: ')).trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) {
    throw new Error('No existing user was found for that email.')
  }
  if (user.role === 'admin') {
    console.log('This account is already an admin.')
    return
  }

  const confirmation = await prompt.question(`Promote ${user.name} (${user.email}) to admin? Type PROMOTE to confirm: `)
  if (confirmation.trim() !== 'PROMOTE') {
    console.log('Promotion cancelled; no account was changed.')
    return
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } })
  console.log(`Promoted ${user.email} to admin.`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unable to promote user')
    process.exitCode = 1
  })
  .finally(async () => {
    prompt.close()
    await prisma.$disconnect()
  })