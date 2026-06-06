/**
 * Skill Loader — layered skill.md support for ERC-8183 provider bots.
 *
 * Loads skill content in priority order:
 *   1. Base skill (erc8183-provider.md) — safety/protocol rules
 *   2. Type skill — auto-selected from PROVIDER_AGENT_TYPE or explicit PROVIDER_SKILL
 *   3. Custom skill — optional external provider-specific instructions
 *
 * Results are cached by composite key to avoid disk reads every job cycle.
 *
 * v2 hardening:
 *   - Custom skill path must be absolute (production)
 *   - Custom skill must be a regular file, readable, non-empty, <= 50KB
 *   - Symlinks are resolved — final target must pass all checks
 *   - Unsafe phrase scanner runs on custom skill content
 *   - Only basename and size are logged (no full path, no content)
 */

const fs = require('node:fs');
const path = require('node:path');
const { scanCustomSkill } = require('./custom-skill-scanner');

// ── Skill file mapping ──────────────────────────────────────────────────────
// Maps PROVIDER_SKILL / PROVIDER_AGENT_TYPE values to skill filenames.
// Roles without dedicated skills fall back to general-provider.md.

const SKILL_MAP = {
  'smart-contract': 'smart-contract-provider.md',
  'frontend':       'frontend-provider.md',
  'backend':        'backend-provider.md',
  'devops':         'devops-provider.md',
  'data-analysis':  'data-analysis-provider.md',
  'design':         'general-provider.md',
  'documentation':  'general-provider.md',
  'analysis':       'general-provider.md',
  'general':        'general-provider.md',
  'other':          'general-provider.md',
};

// Valid PROVIDER_SKILL values (key names only, no filenames)
const VALID_SKILL_KEYS = new Set(Object.keys(SKILL_MAP));

// Custom skill size limits
const CUSTOM_SKILL_MIN_BYTES = 1;
const CUSTOM_SKILL_MAX_BYTES = 50_000;

// ── Cache ───────────────────────────────────────────────────────────────────
// Keyed by `${providerSkill}:${agentType}:${customSkillPath}`.
// Skill files are static per PM2 process lifetime — no need to re-read.

const _cache = new Map();

// ── Custom skill validation result ──────────────────────────────────────────
// Stored for health diagnostics.

let _lastCustomSkillValidation = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a text file safely. Returns empty string on failure.
 * Never throws — caller decides how to handle missing content.
 */
function readTextFile(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    console.warn(`[skills] Could not load ${label}: ${err.message}`);
    return '';
  }
}

/**
 * Validate a custom skill path for production safety.
 *
 * @param {string} rawPath - the raw PROVIDER_CUSTOM_SKILL_PATH value
 * @returns {{ valid: boolean, resolvedPath: string, reason: string, basename: string, size: number }}
 */
function validateCustomSkillPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return { valid: true, resolvedPath: '', reason: '', basename: '', size: 0 };
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { valid: true, resolvedPath: '', reason: '', basename: '', size: 0 };
  }

  // Must be absolute for production
  if (!path.isAbsolute(trimmed)) {
    return {
      valid: false,
      resolvedPath: trimmed,
      reason: 'Custom skill path must be absolute (e.g. /home/user/skills/my-skill.md)',
      basename: path.basename(trimmed),
      size: 0,
    };
  }

  const resolved = path.resolve(trimmed);

  // Check existence
  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      resolvedPath: resolved,
      reason: `Custom skill file not found: ${path.basename(resolved)}`,
      basename: path.basename(resolved),
      size: 0,
    };
  }

  let stat;
  try {
    // lstat first to detect symlinks
    stat = fs.lstatSync(resolved);
  } catch (err) {
    return {
      valid: false,
      resolvedPath: resolved,
      reason: `Cannot stat custom skill: ${err.message}`,
      basename: path.basename(resolved),
      size: 0,
    };
  }

  // Symlink handling: resolve and validate target
  let finalStat = stat;
  let finalPath = resolved;
  if (stat.isSymbolicLink()) {
    try {
      const realPath = fs.realpathSync(resolved);
      finalStat = fs.statSync(realPath);
      finalPath = realPath;
      console.log(`[skills] Symlink resolved: ${path.basename(resolved)} -> ${path.basename(realPath)}`);
    } catch (err) {
      return {
        valid: false,
        resolvedPath: resolved,
        reason: `Symlink target unreadable: ${err.message}`,
        basename: path.basename(resolved),
        size: 0,
      };
    }
  }

  // Must be a regular file
  if (!finalStat.isFile()) {
    return {
      valid: false,
      resolvedPath: finalPath,
      reason: `Custom skill path is not a regular file: ${path.basename(finalPath)}`,
      basename: path.basename(finalPath),
      size: 0,
    };
  }

  // Reject .env files
  const baseName = path.basename(finalPath).toLowerCase();
  if (baseName === '.env' || baseName.endsWith('.env')) {
    return {
      valid: false,
      resolvedPath: finalPath,
      reason: 'Custom skill path must not be a .env file',
      basename: path.basename(finalPath),
      size: 0,
    };
  }

  // Size checks
  if (finalStat.size < CUSTOM_SKILL_MIN_BYTES) {
    return {
      valid: false,
      resolvedPath: finalPath,
      reason: `Custom skill file is empty (0 bytes)`,
      basename: path.basename(finalPath),
      size: finalStat.size,
    };
  }

  if (finalStat.size > CUSTOM_SKILL_MAX_BYTES) {
    return {
      valid: false,
      resolvedPath: finalPath,
      reason: `Custom skill file is too large: ${finalStat.size} bytes (max ${CUSTOM_SKILL_MAX_BYTES})`,
      basename: path.basename(finalPath),
      size: finalStat.size,
    };
  }

  // Readable check
  try {
    fs.readFileSync(finalPath, 'utf8');
  } catch (err) {
    return {
      valid: false,
      resolvedPath: finalPath,
      reason: `Custom skill file unreadable: ${err.message}`,
      basename: path.basename(finalPath),
      size: finalStat.size,
    };
  }

  return {
    valid: true,
    resolvedPath: finalPath,
    reason: '',
    basename: path.basename(finalPath),
    size: finalStat.size,
  };
}

/**
 * Resolve the type skill filename from PROVIDER_SKILL and PROVIDER_AGENT_TYPE.
 *
 * Priority:
 *   1. If PROVIDER_SKILL is a valid key (not 'auto'), use that key's mapping
 *   2. If PROVIDER_SKILL is 'auto' or empty, use PROVIDER_AGENT_TYPE
 *   3. Fallback to general-provider.md
 */
function resolveSkillFilename(providerSkill, agentType) {
  const selected = String(providerSkill || 'auto').trim().toLowerCase();

  if (selected && selected !== 'auto') {
    // Explicit key — must be valid
    if (!VALID_SKILL_KEYS.has(selected)) {
      console.warn(`[skills] Unknown PROVIDER_SKILL "${selected}", falling back to auto-detect`);
    } else {
      return SKILL_MAP[selected];
    }
  }

  // Auto-detect from agent type
  const type = String(agentType || 'other').trim().toLowerCase();
  return SKILL_MAP[type] || 'general-provider.md';
}

/**
 * Load and combine all skill layers for a provider bot.
 * Results are cached — subsequent calls with the same params return instantly.
 *
 * @param {Object} opts
 * @param {string} opts.agentType - PROVIDER_AGENT_TYPE value
 * @param {string} [opts.providerSkill='auto'] - PROVIDER_SKILL value
 * @param {string} [opts.customSkillPath] - PROVIDER_CUSTOM_SKILL_PATH value
 * @returns {string} Combined skill content (empty string if all layers fail)
 */
function loadProviderSkills({ agentType, providerSkill, customSkillPath } = {}) {
  const cacheKey = `${providerSkill || 'auto'}:${agentType || ''}:${customSkillPath || ''}`;
  if (_cache.has(cacheKey)) {
    return _cache.get(cacheKey);
  }

  const skillsDir = path.join(__dirname, 'skills');

  // Layer 1: Base skill (always loaded)
  const base = readTextFile(
    path.join(skillsDir, 'erc8183-provider.md'),
    'base provider skill',
  );

  // Layer 2: Type skill
  const typeFilename = resolveSkillFilename(providerSkill, agentType);
  const typed = readTextFile(
    path.join(skillsDir, typeFilename),
    `type skill ${typeFilename}`,
  );

  // Layer 3: Custom skill (optional, with v2 validation)
  let custom = '';
  let customSkillInfo = { configured: false, basename: '', size: 0, scannerPass: true, matches: [] };

  if (customSkillPath && customSkillPath.trim()) {
    const validation = validateCustomSkillPath(customSkillPath);
    customSkillInfo.configured = true;

    if (!validation.valid) {
      console.error(`[skills] Custom skill validation failed: ${validation.reason}`);
      customSkillInfo.basename = validation.basename;
      _lastCustomSkillValidation = { ...customSkillInfo, valid: false, reason: validation.reason };
      // Don't load — custom skill is optional, proceed without it
    } else {
      custom = readTextFile(validation.resolvedPath, 'custom provider skill');
      customSkillInfo.basename = validation.basename;
      customSkillInfo.size = validation.size;

      if (custom) {
        // Run safety scanner
        const scanResult = scanCustomSkill(custom);
        customSkillInfo.scannerPass = scanResult.safe;
        customSkillInfo.matches = scanResult.matches;

        if (!scanResult.safe) {
          const phrases = scanResult.matches.map(m => m.description).join(', ');
          console.error(`[skills] UNSAFE custom skill detected — contains: ${phrases}`);
          console.error(`[skills] Custom skill NOT loaded — falling back to base+type only`);
          custom = ''; // Do not load unsafe content
        } else {
          console.log(
            `[skills] Custom skill loaded: ${validation.basename} (${validation.size} bytes) — scanner PASS`,
          );
        }
      } else {
        console.warn(`[skills] Custom skill path set but empty/unreadable: ${validation.basename}`);
      }

      _lastCustomSkillValidation = { ...customSkillInfo, valid: validation.valid && !!custom };
    }
  } else {
    _lastCustomSkillValidation = { ...customSkillInfo, valid: true };
  }

  // Combine layers with section headers
  const parts = [
    '## ArcLayer Base Provider Skill\n\n' + base,
    '## ArcLayer Type Provider Skill\n\n' + typed,
    custom ? '## External Provider Custom Skill\n\n' + custom : '',
  ].filter(Boolean);

  const combined = parts.join('\n\n---\n\n');

  // Log summary (not full content)
  const baseLines = base ? base.split('\n').length : 0;
  const typedLines = typed ? typed.split('\n').length : 0;
  const customLines = custom ? custom.split('\n').length : 0;
  console.log(
    `[skills] Loaded: base=${baseLines}L, type=${typeFilename}(${typedLines}L)` +
    (custom ? `, custom=${customLines}L` : ''),
  );

  _cache.set(cacheKey, combined);
  return combined;
}

/**
 * Validate that a PROVIDER_SKILL value is recognized.
 * Returns true if valid or 'auto'.
 */
function isValidSkillKey(value) {
  if (!value || value === 'auto') return true;
  return VALID_SKILL_KEYS.has(String(value).trim().toLowerCase());
}

/**
 * Get the last custom skill validation result (for health diagnostics).
 */
function getLastCustomSkillValidation() {
  return _lastCustomSkillValidation;
}

module.exports = {
  loadProviderSkills,
  resolveSkillFilename,
  isValidSkillKey,
  validateCustomSkillPath,
  getLastCustomSkillValidation,
  SKILL_MAP,
  VALID_SKILL_KEYS,
};
