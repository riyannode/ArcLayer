import { ConnectWallet } from "@/components/ConnectWallet";
import { X402PayButton } from "@/components/X402PayButton";
import { RegisterAgentCard } from "@/components/RegisterAgentCard";
import { CreateJobCard } from "@/components/CreateJobCard";

export default function Home() {
  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Arc x402 Agent Starter</h1>
      <ConnectWallet />
      <X402PayButton resource="/api/x402/protected-resource" label="Unlock protected resource" />
      <RegisterAgentCard />
      <CreateJobCard />
    </main>
  );
}
