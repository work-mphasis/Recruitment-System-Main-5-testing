import { useState } from "react";
import { useAuth } from "../AuthContext";
import { useTheme } from "../ThemeContext";

const PAGE_META = [
  { key:"dashboard",           label:"Dashboard",           icon:"◈" },
  { key:"position-management", label:"Position Management", icon:"⊞" },
  { key:"candidates",          label:"Candidates",          icon:"◉" },
  { key:"resumes",             label:"Resumes",             icon:"▤"  },
  { key:"client-report",       label:"Client Report",       icon:"◧" },
];

export default function ManagePrivileges() {
  const { authData, updatePrivileges } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [selectedAcc, setSelectedAcc] = useState("");
  const [saved,       setSaved]       = useState("");

  const accounts = Object.entries(authData.accounts).filter(([a]) => a !== "Admin");

  const handleToggle = (account, username, pageKey, current) => {
    const user = authData.accounts[account].users[username];
    const privs = user.privileges || [];
    const next  = privs.includes(pageKey) ? privs.filter(p => p !== pageKey) : [...privs, pageKey];
    updatePrivileges(account, username, next);
    setSaved(`${username} updated`);
    setTimeout(() => setSaved(""), 2000);
  };

  const handleSelectAll = (account, username, giveAll) => {
    updatePrivileges(account, username, giveAll ? PAGE_META.map(p => p.key) : []);
    setSaved(`${username} updated`);
    setTimeout(() => setSaved(""), 2000);
  };

  const card = { background: isDark?"rgba(255,255,255,0.03)":"white", border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)"}`, borderRadius:14, padding:20, marginBottom:16 };

  return (
    <div style={{ padding:"28px 36px", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", maxWidth:860 }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"var(--t3)", marginBottom:4 }}>Admin · Privileges</div>
        <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:"var(--t1)", letterSpacing:0 }}>Manage Privileges</h2>
        <div style={{ fontSize:13, color:"var(--t3)", marginTop:4 }}>Control which pages each user can access. Admin has full access by default.</div>
      </div>

      {/* Account filter */}
      <div style={{ marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
        <select value={selectedAcc} onChange={e => setSelectedAcc(e.target.value)}
          style={{ padding:"10px 14px", background: isDark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.03)", border:`1px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)"}`, borderRadius:8, color:"var(--t1)", fontSize:13, outline:"none", fontFamily:"inherit", appearance:"none", minWidth:200 }}>
          <option value="">All Accounts</option>
          {accounts.map(([a]) => <option key={a} value={a}>{a}</option>)}
        </select>
        {saved && <span style={{ fontSize:12, fontWeight:700, color:"#168740" }}>✓ {saved}</span>}
      </div>

      {/* Admin notice */}
      <div style={{ ...card, background: isDark?"rgba(10,102,194,0.08)":"rgba(10,102,194,0.04)", border:"1px solid rgba(10,102,194,0.2)", marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#0A66C2,#004182)", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:13 }}>A</div>
          <div>
            <div style={{ fontWeight:800, color:"var(--t1)", fontSize:14 }}>Admin · Admin</div>
            <div style={{ fontSize:12, color:"#0A66C2", marginTop:2, fontWeight:600 }}>Full access to all pages — cannot be restricted.</div>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", gap:6, flexWrap:"wrap" }}>
            {PAGE_META.map(p => (
              <span key={p.key} style={{ padding:"3px 10px", background:"rgba(10,102,194,0.15)", color:"#0A66C2", borderRadius:20, fontSize:11, fontWeight:700 }}>{p.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Users */}
      {accounts
        .filter(([a]) => !selectedAcc || a === selectedAcc)
        .map(([accName, accData]) => (
          <div key={accName}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"var(--t3)", marginBottom:10, paddingLeft:4 }}>
              {accName}
            </div>
            {Object.keys(accData.users).length === 0 ? (
              <div style={{ ...card, color:"var(--t3)", fontSize:13 }}>No users in this account.</div>
            ) : (
              Object.entries(accData.users).map(([uName, uData]) => {
                const privs = uData.privileges || [];
                const allOn = PAGE_META.every(p => privs.includes(p.key));
                return (
                  <div key={uName} style={card}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                      <div style={{ width:34, height:34, borderRadius:10, background:"rgba(14,165,233,0.15)", display:"flex", alignItems:"center", justifyContent:"center", color:"#0A66C2", fontWeight:800, fontSize:13 }}>
                        {uName[0].toUpperCase()}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:800, color:"var(--t1)", fontSize:14 }}>{uName}</div>
                        <div style={{ fontSize:11, color:"var(--t3)" }}>{accName} · {privs.length} page{privs.length !== 1 ? "s" : ""} accessible</div>
                      </div>
                      <button onClick={() => handleSelectAll(accName, uName, !allOn)}
                        style={{ padding:"5px 14px", background: allOn?"rgba(204,16,22,0.1)":"rgba(22,135,64,0.1)", color: allOn?"#CC1016":"#168740", border:`1px solid ${allOn?"rgba(204,16,22,0.25)":"rgba(22,135,64,0.25)"}`, borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                        {allOn ? "Remove All" : "Grant All"}
                      </button>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8 }}>
                      {PAGE_META.map(page => {
                        const on = privs.includes(page.key);
                        return (
                          <button key={page.key} onClick={() => handleToggle(accName, uName, page.key, on)}
                            style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", background: on ? (isDark?"rgba(10,102,194,0.15)":"rgba(10,102,194,0.08)") : (isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.03)"), border:`1px solid ${on?"rgba(10,102,194,0.35)":"rgba(100,116,139,0.15)"}`, borderRadius:10, cursor:"pointer", transition:"all 0.15s", textAlign:"left" }}>
                            <div style={{ width:18, height:18, borderRadius:5, border:`2px solid ${on?"#0A66C2":"rgba(100,116,139,0.4)"}`, background: on?"#0A66C2":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.15s" }}>
                              {on && <span style={{ color:"white", fontSize:10, fontWeight:800 }}>✓</span>}
                            </div>
                            <span style={{ fontSize:12, fontWeight:on?700:500, color: on?"var(--t1)":"var(--t3)" }}>{page.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))}

      {accounts.length === 0 && (
        <div style={{ ...card, color:"var(--t3)", fontSize:13, textAlign:"center", padding:40 }}>
          No accounts created yet. Go to <strong>Create</strong> to add accounts and users.
        </div>
      )}
    </div>
  );
}
