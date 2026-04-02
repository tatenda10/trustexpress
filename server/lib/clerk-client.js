import { createClerkClient } from '@clerk/backend';

let clerkClientInstance = null;

export function getClerkClient() {
  if (clerkClientInstance) return clerkClientInstance;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing CLERK_SECRET_KEY');
  }

  clerkClientInstance = createClerkClient({ secretKey });
  return clerkClientInstance;
}