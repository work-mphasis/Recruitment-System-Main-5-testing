import { useAuth } from "../AuthContext";
import { useTheme } from "../ThemeContext";

export default function AccountSwitcher() {
  const { session, selectWorkspace, logout } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const workspaces = session?.workspaces || [];

  // Group workspaces by account for display
  const grouped = {};
  workspaces.forEach(ws => {
    if (!grouped[ws.account]) grouped[ws.account] = [];
    grouped[ws.account].push(ws);
  });

  const colors = [
    { bg: "linear-gradient(135deg,#0A66C2,#004182)", light: "rgba(10,102,194,0.10)", border: "rgba(10,102,194,0.28)", text: "#0A66C2" },
    { bg: "linear-gradient(135deg,#0A66C2,#004182)", light: "rgba(0,65,130,0.10)", border: "rgba(0,65,130,0.28)", text: "#a78bfa" },
    { bg: "linear-gradient(135deg,#0A66C2,#004182)", light: "rgba(10,102,194,0.10)", border: "rgba(10,102,194,0.28)", text: "#60a5fa" },
    { bg: "linear-gradient(135deg,#168740,#0D6B35)", light: "rgba(22,135,64,0.10)", border: "rgba(22,135,64,0.28)", text: "#168740" },
    { bg: "linear-gradient(135deg,#38434F,#56687A)", light: "rgba(56,67,79,0.10)", border: "rgba(56,67,79,0.28)", text: "#56687A" },
    { bg: "linear-gradient(135deg,#0A66C2,#0A66C2)", light: "rgba(10,102,194,0.10)", border: "rgba(10,102,194,0.28)", text: "#f472b6" },
  ];

  const accounts = Object.keys(grouped);

  return (
    <div style={{ minHeight:"100vh", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", display:"flex", flexDirection:"column" }}>

      {/* Top bar */}
      <div style={{ padding:"0 28px", height:52, background: isDark?"rgba(255,255,255,0.03)":"white", borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.07)"}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontWeight:800, fontSize:15, color:"var(--t1)", letterSpacing:-0.3 }}>◈ ATS</span>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:12, color:"var(--t3)", fontWeight:600 }}>{session?.username}</div>
          <button onClick={logout}
            style={{ padding:"5px 14px", background:"rgba(204,16,22,0.08)", border:"1px solid rgba(204,16,22,0.25)", borderRadius:20, cursor:"pointer", color:"#CC1016", fontSize:12, fontWeight:700 }}>
            Logout
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px" }}>

        <div style={{ textAlign:"center", marginBottom:40 }}>
          <h1 style={{ margin:0, fontSize:28, fontWeight:800, color:"var(--t1)", letterSpacing:0 }}>
            Select a Workspace
          </h1>
          <p style={{ margin:"10px 0 0", fontSize:14, color:"var(--t3)" }}>
            You have access to {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}. Click one to enter.
          </p>
        </div>

        {accounts.length === 0 ? (
          <div style={{ padding:"32px 40px", background: isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.03)", borderRadius:16, border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)"}`, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:12 }}>◎</div>
            <div style={{ fontWeight:700, color:"var(--t2)", marginBottom:6 }}>No workspaces assigned yet</div>
            <div style={{ fontSize:13, color:"var(--t3)" }}>Ask your Admin to assign you access.</div>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:16, maxWidth:960, width:"100%" }}>
            {accounts.map((acc, i) => {
              const c    = colors[i % colors.length];
              const lobs = grouped[acc];
              const hasLobs = lobs.some(ws => ws.lob);

              if (!hasLobs) {
                // Account-level card (no LOB distinction)
                const perm = lobs[0]?.permission || "read";
                return (
                  <button key={acc} onClick={() => selectWorkspace(acc, null)}
                    style={{ padding:"28px 24px", background: isDark ? c.light : "white", border:`1.5px solid ${c.border}`, borderRadius:16, cursor:"pointer", textAlign:"left", transition:"all 0.18s", position:"relative", overflow:"hidden" }}
                    onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=`0 8px 24px ${c.border}`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=""; }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:c.bg, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:18, marginBottom:16 }}>
                      {acc[0].toUpperCase()}
                    </div>
                    <div style={{ fontWeight:800, color:"var(--t1)", fontSize:16, marginBottom:4 }}>{acc}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:12, color:c.text, fontWeight:700 }}>Enter Account →</span>
                      <span style={{ fontSize:10, padding:"2px 7px", background: perm==="write"?"rgba(22,135,64,0.12)":"rgba(148,163,184,0.12)", color: perm==="write"?"#168740":"#94a3b8", border:`1px solid ${perm==="write"?"rgba(22,135,64,0.3)":"rgba(148,163,184,0.2)"}`, borderRadius:8, fontWeight:700 }}>
                        {perm === "write" ? "Read/Write" : "Read"}
                      </span>
                    </div>
                    <div style={{ position:"absolute", right:-12, top:-12, width:60, height:60, borderRadius:"50%", background:c.bg, opacity:0.12 }}/>
                  </button>
                );
              }

              // Account with LOBs — show sub-cards
              return (
                <div key={acc} style={{ background: isDark?"rgba(255,255,255,0.02)":"white", border:`1.5px solid ${c.border}`, borderRadius:16, overflow:"hidden" }}>
                  <div style={{ padding:"16px 20px 10px", borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)"}`, display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:c.bg, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:14 }}>
                      {acc[0].toUpperCase()}
                    </div>
                    <div style={{ fontWeight:800, color:"var(--t1)", fontSize:14 }}>{acc}</div>
                  </div>
                  <div style={{ padding:"8px 12px 12px", display:"flex", flexDirection:"column", gap:6 }}>
                    {lobs.map(ws => (
                      <button key={ws.lob} onClick={() => selectWorkspace(ws.account, ws.lob)}
                        style={{ padding:"10px 14px", background: isDark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.02)", border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)"}`, borderRadius:10, cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between", transition:"all 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark?"rgba(10,102,194,0.1)":"rgba(10,102,194,0.06)"; e.currentTarget.style.borderColor=c.border; }}
                        onMouseLeave={e => { e.currentTarget.style.background = isDark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.02)"; e.currentTarget.style.borderColor=isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)"; }}>
                        <span style={{ fontWeight:700, color:"var(--t1)", fontSize:13 }}>{ws.lob}</span>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ fontSize:10, padding:"2px 7px", background: ws.permission==="write"?"rgba(22,135,64,0.12)":"rgba(148,163,184,0.12)", color: ws.permission==="write"?"#168740":"#94a3b8", border:`1px solid ${ws.permission==="write"?"rgba(22,135,64,0.3)":"rgba(148,163,184,0.2)"}`, borderRadius:8, fontWeight:700 }}>
                            {ws.permission === "write" ? "Read/Write" : "Read"}
                          </span>
                          <span style={{ color:c.text, fontSize:12, fontWeight:700 }}>→</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
