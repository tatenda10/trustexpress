import 'dotenv/config'

function getArg(name, fallback = '') {
  const args = process.argv.slice(2)
  const prefix = `--${name}=`
  const direct = args.find((arg) => arg.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  return fallback
}

async function run() {
  const setupKey = process.env.ADMIN_SETUP_KEY || getArg('setup-key')
  const baseUrl = process.env.API_BASE_URL || getArg('base-url', 'http://localhost:3001/api')
  const fullName = process.env.ADMIN_BOOTSTRAP_NAME || getArg('name')
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || getArg('email')
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || getArg('password')

  if (!setupKey) {
    throw new Error('Missing ADMIN_SETUP_KEY (or --setup-key=...)')
  }

  if (!fullName || !email || !password) {
    throw new Error('Missing admin details. Provide name/email/password via env or args.')
  }

  const response = await fetch(`${baseUrl}/admin/auth/bootstrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-setup-key': setupKey,
    },
    body: JSON.stringify({
      fullName,
      email,
      password,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `Bootstrap failed with status ${response.status}`)
  }

  console.log('Admin bootstrap succeeded.')
  console.log(`Admin ID: ${data.id}`)
  console.log(`Email: ${data.email}`)
  console.log(`Role: ${data.role}`)
}

run().catch((error) => {
  console.error(error.message)
  process.exit(1)
})