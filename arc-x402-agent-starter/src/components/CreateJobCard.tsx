"use client";
import { useJobFlow } from "@/hooks/useJobFlow";
export function CreateJobCard() {
  const { description, setDescription, createJob, result } = useJobFlow();
  return <div className="space-y-2"><h2>Create Job</h2><input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="job description"/><button onClick={createJob}>Pay + Create Job</button><p>{result}</p></div>;
}
