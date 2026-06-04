/**
 * Smart Contract Provider Profile — backward compatibility shim.
 *
 * Re-exports from role-aware-profile.js.
 * New code should import from role-aware-profile.js directly.
 *
 * @deprecated Use role-aware-profile.js for all new provider roles.
 */

const {
  buildMessages,
  sanitizePayload,
  buildSystemPrompt,
  DASHBOARD_PROVIDER_ROLES,
} = require('./role-aware-profile');

// Legacy export — buildMessages now accepts agentType in opts
// When called without agentType, defaults to 'smart-contract' for backward compat
function buildMessagesLegacy(job, opts = {}) {
  return buildMessages(job, {
    ...opts,
    agentType: opts.agentType || 'smart-contract',
  });
}

module.exports = {
  buildMessages: buildMessagesLegacy,
  sanitizePayload,
  SYSTEM_PROMPT: buildSystemPrompt(
    'smart-contract',
    'Smart Contract Agent',
    DASHBOARD_PROVIDER_ROLES['smart-contract'].expertise,
  ),
};
