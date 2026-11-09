/**
 * GraphRAG Knowledge System API Client
 * Connects frontend UI to FastAPI backend on localhost:8000
 */

export interface HealthStatus {
  status: "online" | "degraded" | "offline";
  neo4j: "connected" | "disconnected";
  ollama: "connected" | "disconnected";
  model: string;
  available_models?: string[];
  auth_enabled?: boolean;
  backend_connected: boolean;
  error?: string;
}

export interface GraphNode {
  id: string;
  label?: string;
  degree?: number;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  nodes: number;
  edges: number;
}

export interface UploadJobStatus {
  job_id: string;
  filename: string;
  workspace: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  stage: string;
  nodes: number;
  edges: number;
  error?: string | null;
  created_at: number;
  completed_at?: number | null;
}

export interface UploadResponse {
  message: string;
  nodes: number;
  edges: number;
  total_nodes?: number;
  total_edges?: number;
  extracted_nodes?: Array<{ id: string; label: string }>;
  extracted_edges?: Array<{ source: string; target: string; relation: string }>;
}

export interface QueryResponse {
  answer: string;
  context: string[];
  extracted_entities: string[];
  latency_ms?: number;
}

export interface BackupSnapshot {
  filename: string;
  workspace: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  size_bytes: number;
}

let resolvedBaseUrl: string = "";

export async function getActiveBaseUrl(): Promise<string> {
  if (resolvedBaseUrl) return resolvedBaseUrl;

  const envUrl = (import.meta as any).env?.VITE_API_URL;
  const custom = typeof window !== "undefined" ? localStorage.getItem("graphrag_api_url") : null;
  const rawCandidates = [
    envUrl,
    custom,
    "https://graphrag-backend-pvn3.onrender.com",
    "/api",
    "http://127.0.0.1:8000",
    "http://localhost:8000"
  ];
  const candidates = rawCandidates.filter(Boolean) as string[];

  for (const candidate of candidates) {
    const clean = candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
    try {
      const res = await fetch(`${clean}/health`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        resolvedBaseUrl = clean;
        return clean;
      }
    } catch {
      // try next candidate
    }
  }

  // default fallback to live Render backend
  resolvedBaseUrl = "https://graphrag-backend-pvn3.onrender.com";
  return resolvedBaseUrl;
}

export function getApiBaseUrl(): string {
  if (resolvedBaseUrl) return resolvedBaseUrl;
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) return envUrl.endsWith("/") ? envUrl.slice(0, -1) : envUrl;
  if (typeof window !== "undefined") {
    return localStorage.getItem("graphrag_api_url") || "https://graphrag-backend-pvn3.onrender.com";
  }
  return "https://graphrag-backend-pvn3.onrender.com";
}

export function setApiBaseUrl(url: string) {
  resolvedBaseUrl = url;
  if (typeof window !== "undefined") {
    localStorage.setItem("graphrag_api_url", url);
  }
}

export function getApiKey(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("graphrag_api_key");
    if (stored !== null) return stored;
  }
  return "srjforsure-company-token-2026";
}

export function setApiKey(key: string) {
  if (typeof window !== "undefined") {
    if (key && key.trim()) {
      localStorage.setItem("graphrag_api_key", key.trim());
    } else {
      localStorage.removeItem("graphrag_api_key");
    }
  }
}

export function getAuthHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}

export async function checkHealth(): Promise<HealthStatus> {
  const baseUrl = await getActiveBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        status: "degraded",
        neo4j: "disconnected",
        ollama: "disconnected",
        model: "llama3.2",
        backend_connected: true,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    const data = await res.json();
    return {
      ...data,
      backend_connected: true,
    };
  } catch (err: any) {
    // Try refreshing active base
    resolvedBaseUrl = "";
    return {
      status: "offline",
      neo4j: "disconnected",
      ollama: "disconnected",
      model: "llama3.2",
      backend_connected: false,
      error: err.message || "Connection refused",
    };
  }
}

export async function fetchGraphData(limit: number = 150, workspace: string = "all"): Promise<GraphData> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/graph?limit=${limit}&workspace=${encodeURIComponent(workspace)}`, {
    method: "GET",
    headers: { Accept: "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch graph: ${res.statusText}`);
  }
  return await res.json();
}

export async function fetchStats(workspace: string = "all"): Promise<GraphStats> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/stats?workspace=${encodeURIComponent(workspace)}`, {
    method: "GET",
    headers: { Accept: "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.statusText}`);
  }
  return await res.json();
}

export async function uploadDocument(
  file: File,
  workspace: string = "default",
  onProgress?: (stage: string, progress: number) => void
): Promise<UploadResponse> {
  const baseUrl = await getActiveBaseUrl();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspace", workspace);

  const res = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed (${res.status}): ${errText}`);
  }

  const initial = await res.json();

  // Handle asynchronous polling if backend returned a job_id
  if (initial.job_id) {
    const jobId = initial.job_id;
    onProgress?.(initial.stage || "Document queued for processing...", initial.progress || 5);

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusRes = await fetch(`${baseUrl}/upload/status/${jobId}`, {
        headers: { ...getAuthHeaders() }
      });
      if (!statusRes.ok) {
        throw new Error(`Failed to fetch job status (${statusRes.status})`);
      }
      const job: UploadJobStatus = await statusRes.json();
      onProgress?.(job.stage, job.progress);

      if (job.status === "completed") {
        return {
          message: job.stage,
          nodes: job.nodes,
          edges: job.edges,
        };
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Document ingestion failed.");
      }
    }
  }

  return initial;
}

export async function uploadTextSnippet(
  filename: string,
  text: string,
  workspace: string = "default",
  onProgress?: (stage: string, progress: number) => void
): Promise<UploadResponse> {
  const blob = new Blob([text], { type: "text/plain" });
  const file = new File([blob], filename, { type: "text/plain" });
  return uploadDocument(file, workspace, onProgress);
}

export async function queryKnowledgeGraph(question: string, workspace: string = "all"): Promise<QueryResponse> {
  const baseUrl = await getActiveBaseUrl();
  const formData = new FormData();
  formData.append("question", question);
  formData.append("workspace", workspace);

  const res = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Query failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function summarizeKnowledgeGraph(workspace: string = "all"): Promise<QueryResponse> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/query/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ workspace }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Summarization failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

export interface StreamCallbacks {
  onMeta?: (entities: string[], context: string[]) => void;
  onToken?: (token: string) => void;
  onDone?: (latencyMs: number) => void;
  onError?: (error: string) => void;
}

export async function streamQueryKnowledgeGraph(
  question: string,
  callbacks: StreamCallbacks,
  workspace: string = "all"
): Promise<void> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/query/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ question, workspace }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stream request failed (${res.status}): ${err}`);
  }

  if (!res.body) {
    throw new Error("ReadableStream not supported in this environment.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.type === "meta") {
            callbacks.onMeta?.(data.entities || [], data.context || []);
          } else if (data.type === "token") {
            callbacks.onToken?.(data.token || "");
          } else if (data.type === "done") {
            callbacks.onDone?.(data.latency_ms || 0);
          } else if (data.type === "error") {
            callbacks.onError?.(data.error || "Streaming error");
          }
        } catch {
          // ignore incomplete json chunk
        }
      }
    }
  }
}

export async function clearKnowledgeGraph(workspace: string = "all"): Promise<{ success: boolean; message: string }> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/clear?workspace=${encodeURIComponent(workspace)}`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new Error(`Clear failed: ${res.statusText}`);
  }
  return await res.json();
}

export async function createGraphBackup(workspace: string = "all"): Promise<{ success: boolean; filename: string; snapshot: BackupSnapshot }> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/admin/backup?workspace=${encodeURIComponent(workspace)}`, {
    method: "POST",
    headers: { Accept: "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backup failed (${res.status}): ${err}`);
  }
  return await res.json();
}

export async function listGraphBackups(): Promise<{ backups: BackupSnapshot[] }> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/admin/backups`, {
    method: "GET",
    headers: { Accept: "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list backups (${res.status}): ${err}`);
  }
  return await res.json();
}

export async function restoreGraphBackup(filename: string, clearBefore: boolean = false): Promise<{ success: boolean; restored_nodes: number; restored_edges: number }> {
  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/admin/restore?filename=${encodeURIComponent(filename)}&clear_before=${clearBefore}`, {
    method: "POST",
    headers: { Accept: "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Restore failed (${res.status}): ${err}`);
  }
  return await res.json();
}


