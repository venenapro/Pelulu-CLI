/**
 * Update Checker — compare local version with npm registry
 * Uses: https://registry.npmjs.org/PACKAGE_NAME/latest
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const TIMEOUT_MS = 8000;

/**
 * Parse semver string "1.2.3" → { major, minor, patch }
 */
function parseSemver(version) {
  const clean = version.replace(/^v/i, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

/**
 * Compare two semver objects.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

/**
 * Read local version from package.json
 */
async function getLocalVersion(root) {
  try {
    const raw = await readFile(join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Read package name from package.json
 */
async function getPackageName(root) {
  try {
    const raw = await readFile(join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.name || 'pelulu-cli';
  } catch {
    return 'pelulu-cli';
  }
}

/**
 * Fetch latest version from npm registry.
 * Returns { version, url } or null on failure.
 */
async function fetchLatestFromNpm(packageName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${NPM_REGISTRY_URL}/${packageName}/latest`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const version = data.version;
    if (!version) return null;

    return {
      version,
      url: `https://www.npmjs.com/package/${packageName}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check for updates (from npm registry).
 * Returns:
 *   { available: true, local, remote, npm_url }  — update available
 *   { available: false, local, remote }           — up to date
 *   { available: false, error: true, message }    — check failed
 */
export async function checkForUpdates(root) {
  const localVersion = await getLocalVersion(root);
  if (!localVersion) {
    return { available: false, error: true, message: 'Could not read local version from package.json' };
  }

  const packageName = await getPackageName(root);
  const npm = await fetchLatestFromNpm(packageName);
  if (!npm) {
    return { available: false, error: true, local: localVersion, message: 'Could not fetch npm registry' };
  }

  const localParsed = parseSemver(localVersion);
  const remoteParsed = parseSemver(npm.version);

  if (!localParsed || !remoteParsed) {
    return { available: false, error: true, local: localVersion, remote: npm.version, message: 'Invalid version format' };
  }

  const cmp = compareSemver(remoteParsed, localParsed);

  if (cmp > 0) {
    return {
      available: true,
      local: localVersion,
      remote: npm.version,
      release: { url: npm.url },
    };
  }

  return {
    available: false,
    local: localVersion,
    remote: npm.version,
  };
}
