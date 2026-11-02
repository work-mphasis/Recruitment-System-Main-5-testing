import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const API = import.meta.env.VITE_API_URL ?? "";

const AGING_STYLES = {
  Fresh:    { color: "#168740", bg: "rgba(22,135,64,0.1)",  border: "rgba(22,135,64,0.25)"  },
  Aging:    { color: "#56687A", bg: "rgba(86,104,122,0.1)",  border: "rgba(86,104,122,0.25)"  },
  Stale:    { color: "#fb923c", bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.25)"  },
  Critical: { color: "#CC1016", bg: "rgba(204,16,22,0.1)", border: "rgba(204,16,22,0.25)" },
};

// ── Micro sparkline ───────────────────────────────────────────
function Sparkline({ color }) {
  const pts = [40,55,35,70,50,80,60,90,72,88].map((y,i) => `${i*12},${100-y}`).join(" ");
  return (
    <svg width="96" height="32" style={{ opacity:0.5 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Radial gauge ─────────────────────────────────────────────
function GaugeArc({ value, max, color, size = 56 }) {
  const r = size * 0.38, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(value / max, 1);
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--l05)" strokeWidth="5"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={circ} strokeDashoffset={circ - pct * circ}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition:"stroke-dashoffset 1.4s cubic-bezier(0.34,1.56,0.64,1)" }}/>
    </svg>
  );
}

// ── Glow dot ─────────────────────────────────────────────────
function Dot({ color }) {
  return (
    <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}`, flexShrink:0 }}/>
  );
}

// ── Pill badge ────────────────────────────────────────────────
function Pill({ label, color, bg, border }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, background:bg, border:`1px solid ${border}`, color, fontSize:11, fontWeight:700, letterSpacing:0.3 }}>
      <Dot color={color}/>{label}
    </span>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]             = useState({});
  const [roleSummary, setRoleSummary] = useState([]);
  const [selectedRole, setSelectedRole] = useState("");
  const [roleReport, setRoleReport]   = useState(null);
  const [showReport, setShowReport]   = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [showAgingBreakdown, setShowAgingBreakdown] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const [dashRes, roleRes] = await Promise.all([
        fetch(`${API}/dashboard`),
        fetch(`${API}/role-summary`),
      ]);
      if (!dashRes.ok || !roleRes.ok) throw new Error("Failed to load");
      setStats(await dashRes.json());
      setRoleSummary(await roleRes.json());
      setError(null);
    } catch {
      setError("Failed to fetch dashboard data. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboard(); }, [location]);

  const fetchRoleReport = async (role) => {
    try {
      const res = await fetch(`${API}/positions-by-role?role=${encodeURIComponent(role)}`);
      setRoleReport(await res.json());
    } catch { setRoleReport(null); }
  };

  useEffect(() => {
    if (!selectedRole) { setRoleReport(null); setShowReport(false); return; }
    fetchRoleReport(selectedRole);
  }, [selectedRole]);

  // ── Loading / error states ────────────────────────────────
  if (loading) return (
    <div style={S.centeredScreen}>
      <div style={S.loadingSpinner}/>
      <p style={{ color:"var(--t3)", fontSize:14, marginTop:16 }}>Loading workspace...</p>
    </div>
  );
  if (error) return (
    <div style={S.centeredScreen}>
      <div style={{ color:"#CC1016", fontSize:14 }}>{error}</div>
    </div>
  );

  // ── Derived values ────────────────────────────────────────
  const agingBreakdown = stats.aging_breakdown || [];
  const hasCritical    = agingBreakdown.some(r => r.bucket === "Critical");
  const hasStale       = agingBreakdown.some(r => r.bucket === "Stale");
  const hasAging       = agingBreakdown.some(r => r.bucket === "Aging");
  const gapBucket      = hasCritical ? "Critical" : hasStale ? "Stale" : hasAging ? "Aging" : "Fresh";
  const gapStyle       = AGING_STYLES[gapBucket];
  const criticalCount  = stats.critical_roles_count || 0;
  const staleCount     = stats.stale_roles_count    || 0;
  const totalGap       = stats.total_gap            || 0;

  const kpiCards = [
    { label:"Total Positions",      value: stats.total_positions    ?? 0, color:"#0A66C2", accent:"rgba(129,140,248,0.15)" },
    { label:"Open Positions",       value: stats.total_open         ?? 0, color:"#168740", accent:"rgba(22,135,64,0.15)"  },
    { label:"Profiles Submitted",   value: stats.profiles_submitted ?? 0, color:"#0A66C2", accent:"rgba(10,102,194,0.15)"  },
    { label:"Interviews Scheduled", value: stats.profiles_scheduled ?? 0, color:"#56687A", accent:"rgba(86,104,122,0.15)"  },
  ];

  const reportRows = roleReport ? [
    { label:"Positions Fulfilled", value: roleReport.fulfilled },
    { label:"Positions On Hold",   value: roleReport.on_hold },
    { label:"Positions Net Open",  value: roleReport.net_open },
    { label:"Profiles Submitted",  value: roleReport.submitted },
    { label:"Profiles Rejected",   value: roleReport.rejected },
    { label:"Pending Feedback",    value: roleReport.pending_feedback },
    { label:"Profiles Scheduled",  value: roleReport.scheduled },
    { label:"Pending with Client", value: roleReport.pending_client },
    { label:"Gap",                 value: roleReport.gap },
    { label:"Days Open",           value: roleReport.days_open != null ? `${roleReport.days_open}d` : "—" },
    { label:"Aging Bucket",        value: roleReport.aging_bucket  || "—" },
    { label:"Weighted Gap",        value: roleReport.weighted_gap  != null ? roleReport.weighted_gap : "—" },
  ] : [];

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:var(--l03); border-radius:6px; }
        ::-webkit-scrollbar-thumb { background:rgba(10,102,194,0.55); border-radius:6px; border:1px solid rgba(10,102,194,0.2); }
        ::-webkit-scrollbar-thumb:hover { background:rgba(10,102,194,0.85); }
      `}</style>

      <div style={S.gridOverlay}/>

      {/* ── HEADER ── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:28, position:"relative", zIndex:1 }}>
        <div>
          <div style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1.5, marginBottom:6 }}>
            Enterprise ATS · Live
          </div>
          <h1 style={{ color:"var(--t1)", fontSize:30, fontWeight:800, margin:0, letterSpacing:-1 }}>Hiring Dashboard</h1>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px", background:"rgba(22,135,64,0.08)", border:"1px solid rgba(22,135,64,0.2)", borderRadius:20 }}>
            <Dot color="#168740"/>
            <span style={{ color:"#168740", fontSize:11, fontWeight:700 }}>Live</span>
          </div>
          <button onClick={fetchDashboard}
            style={{ background:"var(--l04)", border:"1px solid var(--l08)", color:"var(--t3)", width:36, height:36, borderRadius:10, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}
            title="Refresh">↻</button>
        </div>
      </div>

      {/* ── NAV STRIP ── */}
      <div style={{ display:"flex", gap:8, marginBottom:28, flexWrap:"wrap", position:"relative", zIndex:1 }}>
        {[
          { label:"Candidates",    path:"/candidates",       icon:"◈" },
          { label:"Position Management", path:"/new-requirements", icon:"≡" },
          { label:"Client Report", path:"/client-report",    icon:"↗" },
        ].map(btn => (
          <button key={btn.path} onClick={() => navigate(btn.path)}
            style={{ display:"flex", alignItems:"center", gap:7, padding:"9px 16px", background:"var(--l04)", color:"var(--t3)", border:"1px solid var(--l07)", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600 }}
            onMouseEnter={e => { e.currentTarget.style.background="var(--l08)"; e.currentTarget.style.color="var(--t1)"; }}
            onMouseLeave={e => { e.currentTarget.style.background="var(--l04)"; e.currentTarget.style.color="var(--t3)"; }}>
            <span style={{ color:"#0A66C2", fontSize:14 }}>{btn.icon}</span>
            {btn.label}
          </button>
        ))}
      </div>

      {/* ── KPI GRID ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:14, marginBottom:14, position:"relative", zIndex:1 }}>
        {kpiCards.map((card, i) => (
          <div key={i}
            style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:16, padding:"22px 20px", transition:"all 0.2s ease", cursor:"default" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor=card.color+"66"; e.currentTarget.style.transform="translateY(-3px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="var(--l07)"; e.currentTarget.style.transform="translateY(0)"; }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"var(--t3)" }}>{card.label}</div>
                <div style={{ fontSize:40, fontWeight:800, color:card.color, lineHeight:1, marginTop:8, letterSpacing:-1 }}>{card.value}</div>
              </div>
              <div style={{ background:card.accent, borderRadius:12, padding:10 }}>
                <GaugeArc value={card.value} max={Math.max(card.value*1.5, 10)} color={card.color} size={52}/>
              </div>
            </div>
            <div style={{ marginTop:16 }}><Sparkline color={card.color}/></div>
            <div style={{ marginTop:4, fontSize:11, color:"var(--t3)" }}>↑ trend this cycle</div>
          </div>
        ))}
      </div>

      {/* ── GAP CARD ── */}
      <div
        style={{ background:"var(--l03)", border:`1px solid ${gapStyle.border}`, borderRadius:16, padding:"24px 28px", marginBottom:28, cursor:"pointer", transition:"opacity 0.15s", position:"relative", zIndex:1 }}
        onClick={() => setShowAgingBreakdown(v => !v)}
        onMouseEnter={e => e.currentTarget.style.opacity="0.9"}
        onMouseLeave={e => e.currentTarget.style.opacity="1"}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"var(--t3)" }}>Total Gap</div>
              <div style={{ fontSize:52, fontWeight:800, color:gapStyle.color, lineHeight:1, letterSpacing:-2, marginTop:4 }}>{totalGap}</div>
            </div>
            <div style={{ width:1, height:60, background:"var(--l08)" }}/>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <Pill label={gapBucket} color={gapStyle.color} bg={gapStyle.bg} border={gapStyle.border}/>
              {criticalCount > 0 && (
                <Pill label={`${criticalCount} critical role${criticalCount!==1?"s":""}`}
                  color="#CC1016" bg="rgba(204,16,22,0.1)" border="rgba(204,16,22,0.25)"/>
              )}
              {staleCount > 0 && (
                <Pill label={`${staleCount} stale role${staleCount!==1?"s":""}`}
                  color="#fb923c" bg="rgba(251,146,60,0.1)" border="rgba(251,146,60,0.25)"/>
              )}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, color:"var(--t3)", fontSize:12 }}>
            {showAgingBreakdown ? "▲ collapse" : "▼ view breakdown"}
          </div>
        </div>

        {showAgingBreakdown && agingBreakdown.length > 0 && (
          <div style={{ marginTop:20, borderTop:"1px solid var(--l08)", paddingTop:18 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>
              Role aging breakdown
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {agingBreakdown.sort((a,b) => b.days_open - a.days_open).map(r => {
                const s   = AGING_STYLES[r.bucket] || AGING_STYLES.Fresh;
                const barW = Math.min((r.days_open / 90) * 100, 100);
                return (
                  <div key={r.role} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"var(--l03)", border:`1px solid ${s.border}`, borderRadius:10, flexWrap:"wrap" }}>
                    <span style={{ flex:"1 1 140px", color:"var(--t1)", fontSize:13, fontWeight:600 }}>{r.role}</span>
                    <span style={{ color:"var(--t3)", fontSize:11 }}>{r.days_open}d open</span>
                    <Pill label={r.bucket} color={s.color} bg={s.bg} border={s.border}/>
                    <span style={{ color:"var(--t3)", fontSize:11 }}>
                      Gap <strong style={{ color:"var(--t1)" }}>{r.weighted_gap}</strong>
                      <span style={{ color:"var(--t3)", fontSize:10 }}> w</span>
                    </span>
                    <div style={{ flex:"0 0 80px", height:3, background:"var(--l07)", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${barW}%`, background:s.color, borderRadius:2, transition:"width 0.8s ease" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop:14, display:"flex", gap:16, flexWrap:"wrap" }}>
              {Object.entries(AGING_STYLES).map(([label, s]) => (
                <span key={label} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:s.color }}>
                  <Dot color={s.color}/> {label}
                  <span style={{ color:"var(--t3)", fontSize:10 }}>
                    {label==="Fresh"?"(0–14d)":label==="Aging"?"(15–30d)":label==="Stale"?"(31–60d)":"(60d+)"}
                  </span>
                </span>
              ))}
              <span style={{ color:"var(--t3)", fontSize:11, marginLeft:8 }}>weighted = gap × multiplier (1×–3×)</span>
            </div>
          </div>
        )}
      </div>

      {/* ── ROLE PANEL ── */}
      <div style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:16, padding:28, position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, marginBottom:4 }}>Analytics</div>
            <h2 style={{ color:"var(--t1)", fontSize:18, fontWeight:800, margin:0, letterSpacing:-0.3 }}>Submit Candidate</h2>
          </div>
          <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
            style={{ padding:"10px 14px", minWidth:260, background:"var(--l04)", border:"1px solid var(--l10)", borderRadius:10, color:"var(--t1)", fontSize:13, outline:"none", cursor:"pointer" }}>
            <option value="" style={{ background:"var(--pg-bg)" }}>Select a role…</option>
            {roleSummary.map(item => (
              <option key={item.Role} value={item.Role} style={{ background:"var(--pg-bg)" }}>{item.Role}</option>
            ))}
          </select>
        </div>

        {roleReport && (
          <>
            {/* Role hero */}
            <div style={{ background:"rgba(10,102,194,0.06)", border:"1px solid rgba(10,102,194,0.18)", borderRadius:14, padding:"22px 24px", marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ color:"#0A66C2", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Selected role</div>
                <div style={{ color:"var(--t1)", fontSize:22, fontWeight:800, margin:"6px 0 10px", letterSpacing:0 }}>{roleReport.role}</div>
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <div style={{ color:"#0A66C2", fontSize:38, fontWeight:800, lineHeight:1 }}>
                    {roleReport.total_positions}
                    <span style={{ fontSize:13, color:"var(--t3)", fontWeight:500, marginLeft:8 }}>positions</span>
                  </div>
                  {roleReport.aging_bucket && (() => {
                    const s = AGING_STYLES[roleReport.aging_bucket] || AGING_STYLES.Fresh;
                    return <Pill label={`${roleReport.aging_bucket} · ${roleReport.days_open}d`} color={s.color} bg={s.bg} border={s.border}/>;
                  })()}
                  {roleReport.weighted_gap != null && (
                    <span style={{ fontSize:12, color:"var(--t3)" }}>
                      Weighted gap: <strong style={{ color:"var(--t1)" }}>{roleReport.weighted_gap}</strong>
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => setShowReport(p => !p)}
                  style={{ padding:"10px 18px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13 }}
                  onMouseEnter={e => e.currentTarget.style.background="var(--l07)"}
                  onMouseLeave={e => e.currentTarget.style.background="var(--l04)"}>
                  {showReport ? "Hide Report" : "View Report"}
                </button>
              </div>
            </div>

            {/* Report grid */}
            {showReport && (
              <div style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:14, overflow:"hidden" }}>
                <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--l06)", background:"var(--l02)" }}>
                  <span style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>
                    {roleReport.role} — Analytics
                  </span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))" }}>
                  {reportRows.map((row, i) => {
                    const isAging = row.label === "Aging Bucket";
                    const isGap   = row.label === "Gap" || row.label === "Weighted Gap";
                    const bStyle  = isAging && row.value !== "—" ? AGING_STYLES[row.value] : null;
                    return (
                      <div key={row.label} style={{ padding:"16px 20px", borderBottom:"1px solid var(--l07)", borderRight:"1px solid var(--l07)", background:i%2===0?"transparent":"var(--l02)" }}>
                        <div style={{ color:"var(--t3)", fontSize:10, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>{row.label}</div>
                        {bStyle ? (
                          <Pill label={row.value} color={bStyle.color} bg={bStyle.bg} border={bStyle.border}/>
                        ) : (
                          <div style={{ color:isGap&&row.value>0?"#CC1016":"var(--t1)", fontSize:22, fontWeight:700 }}>
                            {row.value ?? "—"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>


    </div>
  );
}

// ── Style tokens ──────────────────────────────────────────────
const S = {
  root: {
    minHeight:"100vh", background:"var(--pg-bg)",
    fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif",
    padding:"32px 36px", position:"relative", overflowX:"hidden",
  },
  gridOverlay: {
    position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
    backgroundImage:`linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px)`,
    backgroundSize:"40px 40px",
  },
  centeredScreen: {
    minHeight:"100vh", background:"var(--pg-bg)",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    fontFamily:"'Inter',system-ui,sans-serif",
  },
  loadingSpinner: {
    width:32, height:32, borderRadius:"50%",
    border:"2px solid rgba(10,102,194,0.2)", borderTopColor:"#0A66C2",
    animation:"spin 0.8s linear infinite",
  },
};
