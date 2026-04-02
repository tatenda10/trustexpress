import 'dotenv/config'
import { createClerkClient } from '@clerk/backend'

function arg(name) {
  const prefix = `--${name}=`
  const match = process.argv.slice(2).find((v) => v.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

async function run() {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error('Missing CLERK_SECRET_KEY in environment')
  }

  const clerk = createClerkClient({ secretKey })
  const email = arg('email').trim().toLowerCase()
  const userId = arg('user-id').trim()
  const allUnset = hasFlag('all-unset')

  if (!email && !userId && !allUnset) {
    throw new Error('Provide one of: --email=... OR --user-id=... OR --all-unset')
  }

  let targets = []

  if (allUnset) {
    const list = await clerk.users.getUserList({ limit: 200 })
    targets = (list.data || []).filter((u) => !u.publicMetadata?.role)
  } else if (userId) {
    const user = await clerk.users.getUser(userId)
    targets = user ? [user] : []
  } else if (email) {
    const list = await clerk.users.getUserList({ emailAddress: [email], limit: 10 })
    targets = list.data || []
  }

  if (targets.length === 0) {
    console.log('No matching users found to update.')
    return
  }

  for (const user of targets) {
    await clerk.users.updateUserMetadata(user.id, {
      publicMetadata: {
        ...(user.publicMetadata || {}),
        role: 'driver',
      },
    })
    console.log(`Updated user ${user.id} -> role=driver`) 
  }

  console.log(`Done. Updated ${targets.length} user(s).`)
}

run().catch((error) => {
  console.error(error.message)
  process.exit(1)
})