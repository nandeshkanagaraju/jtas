/**
 * After `prisma generate` on the Mac's own CPU, confirm the bits the amd64
 * Alpine container will actually execute are present, and fetch the schema
 * engine for that platform. `prisma generate` only downloads query engines.
 */
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);

async function walk(dir, pred, depth = 0, hits = []) {
  if (depth > 8) return hits;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (pred(full, entry.name)) hits.push(full);
    if (entry.isDirectory()) await walk(full, pred, depth + 1, hits);
  }
  return hits;
}

const engineDirs = await walk('node_modules/.pnpm', (full) =>
  full.endsWith(`${path.sep}@prisma${path.sep}engines-version`),
);
if (engineDirs.length === 0) {
  console.error('No @prisma/engines-version package installed');
  process.exit(1);
}

const enginesVersion = require(path.resolve(engineDirs[0])).enginesVersion;
console.log('prisma engines', enginesVersion);

const destDir = path.resolve('node_modules/@prisma/engines');
await mkdir(destDir, { recursive: true });
const dest = path.join(destDir, 'schema-engine-linux-musl-openssl-3.0.x');
const url = `https://binaries.prisma.sh/all_commits/${enginesVersion}/linux-musl-openssl-3.0.x/schema-engine.gz`;
const response = await fetch(url);
if (!response.ok || !response.body) {
  console.error(`schema engine download failed: ${response.status} ${url}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(dest));
await chmod(dest, 0o755);
console.log('schema engine', dest);

const queryEngines = await walk('node_modules', (full) =>
  full.includes('libquery_engine-linux-musl-openssl-3.0.x.so.node'),
);
console.log('query engines', queryEngines);
if (queryEngines.length === 0) process.exit(1);

const esbuildPackages = await walk(
  'node_modules/.pnpm',
  (full) =>
    full.endsWith(`${path.sep}esbuild${path.sep}package.json`) &&
    full.includes(`${path.sep}esbuild@`),
);
if (esbuildPackages.length === 0) {
  console.error('No esbuild package installed');
  process.exit(1);
}

for (const manifest of esbuildPackages) {
  const version = require(path.resolve(manifest)).version;
  const esbuildRoot = path.dirname(manifest);
  const platformDir = path.join(path.dirname(esbuildRoot), '@esbuild', 'linux-x64');
  const bin = path.join(platformDir, 'bin', 'esbuild');
  const tmp = await mkdtemp(path.join(tmpdir(), 'esbuild-'));
  const tarball = path.join(tmp, 'esbuild.tgz');
  const url = `https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    console.error(`esbuild download failed: ${response.status} ${url}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tarball));
  await execFileAsync('tar', ['-xzf', tarball, '-C', tmp]);
  await mkdir(path.dirname(bin), { recursive: true });
  await execFileAsync('cp', ['-a', path.join(tmp, 'package', 'bin', 'esbuild'), bin]);
  await execFileAsync('cp', [
    '-a',
    path.join(tmp, 'package', 'package.json'),
    path.join(platformDir, 'package.json'),
  ]);
  await chmod(bin, 0o755);
  await rm(tmp, { recursive: true, force: true });
  console.log('esbuild', version, bin);
}
