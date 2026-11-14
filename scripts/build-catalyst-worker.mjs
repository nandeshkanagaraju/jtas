import { createRequire } from 'node:module';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The worker already depends on tsx, which supplies the locked esbuild used
// here. No runtime transpiler is shipped to the Catalyst Job Function.
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve('tsx/package.json'));
const { build } = tsxRequire('esbuild');
const destination = path.resolve('.deploy/functions/jaraa_scheduler');
await mkdir(destination, { recursive: true });
await build({
  entryPoints: ['worker/catalyst-job.ts'],
  outfile: path.join(destination, 'scheduler.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['@prisma/client'],
  tsconfig: 'tsconfig.worker.json',
  // Pino's worker transports are not used in this stdout-only deployment.
  define: { 'process.env.NODE_ENV': '"production"' },
});
const clientPath = path.dirname(require.resolve('@prisma/client/package.json'));
const clientRequire = createRequire(path.join(clientPath, 'package.json'));
const generatedPath = path.dirname(clientRequire.resolve('.prisma/client/package.json'));
await mkdir(path.join(destination, 'node_modules/@prisma'), { recursive: true });
await mkdir(path.join(destination, 'node_modules/.prisma'), { recursive: true });
await cp(clientPath, path.join(destination, 'node_modules/@prisma/client'), {
  recursive: true,
  dereference: true,
});
await cp(generatedPath, path.join(destination, 'node_modules/.prisma/client'), {
  recursive: true,
  dereference: true,
  filter: (file) =>
    !path.basename(file).startsWith('libquery_engine-') || file.includes('debian-openssl-3.0.x'),
});
await writeFile(
  path.join(destination, 'index.js'),
  "module.exports = require('./scheduler.cjs').handler;\n",
);
await writeFile(
  path.join(destination, 'package.json'),
  JSON.stringify(
    { name: 'jaraa-scheduler', version: '1.0.0', main: 'index.js', private: true },
    null,
    2,
  ) + '\n',
);
await writeFile(
  path.join(destination, 'catalyst-config.json'),
  JSON.stringify(
    {
      deployment: { name: 'jaraa_scheduler', stack: 'node22', type: 'job', env_variables: {} },
      execution: { main: 'index.js' },
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Built Catalyst scheduled worker in .deploy/functions/jaraa_scheduler (no secrets included).',
);
