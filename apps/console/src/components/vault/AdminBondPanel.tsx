'use client';

import { useCallback, useEffect, useState } from 'react';
import { type Abi, type Address } from 'viem';
import { readContract } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { config } from '@/lib/wagmi';
import { BOND_CONFIG_ADDRESS, isZeroAddress } from '@/lib/vault/constants';
import bondConfigAbiJson from '@/lib/vault/abi/bond-config.json';

const bondConfigAbi = bondConfigAbiJson as Abi;

type Tier = {
  index: number;
  minAmount: bigint;
  maxAmount: bigint;
  rateBps: bigint;
  flatFee: bigint;
};

export function AdminBondPanel() {
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const [owner, setOwner] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [veteranDiscount, setVeteranDiscount] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();
  const notDeployed = isZeroAddress(BOND_CONFIG_ADDRESS);

  const loadConfig = useCallback(async () => {
    if (notDeployed) return;
    setLoading(true);
    setMsg('');
    try {
      const ownerAddr = await readContract(config, {
        address: BOND_CONFIG_ADDRESS as Address,
        abi: bondConfigAbi,
        functionName: 'owner',
      }) as string;
      setOwner(ownerAddr);

      const count = await readContract(config, {
        address: BOND_CONFIG_ADDRESS as Address,
        abi: bondConfigAbi,
        functionName: 'tierCount',
      }) as bigint;

      const loaded: Tier[] = [];
      for (let i = 0; i < Number(count); i++) {
        const t = await readContract(config, {
          address: BOND_CONFIG_ADDRESS as Address,
          abi: bondConfigAbi,
          functionName: 'tiers',
          args: [BigInt(i)],
        }) as [bigint, bigint, bigint, bigint];
        loaded.push({ index: i, minAmount: t[0], maxAmount: t[1], rateBps: t[2], flatFee: t[3] });
      }
      setTiers(loaded);

      const disc = await readContract(config, {
        address: BOND_CONFIG_ADDRESS as Address,
        abi: bondConfigAbi,
        functionName: 'veteranDiscount',
      }) as bigint;
      setVeteranDiscount(disc);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, [notDeployed]);

  useEffect(() => {
    if (isConnected && !notDeployed) void loadConfig();
  }, [isConnected, notDeployed, loadConfig]);

  // Edit state
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editMin, setEditMin] = useState('');
  const [editMax, setEditMax] = useState('');
  const [editRate, setEditRate] = useState('');
  const [editFlat, setEditFlat] = useState('');
  const [editDiscount, setEditDiscount] = useState('');

  function startEdit(t: Tier) {
    setEditIdx(t.index);
    setEditMin(t.minAmount.toString());
    setEditMax(t.maxAmount.toString());
    setEditRate(t.rateBps.toString());
    setEditFlat(t.flatFee.toString());
  }

  async function saveTier() {
    if (editIdx === null || !isOwner) return;
    setBusy(true);
    setMsg('');
    try {
      await writeContractAsync({
        address: BOND_CONFIG_ADDRESS as Address,
        abi: bondConfigAbi,
        functionName: 'updateTier',
        args: [BigInt(editIdx), BigInt(editMin), BigInt(editMax), BigInt(editRate), BigInt(editFlat)],
      });
      setMsg(`Tier ${editIdx} updated ✓`);
      setEditIdx(null);
      await loadConfig();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Tx failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveDiscount() {
    if (!isOwner) return;
    setBusy(true);
    setMsg('');
    try {
      await writeContractAsync({
        address: BOND_CONFIG_ADDRESS as Address,
        abi: bondConfigAbi,
        functionName: 'setVeteranDiscount',
        args: [BigInt(editDiscount || veteranDiscount.toString())],
      });
      setMsg('Veteran discount updated ✓');
      await loadConfig();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Tx failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aureo-panel p-5">
      <div className="aureo-mono-label">ADMIN · BOND CONFIG</div>
      <h3 className="aureo-display mt-1 text-[24px] text-[#EAE4D8]">Performance bond tiers</h3>

      {notDeployed && (
        <div className="mt-4 rounded-none border border-amber-400/25 bg-amber-400/5 px-4 py-3 font-mono text-[11px] text-amber-200 invisible">
          BondConfig contract not deployed yet. Update BOND_CONFIG_ADDRESS after deploy.
        </div>
      )}

      {!notDeployed && !isOwner && isConnected && (
        <div className="mt-4 rounded-none border border-white/10 bg-black/20 px-4 py-3 font-mono text-[11px] text-[rgba(234,228,216,0.6)]">
          Read-only. Connected wallet is not the contract owner.
        </div>
      )}

      {msg && <div className="mt-3 rounded-none border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-[#C5A67C]">{msg}</div>}

      {!notDeployed && (
        <>
          {/* Tiers table */}
          <div className="mt-5 space-y-2">
            <div className="grid grid-cols-5 gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.5)]">
              <span>Tier</span><span>Min (wei)</span><span>Max (wei)</span><span>Rate (bps)</span><span>Flat Fee</span>
            </div>
            {tiers.map((t) => (
              <div key={t.index} className="grid grid-cols-5 items-center gap-2 rounded-none border border-white/10 bg-black/20 px-3 py-2">
                {editIdx === t.index ? (
                  <>
                    <span className="font-mono text-[11px] text-[#C5A67C]">#{t.index}</span>
                    <input value={editMin} onChange={(e) => setEditMin(e.target.value)} className="input-mono text-[10px]" />
                    <input value={editMax} onChange={(e) => setEditMax(e.target.value)} className="input-mono text-[10px]" />
                    <input value={editRate} onChange={(e) => setEditRate(e.target.value)} className="input-mono text-[10px]" />
                    <div className="flex gap-1">
                      <input value={editFlat} onChange={(e) => setEditFlat(e.target.value)} className="input-mono flex-1 text-[10px]" />
                      <button onClick={saveTier} disabled={busy} className="btn-secondary px-2 py-1 text-[8px]">SAVE</button>
                      <button onClick={() => setEditIdx(null)} className="btn-secondary px-2 py-1 text-[8px]">✕</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-[11px] text-[#C5A67C]">#{t.index}</span>
                    <span className="font-mono text-[11px] text-[#EAE4D8]">{t.minAmount.toString()}</span>
                    <span className="font-mono text-[11px] text-[#EAE4D8]">{t.maxAmount.toString()}</span>
                    <span className="font-mono text-[11px] text-[#EAE4D8]">{t.rateBps.toString()}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[#EAE4D8]">{t.flatFee.toString()}</span>
                      {isOwner && <button onClick={() => startEdit(t)} className="font-mono text-[9px] text-[#C5A67C] hover:text-[#EAE4D8]">EDIT</button>}
                    </div>
                  </>
                )}
              </div>
            ))}
            {loading && <div className="font-mono text-[11px] text-[rgba(234,228,216,0.5)]">Loading…</div>}
          </div>

          {/* Veteran discount */}
          <div className="mt-5 rounded-none border border-white/10 bg-black/20 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.55)]">Veteran Discount (bps)</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="font-mono text-[14px] text-[#EAE4D8]">{veteranDiscount.toString()} bps</span>
              {isOwner && (
                <>
                  <input
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value)}
                    placeholder={veteranDiscount.toString()}
                    className="input-mono w-24 text-[11px]"
                  />
                  <button onClick={saveDiscount} disabled={busy} className="btn-secondary px-3 py-1 text-[9px]">UPDATE</button>
                </>
              )}
            </div>
            <p className="mt-2 font-mono text-[9.5px] text-[rgba(234,228,216,0.5)] invisible">
              Applied to jobbers with 10+ completed jobs and 4.5+ rating. Reduces bond by this bps from tier rate.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
