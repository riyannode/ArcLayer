/**
 * Job deliverable types for shared deliverable storage.
 */
export type JobDeliverable = {
  id: string;
  job_id: string;
  provider_agent_id: string;
  provider_address: string;
  deliverable_hash: string;
  payload_json: unknown;
  artifacts_json: Array<{
    name: string;
    uri?: string;
    contentType?: string;
    sha256?: string;
  }>;
  runtime_receipt_hash?: string;
  submit_tx_hash?: string;
  created_at: string;
  updated_at: string;
};

export type PublishDeliverableInput = {
  agentId: string;
  jobId: string;
  providerAddress: string;
  deliverableHash: string;
  payload: unknown;
  artifacts?: Array<{
    name: string;
    uri?: string;
    contentType?: string;
    sha256?: string;
  }>;
  runtimeReceiptHash?: string;
};

export type GetDeliverableInput = {
  jobId: string;
};
