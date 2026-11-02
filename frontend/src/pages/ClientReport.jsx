import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL ?? "";

function getInitials(name = "") {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = ["#0A66C2","#0ea5e9","#168740","#38434F","#0A66C2","#0A66C2","#14b8a6","#f97316"];

function avatarColor(name = "") {
  let hash = 0;
  for (let c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position:"fixed", bottom:28, right:28, zIndex:9999,
      background: type==="success" ? "rgba(22,135,64,0.15)" : "rgba(204,16,22,0.15)",
      border: `1px solid ${type==="success" ? "rgba(22,135,64,0.4)" : "rgba(204,16,22,0.4)"}`,
      color: type==="success" ? "#168740" : "#CC1016",
      padding:"14px 22px", borderRadius:12, fontSize:14, fontWeight:600,
      backdropFilter:"blur(10px)", boxShadow:"0 8px 32px rgba(0,0,0,0.4)",
      display:"flex", alignItems:"center", gap:10, animation:"fadeUp 0.3s ease"
    }}>
      <span>{type==="success"?"✓":"✕"}</span>{message}
    </div>
  );
}

export default function ClientReport() {
  const navigate = useNavigate();
  const tableRef = useRef(null);

  const [roles,setRoles]           = useState([]);
  const [selectedRole,setSelectedRole] = useState("");
  const [roleSearch,setRoleSearch] = useState("");
  const [roleDropOpen,setRoleDropOpen] = useState(false);
  const [candidates,setCandidates] = useState([]);
  const [reportRows,setReportRows] = useState([]);
  const [generating,setGenerating] = useState(false);
  const [toast,setToast]           = useState(null);
  const [copyMode,setCopyMode]     = useState("table");
  const [generated,setGenerated]   = useState(false);

  const showToast = (message, type="success") => setToast({message,type});

  useEffect(()=>{
    fetch(`${API}/role-summary`).then(r=>r.json()).then(d=>setRoles(d)).catch(console.error);
  },[]);

  useEffect(()=>{
    if (!selectedRole){setCandidates([]);setReportRows([]);setGenerated(false);return;}
    fetch(`${API}/view-candidates`).then(r=>r.json())
      .then(data=>{
        const filtered = data.filter(row=>(row["Role"]||"").trim().toLowerCase()===selectedRole.trim().toLowerCase());
        setCandidates(filtered); setReportRows([]); setGenerated(false);
      }).catch(console.error);
  },[selectedRole]);

  const generateReport = async () => {
    if (!candidates.length) return;
    setGenerating(true); setGenerated(false);
    const initial = candidates.map(c=>({
      name: c["Candidate Name"]||"—",
      position: c["Role"]||selectedRole,
      status: c["Status"]||"—",
      summary:"", loading:true, error:false,
    }));
    setReportRows([...initial]);
    const results = await Promise.all(
      candidates.map(async(c,i)=>{
        const candidateName = c["Candidate Name"]||"";
        const filename = candidateName.replace(/ /g,"_")+".docx";
        try {
          const res = await fetch(`${API}/generate-summary/${filename}`);
          if (!res.ok) throw new Error("not found");
          const data = await res.json();
          return {index:i, summary:data.summary||"No summary available.", error:false};
        } catch {
          return {index:i, summary:"No resume uploaded for this candidate.", error:true};
        }
      })
    );
    setReportRows(prev=>{
      const updated=[...prev];
      results.forEach(({index,summary,error})=>{ updated[index]={...updated[index],summary,loading:false,error}; });
      return updated;
    });
    setGenerating(false); setGenerated(true);
  };

  const copyAsTable = async () => {
    if (!reportRows.length) return;
    const headerStyle=`background-color:#1e1b4b;color:#a5b4fc;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;padding:10px 14px;border:1px solid #312e81;text-align:left;`;
    const cellStyle=`padding:10px 14px;border:1px solid #e2e8f0;vertical-align:top;font-size:13px;font-family:Segoe UI,sans-serif;color:#1e293b;line-height:1.6;`;
    const nameCellStyle=cellStyle+"font-weight:600;color:#0f172a;white-space:nowrap;";
    const posCellStyle=cellStyle+"white-space:nowrap;color:#004182;font-weight:600;";
    const statusColor=(s)=>s==="Selected"?"#0D6B35":s==="Rejected"?"#CC1016":s==="Scheduled"?"#56687A":"#475569";
    const rows=reportRows.map((r,i)=>`<tr style="background-color:${i%2===0?"#ffffff":"#f8fafc"}"><td style="${nameCellStyle}">${r.name}</td><td style="${posCellStyle}">${r.position}</td><td style="${cellStyle}color:${statusColor(r.status)};font-weight:600;white-space:nowrap;">${r.status}</td><td style="${cellStyle}max-width:600px;">${r.summary.replace(/\n/g,"<br/>")}</td></tr>`).join("");
    const html=`<table style="border-collapse:collapse;font-family:Segoe UI,sans-serif;width:100%;"><thead><tr><th style="${headerStyle}">Candidate Name</th><th style="${headerStyle}">Position</th><th style="${headerStyle}">Status</th><th style="${headerStyle}">AI Summary</th></tr></thead><tbody>${rows}</tbody></table>`;
    const plain=["Candidate Name\tPosition\tStatus\tSummary",...reportRows.map(r=>`${r.name}\t${r.position}\t${r.status}\t${r.summary.replace(/\n/g," ")}`)].join("\n");
    try {
      await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([plain],{type:"text/plain"})})]);
      showToast("Table copied! Paste into Outlook, Word, or Excel.");
    } catch {
      try { await navigator.clipboard.writeText(plain); showToast("Copied as plain text (paste into Excel)."); }
      catch { showToast("Copy failed — try selecting & copying manually.","error"); }
    }
  };

  const copyAsEmail = () => {
    if (!reportRows.length) return;
    const lines=[
      `Subject: Candidate Profiles — ${selectedRole}`,"",`Dear Team,`,"",
      `Please find below a summary of ${reportRows.length} candidate(s) shortlisted for the role of ${selectedRole}:`,"",
      "─".repeat(60),
      ...reportRows.map((r,i)=>[`${i+1}. ${r.name}  |  ${r.position}  |  Status: ${r.status}`,"",r.summary,"","─".repeat(60)].join("\n")),
      "","Please review and share your feedback at your earliest convenience.","","Best regards"
    ];
    navigator.clipboard.writeText(lines.join("\n"))
      .then(()=>showToast("Email body copied to clipboard!"))
      .catch(()=>showToast("Copy failed","error"));
  };

  const handleCopy = () => copyMode==="table" ? copyAsTable() : copyAsEmail();
  const allDone = reportRows.length>0 && reportRows.every(r=>!r.loading);

  return (
    <div style={{ minHeight:"100vh", background:"var(--pg-bg)", fontFamily:"'Segoe UI',system-ui,sans-serif", padding:"32px", color:"var(--t1)" }}>

      <style>{`
        @media print { body > *:not(#root) { display:none; } nav,button,input { display:none!important; } .report-table { display:table!important; } @page { margin:1cm; } }
        @keyframes fadeUp { from{transform:translateY(16px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:var(--l03); border-radius:6px; }
        ::-webkit-scrollbar-thumb { background:rgba(10,102,194,0.55); border-radius:6px; border:1px solid rgba(10,102,194,0.2); }
        ::-webkit-scrollbar-thumb:hover { background:rgba(10,102,194,0.85); }
        .report-table th, .report-table td {
          padding:14px 18px; text-align:left; vertical-align:top;
          border-bottom:1px solid var(--l07); font-size:13px;
        }
        .report-table th {
          background:rgba(10,102,194,0.08); color:#0A66C2; font-weight:700;
          font-size:11px; text-transform:uppercase; letter-spacing:0.8px;
          position:sticky; top:0; z-index:2; border-bottom:1px solid rgba(10,102,194,0.2);
        }
        .report-table tr:hover td { background:var(--l02); }
        .summary-cell { line-height:1.7; color:var(--t2); max-width:520px; }
      `}</style>

      {/* HEADER */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:36, flexWrap:"wrap", gap:16 }}>
        <div>
          <button onClick={()=>navigate("/")}
            style={{ background:"var(--l06)", border:"1px solid var(--l10)", color:"var(--t3)", padding:"7px 16px", borderRadius:8, cursor:"pointer", fontSize:13, marginBottom:14, display:"inline-flex", alignItems:"center", gap:6 }}>
            ← Dashboard
          </button>
          <h1 style={{ margin:0, fontSize:30, fontWeight:800, letterSpacing:0 }}>Client Report</h1>
          {/* subtitle bumped #475569 → #64748b */}
          <p style={{ color:"var(--t3)", margin:"6px 0 0", fontSize:14 }}>
            Generate AI-powered candidate summaries to share with clients
          </p>
        </div>
        <div style={{ background:"linear-gradient(135deg,rgba(10,102,194,0.15),rgba(0,65,130,0.1))", border:"1px solid rgba(10,102,194,0.25)", borderRadius:14, padding:"10px 18px", display:"flex", alignItems:"center", gap:10, alignSelf:"flex-end" }}>
          <span style={{ fontSize:20 }}>🤖</span>
          <div>
            <div style={{ fontSize:10, color:"#0A66C2", fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Powered by AI</div>
            <div style={{ fontSize:12, color:"var(--t2)", fontWeight:600 }}>Auto-summarized resumes</div>
          </div>
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{ background:"var(--l03)", border:"1px solid var(--l08)", borderRadius:18, padding:"24px 28px", marginBottom:28, display:"flex", flexWrap:"wrap", gap:16, alignItems:"flex-end" }}>
        <div style={{ flex:"1 1 260px" }}>
          {/* SELECT POSITION / ROLE label bumped #64748b stays — already ok, but border/bg bumped for contrast */}
          <label style={{ display:"block", color:"var(--t2)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>
            Select Position / Role
          </label>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--t3)", fontSize:14, pointerEvents:"none" }}>⌕</span>
            <input
              type="text"
              placeholder="Type to search a role..."
              value={selectedRole ? selectedRole : roleSearch}
              onChange={e=>{ setRoleSearch(e.target.value); setSelectedRole(""); setRoleDropOpen(true); }}
              onFocus={()=>setRoleDropOpen(true)}
              onBlur={()=>setTimeout(()=>setRoleDropOpen(false), 150)}
              style={{ width:"100%", padding:"11px 14px 11px 36px", background: selectedRole?"rgba(10,102,194,0.1)":"var(--l06)", border:`1px solid ${selectedRole?"rgba(10,102,194,0.45)":"var(--l10)"}`, borderRadius:10, color: selectedRole?"#0A66C2":"var(--t1)", fontSize:14, outline:"none", cursor:"text", boxSizing:"border-box", boxShadow: selectedRole?"0 0 10px rgba(10,102,194,0.15)":"none" }}
            />
            {selectedRole&&(
              <button onClick={()=>{ setSelectedRole(""); setRoleSearch(""); }}
                style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--t3)", cursor:"pointer", fontSize:16, lineHeight:1, padding:2 }}>✕</button>
            )}
            {roleDropOpen&&(
              <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, background:"var(--drop-bg)", border:"1px solid rgba(10,102,194,0.3)", borderRadius:10, zIndex:50, maxHeight:240, overflowY:"auto", boxShadow:"0 12px 40px rgba(0,0,0,0.5)" }}>
                {roles
                  .filter(r=>(r.Role||"").toLowerCase().includes((selectedRole||roleSearch).toLowerCase()))
                  .map(r=>(
                    <div key={r.Role}
                      onMouseDown={()=>{ setSelectedRole(r.Role); setRoleSearch(""); setRoleDropOpen(false); }}
                      style={{ padding:"10px 14px", cursor:"pointer", fontSize:13, color:"var(--t2)", borderBottom:"1px solid var(--l07)", display:"flex", justifyContent:"space-between", alignItems:"center" }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.12)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <span><span style={{ color:"#0A66C2", marginRight:8, fontSize:11 }}>◈</span>{r.Role}</span>
                      <span style={{ color:"var(--t4)", fontSize:11 }}>{r.submitted ?? ""}</span>
                    </div>
                  ))
                }
                {roles.filter(r=>(r.Role||"").toLowerCase().includes((selectedRole||roleSearch).toLowerCase())).length===0&&(
                  <div style={{ padding:"14px", color:"var(--t3)", fontSize:13, textAlign:"center" }}>No roles found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {selectedRole&&(
          <div style={{ padding:"11px 18px", background:candidates.length>0?"rgba(22,135,64,0.1)":"rgba(204,16,22,0.1)", border:`1px solid ${candidates.length>0?"rgba(22,135,64,0.25)":"rgba(204,16,22,0.25)"}`, borderRadius:10, color:candidates.length>0?"#168740":"#CC1016", fontSize:13, fontWeight:700, whiteSpace:"nowrap" }}>
            {candidates.length>0?`${candidates.length} candidate${candidates.length!==1?"s":""} found`:"No candidates for this role"}
          </div>
        )}

        <button onClick={generateReport} disabled={!selectedRole||!candidates.length||generating}
          style={{ padding:"11px 26px", background:(!selectedRole||!candidates.length||generating)?"rgba(10,102,194,0.2)":"linear-gradient(135deg,#0A66C2,#004182)", color:(!selectedRole||!candidates.length||generating)?"var(--t3)":"white", border:"none", borderRadius:10, cursor:(!selectedRole||!candidates.length||generating)?"not-allowed":"pointer", fontWeight:700, fontSize:14, display:"flex", alignItems:"center", gap:8, transition:"all 0.2s", whiteSpace:"nowrap" }}>
          {generating
            ? <><span style={{ display:"inline-block", width:14, height:14, border:"2px solid rgba(10,102,194,0.2)", borderTopColor:"#0A66C2", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/> Generating...</>
            : "⚡ Generate Report"}
        </button>
      </div>

      {/* REPORT TABLE */}
      {reportRows.length>0&&(
        <div style={{ animation:"fadeUp 0.4s ease" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ color:"var(--t1)", fontWeight:700, fontSize:16 }}>{selectedRole}</span>
              <span style={{ padding:"2px 10px", background:"rgba(10,102,194,0.15)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:20, fontSize:11, fontWeight:700 }}>
                {reportRows.length} candidate{reportRows.length!==1?"s":""}
              </span>
              {generating&&<span style={{ color:"#56687A", fontSize:12, fontWeight:600, animation:"pulse 1.2s infinite" }}>⚙ Fetching summaries...</span>}
              {allDone&&!generating&&<span style={{ color:"#168740", fontSize:12, fontWeight:600 }}>✓ All summaries ready</span>}
            </div>
            {allDone&&(
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ display:"flex", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, overflow:"hidden" }}>
                  {["table","email"].map(mode=>(
                    <button key={mode} onClick={()=>setCopyMode(mode)}
                      style={{ padding:"7px 14px", background:copyMode===mode?"rgba(10,102,194,0.25)":"transparent", color:copyMode===mode?"#0A66C2":"var(--t3)", border:"none", cursor:"pointer", fontSize:12, fontWeight:600, transition:"all 0.15s" }}>
                      {mode==="table"?"📊 Table":"✉ Email"}
                    </button>
                  ))}
                </div>
                <button onClick={handleCopy}
                  style={{ padding:"8px 18px", background:"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                  📋 Copy {copyMode==="table"?"Table":"Email"}
                </button>
                <button onClick={()=>window.print()}
                  style={{ padding:"8px 18px", background:"linear-gradient(135deg,#0A66C2,#004182)", color:"white", border:"none", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                  ⬇ Download PDF
                </button>
              </div>
            )}
          </div>

          {allDone&&(
            <div style={{ marginBottom:14, padding:"10px 16px", background:"rgba(10,102,194,0.07)", border:"1px solid rgba(10,102,194,0.15)", borderRadius:10, fontSize:12, color:"var(--t2)" }}>
              {copyMode==="table"
                ?"📊 Table mode: Copies tab-separated data — paste directly into Excel, Google Sheets, or Outlook."
                :"✉ Email mode: Copies a formatted email body ready to send to your client."}
            </div>
          )}

          <div style={{ background:"var(--l03)", border:"1px solid var(--l08)", borderRadius:18, overflow:"auto", maxHeight:"62vh" }}>
            <table ref={tableRef} className="report-table" style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
              <thead>
                <tr>
                  <th style={{ width:44 }}>#</th>
                  <th style={{ width:180 }}>Candidate</th>
                  <th style={{ width:160 }}>Position</th>
                  <th style={{ width:110 }}>Status</th>
                  <th>AI Summary</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row,i)=>(
                  <tr key={i}>
                    {/* row number bumped #334155 → #64748b */}
                    <td style={{ color:"var(--t3)", fontWeight:700, fontSize:12 }}>{i+1}</td>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:34, height:34, borderRadius:8, background:avatarColor(row.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"white", flexShrink:0 }}>
                          {getInitials(row.name)}
                        </div>
                        <span style={{ color:"var(--t1)", fontWeight:600, fontSize:13 }}>{row.name}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ display:"inline-block", padding:"3px 10px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:20, fontSize:11, fontWeight:700 }}>
                        {row.position}
                      </span>
                    </td>
                    <td>
                      <span style={{ display:"inline-block", padding:"3px 10px", background:row.status==="Selected"?"rgba(22,135,64,0.1)":row.status==="Rejected"?"rgba(204,16,22,0.1)":row.status==="Scheduled"?"rgba(86,104,122,0.1)":"rgba(148,163,184,0.1)", color:row.status==="Selected"?"#168740":row.status==="Rejected"?"#CC1016":row.status==="Scheduled"?"#56687A":"#94a3b8", border:`1px solid ${row.status==="Selected"?"rgba(22,135,64,0.25)":row.status==="Rejected"?"rgba(204,16,22,0.25)":row.status==="Scheduled"?"rgba(86,104,122,0.25)":"rgba(148,163,184,0.2)"}`, borderRadius:20, fontSize:11, fontWeight:700 }}>
                        {row.status}
                      </span>
                    </td>
                    <td className="summary-cell">
                      {row.loading?(
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ display:"inline-block", width:12, height:12, border:"2px solid rgba(10,102,194,0.3)", borderTopColor:"#0A66C2", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
                          <span style={{ color:"var(--t3)", fontSize:12 }}>Generating summary...</span>
                        </div>
                      ):row.error?(
                        <span style={{ color:"var(--t3)", fontSize:12, fontStyle:"italic", display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ color:"#CC1016" }}>⚠</span> {row.summary}
                        </span>
                      ):(
                        <p style={{ margin:0, lineHeight:1.75, fontSize:13, color:"var(--t2)", whiteSpace:"pre-line" }}>{row.summary}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allDone&&(
            <div style={{ marginTop:16, display:"flex", gap:12, justifyContent:"flex-end" }}>
              <button onClick={copyAsTable} style={{ padding:"10px 20px", background:"var(--l06)", color:"var(--t2)", border:"1px solid var(--l10)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                📊 Copy as Table
              </button>
              <button onClick={copyAsEmail} style={{ padding:"10px 20px", background:"var(--l06)", color:"var(--t2)", border:"1px solid var(--l10)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                ✉ Copy as Email
              </button>
              <button onClick={generateReport} style={{ padding:"10px 20px", background:"rgba(10,102,194,0.15)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
                ↺ Regenerate
              </button>
            </div>
          )}
        </div>
      )}

      {!selectedRole&&(
        <div style={{ textAlign:"center", marginTop:80, animation:"fadeUp 0.5s ease" }}>
          <div style={{ fontSize:56, marginBottom:16, filter:"drop-shadow(0 0 24px rgba(10,102,194,0.3))" }}>📨</div>
          {/* empty state text bumped #334155 → #64748b */}
          <h2 style={{ color:"var(--t3)", fontWeight:700, margin:"0 0 8px" }}>Select a position to get started</h2>
          <p style={{ color:"var(--t3)", fontSize:14, margin:0 }}>
            Choose a role above and click Generate Report to create AI summaries for all candidates
          </p>
        </div>
      )}

      {selectedRole&&!generating&&!reportRows.length&&candidates.length===0&&(
        <div style={{ textAlign:"center", marginTop:60 }}>
          <div style={{ fontSize:44, marginBottom:12 }}>🔍</div>
          <p style={{ color:"var(--t3)", fontSize:14 }}>
            No candidates have been submitted for <strong style={{ color:"var(--t2)" }}>{selectedRole}</strong> yet.
          </p>
        </div>
      )}

      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}
    </div>
  );
}
