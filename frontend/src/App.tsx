import { useState, useRef, useEffect, useCallback } from "react";
import {
  checkHealth,
  fetchStats,
  uploadDocument,
  uploadTextSnippet,
  streamQueryKnowledgeGraph,
  summarizeKnowledgeGraph,
  clearKnowledgeGraph,
  createGraphBackup,
  getApiKey,
  setApiKey,
  type HealthStatus,
} from "./api";

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text: string;
  timestamp: string;
  entities?: string[];
  context?: string[];
  latency?: number;
}

interface IndexedFile {
  name: string;
  nodesAdded: number;
  edgesAdded: number;
  timestamp: string;
}

const SAMPLE_TEXT_1 = `Steve Jobs co-founded Apple Inc. with Steve Wozniak in 1976. Apple Inc. designs the iPhone, iPad, and Mac computers. Tim Cook joined Apple in 1998 and succeeded Steve Jobs as CEO in 2011. Apple is headquartered in Cupertino, California.`;

const SAMPLE_TEXT_2 = `GraphRAG combines Knowledge Graphs with Large Language Models. Neo4j stores graph entities and relationships using Cypher queries. Ollama runs local language models like llama3.2 for private text analysis. Superconducting qubits in Sycamore are developed by Google.`;

/* ==========================================================================
   MINIMAL MODERN SVG ICONS
   ========================================================================== */

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? "animate-spin" : ""}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function UploadCloudIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M12 12v9" />
      <path d="m8 16 4-4 4 4" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-1.5 1.5L14 9l-3-3L2 15l4 4 9-9 3.5 3.5 1.5-1.5 2-2z" />
      <circle cx="7.5" cy="16.5" r="1.5" />
    </svg>
  );
}

function ArchiveIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? "animate-spin" : ""}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

/* ==========================================================================
   MARKDOWN HELPER
   ========================================================================== */

function MarkdownText({ text, isDark }: { text: string; isDark: boolean }) {
  const renderInline = (t: string) => {
    const codeBg = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)";
    const codeColor = isDark ? "#e4e4e7" : "#1e293b";
    return t
      .replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight:600">$1</strong>`)
      .replace(/`(.+?)`/g, `<code style="background:${codeBg};color:${codeColor};padding:1px 5px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:0.85em">$1</code>`);
  };

  return (
    <div className="space-y-2 text-xs leading-relaxed" style={{ color: "var(--text-main)" }}>
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (line.match(/^\d+\.\s/)) {
          const dotIdx = line.indexOf(". ");
          return (
            <div key={i} className="flex gap-2">
              <span className="font-semibold text-xs opacity-60 min-w-[18px]">{line.slice(0, dotIdx + 1)}</span>
              <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(dotIdx + 2)) }} />
            </div>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 items-start pl-1">
              <span className="text-xs opacity-50 mt-1">•</span>
              <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
            </div>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />;
      })}
    </div>
  );
}

/* ==========================================================================
   MAIN APPLICATION COMPONENT
   ========================================================================== */

export default function App() {
  // Theme state: default is LIGHT (false)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
    }
    return false;
  });

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  // Mobile View Switcher: "chat" or "ingest"
  const [mobileTab, setMobileTab] = useState<"chat" | "ingest">("chat");

  // Backend Health
  const [health, setHealth] = useState<HealthStatus>({
    status: "offline",
    neo4j: "disconnected",
    ollama: "disconnected",
    model: "llama3.2",
    backend_connected: false,
  });

  // Single Unified Workspace
  const [workspace, setWorkspace] = useState<string>("default");

  // Stats
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [loadingData, setLoadingData] = useState(false);

  // Ingestion State
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadSec, setUploadSec] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [ingestedFiles, setIngestedFiles] = useState<IndexedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Security & Disaster Recovery State
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => getApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(() => !!getApiKey());
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "ai",
      timestamp: "Ready",
      text: "Welcome to your **GraphRAG Knowledge Assistant**.\nAsk any question grounded on verified entities and relationships in your Neo4j knowledge base, or ingest new documents on the left.",
    },
  ]);
  const [inputQuery, setInputQuery] = useState("");
  const [thinking, setThinking] = useState(false);
  const [thinkSec, setThinkSec] = useState(0);
  const [expandedContextId, setExpandedContextId] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Set window title
  useEffect(() => {
    document.title = "GraphRAG | AI Knowledge System";
  }, []);

  // Ingestion timer
  useEffect(() => {
    let t: any;
    if (uploading) {
      setUploadSec(0);
      t = setInterval(() => setUploadSec((s) => s + 1), 1000);
    }
    return () => clearInterval(t);
  }, [uploading]);

  // Query thinking timer
  useEffect(() => {
    let t: any;
    if (thinking) {
      setThinkSec(0);
      t = setInterval(() => setThinkSec((s) => s + 1), 1000);
    }
    return () => clearInterval(t);
  }, [thinking]);

  // Auto scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  // Refresh Health
  const refreshHealth = useCallback(async () => {
    try {
      const h = await checkHealth();
      setHealth(h);
    } catch {
      setHealth((prev) => ({ ...prev, status: "offline", backend_connected: false }));
    }
  }, []);

  // Refresh Graph Stats for selected workspace
  const refreshStatsOnly = useCallback(async (targetWorkspace?: string) => {
    setLoadingData(true);
    try {
      const ws = targetWorkspace !== undefined ? targetWorkspace : workspace;
      const s = await fetchStats(ws);
      setNodeCount(s.nodes);
      setEdgeCount(s.edges);
    } catch (err) {
      console.warn("Could not sync stats:", err);
    } finally {
      setLoadingData(false);
    }
  }, [workspace]);

  // Initial load and polling
  useEffect(() => {
    refreshHealth();
    refreshStatsOnly(workspace);
    const iv = setInterval(() => {
      refreshHealth();
      refreshStatsOnly(workspace);
    }, 6000);
    return () => clearInterval(iv);
  }, [refreshHealth, refreshStatsOnly, workspace]);

  // Security Handlers
  const handleSaveApiKey = () => {
    setApiKey(apiKeyInput);
    setApiKeySaved(!!apiKeyInput.trim());
    setApiKeyModalOpen(false);
    refreshHealth();
    refreshStatsOnly();
  };

  const handleClearApiKey = () => {
    setApiKey("");
    setApiKeyInput("");
    setApiKeySaved(false);
    refreshHealth();
    refreshStatsOnly();
  };

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    setBackupNotice(null);
    try {
      const res = await createGraphBackup(workspace);
      const nodes = res.snapshot?.node_count ?? (res as any).node_count ?? 0; const edges = res.snapshot?.edge_count ?? (res as any).edge_count ?? 0; setBackupNotice(`Backup saved: ${res.filename} (${nodes} nodes, ${edges} relations)`);
      setTimeout(() => setBackupNotice(null), 6000);
    } catch (err: any) {
      alert(`Backup failed: ${err.message || err}`);
    } finally {
      setBackupLoading(false);
    }
  };

  // Upload Document
  const handleUploadFile = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    setUploadProgress(5);
    setUploadStage("Preparing document...");

    const targetWs = workspace === "all" ? "default" : workspace;

    try {
      const res = await uploadDocument(file, targetWs, (stage, progress) => {
        setUploadStage(stage);
        setUploadProgress(progress);
      });

      const newFile: IndexedFile = {
        name: `${file.name} [${targetWs}]`,
        nodesAdded: res.nodes,
        edgesAdded: res.edges,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setIngestedFiles((prev) => [newFile, ...prev]);
      setUploadSuccess(`Extracted +${res.nodes} entities & +${res.edges} relations into [${targetWs}]`);
      await refreshStatsOnly(workspace);
      setTimeout(() => setUploadSuccess(null), 5000);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStage("");
    }
  };

  // Prevent default dragover/drop
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", preventDefaults);
    window.addEventListener("drop", preventDefaults);
    return () => {
      window.removeEventListener("dragover", preventDefaults);
      window.removeEventListener("drop", preventDefaults);
    };
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleUploadFile(files[0]);
    }
  };

  // Quick Ingest Sample
  const handleIngestSample = async (name: string, content: string) => {
    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    setUploadProgress(5);
    setUploadStage(`Extracting ${name} with Ollama...`);

    const targetWs = workspace === "all" ? "default" : workspace;

    try {
      const res = await uploadTextSnippet(`${name}.txt`, content, targetWs, (stage, progress) => {
        setUploadStage(stage);
        setUploadProgress(progress);
      });
      const newFile: IndexedFile = {
        name: `${name}.txt [${targetWs}]`,
        nodesAdded: res.nodes,
        edgesAdded: res.edges,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setIngestedFiles((prev) => [newFile, ...prev]);
      setUploadSuccess(`Extracted +${res.nodes} entities & +${res.edges} relations into [${targetWs}]`);
      await refreshStatsOnly(workspace);
      setTimeout(() => setUploadSuccess(null), 5000);
    } catch (err: any) {
      setUploadError(err.message || "Failed to ingest sample");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStage("");
    }
  };

  // Clear Graph Index scoped to workspace
  const handleClearGraph = async () => {
    const scopeLabel = workspace === "all" ? "the entire graph across ALL workspaces" : `workspace '${workspace}'`;
    if (!window.confirm(`Are you sure you want to clear ${scopeLabel}? All entities and relations in this scope will be deleted.`)) {
      return;
    }
    try {
      await clearKnowledgeGraph(workspace);
      await refreshStatsOnly(workspace);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "ai",
          text: `Knowledge graph for **${scopeLabel}** was cleared.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
    }
  };

  // Clear Chat Messages
  const handleClearChat = () => {
    setMessages([
      {
        id: Date.now(),
        role: "ai",
        text: "Conversation cleared. Ready for your next question!",
        timestamp: "Ready",
      },
    ]);
  };

  // Query Knowledge Graph
  const handleQuery = async (question: string) => {
    if (!question.trim() || thinking) return;

    // Switch to chat tab automatically if query sent from mobile
    setMobileTab("chat");

    const userMsgId = Date.now();
    const aiMsgId = userMsgId + 1;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: question, timestamp: now },
      { id: aiMsgId, role: "ai", text: "", timestamp: now, entities: [], context: [] },
    ]);

    setInputQuery("");
    setThinking(true);

    try {
      await streamQueryKnowledgeGraph(
        question,
        {
          onMeta: (entities, context) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, entities, context } : msg
              )
            );
          },
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, text: msg.text + token } : msg
              )
            );
          },
          onDone: (latencyMs) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, latency: latencyMs } : msg
              )
            );
            setThinking(false);
          },
          onError: (error) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId
                  ? { ...msg, text: `**Query Error**: ${error}` }
                  : msg
              )
            );
            setThinking(false);
          },
        },
        workspace
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, text: `**Query Failed**: ${err.message || "Failed to reach graph"}` }
            : msg
        )
      );
      setThinking(false);
    }
  };

  // Summarize Knowledge Base
  const handleSummarize = async () => {
    if (thinking) return;

    setMobileTab("chat");

    const userMsgId = Date.now();
    const aiMsgId = userMsgId + 1;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        text: `Summarize knowledge base (Workspace: **${workspace}**)`,
        timestamp: now,
      },
      {
        id: aiMsgId,
        role: "ai",
        text: "",
        timestamp: now,
        entities: [],
        context: [],
      },
    ]);

    setThinking(true);

    try {
      const res = await summarizeKnowledgeGraph(workspace);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                text: res.answer,
                context: res.context,
                entities: res.extracted_entities,
                latency: res.latency_ms,
              }
            : msg
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, text: `**Summarization Error**: ${err.message || "Unable to generate summary"}` }
            : msg
        )
      );
    } finally {
      setThinking(false);
    }
  };

  const isOnline = health.backend_connected && health.neo4j === "connected" && health.ollama === "connected";

  const suggestionPrompts = [
    "What processor did Google build?",
    "Who founded Apple Inc. and when?",
    "What products are associated with Apple?",
    "How does GraphRAG use Neo4j and Ollama?",
  ];

  return (
    <div
      data-theme={isDark ? "dark" : "light"}
      className="flex flex-col h-full w-full select-none"
      style={{
        background: "var(--bg-app)",
        color: "var(--text-main)",
      }}
    >
      {/* ===================================================================
          1. TOP NAVIGATION BAR (RESPONSIVE FOR MOBILE & DESKTOP)
          =================================================================== */}
      <header
        className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-2.5 z-20 flex-shrink-0"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-app)",
        }}
      >
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-bold text-xs sm:text-sm shadow-sm flex-shrink-0"
            style={{
              background: "var(--accent)",
              color: "#ffffff",
            }}
          >
            G
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="font-semibold text-xs sm:text-sm tracking-tight" style={{ color: "var(--text-main)" }}>
              GraphRAG
            </span>
            <span
              className="hidden xs:inline-block px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-mono rounded-full font-medium"
              style={{
                background: "var(--accent-subtle)",
                color: "var(--accent)",
                border: "1px solid var(--border-app)",
              }}
            >
              Enterprise
            </span>
          </div>
        </div>

        {/* Center: Status & Unified Workspace Selector */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Health Indicator */}
          <div
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: isOnline ? "var(--success-subtle)" : "var(--danger-subtle)",
              border: `1px solid ${isOnline ? "var(--success-border)" : "var(--danger-border)"}`,
              color: isOnline ? "var(--success)" : "var(--danger)",
            }}
            title={isOnline ? "Neo4j & Ollama connected" : "Services disconnected"}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? "animate-pulse" : ""}`}
              style={{ background: isOnline ? "var(--success)" : "var(--danger)" }}
            />
            <span className="text-[10px] sm:text-[11px] hidden sm:inline">
              {isOnline ? "Neo4j & Ollama Ready" : "Disconnected"}
            </span>
          </div>

          {/* Graph Stats Badge (Hidden on mobile phones to save space) */}
          <div
            className="hidden md:flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-lg"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-app)",
            }}
          >
            <span className="font-semibold" style={{ color: "var(--text-main)" }}>{nodeCount}</span> n
            <span className="opacity-30">/</span>
            <span className="font-semibold" style={{ color: "var(--text-main)" }}>{edgeCount}</span> e
          </div>

          {/* Unified Workspace Selector */}
          <div
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-xs"
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border-app)",
            }}
          >
            <FolderIcon />
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="bg-transparent text-[11px] sm:text-xs font-semibold cursor-pointer outline-none border-none p-0 max-w-[100px] sm:max-w-none truncate"
              style={{
                color: "var(--text-main)",
                colorScheme: isDark ? "dark" : "light",
              }}
            >
              <option
                value="default"
                style={{ background: isDark ? "#18181b" : "#ffffff", color: isDark ? "#f4f4f5" : "#0f172a" }}
              >
                default
              </option>
              <option
                value="research"
                style={{ background: isDark ? "#18181b" : "#ffffff", color: isDark ? "#f4f4f5" : "#0f172a" }}
              >
                research
              </option>
              <option
                value="finance"
                style={{ background: isDark ? "#18181b" : "#ffffff", color: isDark ? "#f4f4f5" : "#0f172a" }}
              >
                finance
              </option>
              <option
                value="all"
                style={{ background: isDark ? "#18181b" : "#ffffff", color: isDark ? "#f4f4f5" : "#0f172a" }}
              >
                All Workspaces
              </option>
            </select>
          </div>
        </div>

        {/* Right: Action Utilities Toolbar */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={handleCreateBackup}
            disabled={backupLoading}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all hover:opacity-90 min-h-[32px] min-w-[32px] justify-center"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-app)",
              opacity: backupLoading ? 0.6 : 1,
            }}
            title="Create instant disaster recovery snapshot"
          >
            <ArchiveIcon spinning={backupLoading} />
            <span className="hidden lg:inline text-xs">{backupLoading ? "Saving..." : "Backup"}</span>
          </button>

          <button
            onClick={() => refreshStatsOnly(workspace)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all hover:opacity-90 min-h-[32px] min-w-[32px] justify-center"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-app)",
            }}
            title="Sync graph counters from Neo4j"
          >
            <RefreshIcon spinning={loadingData} />
            <span className="hidden lg:inline text-xs">Sync</span>
          </button>

          <button
            onClick={handleClearGraph}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all hover:text-red-500 min-h-[32px] min-w-[32px] justify-center"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-app)",
            }}
            title="Clear entities in current workspace"
          >
            <TrashIcon />
            <span className="hidden lg:inline text-xs">Clear</span>
          </button>

          <button
            onClick={() => setApiKeyModalOpen(true)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all relative min-h-[32px] min-w-[32px] justify-center"
            style={{
              background: "var(--bg-subtle)",
              color: apiKeySaved || health.auth_enabled ? "var(--accent)" : "var(--text-secondary)",
              border: `1px solid ${apiKeySaved || health.auth_enabled ? "var(--accent)" : "var(--border-app)"}`,
            }}
            title={apiKeySaved ? "API Key Configured" : "Security & Authentication"}
          >
            <KeyIcon />
            <span className="hidden lg:inline text-xs">Auth</span>
            {health.auth_enabled && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                style={{ background: apiKeySaved ? "var(--success)" : "#eab308" }}
              />
            )}
          </button>

          <div className="w-[1px] h-4 mx-0.5 sm:mx-1" style={{ background: "var(--border-app)" }} />

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 sm:p-2 rounded-lg text-xs cursor-pointer transition-all hover:opacity-90 flex items-center justify-center min-h-[32px] min-w-[32px]"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--text-main)",
              border: "1px solid var(--border-app)",
            }}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {/* Backup Notification Banner */}
      {backupNotice && (
        <div
          className="px-4 sm:px-6 py-2 text-xs flex items-center justify-between z-10 transition-all flex-shrink-0"
          style={{
            background: "var(--success-subtle)",
            borderBottom: "1px solid var(--success-border)",
            color: "var(--success)",
          }}
        >
          <span className="font-medium truncate mr-2">✓ {backupNotice}</span>
          <button onClick={() => setBackupNotice(null)} className="text-xs font-bold hover:opacity-75 cursor-pointer">✕</button>
        </div>
      )}

      {/* Mobile Tab Switcher (Visible ONLY on screen widths < 1024px) */}
      <div
        className="flex lg:hidden px-3 pt-2 pb-1 gap-2 flex-shrink-0"
        style={{
          background: "var(--bg-app)",
          borderBottom: "1px solid var(--border-app)",
        }}
      >
        <button
          onClick={() => setMobileTab("chat")}
          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          style={{
            background: mobileTab === "chat" ? "var(--bg-surface)" : "var(--bg-subtle)",
            color: mobileTab === "chat" ? "var(--accent)" : "var(--text-secondary)",
            border: `1px solid ${mobileTab === "chat" ? "var(--accent)" : "var(--border-app)"}`,
            boxShadow: mobileTab === "chat" ? "var(--card-shadow)" : "none",
          }}
        >
          <span>💬</span>
          <span>AI Assistant</span>
        </button>
        <button
          onClick={() => setMobileTab("ingest")}
          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          style={{
            background: mobileTab === "ingest" ? "var(--bg-surface)" : "var(--bg-subtle)",
            color: mobileTab === "ingest" ? "var(--accent)" : "var(--text-secondary)",
            border: `1px solid ${mobileTab === "ingest" ? "var(--accent)" : "var(--border-app)"}`,
            boxShadow: mobileTab === "ingest" ? "var(--card-shadow)" : "none",
          }}
        >
          <span>📥</span>
          <span>Ingest & Sources</span>
          {ingestedFiles.length > 0 && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.2 rounded-full font-bold"
              style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              {ingestedFiles.length}
            </span>
          )}
        </button>
      </div>

      {/* ===================================================================
          2. MAIN WORKSPACE CONTENT (RESPONSIVE: MOBILE TABS / DESKTOP SPLIT)
          =================================================================== */}
      <div className="flex flex-1 overflow-hidden p-2 sm:p-4 gap-4">
        {/* =================================================================
            LEFT SIDEBAR: KNOWLEDGE INGESTION
            (Shown when mobileTab === 'ingest' on mobile, always shown on lg)
            ================================================================= */}
        <aside
          className={`${
            mobileTab === "ingest" ? "flex flex-1 w-full" : "hidden"
          } lg:flex lg:flex-initial lg:w-[320px] flex-col p-4 overflow-y-auto flex-shrink-0 space-y-4 rounded-2xl`}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-app)",
            boxShadow: "var(--card-shadow)",
          }}
        >
          {/* Section 1: Ingestion Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Knowledge Ingestion
              </h2>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Target Partition: <span className="font-mono font-medium" style={{ color: "var(--accent)" }}>[{workspace === "all" ? "default" : workspace}]</span>
              </p>
            </div>
            {/* On mobile, show a quick button to jump back to chat */}
            <button
              onClick={() => setMobileTab("chat")}
              className="lg:hidden text-xs px-2.5 py-1 rounded-md cursor-pointer font-medium"
              style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              Open Chat →
            </button>
          </div>

          {/* Section 2: Drag & Drop Zone */}
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all border-dashed select-none"
            style={{
              border: isDragging
                ? "2px dashed var(--accent)"
                : "1.5px dashed var(--border-subtle)",
              background: isDragging
                ? "var(--accent-subtle)"
                : "var(--bg-subtle)",
              opacity: uploading ? 0.7 : 1,
              boxShadow: isDragging ? "0 0 0 4px var(--accent-subtle)" : "none",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.json,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadFile(f);
              }}
            />

            {uploading ? (
              <div className="py-2 space-y-2.5 w-full px-2 pointer-events-none">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                      {uploadProgress}% Ingesting
                    </span>
                  </div>
                  <span className="text-[10px] opacity-60 font-mono">{uploadSec}s</span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-subtle)" }}>
                  <div
                    className="h-full transition-all duration-300 rounded-full"
                    style={{
                      width: `${uploadProgress}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  {uploadStage}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 py-1 pointer-events-none">
                <div
                  className="flex justify-center transition-transform duration-200"
                  style={{
                    color: "var(--accent)",
                    transform: isDragging ? "scale(1.2)" : "scale(1)",
                  }}
                >
                  <UploadCloudIcon />
                </div>
                <p className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>
                  {isDragging ? "Drop to parse document" : "Upload Knowledge Document"}
                </p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Tap to browse or drop <span className="font-mono opacity-80">(.pdf, .txt, .md, .csv)</span>
                </p>
              </div>
            )}
          </div>

          {/* Feedback Alerts */}
          {uploadSuccess && (
            <div
              className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
              style={{
                background: "var(--success-subtle)",
                border: "1px solid var(--success-border)",
                color: "var(--success)",
              }}
            >
              <span>✓</span>
              <span className="text-[11px] font-medium">{uploadSuccess}</span>
            </div>
          )}

          {uploadError && (
            <div
              className="px-3 py-2 rounded-lg text-xs"
              style={{
                background: "var(--danger-subtle)",
                border: "1px solid var(--danger-border)",
                color: "var(--danger)",
              }}
            >
              <span className="text-[11px]">{uploadError}</span>
            </div>
          )}

          {/* Section 3: Quick Test Knowledge Snippets */}
          <div className="space-y-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Quick Test Knowledge
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => handleIngestSample("Apple Inc", SAMPLE_TEXT_1)}
                className="p-2.5 rounded-xl text-left transition-all cursor-pointer hover:border-blue-400 group"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-app)",
                }}
              >
                <div className="text-base mb-1">🍎</div>
                <p className="text-xs font-semibold leading-snug group-hover:text-blue-500 truncate" style={{ color: "var(--text-main)" }}>
                  Apple History
                </p>
                <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: "var(--text-muted)" }}>
                  Jobs, Wozniak, Mac
                </p>
              </button>

              <button
                type="button"
                disabled={uploading}
                onClick={() => handleIngestSample("GraphRAG", SAMPLE_TEXT_2)}
                className="p-2.5 rounded-xl text-left transition-all cursor-pointer hover:border-blue-400 group"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-app)",
                }}
              >
                <div className="text-base mb-1">⚡</div>
                <p className="text-xs font-semibold leading-snug group-hover:text-blue-500 truncate" style={{ color: "var(--text-main)" }}>
                  Quantum Graph
                </p>
                <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: "var(--text-muted)" }}>
                  Neo4j, Ollama, Qubits
                </p>
              </button>
            </div>
          </div>

          {/* Section 4: Ingested Sources Stream */}
          <div className="space-y-2 pt-2 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Ingested Sources ({ingestedFiles.length})
              </span>
            </div>

            <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
              {ingestedFiles.length === 0 ? (
                <div
                  className="py-6 text-center text-[11px] rounded-xl"
                  style={{
                    background: "var(--bg-subtle)",
                    color: "var(--text-muted)",
                    border: "1px dashed var(--border-app)",
                  }}
                >
                  No documents ingested yet.
                </div>
              ) : (
                ingestedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl flex items-center justify-between text-xs"
                    style={{
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border-app)",
                    }}
                  >
                    <div className="truncate mr-2 flex items-center gap-2">
                      <FileIcon />
                      <div className="truncate">
                        <p className="font-medium truncate text-xs" style={{ color: "var(--text-main)" }}>
                          {f.name}
                        </p>
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          +{f.nodesAdded} nodes · +{f.edgesAdded} edges · {f.timestamp}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* =================================================================
            RIGHT MAIN AREA: EXPANSIVE AI CHAT & KNOWLEDGE EXPLORER
            (Shown when mobileTab === 'chat' on mobile, always shown on lg)
            ================================================================= */}
        <main
          className={`${
            mobileTab === "chat" ? "flex flex-1 w-full" : "hidden"
          } lg:flex lg:flex-1 flex-col rounded-2xl overflow-hidden`}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-app)",
            boxShadow: "var(--card-shadow)",
          }}
        >
          {/* Chat Workspace Header */}
          <div
            className="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-3 flex-shrink-0"
            style={{
              borderBottom: "1px solid var(--border-app)",
              background: "var(--bg-surface)",
            }}
          >
            <div className="flex items-center gap-2 truncate mr-2">
              <span className="text-xs font-bold truncate" style={{ color: "var(--text-main)" }}>
                Knowledge Graph Assistant
              </span>
              <span className="text-[10px] sm:text-[11px] opacity-60 hidden sm:inline" style={{ color: "var(--text-muted)" }}>
                · Grounded on Neo4j Triples
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <button
                onClick={handleSummarize}
                disabled={thinking}
                className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:opacity-90"
                style={{
                  background: "var(--accent-subtle)",
                  color: "var(--accent)",
                  border: "1px solid var(--border-app)",
                  opacity: thinking ? 0.5 : 1,
                }}
                title="Synthesize an executive summary across the knowledge graph"
              >
                <span>📊</span>
                <span className="hidden sm:inline">Summarize Graph</span>
                <span className="sm:hidden">Summary</span>
              </button>

              <button
                onClick={handleClearChat}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-all hover:opacity-90"
                style={{
                  background: "var(--bg-subtle)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-app)",
                }}
                title="Clear chat messages"
              >
                <EraserIcon />
                <span className="text-[11px] hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2.5 sm:gap-3.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] sm:text-xs font-bold mt-0.5 shadow-sm"
                  style={{
                    background: m.role === "user" ? "var(--accent)" : "var(--bg-subtle)",
                    color: m.role === "user" ? "#ffffff" : "var(--text-secondary)",
                    border: "1px solid var(--border-app)",
                  }}
                >
                  {m.role === "user" ? "U" : "AI"}
                </div>

                {/* Message Bubble */}
                <div
                  className="rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 max-w-[90%] sm:max-w-[84%] text-xs space-y-2 sm:space-y-2.5 shadow-sm"
                  style={{
                    background: m.role === "user" ? "var(--accent-subtle)" : "var(--bg-subtle)",
                    border: "1px solid var(--border-app)",
                    color: "var(--text-main)",
                  }}
                >
                  {m.role === "ai" ? (
                    <div>
                      <MarkdownText text={m.text} isDark={isDark} />

                      {/* Extracted Search Entities */}
                      {m.entities && m.entities.length > 0 && (
                        <div
                          className="mt-2.5 sm:mt-3 pt-2 flex flex-wrap gap-1 items-center"
                          style={{ borderTop: "1px solid var(--border-app)" }}
                        >
                          <span className="text-[9.5px] font-mono opacity-70" style={{ color: "var(--text-muted)" }}>
                            Entities:
                          </span>
                          {m.entities.map((e, idx) => (
                            <span
                              key={idx}
                              className="text-[9.5px] sm:text-[10px] font-mono px-1.5 sm:px-2 py-0.5 rounded font-medium"
                              style={{
                                background: "var(--bg-surface)",
                                border: "1px solid var(--border-subtle)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Neo4j Traversal Context Accordion */}
                      {m.context && m.context.length > 0 && (
                        <div className="mt-2 text-xs">
                          <button
                            onClick={() =>
                              setExpandedContextId(expandedContextId === m.id ? null : m.id)
                            }
                            className="text-[10.5px] sm:text-[11px] font-mono flex items-center gap-1.5 font-medium hover:underline cursor-pointer"
                            style={{ color: "var(--accent-text)" }}
                          >
                            <span>{expandedContextId === m.id ? "▼" : "▶"}</span>
                            <span>Grounded Context ({m.context.length} triples)</span>
                            {m.latency && <span className="opacity-60">· {m.latency}ms</span>}
                          </button>

                          {expandedContextId === m.id && (
                            <div
                              className="mt-2 p-2.5 sm:p-3 rounded-xl space-y-1 font-mono text-[10px] sm:text-[11px] max-h-48 overflow-y-auto"
                              style={{
                                background: "var(--bg-surface)",
                                border: "1px solid var(--border-app)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {m.context.map((triple, tIdx) => (
                                <div key={tIdx} className="leading-relaxed">
                                  • {triple}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed">{m.text}</p>
                  )}

                  <div className="text-[9px] sm:text-[10px] flex justify-end" style={{ color: "var(--text-muted)" }}>
                    {m.timestamp}
                  </div>
                </div>
              </div>
            ))}

            {/* Generating / Thinking Indicator */}
            {thinking && (
              <div className="flex gap-2.5 sm:gap-3.5 items-center">
                <div
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold shadow-sm"
                  style={{
                    background: "var(--bg-subtle)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-app)",
                  }}
                >
                  AI
                </div>
                <div
                  className="rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 text-xs shadow-sm"
                  style={{
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border-app)",
                    color: "var(--accent)",
                  }}
                >
                  <span className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0" />
                  <span className="text-[11px] sm:text-xs truncate">Traversing graph & synthesizing ({thinkSec}s)...</span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestion Prompts Row */}
          <div
            className="px-3 sm:px-5 py-1.5 sm:py-2 flex gap-1.5 sm:gap-2 overflow-x-auto flex-shrink-0 items-center no-scrollbar"
            style={{
              borderTop: "1px solid var(--border-app)",
              background: "var(--bg-subtle)",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider mr-0.5 sm:mr-1 opacity-60 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
              Suggested:
            </span>
            {suggestionPrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => handleQuery(p)}
                className="px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs whitespace-nowrap transition-all cursor-pointer hover:border-blue-400 flex-shrink-0"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-app)",
                  color: "var(--text-secondary)",
                }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <div
            className="p-2.5 sm:p-4 flex-shrink-0"
            style={{
              background: "var(--bg-surface)",
              borderTop: "1px solid var(--border-app)",
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleQuery(inputQuery);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Ask about entities, relationships, or concepts…"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                disabled={thinking}
                className="flex-1 px-3.5 sm:px-4 py-2.5 rounded-xl text-sm sm:text-xs"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-app)",
                  color: "var(--text-main)",
                }}
              />
              <button
                type="submit"
                disabled={thinking || !inputQuery.trim()}
                className="px-4 sm:px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer min-h-[40px]"
                style={{
                  background: "var(--accent)",
                  color: "#ffffff",
                  opacity: thinking || !inputQuery.trim() ? 0.45 : 1,
                }}
              >
                <span className="hidden sm:inline">Send</span>
                <SendIcon />
              </button>
            </form>
          </div>
        </main>
      </div>

      {/* API Key / Security Modal */}
      {apiKeyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(5px)" }}
          onClick={() => setApiKeyModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-app)",
              color: "var(--text-main)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0"
                  style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                >
                  <KeyIcon />
                </div>
                <div>
                  <h3 className="text-sm font-bold">API Security & Access</h3>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Master access token</p>
                </div>
              </div>
              <button
                onClick={() => setApiKeyModalOpen(false)}
                className="text-xs w-7 h-7 rounded-md flex items-center justify-center hover:opacity-75 cursor-pointer"
                style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div
                className="p-3 rounded-xl text-xs flex items-center justify-between"
                style={{
                  background: health.auth_enabled ? "rgba(234,179,8,0.12)" : "var(--bg-subtle)",
                  border: `1px solid ${health.auth_enabled ? "rgba(234,179,8,0.3)" : "var(--border-app)"}`,
                }}
              >
                <span>Backend Authentication:</span>
                <span className="font-semibold" style={{ color: health.auth_enabled ? "#eab308" : "var(--success)" }}>
                  {health.auth_enabled ? "Required (Protected)" : "Public / Dev Mode"}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  GraphRAG Secret Token
                </label>
                <input
                  type="password"
                  placeholder="Enter secret API token..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono outline-none"
                  style={{
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border-app)",
                    color: "var(--text-main)",
                  }}
                />
                <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                  Stored in browser localStorage and attached to all queries, uploads, and backups.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--border-app)" }}>
              <button
                type="button"
                onClick={handleClearApiKey}
                className="px-3 py-1.5 text-xs rounded-lg transition-colors hover:text-red-500 cursor-pointer"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-app)",
                  color: "var(--text-secondary)",
                }}
              >
                Clear Key
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setApiKeyModalOpen(false)}
                  className="px-3 py-1.5 text-xs rounded-lg cursor-pointer"
                  style={{
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border-app)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveApiKey}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
                  style={{
                    background: "var(--accent)",
                    color: "#ffffff",
                  }}
                >
                  Save Token
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
