"use client";
import { useState } from "react";
import { useX402Pay } from "@/hooks/useX402Pay";
export function useJobFlow() {
  const [description, setDescription] = useState("Build demo");
  const [result, setResult] = useState("");
  const { pay } = useX402Pay("/api/x402/create-job-gate");
  async function createJob() {
    const payment = await pay();
    if (!payment.ok) {
      setResult("payment failed: job not created");
      return;
    }
    setResult(`job created: ${description} (#job-1)`);
  }
  return { description, setDescription, createJob, result };
}
