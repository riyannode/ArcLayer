'use client';

import { useMemo, useState } from 'react';
import type { BridgeEvent, BridgeReceipt, BridgeSession } from './types';
import { eventType, shortHash } from './types';
import { DecisionNodeCard, FlowEdge } from './PredictionDecisionNodes';

export type DecisionNode = {
  key: 'oracle' | 'receipt1' | 'risk' | 'receipt2' | 'evaluator' | 'receipt3' | 'executor' | 'discard';
  title: string;
  status: 'pending' | 'active' | 'completed' | 'rejected';
  accent: 'blue' | 'gold' | 'purple' | 'green' | 'red' | 'neutral';
  summary: string;
  fields: Array<[string, string]>;
  receiptType?: string;
  tx?: string;
  paymentReason?: string;
};

function latest(events: BridgeEvent[], f: (e: BridgeEvent) => boolean) { return events.filter(f).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0] ?? null; }
const txt=(v:unknown)=> v===null||v===undefined||v===''?'—':String(v);

export function buildNodes(session: BridgeSession | null): DecisionNode[] {
  const events=session?.events??[]; const receipts=session?.receipts??[];
  const oracle=latest(events,e=>e.role==='oracle'||eventType(e)==='market_snapshot');
  const risk=latest(events,e=>['analyzer','risk_gate'].includes(e.role)||['resolver_output','risk_output'].includes(eventType(e)));
  const evaluator=latest(events,e=>e.role==='evaluator'||eventType(e)==='evaluation');
  const executor=latest(events,e=>e.role==='executor'||eventType(e)==='execution_intent');

  const rec=(r:BridgeReceipt|undefined)=>({
    receiptType:r?.receipt_type,
    tx:r?.transaction||undefined,
    paymentReason: txt(r?.metadata?.summary || r?.metadata?.reason || r?.metadata?.payment_reason),
    fields:[
      ['receipt_type', txt(r?.receipt_type)], ['payload_hash', shortHash(r?.payload_hash)], ['tx', shortHash(r?.transaction)],
      ['payment_id', txt(r?.payment_id || r?.payment_ref)], ['created', txt(r?.created_at?.slice(11,19))]
    ] as Array<[string,string]>
  });

  const r1 = receipts.find(r=>r.payload_hash===oracle?.payload_hash) ?? receipts.find(r=>r.metadata?.role==='oracle');
  const r2 = receipts.find(r=>r.payload_hash===risk?.payload_hash) ?? receipts.find(r=>['analyzer','risk_gate'].includes(String(r.metadata?.role||'')));
  const r3 = receipts.find(r=>r.payload_hash===evaluator?.payload_hash) ?? receipts.find(r=>r.metadata?.role==='evaluator');

  const rejected = risk?.payload?.noTradeReason || evaluator?.payload?.approved===false;
  return [
    { key:'oracle', title:'ORACLE', status:oracle?'completed':'pending', accent:'blue', summary:txt(oracle?.payload?.summary || 'market_snapshot / oracle role'), fields:[['role','market_snapshot'],['payload_hash', shortHash(oracle?.payload_hash)],['time',txt(oracle?.created_at?.slice(11,19))]]},
    { key:'receipt1', title:'RECEIPT 1', status:r1?'completed':'pending', accent:'gold', summary:'oracle proof + x402 info', ...rec(r1) },
    { key:'risk', title:'RISK GATE', status:risk?(rejected?'rejected':'completed'):'pending', accent:rejected?'red':'purple', summary:txt(risk?.payload?.summary || risk?.payload?.noTradeReason || 'analyzer / risk_gate / resolver_output'), fields:[['confidence',txt(risk?.payload?.confidence)],['direction',txt(risk?.payload?.suggestedDirection)],['reason',txt(risk?.payload?.noTradeReason)]]},
    { key:'receipt2', title:'RECEIPT 2', status:r2?'completed':'pending', accent:'gold', summary:'risk gate proof', ...rec(r2) },
    { key:'evaluator', title:'EVALUATOR', status:evaluator?(evaluator.payload?.approved===false?'rejected':'completed'):'pending', accent:evaluator?.payload?.approved===false?'red':'green', summary:txt(evaluator?.payload?.approved===false?'Rejected':evaluator?.payload?.approved===true?'Approved':'Evaluator pending'), fields:[['approved',txt(evaluator?.payload?.approved)],['reason',txt(evaluator?.payload?.reason)],['flags',txt(evaluator?.payload?.flags)]]},
    { key:'receipt3', title:'RECEIPT 3', status:r3?'completed':'pending', accent:'gold', summary:'evaluator proof', ...rec(r3) },
    { key:'executor', title:'EXECUTOR', status:rejected?'rejected':executor?'active':'pending', accent:rejected?'red':'neutral', summary:rejected?'DISCARD / NO ACTION':txt(executor?.payload?.reason || 'execution intent'), fields:[['action',txt(executor?.payload?.action)],['safety',txt(executor?.payload?.safety)],['payload_hash',shortHash(executor?.payload_hash)]]},
  ];
}

export function PredictionMarketDecisionBoardV2({ session }: { session: BridgeSession | null }) {
  const nodes = useMemo(()=>buildNodes(session),[session]);
  const [selected,setSelected]=useState(nodes[2]?.key ?? 'oracle');
  const main=nodes;
  const hasPaymentAt = (idx:number)=> {
    const next=main[idx+1];
    return Boolean(next?.receiptType==='x402_arc_native' && next?.tx);
  };

  return <section className="rounded-md border border-white/10 bg-[#050505] p-4">
    <h2 className="text-xl font-black uppercase tracking-[0.12em] text-[#F5F0E5]">ORACLE → RECEIPT 1 → RISK GATE → RECEIPT 2 → EVALUATOR → RECEIPT 3 → EXECUTOR</h2>
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr_20px_1fr]">
      {main.map((n,i)=><div key={n.key} className="contents"><DecisionNodeCard node={n} selected={selected===n.key} onClick={()=>setSelected(n.key)} />{i<main.length-1?<FlowEdge active={n.status!=='pending'} payment={hasPaymentAt(i)} />:null}</div>)}
    </div>
    <p className="mt-3 text-xs text-zinc-400">Mobile menampilkan stack vertikal dengan urutan yang sama.</p>
  </section>;
}
