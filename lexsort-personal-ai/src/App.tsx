import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./app.css";
import veraLogo from "./assets/vera-logo.jpg";

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  ollama_tag: string;
}

interface HardwareInfo {
  platform: string;
  ram_gb: number;
  total_memory_bytes: number;
  available_memory_bytes: number;
  allocation_ceiling_bytes: number;
  cpu_cores: number;
  apple_chip: string | null;
  unified_memory: boolean;
  model: ModelInfo;
  model_exists: boolean;
}

interface Message {
  id: number;
  role: "system" | "user" | "assistant";
  content: string;
}

interface DownloadProgress {
  status: string;
  percent: number;
  downloaded: number;
  total: number;
}

// ─── States ──────────────────────────────────────────────────────────────────
const PHASE = {
  DETECTING:   "detecting",
  DOWNLOADING: "downloading",
  BOOTING:     "booting",
  READY:       "ready",
  ERROR:       "error",
};

export default function App() {
  const [phase,            setPhase]            = useState<string>(PHASE.DETECTING);
  const [hardware,         setHardware]         = useState<HardwareInfo | null>(null);
  const [dlProgress,       setDlProgress]       = useState<DownloadProgress>({ status: "", percent: 0, downloaded: 0, total: 0 });
  const [messages,         setMessages]         = useState<Message[]>([]);
  const [input,            setInput]            = useState<string>("");
  const [streaming,        setStreaming]        = useState<boolean>(false);
  const [error,            setError]            = useState<string>("");
  const [serverPort,       setServerPort]       = useState<number>(11434);
  const [showDiagnostics,  setShowDiagnostics]  = useState<boolean>(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState<boolean>(false);

  const bottomRef     = useRef<HTMLDivElement | null>(null);
  const abortRef      = useRef<AbortController | null>(null);
  const inputRef      = useRef<HTMLTextAreaElement | null>(null);

  // ── Boot sequence ──────────────────────────────────────────────────────────
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    bootSequence();
    return () => {
      abortRef.current?.abort();
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function bootSequence() {
    try {
      // 1. Detect hardware → select model
      setPhase(PHASE.DETECTING);
      const hw = await invoke("detect_hardware") as HardwareInfo;
      setHardware(hw);

      const port = await invoke("get_server_port") as number;
      setServerPort(port);

      // 2. Start inference server (ensures Ollama is active on the local port)
      setPhase(PHASE.BOOTING);
      await invoke("start_inference_server", { modelId: hw.model.id });

      // Give the server a moment to bind before the UI hits it
      await delay(1000);

      // 3. Download model if needed
      if (!hw.model_exists) {
        setPhase(PHASE.DOWNLOADING);

        const unlistenProgress = await listen("download_progress", (e: any) => {
          setDlProgress(e.payload as DownloadProgress);
        });
        unlistenRef.current = unlistenProgress;

        try {
          await invoke("download_model", { modelId: hw.model.id });
        } finally {
          unlistenProgress();
          unlistenRef.current = null;
        }
      }

      setPhase(PHASE.READY);
      inputRef.current?.focus();

    } catch (e) {
      setError(String(e));
      setPhase(PHASE.ERROR);
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);

    const userMsg: Message = { role: "user",      content: text,  id: Date.now() };
    const assistMsg: Message = { role: "assistant", content: "",    id: Date.now() + 1 };

    setMessages(prev => [...prev, userMsg, assistMsg]);

    // Build conversation history for context (ephemeral — only lives in RAM)
    const systemPrompt: Message = {
      id: 0,
      role: "system",
      content: "You are Vera, a private personal AI counsel built by LexSort Inc. You run entirely on this device — no cloud, no internet, no data leaves this machine. Be direct, honest, and concise. Never mention other AI companies or models. Never claim to be ChatGPT, Claude, or any other AI. You are Vera."
    };
    const history = [systemPrompt, ...messages, userMsg].map(m => ({
      role:    m.role,
      content: m.content,
    }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const response = await fetch(`http://127.0.0.1:${serverPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model:       hardware?.model?.id ?? "llama3.2:3b",
          messages:    history,
          stream:      true,
          temperature: 0.7,
          max_tokens:  2048,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      if (!response.body) throw new Error("Response body is null");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;

          try {
            const json   = JSON.parse(data);
            const token  = json.choices?.[0]?.delta?.content ?? "";
            if (!token) continue;

            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + token };
              }
              return next;
            });
          } catch { /* partial chunk — skip */ }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: last.content || "⚠ Connection to local inference server lost. Please restart.",
            };
          }
          return next;
        });
      }
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, messages, streaming, serverPort, hardware]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    inputRef.current?.focus();
  };

  // ── Save transcript ────────────────────────────────────────────────────────
  const saveChat = () => {
    if (!messages.length) return;
    const text = messages
      .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `lexsort-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Diagnostics Generator ──────────────────────────────────────────────────
  const generateDiagnosticText = () => {
    return [
      `### VERA Personal AI — Diagnostic Report`,
      `- **VERA Version**: 1.0.0 (Freeware)`,
      `- **OS Platform**: ${hardware?.platform || "Detecting..."}`,
      `- **RAM Detected**: ${hardware?.ram_gb !== undefined ? `${hardware.ram_gb} GB` : "Detecting..."}`,
      `- **CPU Cores**: ${hardware?.cpu_cores || "Detecting..."}`,
      `- **Apple Silicon**: ${hardware?.apple_chip || "No"}`,
      `- **Unified Memory**: ${hardware?.unified_memory ? "Yes" : "No"}`,
      `- **Selected Model**: ${hardware?.model?.name || "None"} (ID: ${hardware?.model?.id || "None"})`,
      `- **Model Cached**: ${hardware?.model_exists ? "Yes" : "No"}`,
      `- **Local Port Binding**: ${serverPort}`,
      `- **Current Phase**: ${phase}`,
      `- **Startup Error**: ${error || "None"}`,
      `\n*Generated on: ${new Date().toUTCString()}*`
    ].join("\n");
  };

  const copyDiagnostics = () => {
    navigator.clipboard.writeText(generateDiagnosticText());
    setDiagnosticCopied(true);
    setTimeout(() => setDiagnosticCopied(false), 2000);
  };

  const fileBugReport = async () => {
    const reportText = generateDiagnosticText();
    const encodedBody = encodeURIComponent(
      `## Describe the issue:\n[Write here]\n\n` +
      `## Diagnostic Logs (auto-generated):\n\`\`\`markdown\n${reportText}\n\`\`\``
    );
    const url = `https://github.com/Lexsort-Core/LexSort-Vera-Personal-AI/issues/new?title=Installation%20Issue&body=${encodedBody}`;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const openCommunityHub = async () => {
    try {
      await openUrl("https://discord.gg/kpZ3hWyAaq");
    } catch {
      window.open("https://discord.gg/kpZ3hWyAaq", "_blank");
    }
  };

  // ── Render: Loading phases ─────────────────────────────────────────────────
  if (phase !== PHASE.READY) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">
          <img src={veraLogo} alt="LexSort Personal AI" className="boot-logo-img" />
        </div>
        <p className="boot-product">LexSort <span className="boot-product-sub">Personal AI</span></p>

        {phase === PHASE.DETECTING && (
          <div className="boot-status">
            <Spinner />
            <p>Detecting hardware…</p>
          </div>
        )}

        {phase === PHASE.DOWNLOADING && hardware && (
          <div className="boot-status">
            <p className="boot-model-name">Downloading {hardware.model.name}</p>
            <p className="boot-model-desc">{hardware.model.description}</p>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${dlProgress.percent.toFixed(1)}%` }}
              />
            </div>
            <p className="progress-label">
              {formatBytes(dlProgress.downloaded)} / {formatBytes(dlProgress.total)}
              &nbsp;·&nbsp;{dlProgress.percent.toFixed(1)}%
            </p>
            <p className="boot-note">One-time download. Stored privately on your machine.</p>
          </div>
        )}

        {phase === PHASE.BOOTING && (
          <div className="boot-status">
            <Spinner />
            <p>Starting private inference engine…</p>
            {hardware && (
              <p className="boot-model-desc">{hardware.model.name} · {hardware.ram_gb} GB RAM detected</p>
            )}
          </div>
        )}

        {phase === PHASE.ERROR && (
          <div className="boot-status error">
            <p>⚠ Startup failed</p>
            <p className="error-detail">{error}</p>
            <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
              <button onClick={bootSequence} className="retry-btn">Retry Boot</button>
              <button
                onClick={() => setShowDiagnostics(true)}
                className="retry-btn"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
              >
                Diagnostic Report
              </button>
            </div>
            <p style={{ marginTop: "20px", fontSize: "12px" }}>
              Need help? Join the{" "}
              <span onClick={openCommunityHub} style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}>
                Discord Community
              </span>
            </p>
          </div>
        )}

        {/* Diagnostic Modal in boot screen */}
        {showDiagnostics && (
          <div className="diagnostic-modal-overlay">
            <div className="diagnostic-modal">
              <h3>Sovereign Diagnostic Utility</h3>
              <p>Verify your hardware configuration and local server status below. You can copy this report to paste into community help boards or file an issue.</p>
              <div className="diagnostic-code">
                {generateDiagnosticText()}
              </div>
              <div className="diagnostic-buttons">
                <button onClick={copyDiagnostics} className="diagnostic-btn diagnostic-btn-secondary">
                  {diagnosticCopied ? "✓ Copied!" : "Copy Report"}
                </button>
                <button onClick={fileBugReport} className="diagnostic-btn diagnostic-btn-primary">
                  File Bug Report
                </button>
                <button onClick={() => setShowDiagnostics(false)} className="diagnostic-btn diagnostic-btn-secondary" style={{ flex: "0 0 auto" }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Chat ───────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src={veraLogo} alt="LexSort Personal AI" className="header-logo-img" />
          <div className="header-title-block">
            <span className="header-title">LexSort <span style={{fontWeight:300}}>Personal AI</span></span>
            <span className="header-subtitle">by LexSort Inc.</span>
          </div>
        </div>
        <div className="header-right">
          {hardware && (
            <span className="header-model">
              {hardware.model.name} · {hardware.ram_gb} GB
            </span>
          )}
          <span className="privacy-badge">● Private</span>
          <button
            onClick={() => setShowDiagnostics(true)}
            className="hdr-btn"
            style={{ borderColor: "var(--accent)", color: "var(--text)", fontWeight: 600 }}
          >
            Support
          </button>
          {messages.length > 0 && (
            <>
              <button onClick={saveChat}  className="hdr-btn" title="Save transcript">Save</button>
              <button onClick={clearChat} className="hdr-btn hdr-btn-clear" title="Clear chat">Clear</button>
            </>
          )}
        </div>
      </header>

      <main className="chat-area">
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-headline">Your conversation never leaves this machine.</p>
            <p className="empty-sub">No account. No cloud. No logs. Start typing.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.content || (msg.role === "assistant" && streaming
                ? <span className="cursor-blink">▋</span>
                : null
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="input-area">
        <textarea
          ref={inputRef}
          className="input-box"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Vera..."
          rows={1}
          disabled={streaming}
        />
        <button
          className={`send-btn ${streaming ? "sending" : ""}`}
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          aria-label="Send"
        >
          {streaming ? <StopIcon /> : <><SendIcon /><span style={{marginLeft:"6px",fontSize:"13px",fontWeight:600}}>Send</span></>}
        </button>
      </footer>

      {/* Diagnostic Modal in Chat */}
      {showDiagnostics && (
        <div className="diagnostic-modal-overlay">
          <div className="diagnostic-modal">
            <h3>Sovereign Diagnostic Utility</h3>
            <p>Verify your hardware configuration and local server status below. You can copy this report to paste into community help boards or file an issue.</p>
            <div className="diagnostic-code">
              {generateDiagnosticText()}
            </div>
            <div className="diagnostic-buttons">
              <button onClick={copyDiagnostics} className="diagnostic-btn diagnostic-btn-secondary">
                {diagnosticCopied ? "✓ Copied!" : "Copy Report"}
              </button>
              <button onClick={fileBugReport} className="diagnostic-btn diagnostic-btn-primary">
                File Bug Report
              </button>
              <button onClick={() => setShowDiagnostics(false)} className="diagnostic-btn diagnostic-btn-secondary" style={{ flex: "0 0 auto" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const formatBytes = (b: number) => {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};

const Spinner = () => <div className="spinner" aria-label="Loading" />;

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);
