'use client';

/**
 * ExternalBotWizard — multi-step onboarding wizard.
 *
 * Steps:
 *   1. Category Selection
 *   2. Template Selection
 *   3. Role Builder
 *   4. Wallet + Chain Check
 *   5. Register Identity (ERC-8004)
 *   6. Publish Manifest (x402 paid fetch)
 *   7. Generate API Keys
 *   8. Runtime Export (env + PM2 command)
 *   9. Health Check
 *
 * agentId consistency (fix #3):
 *   - After ERC-8004 mint, txRow.agentId = minted token ID
 *   - Manifest uses minted token ID
 *   - API key uses minted token ID
 *   - Env ARCLAYER_AGENT_ID = minted token ID
 *   - Branded name goes into RUNTIME_ID prefix only
 *   - This ensures bridge event agentId matches key agentId
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';

import { AGENT_CATEGORIES, getAgentCategory } from '@/app/live-a2a-agent/categories';
import { getTemplate, getTemplatesByCategory, type ExternalBotTemplate, type BotRole } from '@/lib/external-bot/templates';
import { buildExternalBotManifest, type ManifestBuildInput } from '@/lib/external-bot/buildManifest';
import { buildEnvBundle } from '@/lib/external-bot/buildEnvBundle';
import { buildInstallCommand } from '@/lib/external-bot/buildInstallCommand';
import { scopesForRole } from '@/lib/external-bot/scopes';

import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { useArcSign } from '@/hooks/useArcSign';
import { useX402PaidFetch } from '@/hooks/useX402PaidFetch';
import { safeJson } from '@/lib/safeFetch';
import { buildRegisterAgentConfig } from '@arclayer/sdk';
import { extractERC8004MintedTokenIdFromReceipt } from '@/lib/contracts/erc8004';
import { config } from '@/lib/wagmi';
import { manifestHash, buildManifestMessage } from '@/lib/a2a/manifest';

type Step = 'category' | 'template' | 'roles' | 'wallet' | 'register' | 'manifest' | 'keys' | 'export' | 'health';

type TxRow = {
  roleId: string;
  /** agentId used for manifest, keys, and env. After mint: set to mintedTokenId. */
  agentId: string;
  /** Branded display name (e.g. hermes-oracle). Stays in RUNTIME_ID prefix only. */
  brandedName: string;
  step: 'pending' | 'signing' | 'tx' | 'minted' | 'failed';
  txHash?: string;
  mintedTokenId?: string;
  manifestHash?: string;
  apiKey?: string;
  error?: string;
};

type EditableRole = {
  roleId: string;
  botRole: string;
  displayName: string;
  brandedName: string;
  capabilities: string[];
  endpointPath: string;
  scopes: string[];
};

const STEPS: Step[] = ['category', 'template', 'roles', 'wallet', 'register', 'manifest', 'keys', 'export', 'health'];

const STEP_LABELS: Record<Step, string> = {
  category: 'Category',
  template: 'Template',
  roles: 'Roles',
  wallet: 'Wallet',
  register: 'Register',
  manifest: 'Manifest',
  keys: 'API Keys',
  export: 'Export',
  health: 'Health',
};

const ARC_CHAIN_ID = 5042002;

export default function ExternalBotWizard() {
  // ── Core state ──────────────────────────────────────────────
  const [step, setStep] = useState<Step>('category');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [priceAtomic, setPriceAtomic] = useState('1000');
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [envBundleStr, setEnvBundleStr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [payoutAddress, setPayoutAddress] = useState('');
  const [serviceEndpointUrl, setServiceEndpointUrl] = useState('');

  // ── Editable roles state (customizable in Step 3) ──────────
  const [editableRoles, setEditableRoles] = useState<EditableRole[]>([]);
  const [slugErrors, setSlugErrors] = useState<Record<string, string>>({});

  const SLUG_REGEX = /^[a-z0-9-]{3,64}$/;

  // ── Hooks ──────────────────────────────────────────────────
  const { isConnected, address, mode } = useArcWallet();
  const { chainId } = useAccount();
  const { writeContractAsync } = useArcWrite();
  const { signMessageAsync } = useArcSign();
  const { paidFetch } = useX402PaidFetch();

  // ── Derived ─────────────────────────────────────────────────
  const template = useMemo(() => selectedTemplateId ? getTemplate(selectedTemplateId) : null, [selectedTemplateId]);
  const categoryConfig = useMemo(() => selectedCategory ? getAgentCategory(selectedCategory) : null, [selectedCategory]);
  const isOnArc = chainId === ARC_CHAIN_ID;

  const stepIdx = STEPS.indexOf(step);

  // Build activeTemplate: overrides template.roles with the user's selected editableRoles.
  // All downstream operations (register, manifest, keys, export, install) use this.
  const activeTemplate = useMemo(() => {
    if (!template) return null;
    // Only override when template has availableRoles (multi-role catalog)
    if (!template.availableRoles) return template;
    return {
      ...template,
      roles: editableRoles.map((er) => {
        const catalogRole = template.availableRoles!.find((ar) => ar.roleId === er.roleId);
        const base = catalogRole || template.roles[0];
        return {
          ...base,
          displayName: er.displayName,
          defaultAgentId: er.brandedName,
          botRole: er.botRole,
          capabilities: er.capabilities,
          endpointPath: er.endpointPath,
          scopes: er.scopes,
        } as BotRole;
      }),
    };
  }, [template, editableRoles]);

  // ── Helpers ─────────────────────────────────────────────────
  const getAgentId = useCallback((row: TxRow, fallback: string): string => {
    // After mint: row.agentId = minted token ID, row.mintedTokenId also set
    // Before mint: fall back to default agentId
    return row.agentId || fallback;
  }, []);

  // ── Step 1: Category ────────────────────────────────────────
  const handleSelectCategory = useCallback((key: string) => {
    setSelectedCategory(key);
    setSelectedTemplateId(null);
    setError(null);
    setStep('template');
  }, []);

  // Preselect category from URL ?category= on mount
  // Handles category-aware entry points like /register/external-bot?category=prediction-market-bots
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('category');
      if (cat && AGENT_CATEGORIES.some((c) => c.key === cat)) {
        handleSelectCategory(cat);
      }
    }
  }, [handleSelectCategory]);

  // ── Step 2: Template ────────────────────────────────────────
  const templates = useMemo(() =>
    selectedCategory ? getTemplatesByCategory(selectedCategory) : []
  , [selectedCategory]);

  const handleSelectTemplate = useCallback((tid: string) => {
    setSelectedTemplateId(tid);
    setError(null);
    const t = getTemplate(tid);
    if (t) {
      setEditableRoles(t.roles.map((r) => ({
        roleId: r.roleId,
        botRole: r.botRole,
        displayName: r.displayName,
        brandedName: r.defaultAgentId,
        capabilities: r.capabilities,
        endpointPath: r.endpointPath,
        scopes: r.scopes,
      })));
      setSlugErrors({});
    }
    setStep('roles');
  }, [template, editableRoles]);

  // ── Role management helpers (for templates with availableRoles) ──
  // Single-role model: switching replaces the only editableRole.
  const handleSwitchRole = useCallback((oldRoleId: string, newRoleId: string) => {
    if (!template?.availableRoles) return;
    const catalogRole = template.availableRoles.find((r) => r.roleId === newRoleId);
    if (!catalogRole) return;
    setEditableRoles([{
      roleId: catalogRole.roleId,
      botRole: catalogRole.botRole,
      displayName: catalogRole.displayName,
      brandedName: catalogRole.defaultAgentId,
      capabilities: catalogRole.capabilities,
      endpointPath: catalogRole.endpointPath,
      scopes: catalogRole.scopes,
    }]);
  }, [template]);

  // ── Step 3: Roles (preview) ─────────────────────────────────
  const roleRows = useMemo(() => {
    if (!activeTemplate) return [];
    return activeTemplate.roles.map((r) => ({
      roleId: r.roleId,
      displayName: r.displayName,
      brandedName: r.defaultAgentId,
      botRole: r.botRole,
      capabilities: r.capabilities.join(', '),
      scopes: scopesForRole(r.scopes, activeTemplate!.recommendedMode).join(', '),
    }));
  }, [activeTemplate]);

  const handleRolesConfirm = useCallback(() => {
    if (!activeTemplate) return;
    // Validate slugs + display names before confirming
    const errors: Record<string, string> = {};
    const seenSlugs = new Set<string>();

    for (const er of editableRoles) {
      if (!er.displayName.trim()) {
        errors[er.roleId] = 'Display Name is required.';
        continue;
      }

      if (!SLUG_REGEX.test(er.brandedName)) {
        errors[er.roleId] = `Slug "${er.brandedName}" invalid. Lowercase, 3-64 chars, hyphen allowed.`;
        continue;
      }

      if (seenSlugs.has(er.brandedName)) {
        errors[er.roleId] = `Slug "${er.brandedName}" is duplicated. Use a unique runtime slug per role.`;
        continue;
      }

      seenSlugs.add(er.brandedName);
    }
    setSlugErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Fix slug/name errors before proceeding.');
      return;
    }
    const rows: TxRow[] = editableRoles.map((r) => ({
      roleId: r.roleId,
      agentId: r.brandedName,
      brandedName: r.brandedName,
      step: 'pending',
    }));
    setTxRows(rows);
    setError(null);
    setStep('wallet');
  }, [activeTemplate, editableRoles]);

  // ── Step 4: Wallet ──────────────────────────────────────────
  const handleWalletConfirm = useCallback(() => {
    if (!isConnected) { setError('Connect wallet first'); return; }
    if (!isOnArc) { setError('Switch to Arc Testnet (chain 5042002)'); return; }
    setError(null);
    setStep('register');
  }, [isConnected, isOnArc]);

  // ── Step 5: Register Identity (ERC-8004) ────────────────────
  const handleRegister = useCallback(async () => {
    if (!activeTemplate || !address) return;
    setIsBusy(true);
    setError(null);

    const newRows = [...txRows];

    for (let i = 0; i < activeTemplate.roles.length; i++) {
      const role = activeTemplate.roles[i];
      const edRole = editableRoles[i];
      newRows[i] = { ...newRows[i], step: 'signing' };
      setTxRows([...newRows]);

      try {
        // Register ERC-8004 with custom branded metadata URI
        const metadataURI = `arclayer://manifest/${(edRole?.brandedName || role.defaultAgentId)}`;
        newRows[i] = { ...newRows[i], step: 'tx' };
        setTxRows([...newRows]);

        const hash = await writeContractAsync(buildRegisterAgentConfig(metadataURI));
        const receipt = await waitForTransactionReceipt(config, { hash });
        const mintedTokenId = extractERC8004MintedTokenIdFromReceipt(receipt, address);
        const tokenId = mintedTokenId?.toString();

        // (fix #3) After mint: agentId = minted token ID for consistency
        // Branded name stays in brandedName for RUNTIME_ID prefix
        newRows[i] = {
          ...newRows[i],
          agentId: tokenId || role.defaultAgentId,
          step: 'minted',
          mintedTokenId: tokenId || 'unknown',
          txHash: hash,
        };
        setTxRows([...newRows]);
      } catch (err) {
        newRows[i] = {
          ...newRows[i],
          step: 'failed',
          error: err instanceof Error ? err.message : 'register_failed',
        };
        setTxRows([...newRows]);
        setError(`Register failed for ${edRole?.displayName || role.displayName}: ${err instanceof Error ? err.message : 'unknown'}`);
        setIsBusy(false);
        return;
      }
    }

    setIsBusy(false);
  }, [activeTemplate, address, txRows, editableRoles, writeContractAsync]);

  // ── Step 6: Publish Manifest (x402) ─────────────────────────
  // (fix #1) method: POST (not PUT)
  // (fix #2) use canonical manifestHash + buildManifestMessage from lib
  const handlePublishManifest = useCallback(async () => {
    if (!activeTemplate || !address) return;
    setIsBusy(true);
    setError(null);

    const newRows = [...txRows];

    for (let i = 0; i < activeTemplate.roles.length; i++) {
      const role = activeTemplate.roles[i];
      const edRole = editableRoles[i];
      const agentId = getAgentId(newRows[i], role.defaultAgentId);

      try {
        const input: ManifestBuildInput = {
          template: activeTemplate!,
          agentId,
          roleIndex: i,
          controller: address,
          endpoint: serviceEndpointUrl || role.endpointPath,
          priceAtomic,
          payerWallet: payoutAddress || address,
          roleDisplayName: edRole?.displayName,
          roleBrandedName: edRole?.brandedName,
        };

        const manifest = buildExternalBotManifest(input);

        // (fix #2) Use canonical manifestHash + buildManifestMessage from lib
        const hash = manifestHash(manifest);
        const ts = Math.floor(Date.now() / 1000);
        const message = buildManifestMessage({ agentId, manifestHash: hash, ts });
        const signature = await signMessageAsync({ message });

        // (fix #1) POST, not PUT
        const result = await paidFetch('/api/a2a/manifest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            manifest,
            signature,
            signer: address,
            ts,
          }),
        });

        newRows[i] = { ...newRows[i], manifestHash: hash };
        setTxRows([...newRows]);
      } catch (err) {
        setError(`Manifest publish failed for ${edRole?.displayName || role.displayName}: ${err instanceof Error ? err.message : 'unknown'}`);
        setIsBusy(false);
        return;
      }
    }

    setIsBusy(false);
    setStep('keys');
  }, [activeTemplate, address, txRows, priceAtomic, payoutAddress, serviceEndpointUrl, signMessageAsync, paidFetch, getAgentId, editableRoles]);

  // ── Step 7: Generate API Keys ───────────────────────────────
  // (fix #3) agentId = minted token ID (from txRow.agentId after register)
  const handleGenerateKeys = useCallback(async () => {
    if (!activeTemplate || !address) return;
    setIsBusy(true);
    setError(null);

    const newRows = [...txRows];

    for (let i = 0; i < activeTemplate.roles.length; i++) {
      const role = activeTemplate.roles[i];
      const agentId = getAgentId(newRows[i], role.defaultAgentId);

      try {
        const ts = Math.floor(Date.now() / 1000);
        const keyMsg = [
          'ArcLayer A2A API Key',
          `action: create`,
          `agentId: ${agentId}`,
          `ts: ${ts}`,
        ].join('\n');

        const signature = await signMessageAsync({ message: keyMsg });

        const res = await fetch('/api/a2a/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            label: `${role.displayName} Runtime Key`,
            scopes: scopesForRole(role.scopes, activeTemplate!.recommendedMode),
            ts,
            signature,
          }),
        });

        const data = await safeJson<{ ok: boolean; apiKey?: string; key?: string; error?: string }>(res);
        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'key_gen_failed');
        }

        newRows[i] = { ...newRows[i], apiKey: data.apiKey || data.key || 'generated' };
        setTxRows([...newRows]);
      } catch (err) {
        setError(`Key generation failed for ${role.displayName}: ${err instanceof Error ? err.message : 'unknown'}`);
        setIsBusy(false);
        return;
      }
    }

    setIsBusy(false);
    setStep('export');
  }, [activeTemplate, address, txRows, signMessageAsync, getAgentId]);

  // ── Step 8: Export ──────────────────────────────────────────
  // (fix #3) Env uses minted token ID as ARCLAYER_AGENT_ID
  // (fix #4) Branded name goes into RUNTIME_ID prefix
  // (fix #6) Generic template = coming soon, only PM2 is runnable
  const handleBuildExport = useCallback(() => {
    if (!activeTemplate || !selectedCategory) return;

    // (fix #3) Use txRow.agentId which = minted token ID after register
    // This ensures env ARCLAYER_AGENT_ID matches key agentId
    const agentIds = txRows.map((r, i) => r.agentId || activeTemplate.roles[i]?.defaultAgentId || '');
    const apiKeys = txRows.map((r) => r.apiKey || '');
    const erc8004Ids = txRows.map((r) =>
      r.mintedTokenId ? `erc8004_identity_registry:${r.mintedTokenId}` : ''
    );
    // (fix #4) Pass branded names for RUNTIME_ID prefix
    const runtimeNames = txRows.map((r, i) =>
      r.brandedName || activeTemplate.roles[i]?.defaultAgentId || ''
    );

    const bundle = buildEnvBundle({
      template: activeTemplate,
      baseUrl: 'https://www.arclayers.xyz',
      category: selectedCategory,
      agentIds,
      apiKeys,
      erc8004Ids,
      runtimeNames,
      payoutAddress: payoutAddress || undefined,
    });

    const cmd = buildInstallCommand({
      template: activeTemplate,
      envBundle: bundle,
      roleNames: activeTemplate.roles.map((r) => r.roleId),
    });

    let exportStr = '# ── Category: ' + (categoryConfig?.label || selectedCategory) + ' ──\n';
    exportStr += `# Template: ${activeTemplate!.name}\n\n`;
    exportStr += '## .env.common\n\n';
    exportStr += bundle.common.content + '\n';

    for (const rf of bundle.roleFiles) {
      exportStr += `## ${rf.filename}\n\n`;
      exportStr += rf.content + '\n';
    }

    exportStr += '## Install Command\n\n';
    exportStr += cmd.command + '\n';

    setEnvBundleStr(exportStr);
    setInstallCmd(cmd.command);
    setError(null);
  }, [activeTemplate, selectedCategory, txRows, categoryConfig, payoutAddress]);

  const handleCopyCommand = useCallback(() => {
    if (!installCmd) return;
    navigator.clipboard.writeText(installCmd).catch(() => {});
  }, [installCmd]);

  // ── Render helpers ──────────────────────────────────────────
  const back = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  const allDone = (pred: (r: TxRow) => boolean) =>
    txRows.length > 0 && txRows.every(pred);

  // ── UI ──────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl">
      {/* Progress bar */}
      <div className="mb-6 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-full ${
              i <= stepIdx ? 'bg-[#C5A67C]' : 'bg-white/10'
            }`} title={STEP_LABELS[s]} />
            {i < STEPS.length - 1 && <div className={`h-px w-6 ${i < stepIdx ? 'bg-[#C5A67C]/50' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-[#C5A67C] mb-2">
        {STEP_LABELS[step]}
      </div>

      {/* ── Step 1: Category Selection ─────────────────────────── */}
      {step === 'category' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Choose Category
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {AGENT_CATEGORIES.filter((c) => c.status === 'LIVE').map((cat) => (
              <button
                key={cat.key}
                onClick={() => handleSelectCategory(cat.key)}
                className="rounded-sm border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-[#C5A67C]/40 hover:bg-white/[0.04]"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">{cat.label}</div>
                <p className="mt-1 text-xs text-[#EAE4D8]/70">{cat.tagline}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {cat.capabilities.map((c) => (
                    <span key={c} className="rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-[#EAE4D8]/60">
                      {c}
                    </span>
                  ))}
                </div>
                {cat.feeRange && (
                  <div className="mt-2 font-mono text-[9px] text-[#EAE4D8]/40">{cat.feeRange}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: Template Selection ─────────────────────────── */}
      {/* (fix #5) Categories without templates show 'Template coming soon' */}
      {step === 'template' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-1">
            {categoryConfig?.label}
          </h2>
          <p className="text-xs text-[#EAE4D8]/70 mb-4">{categoryConfig?.tagline}</p>

          {templates.length === 0 ? (
            <div className="rounded-sm border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-yellow-300/80">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] mb-1">Template coming soon</div>
              This category does not have an onboarding template yet. Templates are being added per category.
              Check back later or use the{' '}
              <button
                onClick={() => handleSelectCategory('custom-workers')}
                className="underline text-[#C5A67C]"
              >
                Custom Worker
              </button>{' '}
              template for a generic setup.
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t.id)}
                  className="w-full rounded-sm border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-[#C5A67C]/40 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-[#EAE4D8]">{t.name}</div>
                      <p className="mt-0.5 text-xs text-[#EAE4D8]/60">{t.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase text-[#C5A67C]">
                        {t.defaultRuntime}
                      </span>
                      <span className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase text-[#C5A67C]">
                        {t.recommendedMode}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(t.availableRoles || t.roles).map((r) => (
                      <span key={r.roleId} className="rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-[#EAE4D8]/70">
                        {r.displayName}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 font-mono text-[9px] text-[#EAE4D8]/40">
                    {t.defaultPriceLabel} per job · {t.roles.length} selected · {(t.availableRoles || t.roles).length} available
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setStep('category')}
            className="mt-4 px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]"
          >
            ← Back to categories
          </button>
        </div>
      )}

      {/* ── Step 3: Roles Preview ─────────────────────────────── */}
      {step === 'roles' && template && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-1">
            {template.name}
          </h2>
          <p className="text-xs text-[#EAE4D8]/60 mb-4">{template.description}</p>

          <div className="space-y-3 mb-4">
            {editableRoles.map((r) => (
              <div key={r.roleId} className="rounded-sm border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[#EAE4D8]">{r.botRole}</span>
                    {template.fixedBotRoleNames && (
                      <span className="rounded-sm bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[8px] text-cyan-300">
                        BOT_ROLE={r.botRole}
                      </span>
                    )}
                  </div>
                </div>

                {/* Role Selector (only when template has availableRoles) */}
                {template.availableRoles && (
                  <div className="mb-2">
                    <label className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]/60">
                      Role
                    </label>
                    <select
                      value={r.roleId}
                      onChange={(e) => handleSwitchRole(r.roleId, e.target.value)}
                      className="mt-0.5 w-full rounded-sm border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-[#EAE4D8]"
                    >
                      {template.availableRoles.map((ar) => (
                        <option key={ar.roleId} value={ar.roleId}>
                          {ar.displayName} ({ar.botRole})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Display Name (editable) */}
                <div className="mb-2">
                  <label className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]/60">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={r.displayName}
                    onChange={(e) => {
                      setEditableRoles((prev) =>
                        prev.map((pr) =>
                          pr.roleId === r.roleId ? { ...pr, displayName: e.target.value } : pr
                        )
                      );
                    }}
                    className="mt-0.5 w-full rounded-sm border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-[#EAE4D8]"
                    placeholder="My Custom Oracle"
                  />
                </div>

                {/* Runtime Slug (editable) */}
                <div className="mb-2">
                  <label className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]/60">
                    Runtime Slug
                  </label>
                  <input
                    type="text"
                    value={r.brandedName}
                    onChange={(e) => {
                      const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                      setEditableRoles((prev) =>
                        prev.map((pr) =>
                          pr.roleId === r.roleId ? { ...pr, brandedName: val } : pr
                        )
                      );
                      // Clear error for this role if valid
                      if (SLUG_REGEX.test(val) || val === '') {
                        setSlugErrors((prev) => {
                          const next = { ...prev };
                          delete next[r.roleId];
                          return next;
                        });
                      }
                    }}
                    className={`mt-0.5 w-full rounded-sm border px-2 py-1.5 font-mono text-xs text-[#EAE4D8] ${
                      slugErrors[r.roleId] ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 bg-black/40'
                    }`}
                    placeholder="my-custom-oracle"
                  />
                  {slugErrors[r.roleId] && (
                    <div className="mt-1 font-mono text-[9px] text-red-400">{slugErrors[r.roleId]}</div>
                  )}
                  <div className="mt-1 font-mono text-[9px] text-[#EAE4D8]/40">
                    RUNTIME_ID = {r.brandedName}-runtime-01
                  </div>
                </div>

                {/* Capabilities (read-only) */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {r.capabilities.map((c) => (
                    <span key={c} className="rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[8px] text-[#EAE4D8]/50">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/70">
              x402 Price (atomic USDC)
            </label>
            <input
              type="text"
              value={priceAtomic}
              onChange={(e) => setPriceAtomic(e.target.value)}
              className="mt-1 w-full rounded-sm border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-[#EAE4D8]"
              placeholder="1000"
            />
            <div className="mt-1 font-mono text-[9px] text-[#EAE4D8]/40">1000 = 0.001 USDC (6 decimals)</div>
          </div>

          <div className="mb-4">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/70">
              Service Endpoint URL <span className="text-[#EAE4D8]/30">(optional)</span>
            </label>
            <input
              type="text"
              value={serviceEndpointUrl}
              onChange={(e) => setServiceEndpointUrl(e.target.value)}
              className="mt-1 w-full rounded-sm border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-[#EAE4D8]"
              placeholder="https://agent.example.com"
            />
            <div className="mt-1 font-mono text-[9px] text-[#EAE4D8]/40">
              Public HTTPS URL if your bot has an HTTP endpoint. Leave empty for PM2-only bots.
            </div>
          </div>

          {template.fixedBotRoleNames && (
            <div className="rounded-sm border border-cyan-500/20 bg-cyan-500/5 p-3 mb-4">
              <div className="font-mono text-[10px] text-cyan-300">
                ⚠ BOT_ROLE is fixed by runtime script. Display Name and Runtime Slug are customizable.
                ARCLAYER_AGENT_ID will use the minted ERC-8004 token ID for consistency.
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleRolesConfirm}
              className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition-colors hover:bg-[#C5A67C]/20"
            >
              Confirm Roles →
            </button>
            <button onClick={() => setStep('template')} className="px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]">
              ← Back to templates
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Wallet ────────────────────────────────────── */}
      {step === 'wallet' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Connect Wallet
          </h2>

          <div className="space-y-3 mb-4">
            <div className={`rounded-sm border p-3 ${isConnected ? 'border-green-500/30 bg-green-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
              <div className="font-mono text-[10px] text-[#EAE4D8]/60 mb-1">Wallet</div>
              <div className="text-sm text-[#EAE4D8]">{isConnected ? address : 'Not connected'}</div>
            </div>

            <div className={`rounded-sm border p-3 ${isOnArc ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
              <div className="font-mono text-[10px] text-[#EAE4D8]/60 mb-1">Network</div>
              <div className="text-sm text-[#EAE4D8]">{isOnArc ? '✅ Arc Testnet (5042002)' : '⚠ Switch to Arc Testnet'}</div>
            </div>

            {activeTemplate && (
              <div className="rounded-sm border border-white/10 bg-white/[0.02] p-3">
                <div className="font-mono text-[10px] text-[#EAE4D8]/60 mb-1">Estimated Steps</div>
                <div className="text-sm text-[#EAE4D8]">
                  • {activeTemplate.roles.length} ERC-8004 register transaction{activeTemplate.roles.length > 1 ? 's' : ''}
                  • {activeTemplate.roles.length} manifest sign + x402 publish
                  • {activeTemplate.roles.length} API key sign + generate
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleWalletConfirm}
            disabled={!isConnected || !isOnArc}
            className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition-colors hover:bg-[#C5A67C]/20 disabled:opacity-40"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ── Step 5: Register ──────────────────────────────────── */}
      {step === 'register' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Register Agent Identity
          </h2>

          <TxProgressTable rows={txRows} template={activeTemplate} action="register" />

          {error && (
            <div className="mt-3 rounded-sm border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {allDone((r) => r.step === 'minted') ? (
              <button
                onClick={() => setStep('manifest')}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C]"
              >
                Next: Manifest →
              </button>
            ) : (
              <button
                onClick={handleRegister}
                disabled={isBusy}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition-colors hover:bg-[#C5A67C]/20 disabled:opacity-40"
              >
                {isBusy ? 'Registering…' : 'Register Agent'}
              </button>
            )}
            <button onClick={back} className="px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 6: Manifest ──────────────────────────────────── */}
      {step === 'manifest' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Publish Manifest (x402)
          </h2>

          <TxProgressTable rows={txRows} template={activeTemplate} action="manifest" />

          {error && (
            <div className="mt-3 rounded-sm border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {allDone((r) => !!r.manifestHash) ? (
              <button
                onClick={() => setStep('keys')}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C]"
              >
                Next: API Keys →
              </button>
            ) : (
              <button
                onClick={handlePublishManifest}
                disabled={isBusy}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/20 disabled:opacity-40"
              >
                {isBusy ? 'Publishing…' : 'Publish Manifest'}
              </button>
            )}
            <button onClick={back} className="px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 7: API Keys ──────────────────────────────────── */}
      {step === 'keys' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Generate API Keys
          </h2>

          <div className="mb-4 rounded-sm border border-yellow-500/20 bg-yellow-500/5 p-3">
            <div className="font-mono text-[10px] text-yellow-300/80">
              ⚠ API keys shown once. Copy them now. If lost, revoke and regenerate from agent settings.
            </div>
          </div>

          <TxProgressTable rows={txRows} template={activeTemplate} action="keys" />

          {error && (
            <div className="mt-3 rounded-sm border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {allDone((r) => !!r.apiKey) ? (
              <button
                onClick={() => setStep('export')}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C]"
              >
                Next: Export →
              </button>
            ) : (
              <button
                onClick={handleGenerateKeys}
                disabled={isBusy}
                className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/20 disabled:opacity-40"
              >
                {isBusy ? 'Generating…' : 'Generate API Key'}
              </button>
            )}
            <button onClick={back} className="px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 8: Export ────────────────────────────────────── */}
      {step === 'export' && (
        <div>
          <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
            Runtime Export
          </h2>

          {/* Show generated API keys once */}
          <div className="mb-4 rounded-sm border border-yellow-500/20 bg-yellow-500/5 p-3">
            <div className="font-mono text-[10px] text-yellow-300/80">
              ⚠ API keys shown once. Copy or download them now.
            </div>
          </div>
          {txRows.map((r) => (
            <div key={r.roleId} className="mb-2 rounded-sm border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] text-[#EAE4D8]/60">
                    {r.brandedName} (ID: {r.agentId})
                  </div>
                  {r.apiKey && (
                    <div className="mt-1 break-all font-mono text-xs text-[#C5A67C]">{r.apiKey}</div>
                  )}
                </div>
                {r.apiKey && (
                  <button
                    onClick={() => navigator.clipboard.writeText(r.apiKey || '')}
                    className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] text-[#EAE4D8]/60 hover:text-[#EAE4D8]"
                  >
                    Copy Key
                  </button>
                )}
              </div>
            </div>
          ))}

          {template && (
            <div className="mb-4">
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/70">
                Payout Address (x402 receiver)
              </label>
              <input
                type="text"
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value)}
                className="mt-1 w-full rounded-sm border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-[#EAE4D8]"
                placeholder="Leave empty = controller wallet"
              />
            </div>
          )}

          {!installCmd ? (
            <button
              onClick={handleBuildExport}
              className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/20"
            >
              Build Export
            </button>
          ) : (
            <div className="space-y-4">
              {/* Download .env bundle */}
              {envBundleStr && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const blob = new Blob([envBundleStr], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'arclayer-env-bundle.txt';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/20"
                  >
                    📥 Download .env Bundle
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(envBundleStr)}
                    className="rounded-sm border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/60 hover:text-[#EAE4D8]"
                  >
                    📋 Copy All Env
                  </button>
                </div>
              )}

              <div className="rounded-sm border border-white/10 bg-black/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">PM2 Run Command</div>
                  <button
                    onClick={handleCopyCommand}
                    className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] text-[#EAE4D8]/60 hover:text-[#EAE4D8]"
                  >
                    Copy
                  </button>
                </div>
                <pre className="overflow-x-auto font-mono text-[10px] text-[#EAE4D8]/80 leading-5 whitespace-pre-wrap">
                  {installCmd}
                </pre>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('health')}
                  className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/20"
                >
                  Next: Diagnostics →
                </button>
                <button onClick={back} className="px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50 hover:text-[#EAE4D8]">
                  ← Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 9: Diagnostics + Success ─────────────────────── */}
      {step === 'health' && (
        <DiagnosticsPanel
          category={selectedCategory}
          txRows={txRows}
          template={activeTemplate ?? null}
        />
      )}

      {error && step !== 'register' && step !== 'manifest' && step !== 'keys' && (
        <div className="mt-4 rounded-sm border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ── Tx Progress Table ──────────────────────────────────────────────

function TxProgressTable({ rows, template, action }: {
  rows: TxRow[];
  template: { roles: { displayName: string }[] } | null | undefined;
  action: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const roleName = template?.roles[i]?.displayName || r.roleId;
        const statusEmoji = r.step === 'minted' ? '✅' : r.step === 'failed' ? '❌' : '⏳';
        const statusText = r.step === 'pending' ? 'Pending'
          : r.step === 'signing' ? 'Signing…'
          : r.step === 'tx' ? 'Tx in progress…'
          : r.step === 'minted' ? 'Done'
          : r.step === 'failed' ? r.error || 'Failed'
          : r.step;

        return (
          <div key={r.roleId} className="flex items-center justify-between rounded-sm border border-white/10 bg-white/[0.02] p-3">
            <div>
              <div className="font-semibold text-sm text-[#EAE4D8]">{roleName}</div>
              <div className="font-mono text-[9px] text-[#EAE4D8]/50">ID: {r.agentId}</div>
              {r.txHash && <div className="font-mono text-[8px] text-[#EAE4D8]/30 mt-0.5">Tx: {r.txHash.slice(0, 16)}…</div>}
              {r.mintedTokenId && <div className="font-mono text-[9px] text-green-400/60 mt-0.5">Token: {r.mintedTokenId}</div>}
              {r.manifestHash && <div className="font-mono text-[9px] text-cyan-400/60 mt-0.5">Manifest: {r.manifestHash.slice(0, 16)}…</div>}
              {action === 'keys' && r.apiKey && (
                <div className="mt-1 break-all font-mono text-[9px] text-[#C5A67C]">Key: {r.apiKey.slice(0, 24)}…</div>
              )}
            </div>
            <div className="text-right">
              {r.step === 'failed' ? (
                <span className="font-mono text-[10px] text-red-400">❌ {r.error || 'Failed'}</span>
              ) : (
                <span className="font-mono text-[10px] text-[#EAE4D8]/50">{statusEmoji} {statusText}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Diagnostics Panel (Step 9) ────────────────────────────────────

type DiagCheck = { label: string; status: 'ok' | 'fail' | 'pending'; detail: string };

function DiagnosticsPanel({ category, txRows, template }: {
  category: string | null;
  txRows: TxRow[];
  template: ExternalBotTemplate | null;
}) {
  const [checks, setChecks] = useState<DiagCheck[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const dashboardUrl = category
    ? `/dashboard/external-bot?category=${encodeURIComponent(category)}&agentId=${encodeURIComponent(txRows[0]?.agentId || '')}`
    : '/live-a2a-agent';

  // Run initial checks on mount
  useEffect(() => {
    const initial: DiagCheck[] = txRows.map((r) => ({
      label: `${r.brandedName}`,
      status: r.mintedTokenId && r.manifestHash && r.apiKey ? 'ok' : r.mintedTokenId ? 'fail' : 'pending',
      detail: [
        r.mintedTokenId ? '✅ Registered' : '❌ Not Registered',
        r.manifestHash ? '✅ Manifest' : '❌ No Manifest',
        r.apiKey ? '✅ Key' : '❌ No Key',
      ].join(' · '),
    }));
    setChecks(initial);
  }, [txRows]);

  const runTestSync = useCallback(async () => {
    if (!category) return;
    setSyncing(true);
    const cat = category;
    const newChecks: DiagCheck[] = [];

    // 1. Roster check — /api/a2a/agents/by-category
    try {
      const rosterRes = await fetch(`/api/a2a/agents/by-category?category=${encodeURIComponent(cat)}`);
      const rosterData = await safeJson<{ agents?: { agentId: string }[]; total?: number; source?: string }>(rosterRes);
      const ourAgentIds = txRows.map((r) => r.agentId);
      const visible = rosterData.agents?.filter((a) => ourAgentIds.includes(a.agentId)) || [];

      newChecks.push({
        label: 'Roster Visibility',
        status: visible.length > 0 ? 'ok' : 'fail',
        detail: visible.length > 0
          ? `${visible.length}/${ourAgentIds.length} agents visible in roster (total: ${rosterData.total})`
          : `0 agents found. Source: ${rosterData.source || 'unknown'}. Total roster: ${rosterData.total}`,
      });
    } catch {
      newChecks.push({ label: 'Roster Visibility', status: 'fail', detail: 'API unreachable' });
    }

    // 2. Presence check
    try {
      const presRes = await fetch(`/api/a2a/presence?category=${encodeURIComponent(cat)}`);
      const presData = await safeJson<{ presence?: { agentId: string; status?: string }[]; total?: number }>(presRes);
      const ourIds = txRows.map((r) => r.agentId);
      const present = presData.presence?.filter((p) => ourIds.includes(p.agentId)) || [];
      newChecks.push({
        label: 'Presence Status',
        status: present.length > 0 ? 'ok' : 'fail',
        detail: present.length > 0
          ? `${present.length} online (${presData.total} total)`
          : `0 present. Run bots to send heartbeat. Total: ${presData.total}`,
      });
    } catch {
      newChecks.push({ label: 'Presence Status', status: 'fail', detail: 'API unreachable' });
    }

    // 3. Live events count
    try {
      const evRes = await fetch(`/api/a2a/live-events?category=${encodeURIComponent(cat)}&limit=5`);
      const evData = await safeJson<{ total?: number }>(evRes);
      newChecks.push({
        label: 'Live Events',
        status: (evData.total ?? 0) > 0 ? 'ok' : 'pending',
        detail: (evData.total ?? 0) > 0 ? `${evData.total} events recorded` : 'No events yet. Run bots to emit events.',
      });
    } catch {
      newChecks.push({ label: 'Live Events', status: 'fail', detail: 'API unreachable' });
    }

    // 4. Latest bridge session
    try {
      const sessRes = await fetch('/api/agent-bridge/sessions/latest');
      const sessData = await safeJson<{ session?: { id?: string; totals?: { events?: number } } }>(sessRes);
      newChecks.push({
        label: 'Latest Bridge Session',
        status: sessData.session ? 'ok' : 'pending',
        detail: sessData.session
          ? `Session ${sessData.session.id?.slice(0, 12)}… (${sessData.session.totals?.events || 0} events)`
          : 'No sessions yet. Bridge activates on first event.',
      });
    } catch {
      newChecks.push({ label: 'Latest Bridge Session', status: 'fail', detail: 'API unreachable' });
    }

    // 5. Per-agent status checks
    for (const row of txRows) {
      newChecks.push({
        label: `${row.brandedName} (${row.agentId})`,
        status: row.mintedTokenId && row.manifestHash && row.apiKey ? 'ok' : 'fail',
        detail: [
          row.mintedTokenId ? '✅ Reg' : '❌ Reg',
          row.manifestHash ? '✅ Man' : '❌ Man',
          row.apiKey ? '✅ Key' : '❌ Key',
        ].join(' · '),
      });
    }

    setChecks(newChecks);
    setLastSync(new Date().toLocaleTimeString());
    setSyncing(false);
  }, [category, txRows]);

  return (
    <div>
      <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-[#F5F0E5] mb-4">
        Diagnostics &amp; Status
      </h2>

      {/* Success summary */}
      <div className="mb-4 rounded-sm border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-emerald-300 mb-2">
          ✅ Onboarding Complete
        </div>
        <div className="space-y-1 font-mono text-[10px] text-[#EAE4D8]/70">
          {txRows.map((r) => (
            <div key={r.roleId}>
              <span className="text-[#C5A67C]">{r.brandedName}</span>
              {' '}— Agent ID: {r.agentId} · Runtime: {r.brandedName}-runtime-01
            </div>
          ))}
        </div>
        <div className="mt-3 font-mono text-[10px] text-[#EAE4D8]/50">
          Next: Copy .env files to your VPS, paste X402_PAYER_PRIVATE_KEY + LLM_API_KEY, run PM2 command.
        </div>
      </div>

      {/* Test Sync button */}
      <div className="mb-4 flex gap-3">
        <button
          onClick={runTestSync}
          disabled={syncing}
          className="rounded-sm border border-[#C5A67C] bg-[#C5A67C]/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/20 disabled:opacity-40"
        >
          {syncing ? 'Testing…' : '🔍 Test Sync'}
        </button>
        <a
          href={dashboardUrl}
          className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/20"
        >
          Open Dashboard →
        </a>
      </div>

      {lastSync && (
        <div className="mb-3 font-mono text-[9px] text-[#EAE4D8]/40">
          Last sync: {lastSync}
        </div>
      )}

      {/* Checks table */}
      {checks.length > 0 && (
        <div className="rounded-sm border border-white/10 bg-black/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] mb-3">
            Sync Results
          </div>
          <div className="space-y-2">
            {checks.map((c, i) => (
              <div key={i} className={`rounded-sm border p-2 ${
                c.status === 'ok' ? 'border-emerald-500/20 bg-emerald-500/5' :
                c.status === 'fail' ? 'border-red-500/20 bg-red-500/5' :
                'border-white/10 bg-white/[0.02]'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[10px] text-[#EAE4D8]">{c.label}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-[#EAE4D8]/50">{c.detail}</div>
                  </div>
                  <span className={`font-mono text-[9px] ${
                    c.status === 'ok' ? 'text-emerald-300' :
                    c.status === 'fail' ? 'text-red-400' :
                    'text-[#EAE4D8]/40'
                  }`}>
                    {c.status === 'ok' ? '✅' : c.status === 'fail' ? '❌' : '⏳'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guide */}
      <div className="mt-4 rounded-sm border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300 mb-2">
          After running on VPS
        </div>
        <ol className="space-y-1 font-mono text-[10px] text-[#EAE4D8]/70 list-decimal list-inside">
          <li>Copy .env files to your VPS (download button in Export step)</li>
          <li>Paste X402_PAYER_PRIVATE_KEY + LLM_API_KEY in .env.common</li>
          <li>Run: <code className="text-[#C5A67C]">pm2 start ecosystem.config.cjs</code></li>
          <li>Check: <code className="text-[#C5A67C]">pm2 logs</code> for startup</li>
          <li>Click Test Sync after bots emit first event (~1 cycle)</li>
        </ol>
      </div>
    </div>
  );
}
