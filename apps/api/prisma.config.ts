import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const here = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string) {
  if (!existsSync(file)) {
    return;
  }
  process.loadEnvFile(file);
}

// Repo-root `.env` first, then a local override. Existing process env wins.
loadEnv(resolve(here, '../../.env'));
loadEnv(resolve(here, '.env'));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
