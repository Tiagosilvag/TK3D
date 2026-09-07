import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths() as any],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Integration tests hit a real Postgres database. Force every test process
    // (including the shared `lib/prisma.ts` client used by server actions) to
    // point at TEST_DATABASE_URL (tk3d_test) instead of DATABASE_URL (tk3d_dev),
    // so `npm test` never reads or writes the dev database.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    },
    // Integration test files each wipe whole tables in their own beforeEach
    // (e.g. printers.test.ts unconditionally deletes every Printer row) and
    // now that Product carries real (non-cascading) FKs to Printer/Filament/
    // PackagingItem/Accessory/Supply, two such files racing in parallel could
    // try to delete a row the other still depends on and fail with a foreign
    // key violation. Run test files one at a time against the shared test DB.
    fileParallelism: false,
  },
})
