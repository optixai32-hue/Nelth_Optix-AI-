import { vi } from 'vitest'

import '@testing-library/jest-dom'

// Provide dummy values for environment variables required during tests
process.env.FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ?? 'test-project'
process.env.FIREBASE_CLIENT_EMAIL =
  process.env.FIREBASE_CLIENT_EMAIL ??
  'test@test-project.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ?? 'test-private-key'

// Mock Next.js functions
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn(fn => fn)
}))
