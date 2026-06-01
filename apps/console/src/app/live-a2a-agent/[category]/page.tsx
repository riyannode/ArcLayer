import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentCategory } from '../categories';
import { A2ACategoryPageView } from '@/components/agent-bridge/A2ACategoryPageView';

type PageProps = { params: Promise<{ category: string }> };

export default async function LiveA2AAgentCategoryPage({ params }: PageProps) {
  const { category: categoryKey } = await params;
  const category = getAgentCategory(categoryKey);

  if (!category) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8]">
        <div className="mx-auto max-w-3xl rounded-sm border border-white/10 bg-black/30 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
            Unknown Category
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.14em]">
            Category not found
          </h1>
          <Link
            href="/live-a2a-agent"
            className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/35 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]"
          >
            Back to marketplace →
          </Link>
        </div>
      </main>
    );
  }

  if (categoryKey === 'prediction-market-bots') {
    redirect('/live-a2a-agent/prediction-market-bots');
  }

  return <A2ACategoryPageView category={category} />;
}
