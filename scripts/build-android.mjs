import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(repo, 'android');
const sdk = process.env.ANDROID_HOME || path.join(homedir(), '.jtas/android-tools/sdk');
const java =
  process.env.JAVA_HOME || path.join(homedir(), '.jtas/android-tools/jdk17/Contents/Home');
const signingFile =
  process.env.JTAS_ANDROID_SIGNING_FILE ||
  path.join(homedir(), '.jtas/android-signing/signing.json');
if (path.resolve(signingFile).startsWith(repo + path.sep))
  throw new Error('Keep signing credentials outside the repository.');
if (statSync(signingFile).mode & 0o077) throw new Error('Signing credentials must have mode 600.');
const signing = JSON.parse(readFileSync(signingFile, 'utf8'));
if (!signing.keystore || !signing.alias || !signing.storePassword || !signing.keyPassword)
  throw new Error('Incomplete private signing configuration.');
if (statSync(signing.keystore).mode & 0o077) throw new Error('Keystore must have mode 600.');
const env = {
  ...process.env,
  JAVA_HOME: java,
  ANDROID_HOME: sdk,
  JTAS_ANDROID_STORE_PASSWORD: signing.storePassword,
  JTAS_ANDROID_KEY_PASSWORD: signing.keyPassword,
};
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: android,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0)
    throw new Error(`${path.basename(command)} failed${capture ? `: ${result.stderr}` : '.'}`);
  return result.stdout;
}
run(path.join(android, 'gradlew'), [
  '--no-daemon',
  '--console',
  'plain',
  'assembleRelease',
  'bundleRelease',
  'lintRelease',
]);
const release = path.join(repo, 'releases/android');
const downloads = path.join(release, 'downloads');
mkdirSync(downloads, { recursive: true });
mkdirSync(path.join(release, '.well-known'), { recursive: true });
const tools = path.join(sdk, 'build-tools/36.0.0');
const aligned = path.join(android, 'app/build/outputs/apk/release/jaraa-aligned.apk');
const apk = path.join(downloads, 'jaraa-android.apk');
run(path.join(tools, 'zipalign'), [
  '-f',
  '-p',
  '4',
  path.join(android, 'app/build/outputs/apk/release/app-release-unsigned.apk'),
  aligned,
]);
run(path.join(tools, 'apksigner'), [
  'sign',
  '--ks',
  signing.keystore,
  '--ks-key-alias',
  signing.alias,
  '--ks-pass',
  'env:JTAS_ANDROID_STORE_PASSWORD',
  '--key-pass',
  'env:JTAS_ANDROID_KEY_PASSWORD',
  '--out',
  apk,
  aligned,
]);
const certificate = run(
  path.join(tools, 'apksigner'),
  ['verify', '--verbose', '--print-certs', apk],
  true,
);
const fingerprint = /certificate SHA-256 digest: ([a-f0-9]+)/i.exec(certificate)?.[1].toUpperCase();
const manifest = JSON.parse(readFileSync(path.join(android, 'twa-manifest.json'), 'utf8'));
if (
  !fingerprint ||
  !manifest.fingerprints.some(
    (entry) => entry.value.replaceAll(':', '').toUpperCase() === fingerprint,
  )
)
  throw new Error('APK signing certificate does not match the published app identity.');
run(path.join(java, 'bin/jarsigner'), [
  '-keystore',
  signing.keystore,
  '-storepass:env',
  'JTAS_ANDROID_STORE_PASSWORD',
  '-keypass:env',
  'JTAS_ANDROID_KEY_PASSWORD',
  '-signedjar',
  path.join(release, 'jaraa-android.aab'),
  path.join(android, 'app/build/outputs/bundle/release/app-release.aab'),
  signing.alias,
]);
const assetlinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: manifest.packageId,
      sha256_cert_fingerprints: manifest.fingerprints.map((entry) => entry.value),
    },
  },
];
writeFileSync(
  path.join(release, '.well-known/assetlinks.json'),
  JSON.stringify(assetlinks, null, 2) + '\n',
);
const digest = createHash('sha256').update(readFileSync(apk)).digest('hex');
writeFileSync(apk + '.sha256', `${digest}  jaraa-android.apk\n`);
chmodSync(apk, 0o644);
console.log(`Signed Android installer verified: ${apk}\nSHA-256: ${digest}`);
