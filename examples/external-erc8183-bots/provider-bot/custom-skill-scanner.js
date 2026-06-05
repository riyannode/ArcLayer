/**
 * Custom Skill Safety Scanner — defense-in-depth for external custom skill.md files.
 *
 * Scans custom skill content for obviously unsafe instructions that could:
 * - Exfiltrate secrets (private keys, API keys, .env contents)
 * - Override JSON output schema
 * - Control transactions (sign, send, fund, settle, reject, refund)
 * - Bypass validation
 *
 * This is a lightweight heuristic layer — the strict JSON validator and
 * sanitizePayload remain the final authority on output safety.
 */

// ── Unsafe phrase patterns (case-insensitive) ──────────────────────────────
// Each pattern is tested against the full skill content.
// Matched phrase is reported for logging, but full file content is NEVER logged.

const UNSAFE_PATTERNS = [
  // Secret exfiltration
  { pattern: /print\s+private\s+key/i, category: 'secret-exfil', description: 'print private key' },
  { pattern: /output\s+private\s+key/i, category: 'secret-exfil', description: 'output private key' },
  { pattern: /show\s+private\s+key/i, category: 'secret-exfil', description: 'show private key' },
  { pattern: /reveal\s+private\s+key/i, category: 'secret-exfil', description: 'reveal private key' },
  { pattern: /display\s+private\s+key/i, category: 'secret-exfil', description: 'display private key' },
  { pattern: /dump\s+private\s+key/i, category: 'secret-exfil', description: 'dump private key' },
  { pattern: /show\s+api\s+key/i, category: 'secret-exfil', description: 'show api key' },
  { pattern: /print\s+api\s+key/i, category: 'secret-exfil', description: 'print api key' },
  { pattern: /output\s+api\s+key/i, category: 'secret-exfil', description: 'output api key' },
  { pattern: /cat\s+\.env/i, category: 'secret-exfil', description: 'cat .env' },
  { pattern: /read\s+\.env/i, category: 'secret-exfil', description: 'read .env' },
  { pattern: /output\s+wallet\s+secret/i, category: 'secret-exfil', description: 'output wallet secret' },
  { pattern: /print\s+wallet\s+secret/i, category: 'secret-exfil', description: 'print wallet secret' },
  { pattern: /show\s+wallet\s+secret/i, category: 'secret-exfil', description: 'show wallet secret' },

  // Schema override attempts
  { pattern: /ignore\s+json\s+schema/i, category: 'schema-override', description: 'ignore json schema' },
  { pattern: /do\s+not\s+return\s+json/i, category: 'schema-override', description: 'do not return json' },
  { pattern: /output\s+markdown\s+instead\s+of\s+json/i, category: 'schema-override', description: 'output markdown instead of json' },
  { pattern: /return\s+markdown\s+instead\s+of\s+json/i, category: 'schema-override', description: 'return markdown instead of json' },
  { pattern: /skip\s+json\s+validation/i, category: 'schema-override', description: 'skip json validation' },
  { pattern: /bypass\s+validation/i, category: 'schema-override', description: 'bypass validation' },
  { pattern: /disable\s+validation/i, category: 'schema-override', description: 'disable validation' },

  // Transaction control
  { pattern: /sign\s+transaction/i, category: 'tx-control', description: 'sign transaction' },
  { pattern: /send\s+transaction/i, category: 'tx-control', description: 'send transaction' },
  { pattern: /fund\s+job/i, category: 'tx-control', description: 'fund job' },
  { pattern: /settle\s+job/i, category: 'tx-control', description: 'settle job' },
  { pattern: /reject\s+job/i, category: 'tx-control', description: 'reject job' },
  { pattern: /refund\s+job/i, category: 'tx-control', description: 'refund job' },
  { pattern: /approve\s+.*spending/i, category: 'tx-control', description: 'approve spending' },
  { pattern: /transfer\s+.*usdc/i, category: 'tx-control', description: 'transfer USDC' },
];

/**
 * Scan custom skill content for unsafe phrases.
 *
 * @param {string} content - the skill file content
 * @returns {{ safe: boolean, matches: Array<{ category: string, description: string }> }}
 */
function scanCustomSkill(content) {
  if (!content || typeof content !== 'string') {
    return { safe: true, matches: [] };
  }

  const matches = [];

  for (const { pattern, category, description } of UNSAFE_PATTERNS) {
    if (pattern.test(content)) {
      matches.push({ category, description });
    }
  }

  // Deduplicate by description
  const seen = new Set();
  const unique = matches.filter(m => {
    if (seen.has(m.description)) return false;
    seen.add(m.description);
    return true;
  });

  return {
    safe: unique.length === 0,
    matches: unique,
  };
}

module.exports = { scanCustomSkill, UNSAFE_PATTERNS };
