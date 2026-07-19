/**
 * Update Checker — compare local version with GitHub releases
 * Uses: https://api.github.com/repos/venenapro/Pelulu-CLI/releases
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/venenapro/Pelulu-CLI/releases';
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
 * Fetch latest release from GitHub API.
 * Returns { tag, name, body, url, publishedAt } or null on failure.
 */
async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Pelulu-CLI',
      },
    });

    if (!res.ok) return null;

    const releases = await res.json();
    if (!Array.isArray(releases) || releases.length === 0) return null;

    // Filter out prerelease/draft, pick latest stable
    const stable = releases.find(r => !r.prerelease && !r.draft) || releases[0];

    return {
      tag: stable.tag_name || '',
      name: stable.name || stable.tag_name || '',
      body: stable.body || '',
      url: stable.html_url || '',
      publishedAt: stable.published_at || '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check for updates.
 * Returns:
 *   { available: true, local, remote, release }  — update available
 *   { available: false, local, remote }           — up to date
 *   { available: false, error: true, message }    — check failed
 */
export async function checkForUpdates(root) {
  const localVersion = await getLocalVersion(root);
  if (!localVersion) {
    return { available: false, error: true, message: 'Could not read local version from package.json' };
  }

  const release = await fetchLatestRelease();
  if (!release) {
    return { available: false, error: true, local: localVersion, message: 'Could not fetch GitHub releases' };
  }

  const localParsed = parseSemver(localVersion);
  const remoteParsed = parseSemver(release.tag);

  if (!localParsed || !remoteParsed) {
    return { available: false, error: true, local: localVersion, remote: release.tag, message: 'Invalid version format' };
  }

  const cmp = compareSemver(remoteParsed, localParsed);

  if (cmp > 0) {
    return {
      available: true,
      local: localVersion,
      remote: release.tag.replace(/^v/i, ''),
      release,
    };
  }

  return {
    available: false,
    local: localVersion,
    remote: release.tag.replace(/^v/i, ''),
  };
}
