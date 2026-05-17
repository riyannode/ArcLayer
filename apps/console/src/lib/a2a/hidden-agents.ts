/**
 * Soft-hide config for AgentRegistry (v1) test agents.
 *
 * Agents listed here are filtered from the public /api/a2a/agents response
 * but remain on-chain and in the raw indexer. This is reversible — remove
 * an ID from this set to un-hide it.
 *
 * NOTE: These are AgentRegistry agents (test junk). Hermes/Pythia live in
 * A2AAgentRegistry and are NOT affected by this filter.
 *
 * Snapshot taken 2026-05-17 from indexer.arclayers.xyz/agents.
 * To un-hide any agent, simply remove its ID from this set.
 */
export const HIDDEN_AGENT_IDS: ReadonlySet<string> = new Set([
  // Early sequential test agents (1, 3)
  '1',
  '3',

  // QA / E2E burners
  '1778814739',
  '11638324083506658977',

  // arclayer://agent/* test registrations
  '17611181715839556196181856844424107154700587505403014798886521120353989672428',
  '26376554243857730040358699378827119729445318920046711339608035909971011361120',
  '26862021168120898508811658612636024010972295819109983998318047752338467433000',
  '43010280667384004654441207986232896993269182950646931792897788114357618285314',
  '43518756578371881798496742456647510799687939488477133760430373164777896262673',
  '54848283863043510111052540287598096325112087960936065492277646804763701445751',
  '93017827286593744430470454524534309857931460864221571198937481383395753127247',
  '96088972772758452070668836347711605857596597805923605477664403247250713392725',
  '99744365467954857222882204325416987054501684726584290546707581533988967779300',
]);

/**
 * Returns true if the agent should be hidden from public API responses.
 * Does NOT affect raw indexer data or on-chain state.
 */
export function isHiddenAgent(agentId: string): boolean {
  return HIDDEN_AGENT_IDS.has(agentId);
}
