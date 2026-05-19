'use client';

import { useCallback, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useArcSign } from '@/hooks/useArcSign';
import { keccak256, stringToBytes } from 'viem';
import type { AgentManifestV1 } from '@/lib/a2a/manifest';
import { X402ActionGate } from '@/components/x402/X402ActionGate';

type Props = {
  agentId: string;
  currentAvatar?: string;
  ownerAddress?: string;
  manifestData?: AgentManifestV1;
  onUpdated: (newAvatarUrl: string | null) => void;
};

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return 'null';
}

export function AvatarUploader({ agentId, currentAvatar, ownerAddress, manifestData, onUpdated }: Props) {
  const { address } = useAccount();
  const { signMessageAsync } = useArcSign();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const isOwner =
    !!address && !!ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase();

  const updateManifestAvatar = useCallback(
    async (newUrl: string | null) => {
      if (!manifestData) {
        throw new Error('Manifest data missing — cannot update.');
      }
      const nowIso = new Date().toISOString();
      const manifest: Record<string, unknown> = {
        schema: 'arclayer.agent/v1',
        version: 1,
        agentId,
        name: manifestData.name,
        role: manifestData.role,
        description: manifestData.description,
        capability: manifestData.capability,
        categories: manifestData.categories,
        createdAt: manifestData.createdAt,
        updatedAt: nowIso,
      };
      if (manifestData.endpoint) manifest.endpoint = manifestData.endpoint;
      if (manifestData.mode) manifest.mode = manifestData.mode;
      if (manifestData.price) manifest.price = manifestData.price;
      if (manifestData.tags?.length) manifest.tags = manifestData.tags;
      if (manifestData.links) manifest.links = manifestData.links;
      if (manifestData.x402) manifest.x402 = manifestData.x402;
      if (newUrl) manifest.avatar = newUrl;

      const hash = keccak256(stringToBytes(canonicalize(manifest)));
      const ts = Math.floor(Date.now() / 1000);
      const message = ['ArcLayer Manifest v1', `agentId=${agentId}`, `hash=${hash}`, `ts=${ts}`].join('\n');
      const signature = await signMessageAsync({ message });
      const res = await fetch('/api/a2a/manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest, signature, ts }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Manifest update failed');
      }
    },
    [agentId, manifestData, signMessageAsync]
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!isOwner) {
        setStatus('Only the agent owner can change the photo.');
        return;
      }
      if (!file.type.startsWith('image/')) {
        setStatus('File must be an image.');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setStatus('File too large (max 2 MB).');
        return;
      }
      setBusy(true);
      setStatus('Signing upload request…');
      try {
        const ts = Math.floor(Date.now() / 1000);
        const message = `ArcLayer Avatar Upload\nagentId=${agentId}\nts=${ts}`;
        const signature = await signMessageAsync({ message });

        setStatus('Uploading photo…');
        const fd = new FormData();
        fd.append('agentId', agentId);
        fd.append('signature', signature);
        fd.append('ts', String(ts));
        fd.append('file', file);
        const upRes = await fetch('/api/a2a/avatar/upload', { method: 'POST', body: fd });
        const upBody = await upRes.json().catch(() => ({}));
        if (!upRes.ok) throw new Error(upBody?.error || 'Upload failed');
        const newUrl: string = upBody.url;

        setStatus('Updating manifest…');
        await updateManifestAvatar(newUrl);

        setStatus('✓ Photo updated.');
        onUpdated(newUrl);
        setTimeout(() => setStatus(null), 2000);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [agentId, isOwner, onUpdated, signMessageAsync, updateManifestAvatar]
  );

  const handleRemove = useCallback(async () => {
    if (!isOwner || !currentAvatar) return;
    if (!confirm('Remove this photo from the agent profile?')) return;
    setBusy(true);
    setStatus('Updating manifest…');
    try {
      await updateManifestAvatar(null);
      setStatus('✓ Photo removed.');
      onUpdated(null);
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }, [currentAvatar, isOwner, onUpdated, updateManifestAvatar]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (busy || !isOwner) return;
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [busy, handleFile, isOwner]
  );

  if (!isOwner) {
    return null;
  }

  return (
    <X402ActionGate lockedMessage="Pay x402 on homepage to upload avatar">
    <div className="mt-2 flex flex-col gap-1">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileRef.current?.click()}
        className={`cursor-pointer rounded border px-2 py-1 font-mono text-[10px] tracking-[0.14em] transition-colors ${
          dragOver
            ? 'border-[#C5A67C] bg-[#C5A67C]/10 text-[#EAE4D8]'
            : 'border-white/10 bg-white/[0.02] text-[#777] hover:border-[#C5A67C]/40 hover:text-[#C5A67C]'
        } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {busy ? 'WORKING…' : currentAvatar ? 'CHANGE PHOTO · DRAG OR CLICK' : 'UPLOAD PHOTO · DRAG OR CLICK'}
      </div>
      {currentAvatar && !busy && (
        <button
          type="button"
          onClick={handleRemove}
          className="self-start font-mono text-[10px] tracking-[0.14em] text-[#777] underline-offset-2 hover:text-[#e88080] hover:underline"
        >
          REMOVE PHOTO
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {status && <p className="font-mono text-[10px] text-[#999]">{status}</p>}
    </div>
    </X402ActionGate>
  );
}
