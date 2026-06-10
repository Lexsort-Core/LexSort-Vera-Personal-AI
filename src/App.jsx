import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./app.css";

// ─── States ──────────────────────────────────────────────────────────────────
const PHASE = {
  DETECTING:   "detecting",
  DOWNLOADING: "downloading",
  BOOTING:     "booting",
  READY:       "ready",
  ERROR:       "error",
};

export default function App() {
  const [phase,       setPhase]       = useState(PHASE.DETECTING);
  const [hardware,    setHardware]    = useState(null);
  const [dlProgress,  setDlProgress]  = useState({ percent: 0, downloaded: 0, total: 0 });
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState("");
  const [streaming,   setStreaming]   = useState(false);
  const [error,       setError]       = useState("");
  const [serverPort,  setServerPort]  = useState(8765);

  const bottomRef     = useRef(null);
  const abortRef      = useRef(null);
  const inputRef      = useRef(null);

  // ── Boot sequence ──────────────────────────────────────────────────────────
  useEffect(() => {
    bootSequence();
    return () => { abortRef.current?.abort(); };
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function bootSequence() {
    try {
      // 1. Detect hardware → select model
      setPhase(PHASE.DETECTING);
      const hw = await invoke("detect_hardware");
      setHardware(hw);

      const port = await invoke("get_server_port");
      setServerPort(port);

      // 2. Download model if needed
      if (!hw.model_exists) {
        setPhase(PHASE.DOWNLOADING);

        const unlistenProgress = await listen("download_progress", (e) => {
          setDlProgress(e.payload);
        });

        await invoke("download_model", { modelId: hw.model.id });
        unlistenProgress();
      }

      // 3. Start llama-server sidecar
      setPhase(PHASE.BOOTING);
      await invoke("start_inference_server", { modelId: hw.model.id });

      // Give the server a moment to bind before the UI hits it
      await delay(1800);

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

    const userMsg    = { role: "user",      content: text,  id: Date.now() };
    const assistMsg  = { role: "assistant", content: "",    id: Date.now() + 1 };

    setMessages(prev => [...prev, userMsg, assistMsg]);

    // Build conversation history for context (ephemeral — only lives in RAM)
    const history = [...messages, userMsg].map(m => ({
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
          model:       "local",
          messages:    history,
          stream:      true,
          temperature: 0.7,
          max_tokens:  2048,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

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
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + token };
              }
              return next;
            });
          } catch { /* partial chunk — skip */ }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
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
  }, [input, messages, streaming, serverPort]);

  const handleKeyDown = (e) => {
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
    a.download = `vera-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render: Loading phases ─────────────────────────────────────────────────
  if (phase !== PHASE.READY) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">
          <span className="logo-l">L</span>
          <span className="logo-s">S</span>
        </div>
        <p className="boot-product">LexSort Personal AI</p>

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
            <button onClick={bootSequence} className="retry-btn">Retry</button>
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
          <span className="header-logo">LS</span>
          <span className="header-title">LexSort Personal AI</span>
        </div>
        <div className="header-right">
          {hardware && (
            <span className="header-model">
              {hardware.model.name} · {hardware.ram_gb} GB
            </span>
          )}
          <span className="privacy-badge">● Private</span>
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
          placeholder="Message LexSort AI…"
          rows={1}
          disabled={streaming}
        />
        <button
          className={`send-btn ${streaming ? "sending" : ""}`}
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          aria-label="Send"
        >
          {streaming ? <StopIcon /> : <SendIcon />}
        </button>
      </footer>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const formatBytes = (b) => {
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
