/** Filters accepted by the job listing service function. */
export interface JobListParams {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
  sort_by?: string;
  order?: string;
  registered?: string;
}

/** A single job row returned by listJobs(). */
export interface JobRow {
  workflow_id: string;
  entity: string;
  status: 'running' | 'completed' | 'failed';
  is_live: boolean;
  created_at: string;
  updated_at: string;
}

/** Paginated result from listJobs(). */
export interface JobListResult {
  jobs: JobRow[];
  total: number;
}
