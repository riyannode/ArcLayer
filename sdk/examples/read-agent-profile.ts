import { formatUnits } from "viem";
import { readAgentProfile } from "@arclayer/sdk";

async function main(agentId: bigint) {
  const profile = await readAgentProfile(agentId);

  return {
    agentId: profile.agent.agentId.toString(),
    controller: profile.agent.controller,
    metadataURI: profile.agent.metadataURI,
    reputationScore: profile.score.toString(),
    totalJobs: profile.jobs.length,
    proofs: profile.proofs.map((proof) => ({
      jobId: proof.jobId.toString(),
      amountPaid: formatUnits(proof.amountPaid, 6),
      metadataURI: proof.metadataURI,
    })),
  };
}

main(1n)
  .then((profile) => console.log(JSON.stringify(profile, null, 2)))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
