import { vi } from 'vitest'

// Server actions call revalidatePath()/revalidateTag() after mutations, which
// require a Next.js request-scoped store that doesn't exist when the actions
// are invoked directly from a test process. Mock next/cache as a no-op so
// integration tests can call server actions without booting a Next.js server.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))
