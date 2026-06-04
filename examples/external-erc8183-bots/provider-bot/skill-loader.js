/**
 * Skill Loader — layered skill.md support for ERC-8183 provider bots.
 *
 * Loads skill content in priority order:
 *   1. Base skill (erc8183-provider.md) — safety/protocol rules
 *   2. Type skill — auto-selected from PROVIDER_AGENT_TYPE or explicit PROVIDER_SKILL
 *   3. Custom skill — optional external provider-specific instructions
 *
 * Results are cached by composite key to avoid disk reads every job cycle.
 */

const fs = require('node:fs');
const path = require('node:path');

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

// ── Cache ───────────────────────────────────────────────────────────────────
// Keyed by `${providerSkill}:${agentType}:${customSkillPath}`.
// Skill files are static per PM2 process lifetime — no need to re-read.

const _cache = new Map();

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

  // Layer 3: Custom skill (optional)
  let custom = '';
  if (customSkillPath) {
    const resolvedPath = path.resolve(customSkillPath);
    custom = readTextFile(resolvedPath, 'custom provider skill');
    if (!custom) {
      console.warn(`[skills] Custom skill path set but unreadable: ${resolvedPath}`);
    }
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

module.exports = {
  loadProviderSkills,
  resolveSkillFilename,
  isValidSkillKey,
  SKILL_MAP,
  VALID_SKILL_KEYS,
};
