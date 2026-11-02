import { useMemo, useRef, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

const API = import.meta.env.VITE_API_URL ?? "";

const PAGE_CONTEXT = {
  "/": {
    label: "Dashboard",
    mode: "Page Q&A",
    intro: "Ask dashboard questions about open roles, gaps, aging, submissions, and overall hiring status.",
    insightAction: { label: "What is the overall hiring status?", action: "explain_dashboard" },
    primaryActions: [
      { label: "Which positions are open?", action: "open_roles" },
      { label: "Which roles have the biggest gap?", action: "hiring_risks" },
      { label: "How many profiles were submitted?", action: "explain_dashboard" },
    ],
    secondaryActions: [
      { label: "Which positions are aging?", action: "hiring_risks" },
      { label: "What is the total hiring gap?", action: "explain_dashboard" },
      { label: "Which roles need attention?", action: "hiring_risks" },
      { label: "What changed in the funnel?", action: "client_update" },
    ],
  },
  "/new-requirements": {
    label: "Position Management",
    mode: "Page Q&A",
    intro: "Ask position questions about open roles, fulfilled roles, gaps, zero submissions, and role setup.",
    insightAction: { label: "Which positions have open roles?", action: "open_roles" },
    primaryActions: [
      { label: "Which positions have open roles?", action: "open_roles" },
      { label: "Which roles are fulfilled?", action: "fulfilled_roles" },
      { label: "Which roles need more candidates?", action: "hiring_risks" },
    ],
    secondaryActions: [
      { label: "What is the gap by role?", action: "open_roles" },
      { label: "Which positions have zero submissions?", action: "roles_no_candidates" },
      { label: "Which roles are poorly defined?", action: "requirement_health" },
      { label: "Which deleted positions have retained candidates?", action: "deleted_position_impact" },
    ],
  },
  "/candidates": {
    label: "Candidates",
    mode: "Page Q&A",
    intro: "Ask candidate questions about pipeline stages, selected profiles, rejected profiles, and candidate status.",
    insightAction: { label: "Which candidates are in pipeline?", action: "candidate_pipeline" },
    primaryActions: [
      { label: "Which candidates are in pipeline?", action: "candidate_pipeline" },
      { label: "Which candidates are selected?", action: "selected_candidates" },
      { label: "Which candidates are rejected?", action: "rejected_candidates" },
    ],
    secondaryActions: [
      { label: "Who was submitted for this role?", action: "find_best_candidates" },
      { label: "What is this candidate's status?", action: "candidate_status" },
      { label: "Which candidates are pending feedback?", action: "stuck_candidates" },
      { label: "Which candidates are missing resumes?", action: "missing_resumes" },
    ],
  },
  "/resumes": {
    label: "Resumes",
    mode: "Page Q&A",
    intro: "Ask resume questions about original files, Mphasis files, formatting status, failures, and preservation.",
    insightAction: { label: "Which resumes are ready?", action: "resume_ready" },
    primaryActions: [
      { label: "Which resumes are ready?", action: "resume_ready" },
      { label: "Which resumes are still formatting?", action: "resume_formatting" },
      { label: "Which resumes failed formatting?", action: "resume_failed" },
    ],
    secondaryActions: [
      { label: "Who has both original and Mphasis resume?", action: "resume_versions" },
      { label: "Who has no Mphasis resume?", action: "resume_missing_mphasis" },
      { label: "Which resume has best preservation?", action: "resume_preservation" },
      { label: "Which resumes need scoring?", action: "resumes_need_scoring" },
    ],
  },
  "/client-report": {
    label: "Client Report",
    mode: "Page Q&A",
    intro: "Ask client-report questions about report-ready candidates, role risks, and current client update points.",
    insightAction: { label: "What should I report to the client?", action: "client_update" },
    primaryActions: [
      { label: "What should I report to the client?", action: "client_update" },
      { label: "Which roles need attention?", action: "hiring_risks" },
      { label: "Which candidates are ready to share?", action: "client_report" },
    ],
    secondaryActions: [
      { label: "What changed since last update?", action: "client_update" },
      { label: "What are the hiring risks?", action: "hiring_risks" },
      { label: "Which active candidates are strongest?", action: "find_best_candidates" },
      { label: "Which roles have no active shortlist?", action: "roles_no_candidates" },
    ],
  },
};

const DEFAULT_CONTEXT = {
  label: "ATS",
  mode: "Page Q&A",
  intro: "Ask page-specific questions about ATS data.",
  insightAction: { label: "What is the overall hiring status?", action: "explain_dashboard" },
  primaryActions: [
    { label: "Which positions are open?", action: "open_roles" },
    { label: "Which candidates are in pipeline?", action: "candidate_pipeline" },
    { label: "Which resumes are ready?", action: "resume_ready" },
  ],
  secondaryActions: [
    { label: "What should I report to the client?", action: "client_update" },
  ],
};

function BotMark() {
  return (
    <div style={S.mark}>
      DRISHTI
    </div>
  );
}

function ActionButton({ action, onClick }) {
  return (
    <button type="button" onClick={() => onClick(action)} style={S.actionButton}>
      {action.label}
    </button>
  );
}

function ResultCard({ card }) {
  return (
    <div style={S.resultCard}>
      <div style={S.resultTitle}>{card.title}</div>
      {card.subtitle && <div style={S.resultSub}>{card.subtitle}</div>}
      {Array.isArray(card.meta) && card.meta.length > 0 && (
        <div style={S.metaGrid}>
          {card.meta.map((item, index) => (
            <div key={`${item.label}-${index}`} style={S.metaItem}>
              <span style={S.metaLabel}>{item.label}</span>
              <span style={S.metaValue}>{item.value || "-"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BotMessage({ message, onAction }) {
  return (
    <div style={S.botRow}>
      <BotMark />
      <div style={S.botBubble}>
        <div style={S.botText}>{message.text}</div>
        {Array.isArray(message.cards) && message.cards.length > 0 && (
          <div style={S.cardsWrap}>
            {message.cards.map((card, index) => (
              <ResultCard key={`${card.title}-${index}`} card={card} />
            ))}
          </div>
        )}
        {(message.confidence || message.sources?.length > 0) && (
          <div style={S.evidenceLine}>
            {message.confidence && <span>Confidence: {message.confidence}</span>}
            {message.sources?.length > 0 && <span>Based on: {message.sources.join(", ")}</span>}
          </div>
        )}
        {Array.isArray(message.actions) && message.actions.length > 0 && (
          <div style={S.actionsWrap}>
            {message.actions.map((action, index) => (
              <ActionButton key={`${action.label}-${index}`} action={action} onClick={onAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ text }) {
  return (
    <div style={S.userRow}>
      <div style={S.userBubble}>{text}</div>
    </div>
  );
}

function StarterGrid({ context, onAction }) {
  const primary = context.primaryActions || context.actions || [];
  const secondary = context.secondaryActions || [];
  return (
    <div style={S.starter}>
      <div style={S.starterTitle}>Suggested questions for {context.label}</div>
      <div style={S.starterGrid}>
        {primary.map((action) => (
          <button key={action.label} type="button" onClick={() => onAction(action)} style={S.starterButton}>
            <span style={S.starterDot} />
            {action.label}
          </button>
        ))}
      </div>
      {secondary.length > 0 && (
        <>
          <div style={{ ...S.starterTitle, marginTop: 14 }}>More questions</div>
          <div style={S.secondaryGrid}>
            {secondary.map((action) => (
              <button key={action.label} type="button" onClick={() => onAction(action)} style={S.secondaryButton}>
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ATSCopilot() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const scrollRef = useRef(null);

  const context = useMemo(
    () => PAGE_CONTEXT[location.pathname] || DEFAULT_CONTEXT,
    [location.pathname]
  );

  useEffect(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
  }, [location.pathname]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const pushBot = (data) => {
    setMessages((prev) => [
      ...prev,
      {
        role: "bot",
        text: data.reply || "I could not find an answer for that yet.",
        cards: data.cards || [],
        confidence: data.confidence,
        sources: data.sources || [],
        actions: data.quick_actions || [],
      },
    ]);
  };

  const send = async (payload, label) => {
    setOpen(true);
    if (label) {
      setMessages((prev) => [...prev, { role: "user", text: label }]);
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/copilot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: context.label,
          ...payload,
        }),
      });
      if (!res.ok) {
        throw new Error("Copilot request failed");
      }
      pushBot(await res.json());
    } catch {
      pushBot({
        reply: "I could not reach ATS Copilot. Check that the backend is running, then try again.",
        confidence: "Low",
        sources: [],
        quick_actions: [...(context.primaryActions || []), ...(context.secondaryActions || [])].slice(0, 4),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (action) => {
    const { label, ...payload } = action;
    send(payload, label);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    send({ message: text }, text);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Drishti AI — Guided hiring help" style={S.launcher}>
        <BotMark />
      </button>
    );
  }

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BotMark />
          <div>
            <div style={S.title}>Drishti AI</div>
            <div style={S.subtitle}>{context.mode} · {context.label}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setMessages([])} style={S.iconButton} title="Clear chat">
            C
          </button>
          <button type="button" onClick={() => setOpen(false)} style={S.iconButton} title="Minimize">
            -
          </button>
        </div>
      </div>

      <div ref={scrollRef} style={S.body}>
        {messages.length === 0 && (
          <>
            <div style={S.botRow}>
              <BotMark />
              <div style={S.botBubble}>
                <div style={S.botText}>
                  Hi, I am Drishti AI. I answer read-only questions about the page you are viewing.
                </div>
                <div style={S.contextHint}>{context.intro}</div>
                {context.insightAction && (
                  <button type="button" onClick={() => handleAction(context.insightAction)} style={S.insightButton}>
                    {context.insightAction.label}
                  </button>
                )}
              </div>
            </div>
            <StarterGrid context={context} onAction={handleAction} />
          </>
        )}

        {messages.map((message, index) => (
          message.role === "user"
            ? <UserMessage key={index} text={message.text} />
            : <BotMessage key={index} message={message} onAction={handleAction} />
        ))}

        {loading && (
          <div style={S.botRow}>
            <BotMark />
          <div style={S.typing}>Checking ATS data...</div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={S.inputBar}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={`Ask about ${context.label.toLowerCase()}...`}
          style={S.input}
        />
        <button type="submit" disabled={loading || !input.trim()} style={{
          ...S.sendButton,
          opacity: loading || !input.trim() ? 0.55 : 1,
          cursor: loading || !input.trim() ? "not-allowed" : "pointer",
        }}>
          Send
        </button>
      </form>
    </div>
  );
}

const S = {
  launcher: {
    position: "fixed",
    right: 24,
    bottom: 24,
    zIndex: 900,
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "1px solid rgba(129,140,248,0.35)",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#0A66C2,#0ea5e9)",
    color: "white",
    boxShadow: "0 8px 24px rgba(10,102,194,0.4)",
    cursor: "pointer",
    fontFamily: "'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif",
  },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg,#0A66C2,#0ea5e9)",
    color: "white",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: 0.6,
    flexShrink: 0,
    boxShadow: "0 8px 18px rgba(10,102,194,0.28)",
  },
  panel: {
    position: "fixed",
    right: 24,
    bottom: 24,
    zIndex: 900,
    width: "min(420px, calc(100vw - 32px))",
    height: "min(680px, calc(100vh - 84px))",
    display: "flex",
    flexDirection: "column",
    background: "var(--pg-bg)",
    border: "1px solid var(--l09)",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 28px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(10,102,194,0.08)",
    fontFamily: "'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif",
  },
  header: {
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--l07)",
    background: "var(--hdr-bg)",
  },
  title: { color: "var(--t1)", fontSize: 14, fontWeight: 900 },
  subtitle: { color: "var(--t3)", fontSize: 11, marginTop: 2 },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "1px solid var(--l08)",
    background: "var(--l04)",
    color: "var(--t2)",
    cursor: "pointer",
    fontWeight: 800,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    background: "linear-gradient(180deg,var(--l02),transparent 180px)",
  },
  botRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 14,
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 14,
  },
  botBubble: {
    flex: 1,
    minWidth: 0,
    background: "var(--l03)",
    border: "1px solid var(--l07)",
    borderRadius: 14,
    padding: "12px 13px",
  },
  userBubble: {
    maxWidth: "82%",
    background: "linear-gradient(135deg,#0A66C2,#004182)",
    color: "white",
    borderRadius: 14,
    padding: "10px 13px",
    fontSize: 13,
    lineHeight: 1.5,
    fontWeight: 600,
  },
  botText: {
    color: "var(--t2)",
    fontSize: 13,
    lineHeight: 1.6,
  },
  contextHint: {
    marginTop: 8,
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(10,102,194,0.08)",
    border: "1px solid rgba(10,102,194,0.16)",
    color: "#0A66C2",
    fontSize: 12,
    lineHeight: 1.45,
  },
  starter: {
    margin: "6px 0 16px 42px",
  },
  starterTitle: {
    color: "var(--t3)",
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: 800,
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  starterGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
  },
  starterButton: {
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    gap: 8,
    textAlign: "left",
    padding: "9px 10px",
    border: "1px solid var(--l08)",
    borderRadius: 11,
    background: "var(--l03)",
    color: "var(--t2)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.25,
  },
  secondaryGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
  },
  secondaryButton: {
    padding: "7px 10px",
    borderRadius: 18,
    border: "1px solid var(--l08)",
    background: "var(--l03)",
    color: "var(--t3)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 800,
  },
  insightButton: {
    marginTop: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(14,165,233,0.28)",
    background: "rgba(14,165,233,0.08)",
    color: "#0A66C2",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
  },
  starterDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#0A66C2",
    boxShadow: "0 0 8px rgba(129,140,248,0.6)",
    flexShrink: 0,
  },
  cardsWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 12,
  },
  resultCard: {
    padding: 11,
    borderRadius: 12,
    background: "var(--l04)",
    border: "1px solid var(--l08)",
  },
  resultTitle: {
    color: "var(--t1)",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  resultSub: {
    color: "var(--t3)",
    fontSize: 12,
    lineHeight: 1.45,
    marginTop: 4,
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 7,
    marginTop: 10,
  },
  metaItem: {
    minWidth: 0,
    padding: "7px 8px",
    borderRadius: 9,
    background: "var(--l03)",
    border: "1px solid var(--l07)",
  },
  metaLabel: {
    display: "block",
    color: "var(--t3)",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  metaValue: {
    display: "block",
    color: "var(--t1)",
    fontSize: 12,
    fontWeight: 700,
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  evidenceLine: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    color: "var(--t4)",
    fontSize: 10.5,
    lineHeight: 1.35,
    marginTop: 10,
    borderTop: "1px solid var(--l06)",
    paddingTop: 9,
  },
  actionsWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 10,
  },
  actionButton: {
    padding: "6px 9px",
    borderRadius: 18,
    border: "1px solid rgba(129,140,248,0.28)",
    background: "rgba(10,102,194,0.1)",
    color: "#0A66C2",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 800,
  },
  typing: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--l03)",
    border: "1px solid var(--l07)",
    color: "var(--t3)",
    fontSize: 12,
    fontWeight: 700,
  },
  inputBar: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid var(--l07)",
    background: "var(--hdr-bg)",
  },
  input: {
    flex: 1,
    minWidth: 0,
    border: "1px solid var(--l08)",
    borderRadius: 11,
    background: "var(--l04)",
    color: "var(--t1)",
    outline: "none",
    padding: "10px 11px",
    fontSize: 13,
  },
  sendButton: {
    border: "none",
    borderRadius: 11,
    background: "linear-gradient(135deg,#0D6B35,#047857)",
    color: "white",
    padding: "0 14px",
    fontSize: 12,
    fontWeight: 900,
  },
};

