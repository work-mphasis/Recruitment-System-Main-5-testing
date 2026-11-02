import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

const API = import.meta.env.VITE_API_URL ?? "";

const MAIN_COLUMNS = [
  { key: "Position Code",   label: "Position Code", width: "11%" },
  { key: "Role",            label: "Role",          width: "18%" },
  { key: "Manager",         label: "Manager",       width: "11%" },
  { key: "Location",        label: "Location",      width: "9%"  },
  { key: "# of Position",  label: "Positions",     width: "6%"  },
  { key: "New/Replacement", label: "Type",          width: "8%"  },
  { key: "_candidate_count",label: "Submitted",     width: "8%"  },
  { key: "_account_name",   label: "Account",       width: "12%" },
  { key: "lob_name",        label: "LOB",           width: "8%"  },
];

const DETAIL_FIELDS = [
  "WIPPX", "Category", "Proposed POD Name",
  "New/Replacement", "Location", "Manager",
];

const EDITABLE_FIELDS = [
  { key: "Position Code",     label: "Position Code"  },
  { key: "WIPPX",             label: "WIPPX"          },
  { key: "Category",          label: "Category"       },
  { key: "Proposed POD Name", label: "POD Name"       },
  { key: "Manager",           label: "Manager"        },
  { key: "Role",              label: "Role"           },
  { key: "Location",          label: "Location"       },
  { key: "# of Position",    label: "# of Positions" },
  { key: "New/Replacement",   label: "Type", select: ["New", "Replacement"] },
];

function GlowDot({ color, size = 7 }) {
  return (
    <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, boxShadow:`0 0 ${size}px ${color}`, flexShrink:0 }}/>
  );
}

function TypeBadge({ value }) {
  const isNew = (value||"").toLowerCase() === "new";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:isNew?"#168740":"#56687A", fontSize:12, fontWeight:600 }}>
      <GlowDot color={isNew?"#168740":"#56687A"} size={6}/>{value||"—"}
    </span>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(()=>{ const t=setTimeout(onClose,3500); return ()=>clearTimeout(t); },[onClose]);
  const ok = type==="success";
  return (
    <div style={{ position:"fixed", bottom:28, right:28, zIndex:9999, background:ok?"rgba(22,135,64,0.12)":"rgba(204,16,22,0.12)", border:`1px solid ${ok?"rgba(22,135,64,0.35)":"rgba(204,16,22,0.35)"}`, color:ok?"#168740":"#CC1016", padding:"12px 20px", borderRadius:14, fontSize:14, fontWeight:700, backdropFilter:"blur(14px)", boxShadow:`0 8px 32px ${ok?"rgba(22,135,64,0.2)":"rgba(204,16,22,0.2)"}`, display:"flex", alignItems:"center", gap:10 }}>
      <GlowDot color={ok?"#168740":"#CC1016"}/>{message}
    </div>
  );
}

function EditModal({ row, onSave, onCancel }) {
  const { authData, session }                  = useAuth();
  const isAdmin                                = session?.role === "admin";
  const accounts                               = isAdmin
    ? Object.keys(authData.accounts || {})
    : [...new Set((session?.workspaces || []).map(w => w.account))];

  const [selAccount, setSelAccount]            = useState(row["_account_name"] || "");
  const [selLob,     setSelLob]                = useState(row["lob_name"]      || "");
  const lobs                                   = selAccount ? (authData.accounts?.[selAccount]?.lobs || []) : [];

  const [form,setForm]                         = useState({...row});
  const [original]                             = useState({...row});
  const [skills,setSkills]                     = useState([]);
  const [jobDescription,setJD]                 = useState("");
  const [skillInput,setSkillInput]             = useState("");
  const [showSkillInput,setShowSkillInput]     = useState(false);
  const [loadingSkills,setLoadingSkills]       = useState(true);

  useEffect(()=>{
    const code  = (row["Position Code"]||"").toString().trim();
    const role  = (row["Role"]||"").trim();
    const param = code ? `position_code=${encodeURIComponent(code)}` : `role=${encodeURIComponent(role)}`;
    fetch(`${API}/position-skills?${param}`)
      .then(r=>r.json())
      .then(d=>{setSkills(d.skills||[]);setJD(d.job_description||"");})
      .catch(e=>console.error("[EditModal]",e))
      .finally(()=>setLoadingSkills(false));
  },[]);

  const addSkill = ()=>{
    if (skillInput.trim()){setSkills([...skills,skillInput.trim()]);setSkillInput("");setShowSkillInput(false);}
  };

  return (
    <div style={S.overlay}>
      <div style={{...S.modal,maxWidth:560}}>
        <div style={S.modalHead}>
          <div>
            <div style={S.eyebrow}>Edit Requirement</div>
            <h3 style={{color:"var(--t1)",margin:"3px 0 0",fontSize:18,fontWeight:800}}>
              {original["Role"]||original["Position Code"]||"—"}
            </h3>
          </div>
          <button onClick={onCancel} style={S.closeBtn}>✕</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          <div style={S.sectionLabel}>Account &amp; LOB</div>
          <div style={{marginBottom:12}}>
            <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Account</label>
            <select value={selAccount} onChange={e=>{setSelAccount(e.target.value);setSelLob("");}} style={S.formField}>
              <option value="" style={{background:"var(--pg-bg)"}}>Select account…</option>
              {accounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
            </select>
          </div>
          {lobs.length > 0 && (
            <div style={{marginBottom:12}}>
              <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Line of Business</label>
              <select value={selLob} onChange={e=>setSelLob(e.target.value)} style={S.formField}>
                <option value="" style={{background:"var(--pg-bg)"}}>No LOB</option>
                {lobs.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
              </select>
            </div>
          )}
          <div style={{height:1,background:"var(--l07)",margin:"4px 0 18px"}}/>
          <div style={S.sectionLabel}>Position Details</div>
          {EDITABLE_FIELDS.map(({key,label,select})=>{
            const locked = key==="Position Code" && !!original[key];
            return (
              <div key={key} style={{marginBottom:12}}>
                {/* form labels bumped #334155 → #64748b */}
                <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>{label}</label>
                {select?(
                  <select value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} style={S.formField}>
                    {select.map(o=><option key={o} value={o} style={{background:"var(--pg-bg)"}}>{o}</option>)}
                  </select>
                ):(
                  <input value={form[key]||""} disabled={locked} onChange={e=>setForm({...form,[key]:e.target.value})}
                    style={{...S.formField,background:locked?"var(--l02)":"var(--l04)",border:`1px solid ${locked?"var(--l04)":"var(--l08)"}`,color:locked?"#475569":"var(--t1)",cursor:locked?"not-allowed":"text"}}/>
                )}
              </div>
            );
          })}
          <div style={{height:1,background:"var(--l07)",margin:"20px 0 18px"}}/>
          <div style={S.sectionLabel}>Job Description &amp; Skills</div>
          {loadingSkills?(
            <div style={{color:"var(--t3)",fontSize:12,marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
              <div style={S.spinner}/>Loading skills...
            </div>
          ):(
            <>
              <div style={{marginBottom:16}}>
                {/* JD label bumped #334155 → #64748b */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Job Description</label>
                  <label style={{padding:"6px 10px",background:"rgba(10,102,194,0.1)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:800}}>
                    Upload JD
                    <input type="file" accept=".txt,.md,.docx,.pdf" style={{display:"none"}}
                      onChange={async e=>{
                        try {
                          const text = await uploadJobDescriptionFile(e.target.files?.[0]);
                          if (text) setJD(text);
                        } catch (err) {
                          alert(err.message || "Could not upload job description");
                        } finally {
                          e.target.value = "";
                        }
                      }}/>
                  </label>
                </div>
                <textarea value={jobDescription} onChange={e=>setJD(e.target.value)}
                  placeholder="Paste or type the job description here..." rows={5}
                  style={{width:"100%",padding:"10px 12px",background:"var(--l04)",border:"1px solid var(--l08)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none",boxSizing:"border-box",resize:"vertical",lineHeight:1.6,fontFamily:"inherit"}}/>
              </div>
              <div style={{marginBottom:16}}>
                {/* Skills label bumped #334155 → #64748b */}
                <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:8}}>Required Skills</label>
                {skills.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                    {skills.map((skill,i)=>(
                      <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 11px",background:"rgba(10,102,194,0.12)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:20,fontSize:12,fontWeight:600,boxShadow:"0 0 8px rgba(10,102,194,0.15)"}}>
                        {skill}
                        <button type="button" onClick={()=>setSkills(skills.filter((_,idx)=>idx!==i))}
                          style={{background:"none",border:"none",color:"#0A66C2",cursor:"pointer",fontSize:14,padding:0,lineHeight:1}}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                {showSkillInput&&(
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <input type="text" value={skillInput} onChange={e=>setSkillInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSkill();}}}
                      placeholder={`Skill ${skills.length+1}`} autoFocus
                      style={{flex:1,padding:"8px 12px",background:"var(--l04)",border:"1px solid rgba(10,102,194,0.35)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none"}}/>
                    <button type="button" onClick={addSkill}
                      style={{padding:"8px 16px",background:"linear-gradient(135deg,#0A66C2,#004182)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13,boxShadow:"0 4px 12px rgba(10,102,194,0.3)"}}>OK</button>
                    <button type="button" onClick={()=>{setSkillInput("");setShowSkillInput(false);}}
                      style={{padding:"8px 12px",background:"var(--l04)",color:"var(--t3)",border:"1px solid var(--l08)",borderRadius:8,cursor:"pointer",fontSize:13}}>✕</button>
                  </div>
                )}
                {!showSkillInput&&(
                  <button type="button" onClick={()=>setShowSkillInput(true)}
                    style={{padding:"7px 14px",background:"rgba(10,102,194,0.08)",color:"#0A66C2",border:"1px dashed rgba(10,102,194,0.3)",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>
                    + Add Skill {skills.length>0?`(${skills.length} added)`:""}
                  </button>
                )}
              </div>
            </>
          )}
          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button onClick={onCancel} style={{flex:1,padding:"11px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:14}}>Cancel</button>
            <button onClick={()=>onSave(form,original,skills,jobDescription,selAccount,selLob)}
              style={{flex:2,padding:"11px",background:"linear-gradient(135deg,#0A66C2,#004182)",color:"white",border:"none",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:14,boxShadow:"0 4px 16px rgba(10,102,194,0.3)"}}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ role, candidateCount, onConfirm, onCancel }) {
  return (
    <div style={{position:"fixed",inset:0,background:"var(--overlay-bg)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
      <div style={{background:"var(--pg-bg)",border:"1px solid rgba(204,16,22,0.3)",borderRadius:22,width:"100%",maxWidth:420,padding:36,textAlign:"center",boxShadow:"0 40px 100px rgba(0,0,0,0.8)"}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(204,16,22,0.1)",border:"1px solid rgba(204,16,22,0.3)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:22,boxShadow:"0 0 20px rgba(204,16,22,0.2)"}}>✕</div>
        <h3 style={{color:"var(--t1)",fontSize:18,fontWeight:800,margin:"0 0 8px"}}>Delete Position</h3>
        <p style={{color:"var(--t2)",fontSize:14,margin:"0 0 10px",lineHeight:1.6}}>
          Remove <strong style={{color:"#CC1016"}}>"{role}"</strong> from requirements?
        </p>
        {candidateCount>0&&(
          <div style={{background:"rgba(56,67,79,0.08)",border:"1px solid rgba(56,67,79,0.25)",borderRadius:10,padding:"10px 16px",marginBottom:18,fontSize:13,color:"#56687A",lineHeight:1.6}}>
            ⚠ {candidateCount} submitted candidate{candidateCount!==1?"s":""} will be kept and highlighted for re-submission.<br/>
            Candidates <strong>without a resume</strong> will be auto-removed.
          </div>
        )}
        <div style={{display:"flex",gap:12,justifyContent:"center"}}>
          <button onClick={onCancel} style={{padding:"10px 24px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:10,cursor:"pointer",fontWeight:600}}>Cancel</button>
          <button onClick={onConfirm} style={{padding:"10px 24px",background:"linear-gradient(135deg,#CC1016,#b91c1c)",color:"white",border:"none",borderRadius:10,cursor:"pointer",fontWeight:700,boxShadow:"0 4px 16px rgba(204,16,22,0.3)"}}>Delete Position</button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ row, onEdit }) {
  const posCount  = parseInt(row["# of Position"]||0);
  const submitted = parseInt(row["_candidate_count"]||0);

  return (
    <tr>
      <td colSpan={MAIN_COLUMNS.length+1} style={{padding:0}}>
        <div style={{padding:"22px 28px 26px",background:"linear-gradient(135deg,rgba(10,102,194,0.04),var(--pg-bg))",borderTop:"1px solid rgba(10,102,194,0.18)",borderBottom:"1px solid var(--l06)"}}>

          {/* Hero banner */}
          <div style={{background:"rgba(10,102,194,0.06)",border:"1px solid rgba(10,102,194,0.18)",borderRadius:16,padding:"20px 24px",marginBottom:22,display:"flex",alignItems:"center",gap:28,flexWrap:"wrap"}}>
            <div>
              <div style={S.sectionLabel}>Role</div>
              <div style={{color:"var(--t1)",fontSize:20,fontWeight:800,marginTop:4,letterSpacing:-0.4}}>{row["Role"]||"—"}</div>
            </div>
            <div style={{width:1,height:48,background:"var(--l09)"}}/>
            <div>
              <div style={S.sectionLabel}>Position Code</div>
              <div style={{color:"#0A66C2",fontSize:16,fontWeight:800,marginTop:4,fontFamily:"monospace",letterSpacing:0.5}}>{row["Position Code"]||"—"}</div>
            </div>
            <div style={{width:1,height:48,background:"var(--l09)"}}/>
            <div>
              <div style={S.sectionLabel}>Open Positions</div>
              <div style={{display:"flex",alignItems:"baseline",gap:6,marginTop:4}}>
                <span style={{fontSize:36,fontWeight:800,color:"#168740",lineHeight:1,letterSpacing:-1,textShadow:"0 0 20px rgba(22,135,64,0.4)"}}>{posCount}</span>
                {/* "open" label bumped #334155 → #64748b */}
                <span style={{color:"var(--t3)",fontSize:12}}>open</span>
              </div>
            </div>
            <div style={{width:1,height:48,background:"var(--l09)"}}/>
            <div>
              <div style={S.sectionLabel}>Type</div>
              <div style={{marginTop:6}}><TypeBadge value={row["New/Replacement"]}/></div>
            </div>
            <div style={{flex:"1 1 160px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <div style={S.sectionLabel}>Submissions</div>
                <div style={{color:"var(--t3)",fontSize:10}}>{submitted} / {posCount}</div>
              </div>
              <div style={{height:6,background:"var(--l07)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${posCount>0?Math.min((submitted/posCount)*100,100):0}%`,background:"linear-gradient(90deg,#0A66C2,#168740)",borderRadius:3,boxShadow:"0 0 10px rgba(10,102,194,0.4)",transition:"width 0.8s ease"}}/>
              </div>
              <div style={{color:"var(--t3)",fontSize:10,marginTop:4}}>
                {submitted===0?"Awaiting submissions":submitted>=posCount?"Position filled":"In progress"}
              </div>
            </div>
          </div>

          {/* Detail grid — labels bumped #334155→#64748b, values bumped #64748b→#94a3b8 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:"14px 28px",marginBottom:22}}>
            {DETAIL_FIELDS.map(key=>(
              <div key={key} style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:10,padding:"10px 14px"}}>
                <div style={{color:"var(--t3)",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:5}}>{key}</div>
                <div style={{color: key==="New/Replacement" ? "inherit" : "var(--t2)", fontSize:13,fontWeight:key==="New/Replacement"?700:400}}>
                  {key==="New/Replacement"?<TypeBadge value={row[key]}/>:(row[key]||"—")}
                </div>
              </div>
            ))}
          </div>

          <div style={{paddingTop:16,borderTop:"1px solid var(--l06)",display:"flex",justifyContent:"flex-end"}}>
            <button onClick={onEdit}
              style={{padding:"9px 22px",background:"rgba(10,102,194,0.12)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,boxShadow:"0 0 14px rgba(10,102,194,0.15)",transition:"all 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(10,102,194,0.22)";e.currentTarget.style.boxShadow="0 0 20px rgba(10,102,194,0.3)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(10,102,194,0.12)";e.currentTarget.style.boxShadow="0 0 14px rgba(10,102,194,0.15)";}}>
              âœ Edit Requirement
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function StatBar({ total, newCount, replacementCount }) {
  const stats = [
    { label:"Total Requirements", value:total,            color:"#0A66C2", accent:"rgba(129,140,248,0.15)" },
    { label:"New Positions",      value:newCount,         color:"#168740", accent:"rgba(22,135,64,0.15)"  },
    { label:"Replacements",       value:replacementCount, color:"#38434F", accent:"rgba(56,67,79,0.15)"  },
  ];
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
      {stats.map(s=>(
        <div key={s.label}
          style={{background:"var(--l02)",border:"1px solid var(--l07)",borderRadius:12,padding:"12px 16px",position:"relative",overflow:"hidden",transition:"all 0.2s",cursor:"default"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=s.color+"55";e.currentTarget.style.transform="translateY(-2px)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--l07)";e.currentTarget.style.transform="translateY(0)";}}>
          <div style={{position:"absolute",top:-12,right:-12,width:50,height:50,borderRadius:"50%",background:s.accent,filter:"blur(14px)"}}/>
          <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.8,color:"var(--t3)",marginBottom:6}}>{s.label}</div>
          <div style={{fontSize:26,fontWeight:800,color:s.color,lineHeight:1,letterSpacing:-1}}>{s.value}</div>
          <div style={{marginTop:8,height:2,background:"var(--l07)",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",width:total>0?`${Math.min((s.value/total)*100,100)}%`:"0%",background:s.color,borderRadius:2,boxShadow:`0 0 6px ${s.color}`,transition:"width 1s ease"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function AddPositionModal({ onSave, onCancel }) {
  const { authData, session } = useAuth();
  const isAdmin = session?.role === "admin";

  const accounts = isAdmin
    ? Object.keys(authData.accounts || {})
    : [...new Set((session?.workspaces || []).map(w => w.account))];

  const [selAccount, setSelAccount] = useState(() =>
    isAdmin ? "" : (session?.effectiveAccount || "")
  );
  const [selLob, setSelLob] = useState(() =>
    isAdmin ? "" : (session?.effectiveLob || "")
  );
  const lobs = selAccount ? (authData.accounts?.[selAccount]?.lobs || []) : [];

  const [form, setForm] = useState({
    "Position Code":"","WIPPX":"","Category":"","Proposed POD Name":"",
    "Manager":"","Role":"","Location":"","# of Position":"","New/Replacement":"New"
  });
  const [skills, setSkills]               = useState([]);
  const [jd, setJD]                       = useState("");
  const [skillInput, setSkillInput]       = useState("");
  const [showSkillInput, setShowSkill]    = useState(false);
  const [saving, setSaving]               = useState(false);

  const addSkill = () => {
    if (skillInput.trim()) { setSkills([...skills, skillInput.trim()]); setSkillInput(""); setShowSkill(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const n = parseFloat(String(form["# of Position"]).trim());
      const res = await fetch(`${API}/positions`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          position_code: form["Position Code"].trim(),
          wippx: form["WIPPX"].trim(),
          category: form["Category"].trim(),
          pod_name: form["Proposed POD Name"].trim(),
          manager: form["Manager"].trim(),
          replacement_new: form["New/Replacement"],
          role: form["Role"].trim(),
          location: form["Location"].trim(),
          positions: isNaN(n) ? 1 : n,
          job_description: jd.trim(),
          skills,
          account_name: selAccount || undefined,
          lob_name: selLob || undefined,
        }),
      });
      if (res.ok) { onSave(); }
      else { const err = await res.json(); alert(err.detail || "Could not add position"); }
    } catch { alert("Network error"); }
    finally { setSaving(false); }
  };

  return (
    <div style={S.overlay}>
      <div style={{...S.modal, maxWidth:560}}>
        <div style={S.modalHead}>
          <div>
            <div style={S.eyebrow}>New Position</div>
            <h3 style={{color:"var(--t1)",margin:"3px 0 0",fontSize:18,fontWeight:800}}>Add Position</h3>
          </div>
          <button onClick={onCancel} style={S.closeBtn}>✕</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          <div style={S.sectionLabel}>Account &amp; LOB</div>
          <div style={{marginBottom:12}}>
            <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Account</label>
            <select value={selAccount} onChange={e=>{setSelAccount(e.target.value);setSelLob("");}} style={S.formField}>
              <option value="" style={{background:"var(--pg-bg)"}}>Select account…</option>
              {accounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
            </select>
          </div>
          {lobs.length > 0 && (
            <div style={{marginBottom:12}}>
              <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Line of Business</label>
              <select value={selLob} onChange={e=>setSelLob(e.target.value)} style={S.formField}>
                <option value="" style={{background:"var(--pg-bg)"}}>No LOB</option>
                {lobs.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
              </select>
            </div>
          )}
          <div style={{height:1,background:"var(--l07)",margin:"4px 0 18px"}}/>
          <div style={S.sectionLabel}>Position Details</div>
          {EDITABLE_FIELDS.map(({key,label,select})=>(
            <div key={key} style={{marginBottom:12}}>
              <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>{label}</label>
              {select?(
                <select value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} style={S.formField}>
                  {select.map(o=><option key={o} value={o} style={{background:"var(--pg-bg)"}}>{o}</option>)}
                </select>
              ):(
                <input value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} style={S.formField} placeholder={label}/>
              )}
            </div>
          ))}
          <div style={{height:1,background:"var(--l07)",margin:"20px 0 18px"}}/>
          <div style={S.sectionLabel}>Job Description &amp; Skills</div>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6}}>
              <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Job Description</label>
              <label style={{padding:"6px 10px",background:"rgba(10,102,194,0.1)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:800}}>
                Upload JD
                <input type="file" accept=".txt,.md,.docx,.pdf" style={{display:"none"}}
                  onChange={async e=>{
                    try {
                      const text = await uploadJobDescriptionFile(e.target.files?.[0]);
                      if (text) setJD(text);
                    } catch (err) {
                      alert(err.message || "Could not upload job description");
                    } finally {
                      e.target.value = "";
                    }
                  }}/>
              </label>
            </div>
            <textarea value={jd} onChange={e=>setJD(e.target.value)} placeholder="Paste or type the job description here..." rows={5}
              style={{width:"100%",padding:"10px 12px",background:"var(--l04)",border:"1px solid var(--l08)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none",boxSizing:"border-box",resize:"vertical",lineHeight:1.6,fontFamily:"inherit"}}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:8}}>Required Skills</label>
            {skills.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                {skills.map((sk,i)=>(
                  <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 11px",background:"rgba(10,102,194,0.12)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:20,fontSize:12,fontWeight:600}}>
                    {sk}<button type="button" onClick={()=>setSkills(skills.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#0A66C2",cursor:"pointer",fontSize:14,padding:0,lineHeight:1,marginLeft:4}}>×</button>
                  </span>
                ))}
              </div>
            )}
            {showSkillInput&&(
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input type="text" value={skillInput} onChange={e=>setSkillInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSkill();}}}
                  placeholder={`Skill ${skills.length+1}`} autoFocus
                  style={{flex:1,padding:"8px 12px",background:"var(--l04)",border:"1px solid rgba(10,102,194,0.35)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none"}}/>
                <button type="button" onClick={addSkill}
                  style={{padding:"8px 16px",background:"linear-gradient(135deg,#0A66C2,#004182)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13}}>OK</button>
                <button type="button" onClick={()=>{setSkillInput("");setShowSkill(false);}}
                  style={{padding:"8px 12px",background:"var(--l04)",color:"var(--t3)",border:"1px solid var(--l08)",borderRadius:8,cursor:"pointer",fontSize:13}}>✕</button>
              </div>
            )}
            {!showSkillInput&&(
              <button type="button" onClick={()=>setShowSkill(true)}
                style={{padding:"7px 14px",background:"rgba(10,102,194,0.08)",color:"#0A66C2",border:"1px dashed rgba(10,102,194,0.3)",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>
                + Add Skill {skills.length>0?`(${skills.length} added)`:""}
              </button>
            )}
          </div>
          {(!form["Position Code"]||!form["Role"])&&(
            <div style={{marginTop:6,padding:"7px 12px",background:"rgba(204,16,22,0.08)",border:"1px solid rgba(204,16,22,0.25)",borderRadius:8,color:"#CC1016",fontSize:12,fontWeight:600}}>
              {!form["Position Code"]&&!form["Role"]?"Position Code and Role are required.":!form["Position Code"]?"Position Code is required.":"Role is required."}
            </div>
          )}
          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button onClick={onCancel} style={{flex:1,padding:"11px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:14}}>Cancel</button>
            <button onClick={handleSave} disabled={saving||!form["Position Code"]||!form["Role"]}
              style={{flex:2,padding:"11px",background:saving?"rgba(10,102,194,0.2)":"linear-gradient(135deg,#0A66C2,#004182)",color:saving?"var(--t3)":"white",border:"none",borderRadius:10,cursor:saving?"not-allowed":"pointer",fontWeight:700,fontSize:14,boxShadow:saving?"none":"0 4px 16px rgba(10,102,194,0.3)"}}>
              {saving?"Saving...":"+ Add Position"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function uploadJobDescriptionFile(file) {
  if (!file) return "";
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/job-description/upload`, { method:"POST", body:formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not read job description file");
  return data.text || "";
}

const GUIDE_SKILL_PATTERNS = [
  { label:"Python", aliases:["python"], category:"technical", level:"Competent" },
  { label:"SQL", aliases:["sql", "postgres", "postgresql", "mysql", "database"], category:"technical", level:"Competent" },
  { label:"AWS", aliases:["aws", "amazon web services", "lambda", "s3", "ec2"], category:"technical", level:"Competent" },
  { label:"React", aliases:["react", "react.js", "frontend"], category:"technical", level:"Competent" },
  { label:"Django", aliases:["django"], category:"technical", level:"Competent" },
  { label:"FastAPI", aliases:["fastapi"], category:"technical", level:"Competent" },
  { label:"REST APIs", aliases:["rest api", "restful", "api integration"], category:"technical", level:"Competent" },
  { label:"Microservices Architecture", aliases:["microservice", "microservices"], category:"competency", level:"Expert" },
  { label:"System Design", aliases:["system design", "architecture"], category:"competency", level:"Expert" },
  { label:"Docker", aliases:["docker", "container"], category:"technical", level:"Competent" },
  { label:"Kubernetes", aliases:["kubernetes", "k8s"], category:"technical", level:"Competent" },
  { label:"CI/CD", aliases:["ci/cd", "pipeline", "deployment"], category:"technical", level:"Competent" },
  { label:"Git", aliases:["git", "github", "version control"], category:"technical", level:"Competent" },
  { label:"Stakeholder Communication", aliases:["stakeholder", "communication", "collaborate"], category:"non_technical", level:"Competent" },
  { label:"Mentoring", aliases:["mentor", "coaching", "technical guidance"], category:"competency", level:"Expert" },
];

function normalizeRubricText(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function displayCategory(value = "") {
  return String(value || "technical").replace("_", "-");
}

function inferRubricSkill(skillName = "") {
  const normalized = normalizeRubricText(skillName);
  return GUIDE_SKILL_PATTERNS.find(pattern =>
    normalizeRubricText(pattern.label) === normalized ||
    pattern.aliases.some(alias => normalized.includes(normalizeRubricText(alias)))
  ) || { label:skillName, category:"technical", level:"Competent" };
}

function balancedGuidanceSkills(skills = [], limit = 8) {
  const buckets = { non_technical:[], competency:[], technical:[] };
  const result = [];
  const seen = new Set();
  skills.forEach(skill => {
    const key = normalizeRubricText(skill.label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const category = skill.category || "technical";
    (buckets[category] || buckets.technical).push(skill);
  });
  while (result.length < limit && (buckets.non_technical.length || buckets.competency.length || buckets.technical.length)) {
    ["non_technical", "competency", "technical"].forEach(category => {
      if (result.length < limit && buckets[category].length) result.push(buckets[category].shift());
    });
  }
  return result;
}

function buildRubricGuidance({ jd = "", skills = [], selected = null, totalWeight = 0, weightTotalOk = false }) {
  const jdText = normalizeRubricText(jd);
  const existingItems = selected?.items || [];
  const existing = new Set(existingItems.map(item => normalizeRubricText(item.skill)));
  const explicitSkills = (skills || []).filter(Boolean).map(skill => {
    const inferred = inferRubricSkill(skill);
    return { label:skill, category:inferred.category, level:inferred.level, source:"Required skills" };
  });
  const jdSkills = GUIDE_SKILL_PATTERNS
    .filter(pattern => pattern.aliases.some(alias => jdText.includes(normalizeRubricText(alias))))
    .map(pattern => ({ ...pattern, source:"Job description" }));
  const candidates = [...explicitSkills, ...jdSkills];
  const unique = [];
  const seen = new Set();
  candidates.forEach(skill => {
    const key = normalizeRubricText(skill.label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(skill);
  });
  const categories = new Set(existingItems.map(item => item.category || "technical"));
  const coverageSuggestions = [];
  if (selected && !categories.has("non_technical")) {
    coverageSuggestions.push({ label:"Stakeholder Communication", category:"non_technical", level:"Competent", source:"Category coverage" });
  }
  if (selected && !categories.has("competency")) {
    coverageSuggestions.push({ label:"Problem Solving", category:"competency", level:"Competent", source:"Category coverage" });
  }
  const missingPool = [
    ...coverageSuggestions,
    ...unique.filter(skill => !existing.has(normalizeRubricText(skill.label))),
  ].filter(skill => !existing.has(normalizeRubricText(skill.label)));
  const missing = balancedGuidanceSkills(missingPool, 8);
  const weights = existingItems.map(item => Number(item.weight || 0).toFixed(2));
  const warnings = [];
  if (!jd.trim()) warnings.push("Add or upload a job description before generating rubric metrics.");
  if (!selected) warnings.push("No active rubric exists yet for this position.");
  if (selected && !weightTotalOk) warnings.push(`Weights total ${totalWeight.toFixed(2)}%; balance them to 100%.`);
  if (selected && existingItems.length < 4) warnings.push("Rubric is very small; consider adding the core technical and competency signals.");
  if (selected && existingItems.length > 3 && new Set(weights).size === 1) warnings.push("All weights are equal; confirm this role does not need priority weighting.");
  if (selected && !categories.has("competency")) warnings.push("Add at least one competency metric for seniority and decision quality.");
  if (selected && !categories.has("non_technical")) warnings.push("Add one non-technical metric for communication or stakeholder fit.");
  if (selected && missing.length > 0) warnings.push(`${missing.length} JD or required-skill signal${missing.length === 1 ? "" : "s"} not in the rubric yet.`);

  let step = 1;
  if (jd.trim() && !selected) step = 2;
  if (selected) step = warnings.length ? 3 : 4;
  if (selected?.status === "active" && weightTotalOk && warnings.length === 0) step = 5;

  return { step, missing, warnings, detectedSkills:balancedGuidanceSkills(unique, 8) };
}

function DrishtiGuideCard({
  analysis,
  loading,
  selected,
  weightTotalOk,
  guideMode,
  setGuideMode,
  onGenerate,
  onBalance,
  onAddSkill,
  onActivate,
  onSave,
}) {
  const steps = [
    { id:1, label:"JD ready", done:analysis.step > 1 },
    { id:2, label:"Generate metrics", done:!!selected },
    { id:3, label:"Review gaps", done:!!selected && analysis.warnings.length === 0 },
    { id:4, label:"Activate", done:selected?.status === "active" && weightTotalOk },
  ];
  const primaryLabel = !selected ? "Generate guided rubric" : analysis.warnings.length ? "Apply Drishti checks" : selected.status === "active" ? "Rubric ready" : "Save & activate";

  return (
    <div style={{background:"linear-gradient(135deg,rgba(10,102,194,0.09),rgba(14,165,233,0.06),rgba(22,135,64,0.05))",border:"1px solid rgba(10,102,194,0.22)",borderRadius:16,padding:14,marginBottom:14,boxShadow:"0 12px 32px rgba(15,23,42,0.06)"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:12}}>
        <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <div style={{width:38,height:38,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0A66C2,#0ea5e9)",color:"white",fontSize:9,fontWeight:800,letterSpacing:0.7,boxShadow:"0 10px 22px rgba(10,102,194,0.24)",flexShrink:0}}>DRISHTI</div>
          <div>
            <div style={{color:"var(--t1)",fontSize:14,fontWeight:800,letterSpacing:-0.2}}>Guided rubric builder</div>
            <div style={{color:"var(--t3)",fontSize:11,lineHeight:1.55,marginTop:3}}>
              I will turn this JD into interview-ready metrics, check the balance, and help you activate a scoring rubric for this position.
            </div>
          </div>
        </div>
        <button type="button" disabled={loading || (selected?.status === "active" && analysis.warnings.length === 0)}
          onClick={!selected ? onGenerate : analysis.warnings.length ? onBalance : onSave}
          style={{padding:"8px 12px",borderRadius:10,border:"1px solid rgba(10,102,194,0.25)",background:selected?.status === "active" && analysis.warnings.length === 0 ? "var(--l04)" : "linear-gradient(135deg,#0A66C2,#004182)",color:selected?.status === "active" && analysis.warnings.length === 0 ? "var(--t3)" : "white",fontSize:11,fontWeight:800,cursor:loading ? "not-allowed" : "pointer",whiteSpace:"nowrap",boxShadow:selected?.status === "active" && analysis.warnings.length === 0 ? "none" : "0 8px 18px rgba(10,102,194,0.22)"}}>
          {loading ? "Working..." : primaryLabel}
        </button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:12}}>
        {steps.map(step => (
          <div key={step.id} style={{padding:"8px 9px",borderRadius:10,background:step.done?"rgba(22,135,64,0.12)":"var(--l03)",border:`1px solid ${step.done?"rgba(22,135,64,0.28)":"var(--l07)"}`,color:step.done?"#168740":"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5}}>
            {step.done ? "Done" : `Step ${step.id}`}<br/><span style={{color:"var(--t2)",fontSize:11,textTransform:"none",letterSpacing:0,fontWeight:800}}>{step.label}</span>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {[
          { key:"full", label:"Full interview rubric" },
          { key:"technical", label:"Technical-heavy" },
          { key:"client", label:"Client validation" },
        ].map(mode => {
          const active = guideMode === mode.key;
          return (
            <button key={mode.key} type="button" onClick={()=>setGuideMode(mode.key)}
              style={{padding:"6px 10px",borderRadius:20,border:`1px solid ${active?"rgba(10,102,194,0.42)":"var(--l08)"}`,background:active?"rgba(10,102,194,0.12)":"var(--l03)",color:active?"#0A66C2":"var(--t3)",fontSize:11,fontWeight:800,cursor:"pointer"}}>
              {mode.label}
            </button>
          );
        })}
      </div>

      {analysis.warnings.length > 0 ? (
        <div style={{display:"grid",gap:7,marginBottom:12}}>
          {analysis.warnings.slice(0, 4).map((warning, index) => (
            <div key={index} style={{padding:"8px 10px",borderRadius:10,background:"rgba(56,67,79,0.08)",border:"1px solid rgba(56,67,79,0.18)",color:"var(--t2)",fontSize:11,lineHeight:1.45}}>
              <strong style={{color:"#38434F"}}>Drishti check:</strong> {warning}
            </div>
          ))}
        </div>
      ) : (
        <div style={{padding:"9px 10px",borderRadius:10,background:"rgba(22,135,64,0.1)",border:"1px solid rgba(22,135,64,0.22)",color:"var(--t2)",fontSize:11,lineHeight:1.45,marginBottom:12}}>
          <strong style={{color:"#168740"}}>Drishti check:</strong> Rubric is balanced and ready for candidate scoring.
        </div>
      )}

      {analysis.missing.length > 0 && (
        <div style={{marginBottom:12}}>
          <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8,marginBottom:7}}>Suggested additions</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {analysis.missing.map(skill => (
              <button key={skill.label} type="button" onClick={()=>onAddSkill(skill)}
                style={{padding:"6px 10px",borderRadius:20,border:"1px solid rgba(14,165,233,0.24)",background:"rgba(14,165,233,0.08)",color:"#0284c7",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                + {skill.label} <span style={{color:"var(--t3)",fontWeight:700}}>({displayCategory(skill.category)})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" onClick={onGenerate} disabled={loading} style={{padding:"7px 10px",borderRadius:9,border:"1px solid rgba(10,102,194,0.24)",background:"rgba(10,102,194,0.1)",color:"#0284c7",fontSize:11,fontWeight:800,cursor:loading?"not-allowed":"pointer"}}>Regenerate from JD</button>
        <button type="button" onClick={onBalance} disabled={loading || !selected} style={{padding:"7px 10px",borderRadius:9,border:"1px solid rgba(22,135,64,0.24)",background:"rgba(22,135,64,0.1)",color:"#0D6B35",fontSize:11,fontWeight:800,cursor:loading || !selected ? "not-allowed" : "pointer"}}>Balance to 100%</button>
        {selected?.status !== "active" && (
          <button type="button" onClick={onActivate} disabled={loading || !selected || !weightTotalOk} style={{padding:"7px 10px",borderRadius:9,border:"1px solid rgba(10,102,194,0.24)",background:"rgba(10,102,194,0.1)",color:"#0A66C2",fontSize:11,fontWeight:800,cursor:loading || !selected || !weightTotalOk ? "not-allowed" : "pointer"}}>Activate rubric</button>
        )}
      </div>
    </div>
  );
}

function chooseRubricForPosition(list, role, positionCode) {
  const rubrics = Array.isArray(list) ? list : [];
  const roleKey = normalizeRubricText(role);
  const positionKey = normalizeRubricText(positionCode);
  const exact = rubrics.filter(rubric => {
    const sameRole = !roleKey || normalizeRubricText(rubric.role) === roleKey;
    const samePosition = !positionKey || normalizeRubricText(rubric.position_code) === positionKey;
    return sameRole && samePosition;
  });
  const candidates = exact.length ? exact : rubrics;
  return [...candidates].sort((a, b) => {
    const aActive = a.status === "active" ? 1 : 0;
    const bActive = b.status === "active" ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (Number(a.version || 0) !== Number(b.version || 0)) return Number(b.version || 0) - Number(a.version || 0);
    return Number(b.id || 0) - Number(a.id || 0);
  })[0] || null;
}

const EXPERIENCE_OPTIONS = [
  { key:"junior", label:"Junior", technical:"Beginner", competency:"Beginner", copy:"Early-career delivery with close guidance." },
  { key:"mid", label:"Mid-level", technical:"Competent", competency:"Competent", copy:"Independent contributor with reliable delivery." },
  { key:"senior", label:"Senior", technical:"Competent", competency:"Expert", copy:"Owns complex work and leads decisions." },
  { key:"lead", label:"Lead / Architect", technical:"Expert", competency:"Expert", copy:"Sets direction, reviews designs, and mentors others." },
];

const DEFAULT_CATEGORY_MIX = { technical:70, non_technical:15, competency:15 };

function normalizeCategoryMix(mix) {
  const technical = Math.max(0, Number(mix.technical || 0));
  const nonTechnical = Math.max(0, Number(mix.non_technical || 0));
  const competency = Math.max(0, Number(mix.competency || 0));
  const total = technical + nonTechnical + competency || 1;
  return {
    technical:Number(((technical / total) * 100).toFixed(2)),
    non_technical:Number(((nonTechnical / total) * 100).toFixed(2)),
    competency:Number((100 - Number(((technical / total) * 100).toFixed(2)) - Number(((nonTechnical / total) * 100).toFixed(2))).toFixed(2)),
  };
}

function levelForExperience(category, experienceLevel) {
  const option = EXPERIENCE_OPTIONS.find(item => item.key === experienceLevel) || EXPERIENCE_OPTIONS[1];
  if (category === "competency") return option.competency;
  if (category === "non_technical") return option.key === "junior" ? "Competent" : option.competency;
  return option.technical;
}

function normalizeGuideText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function defaultGuideItemForCategory(category, jobDescription = "", experienceLevel = "mid") {
  const jdNorm = normalizeGuideText(jobDescription);
  const skill = category === "non_technical"
    ? jdNorm.includes("stakeholder") ? "Stakeholder Communication" : "Communication"
    : category === "competency"
      ? jdNorm.includes("architecture") ? "Architecture Decision-Making" : jdNorm.includes("system design") ? "System Design" : "Problem Solving"
      : "Role Technical Fundamentals";
  return {
    category,
    skill,
    required_level:levelForExperience(category, experienceLevel),
    weight:0,
    beginner_benchmark:`Has basic exposure to ${skill}.`,
    competent_benchmark:`Can apply ${skill} independently in delivery work.`,
    expert_benchmark:`Can design, optimize, or mentor others on ${skill}.`,
    evidence_guidance:`Look for concrete resume or interview evidence of ${skill}.`,
  };
}

function ensureGuideCategoryCoverage(items = [], categoryMix = DEFAULT_CATEGORY_MIX, experienceLevel = "mid", jobDescription = "") {
  const normalizedMix = normalizeCategoryMix(categoryMix);
  const next = [...items];
  ["technical", "non_technical", "competency"].forEach(category => {
    const requested = Number(normalizedMix[category] || 0) > 0;
    const present = next.some(item => (item.category || "technical") === category);
    if (requested && !present) {
      next.push(defaultGuideItemForCategory(category, jobDescription, experienceLevel));
    }
  });
  return next;
}

function calibrateItemsForGuide(items = [], categoryMix = DEFAULT_CATEGORY_MIX, experienceLevel = "mid", jobDescription = "") {
  const coveredItems = ensureGuideCategoryCoverage(items, categoryMix, experienceLevel, jobDescription);
  if (!coveredItems.length) return [];
  const normalizedMix = normalizeCategoryMix(categoryMix);
  const grouped = coveredItems.reduce((acc, item) => {
    const category = item.category || "technical";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});
  const presentCategories = Object.keys(grouped);
  const presentTotal = presentCategories.reduce((sum, category) => sum + Number(normalizedMix[category] || 0), 0) || 100;
  const targetByCategory = presentCategories.reduce((acc, category, index) => {
    const raw = Number(normalizedMix[category] || 0);
    const normalized = presentCategories.length === 1 ? 100 : Number(((raw / presentTotal) * 100).toFixed(2));
    acc[category] = index === presentCategories.length - 1
      ? Number((100 - Object.values(acc).reduce((sum, value) => sum + value, 0)).toFixed(2))
      : normalized;
    return acc;
  }, {});
  return presentCategories.flatMap(category => {
    const categoryItems = grouped[category];
    const even = Number((targetByCategory[category] / categoryItems.length).toFixed(2));
    return categoryItems.map((item, index) => ({
      ...item,
      required_level:levelForExperience(category, experienceLevel),
      weight:index === categoryItems.length - 1
        ? Number((targetByCategory[category] - even * (categoryItems.length - 1)).toFixed(2))
        : even,
    }));
  });
}

function GuidedRubricWizard({
  role,
  positionCode,
  jd,
  skills,
  selected,
  items,
  loading,
  totalWeight,
  weightTotalOk,
  statusColor,
  guidance,
  guideMode,
  setGuideMode,
  experienceLevel,
  setExperienceLevel,
  categoryMix,
  updateCategoryMix,
  categoryMixTotal,
  currentStep,
  setCurrentStep,
  guideSteps,
  categoryCounts,
  canGoNext,
  previousStep,
  nextStep,
  generateFromJD,
  uploadAndGenerate,
  addGuidedSkill,
  addItem,
  updateItem,
  removeItem,
  balanceSelectedWeights,
  saveRubric,
  rubricNotice,
}) {
  const stepTitle = currentStep === 1 ? "Confirm the JD source"
    : currentStep === 2 ? "Choose rubric metrics"
    : currentStep === 3 ? "Calibrate scoring weights"
    : "Activate for candidate scoring";
  const stepCopy = currentStep === 1
    ? "Drishti reads the saved job description and required skills before creating the rubric."
    : currentStep === 2
      ? "Add only the metrics that interviewers can score with evidence."
      : currentStep === 3
        ? "Every weight is a percentage. The total must be exactly 100 before activation."
        : "Publish this rubric so Candidate Management uses it for interview scoring and skill gaps.";
  const activationChecks = [
    {label:"Job description is available",ok:!!jd.trim()},
    {label:"At least one rubric metric exists",ok:items.length > 0},
    {label:"Weights total exactly 100%",ok:weightTotalOk},
    {label:"Competency metric included",ok:!!categoryCounts.competency},
    {label:"Non-technical metric included",ok:!!categoryCounts.non_technical},
  ];
  const activationReady = activationChecks.every(check => check.ok);
  const finalActionReady = !!selected && !loading && activationReady;
  const footerPrimaryDisabled = currentStep === 4 ? !finalActionReady : !canGoNext;
  const footerPrimaryLabel = currentStep === 4 ? loading ? "Saving..." : "Save & Activate" : "Next";
  const handleFooterPrimary = currentStep === 4 ? saveRubric : nextStep;
  const suggestedAdditions = selected ? guidance.missing : guidance.detectedSkills;

  return (
    <div style={{ marginBottom:24, borderTop:"1px solid var(--l06)", paddingTop:18 }}>
      <div style={{background:"linear-gradient(135deg,rgba(10,102,194,0.08),rgba(14,165,233,0.05),rgba(22,135,64,0.04))",border:"1px solid rgba(10,102,194,0.22)",borderRadius:18,overflow:"hidden",boxShadow:"0 18px 40px rgba(15,23,42,0.08)"}}>
        <div style={{padding:16,borderBottom:"1px solid rgba(10,102,194,0.16)",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            <div style={{width:44,height:44,borderRadius:16,background:"linear-gradient(135deg,#0A66C2,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:9,fontWeight:800,letterSpacing:0.7,boxShadow:"0 12px 26px rgba(10,102,194,0.25)",flexShrink:0}}>DRISHTI</div>
            <div>
              <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:1.1}}>Guided rubric builder</div>
              <div style={{color:"var(--t1)",fontSize:18,fontWeight:800,letterSpacing:-0.35,marginTop:2}}>Build interview metrics from the job description</div>
              <div style={{color:"var(--t3)",fontSize:12,lineHeight:1.55,marginTop:5,maxWidth:560}}>
                Role: <strong style={{color:"var(--t2)"}}>{role || "Untitled role"}</strong>{positionCode ? ` · ${positionCode}` : ""}. Drishti guides JD intake, metric selection, weight calibration, and activation.
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            <span style={{padding:"6px 10px",borderRadius:20,background:"var(--l03)",border:"1px solid var(--l07)",color:statusColor,fontSize:11,fontWeight:800,textTransform:"uppercase"}}>{selected?.status || "Not started"}</span>
            <span style={{padding:"6px 10px",borderRadius:20,background:weightTotalOk?"rgba(22,135,64,0.1)":"rgba(204,16,22,0.1)",border:`1px solid ${weightTotalOk?"rgba(22,135,64,0.24)":"rgba(204,16,22,0.24)"}`,color:weightTotalOk?"#0D6B35":"#ef4444",fontSize:11,fontWeight:800}}>
              {totalWeight.toFixed(2)}% total
            </span>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"170px 1fr",minHeight:440}}>
          <div style={{padding:14,borderRight:"1px solid rgba(10,102,194,0.14)",background:"rgba(255,255,255,0.03)"}}>
            {guideSteps.map(step => {
              const active = currentStep === step.id;
              return (
                <button key={step.id} type="button" onClick={()=>setCurrentStep(step.id)}
                  style={{width:"100%",textAlign:"left",padding:"11px 10px",marginBottom:8,borderRadius:13,border:`1px solid ${active?"rgba(10,102,194,0.34)":step.done?"rgba(22,135,64,0.22)":"var(--l07)"}`,background:active?"rgba(10,102,194,0.12)":step.done?"rgba(22,135,64,0.08)":"var(--l03)",cursor:"pointer",color:"var(--t1)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{width:20,height:20,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",background:step.done?"#168740":active?"#0A66C2":"var(--l07)",color:step.done || active ? "white":"var(--t3)",fontSize:10,fontWeight:800}}>{step.done ? "✓" : step.id}</span>
                    <span style={{fontSize:12,fontWeight:800}}>{step.label}</span>
                  </div>
                  <div style={{color:"var(--t3)",fontSize:10,lineHeight:1.35,paddingLeft:28}}>{step.description}</div>
                </button>
              );
            })}
          </div>

          <div style={{padding:16}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:14}}>
              <div>
                <div style={{color:"var(--t1)",fontSize:15,fontWeight:800,marginBottom:5}}>{stepTitle}</div>
                <div style={{color:"var(--t3)",fontSize:12,lineHeight:1.55}}>{stepCopy}</div>
              </div>
              {currentStep > 1 && (
                <button type="button" onClick={async()=>{ await generateFromJD(); setCurrentStep(3); }} disabled={loading || !jd.trim() || Math.abs(categoryMixTotal - 100) >= 0.01}
                  style={{padding:"8px 11px",background:"rgba(10,102,194,0.1)",color:"#0284c7",border:"1px solid rgba(10,102,194,0.25)",borderRadius:10,cursor:loading || !jd.trim() || Math.abs(categoryMixTotal - 100) >= 0.01?"not-allowed":"pointer",fontSize:11,fontWeight:800,whiteSpace:"nowrap"}}>
                  Regenerate from JD
                </button>
              )}
            </div>

            {currentStep === 1 && (
              <>
                <div style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:14,padding:13,marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
                    <div>
                      <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8}}>Position seniority</div>
                      <div style={{color:"var(--t2)",fontSize:12,marginTop:3}}>Drishti uses this to set Beginner, Competent, or Expert expectations.</div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {EXPERIENCE_OPTIONS.map(option => {
                      const active = experienceLevel === option.key;
                      return (
                        <button key={option.key} type="button" onClick={()=>setExperienceLevel(option.key)}
                          style={{textAlign:"left",padding:"10px 9px",borderRadius:12,border:`1px solid ${active?"rgba(10,102,194,0.42)":"var(--l07)"}`,background:active?"rgba(10,102,194,0.12)":"var(--l04)",color:"var(--t1)",cursor:"pointer"}}>
                          <div style={{fontSize:12,fontWeight:800,color:active?"#0A66C2":"var(--t1)"}}>{option.label}</div>
                          <div style={{fontSize:10,lineHeight:1.35,color:"var(--t3)",marginTop:4}}>{option.copy}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:14,padding:13,marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:10}}>
                    <div>
                      <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8}}>Rubric weight split</div>
                      <div style={{color:"var(--t2)",fontSize:12,marginTop:3}}>Set how much the final score should depend on technical, non-technical, and competency metrics.</div>
                    </div>
                    <span style={{padding:"5px 9px",borderRadius:18,background:Math.abs(categoryMixTotal - 100) < 0.01 ? "rgba(22,135,64,0.1)" : "rgba(204,16,22,0.1)",border:`1px solid ${Math.abs(categoryMixTotal - 100) < 0.01 ? "rgba(22,135,64,0.24)" : "rgba(204,16,22,0.24)"}`,color:Math.abs(categoryMixTotal - 100) < 0.01 ? "#0D6B35" : "#ef4444",fontSize:11,fontWeight:800}}>
                      {categoryMixTotal.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9}}>
                    {[
                      {key:"technical", label:"Technical"},
                      {key:"non_technical", label:"Non-technical"},
                      {key:"competency", label:"Competency"},
                    ].map(item => (
                      <label key={item.key} style={{display:"grid",gap:6,color:"var(--t2)",fontSize:11,fontWeight:800}}>
                        {item.label}
                        <input type="number" min="0" max="100" step="1" value={categoryMix[item.key]} onChange={e=>updateCategoryMix(item.key, e.target.value)}
                          style={{...S.formField,marginBottom:0,fontWeight:800}}/>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                  {[
                    {label:"JD status",value:jd.trim()?"Ready":"Missing",color:jd.trim()?"#168740":"#ef4444"},
                    {label:"JD length",value:`${jd.trim().length} chars`,color:"#0A66C2"},
                    {label:"Required skills",value:String(skills.length),color:"#0ea5e9"},
                  ].map(card => (
                    <div key={card.label} style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:13,padding:12}}>
                      <div style={{color:"var(--t3)",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8}}>{card.label}</div>
                      <div style={{color:card.color,fontSize:19,fontWeight:800,marginTop:5}}>{card.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:14,padding:13,marginBottom:14}}>
                  <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>Drishti JD preview</div>
                  <div style={{color:"var(--t2)",fontSize:12,lineHeight:1.65,maxHeight:132,overflow:"auto",whiteSpace:"pre-wrap"}}>{jd.trim() ? jd.trim().slice(0, 900) : "No job description available yet."}</div>
                </div>
                <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
                  <label style={{padding:"9px 12px",background:"rgba(10,102,194,0.1)",color:"#0284c7",border:"1px solid rgba(10,102,194,0.25)",borderRadius:10,cursor:loading?"not-allowed":"pointer",fontSize:12,fontWeight:800}}>
                    Upload JD
                    <input type="file" accept=".txt,.md,.docx,.pdf" disabled={loading} style={{display:"none"}}
                      onChange={async e=>{ await uploadAndGenerate(e.target.files?.[0]); e.target.value = ""; setCurrentStep(2); }}/>
                  </label>
                  <button type="button" onClick={async()=>{ await generateFromJD(); setCurrentStep(3); }} disabled={loading || !jd.trim() || Math.abs(categoryMixTotal - 100) >= 0.01} style={{padding:"9px 12px",background:"linear-gradient(135deg,#0A66C2,#004182)",color:"white",border:"none",borderRadius:10,cursor:loading || !jd.trim() || Math.abs(categoryMixTotal - 100) >= 0.01?"not-allowed":"pointer",fontSize:12,fontWeight:800,boxShadow:"0 8px 18px rgba(10,102,194,0.24)"}}>
                    {loading ? "Generating..." : "Generate metrics from JD"}
                  </button>
                </div>
              </>
            )}

            {currentStep === 2 && (
              <>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                  {["full","technical","client"].map(mode => (
                    <button key={mode} type="button" onClick={()=>setGuideMode(mode)} style={{padding:"7px 11px",borderRadius:20,border:`1px solid ${guideMode===mode?"rgba(10,102,194,0.42)":"var(--l08)"}`,background:guideMode===mode?"rgba(10,102,194,0.12)":"var(--l03)",color:guideMode===mode?"#0A66C2":"var(--t3)",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                      {mode === "full" ? "Full interview rubric" : mode === "technical" ? "Technical-heavy" : "Client validation"}
                    </button>
                  ))}
                </div>
                {!selected && (
                  <div style={{background:"rgba(56,67,79,0.08)",border:"1px solid rgba(56,67,79,0.18)",borderRadius:13,padding:12,marginBottom:14,color:"var(--t2)",fontSize:12,lineHeight:1.5}}>
                    No rubric has been generated yet. Start with Drishti's JD metrics, then refine.
                    <div style={{marginTop:10}}><button type="button" onClick={async()=>{ await generateFromJD(); setCurrentStep(3); }} disabled={loading || Math.abs(categoryMixTotal - 100) >= 0.01} style={{padding:"8px 11px",borderRadius:9,border:"none",background:"#0A66C2",color:"white",fontSize:11,fontWeight:800,cursor:loading || Math.abs(categoryMixTotal - 100) >= 0.01?"not-allowed":"pointer"}}>Generate now</button></div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                  {["technical","non_technical","competency"].map(category => (
                    <div key={category} style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:13,padding:12}}>
                      <div style={{color:"var(--t3)",fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8}}>{displayCategory(category)}</div>
                      <div style={{color:"var(--t1)",fontSize:24,fontWeight:800,marginTop:4}}>{categoryCounts[category] || 0}</div>
                    </div>
                  ))}
                </div>
                <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>Drishti suggested additions</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                  {suggestedAdditions.map(skill => (
                    <button key={skill.label} type="button" disabled={!selected} onClick={()=>addGuidedSkill(skill)}
                      style={{padding:"8px 11px",borderRadius:20,border:"1px solid rgba(14,165,233,0.24)",background:"rgba(14,165,233,0.08)",color:"#0284c7",fontSize:11,fontWeight:800,cursor:selected?"pointer":"not-allowed"}}>
                      + {skill.label} <span style={{color:"var(--t3)"}}>{displayCategory(skill.category)}</span>
                    </button>
                  ))}
                  {!guidance.detectedSkills.length && <span style={{color:"var(--t3)",fontSize:12}}>No obvious skill signals found yet. Generate from JD or add metrics manually.</span>}
                </div>
                {selected && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                    {items.slice(0, 16).map(item => (
                      <span key={item.id || item.skill} style={{padding:"6px 9px",borderRadius:18,background:"var(--l03)",border:"1px solid var(--l07)",color:"var(--t2)",fontSize:11,fontWeight:800}}>{item.skill}</span>
                    ))}
                  </div>
                )}
              </>
            )}

            {currentStep === 3 && (
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{color:weightTotalOk ? "#0D6B35" : "#ef4444",fontSize:12,fontWeight:800}}>Total weight: {totalWeight.toFixed(2)}%</span>
                    <span style={{color:"var(--t3)",fontSize:12}}>{items.length} metrics</span>
                    <span style={{color:"#0A66C2",fontSize:12,fontWeight:800}}>{EXPERIENCE_OPTIONS.find(option => option.key === experienceLevel)?.label || "Mid-level"}</span>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button type="button" onClick={addItem} disabled={!selected} style={{padding:"7px 10px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:9,cursor:selected?"pointer":"not-allowed",fontSize:11,fontWeight:800}}>+ Metric</button>
                    <button type="button" onClick={balanceSelectedWeights} disabled={!selected} style={{padding:"7px 10px",background:"rgba(22,135,64,0.1)",color:"#0D6B35",border:"1px solid rgba(22,135,64,0.24)",borderRadius:9,cursor:selected?"pointer":"not-allowed",fontSize:11,fontWeight:800}}>Balance to 100%</button>
                  </div>
                </div>
                {selected && (
                  <div style={{background:"rgba(14,165,233,0.06)",border:"1px solid rgba(14,165,233,0.18)",borderRadius:14,padding:12,marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:9,flexWrap:"wrap"}}>
                      <div>
                        <div style={{color:"var(--t3)",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.8}}>Suggested skills</div>
                        <div style={{color:"var(--t3)",fontSize:11,marginTop:3}}>Add missing JD signals while you calibrate weights.</div>
                      </div>
                      <button type="button" onClick={()=>setCurrentStep(2)} style={{padding:"6px 9px",borderRadius:9,border:"1px solid rgba(10,102,194,0.24)",background:"rgba(10,102,194,0.08)",color:"#0A66C2",fontSize:11,fontWeight:800,cursor:"pointer"}}>Review all</button>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {suggestedAdditions.length ? suggestedAdditions.slice(0, 8).map(skill => (
                        <button key={skill.label} type="button" onClick={()=>addGuidedSkill(skill)}
                          style={{padding:"7px 10px",borderRadius:20,border:"1px solid rgba(14,165,233,0.24)",background:"var(--l03)",color:"#0284c7",fontSize:11,fontWeight:800,cursor:"pointer"}}>
                          + {skill.label} <span style={{color:"var(--t3)"}}>{displayCategory(skill.category)}</span>
                        </button>
                      )) : (
                        <span style={{color:"var(--t3)",fontSize:12}}>No additional JD skill signals detected right now.</span>
                      )}
                    </div>
                  </div>
                )}
                {!selected ? (
                  <div style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:14,padding:18,textAlign:"center",color:"var(--t3)",fontSize:12}}>Generate a rubric first to calibrate scoring metrics.</div>
                ) : (
                  <div style={{display:"grid",gap:9}}>
                    {items.map((item, index) => (
                      <div key={item.id || index} style={{background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:14,padding:10}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 120px 116px 88px 28px",gap:8,alignItems:"center"}}>
                          <input value={item.skill || ""} onChange={e=>updateItem(index,"skill",e.target.value)} placeholder="Skill or competency" style={{...S.formField,marginBottom:0}}/>
                          <select value={item.category || "technical"} onChange={e=>updateItem(index,"category",e.target.value)} style={{...S.formField,marginBottom:0}}>
                            <option value="technical">Technical</option>
                            <option value="non_technical">Non-technical</option>
                            <option value="competency">Competency</option>
                          </select>
                          <select value={item.required_level || "Competent"} onChange={e=>updateItem(index,"required_level",e.target.value)} style={{...S.formField,marginBottom:0}}>
                            <option>Beginner</option>
                            <option>Competent</option>
                            <option>Expert</option>
                          </select>
                          <input type="number" min="0" max="100" step="0.01" value={item.weight || 0} onChange={e=>updateItem(index,"weight",e.target.value)} style={{...S.formField,marginBottom:0}}/>
                          <button type="button" onClick={()=>removeItem(index)} title={`Remove ${item.skill || "rubric item"}`} aria-label={`Remove ${item.skill || "rubric item"}`}
                            style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",color:"#ef4444",border:"1px solid rgba(239,68,68,0.22)",borderRadius:"50%",cursor:"pointer",fontSize:13,fontWeight:800,lineHeight:1,opacity:0.82,justifySelf:"center"}}>x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {currentStep === 4 && (
              <>
                <div style={{display:"grid",gap:9,marginBottom:14}}>
                  {activationChecks.map(check => (
                    <div key={check.label} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",borderRadius:12,background:check.ok?"rgba(22,135,64,0.08)":"rgba(56,67,79,0.08)",border:`1px solid ${check.ok?"rgba(22,135,64,0.2)":"rgba(56,67,79,0.18)"}`,color:"var(--t2)",fontSize:12,fontWeight:800}}>
                      <span style={{width:20,height:20,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",background:check.ok?"#168740":"#38434F",color:"white",fontSize:11,fontWeight:800}}>{check.ok ? "✓" : "!"}</span>
                      {check.label}
                    </div>
                  ))}
                </div>
                {rubricNotice && (
                  <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(22,135,64,0.1)",border:"1px solid rgba(22,135,64,0.24)",borderRadius:13,padding:"11px 12px",marginBottom:14,color:"#047857",fontSize:12,fontWeight:800}}>
                    <span style={{width:22,height:22,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",background:"#168740",color:"white",fontSize:12,fontWeight:800}}>✓</span>
                    {rubricNotice}
                  </div>
                )}
                {guidance.warnings.length > 0 && (
                  <div style={{background:"rgba(56,67,79,0.08)",border:"1px solid rgba(56,67,79,0.18)",borderRadius:13,padding:12,marginBottom:14}}>
                    <div style={{color:"#38434F",fontSize:11,fontWeight:800,marginBottom:7}}>Drishti notes</div>
                    {guidance.warnings.slice(0, 4).map((warning, index) => <div key={index} style={{color:"var(--t2)",fontSize:12,lineHeight:1.5}}>• {warning}</div>)}
                  </div>
                )}
                <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
                  <button type="button" onClick={balanceSelectedWeights} disabled={!selected} style={{padding:"10px 14px",background:"rgba(22,135,64,0.1)",color:"#0D6B35",border:"1px solid rgba(22,135,64,0.24)",borderRadius:11,cursor:selected?"pointer":"not-allowed",fontSize:12,fontWeight:800}}>Balance to 100%</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"12px 16px",borderTop:"1px solid rgba(10,102,194,0.16)",background:"rgba(255,255,255,0.03)"}}>
          <button type="button" onClick={previousStep} disabled={currentStep === 1} style={{padding:"8px 12px",borderRadius:10,border:"1px solid var(--l08)",background:"var(--l03)",color:"var(--t2)",fontSize:12,fontWeight:800,cursor:currentStep === 1 ? "not-allowed":"pointer"}}>Back</button>
          <div style={{color:weightTotalOk ? "var(--t3)" : "#ef4444",fontSize:11,fontWeight:800}}>
            {selected ? `${items.length} metrics · ${totalWeight.toFixed(2)}% total` : "Generate rubric metrics to continue"}
          </div>
          <button type="button" onClick={handleFooterPrimary} disabled={footerPrimaryDisabled} style={{padding:"8px 12px",borderRadius:10,border:"none",background:footerPrimaryDisabled ? "var(--l04)" : currentStep === 4 ? "linear-gradient(135deg,#0D6B35,#047857)" : "linear-gradient(135deg,#0A66C2,#004182)",color:footerPrimaryDisabled ? "var(--t3)" : "white",fontSize:12,fontWeight:800,cursor:footerPrimaryDisabled ? "not-allowed":"pointer",boxShadow:!footerPrimaryDisabled && currentStep === 4 ? "0 8px 18px rgba(5,150,105,0.22)" : "none"}}>{footerPrimaryLabel}</button>
        </div>
      </div>
    </div>
  );
}

function RubricPanel({ row, skills, jd, onJDUploaded }) {
  const [rubrics, setRubrics] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [guideMode, setGuideMode] = useState("full");
  const [currentStep, setCurrentStep] = useState(1);
  const [experienceLevel, setExperienceLevel] = useState("mid");
  const [categoryMix, setCategoryMix] = useState(DEFAULT_CATEGORY_MIX);
  const [rubricNotice, setRubricNotice] = useState("");
  const role = row["Role"] || "";
  const positionCode = row["Position Code"] || "";
  const totalWeight = (selected?.items || []).reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const weightTotalOk = Math.abs(totalWeight - 100) < 0.01;
  const categoryMixTotal = Object.values(categoryMix).reduce((sum, value) => sum + Number(value || 0), 0);
  const guidance = useMemo(
    () => buildRubricGuidance({ jd, skills, selected, totalWeight, weightTotalOk }),
    [jd, skills, selected, totalWeight, weightTotalOk]
  );

  const updateCategoryMix = (key, value) => {
    const nextValue = Math.max(0, Math.min(100, Number(value || 0)));
    setCategoryMix(prev => ({ ...prev, [key]: nextValue }));
    setRubricNotice("");
  };

  const loadRubrics = useCallback(async () => {
    if (!role && !positionCode) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (positionCode) params.set("position_code", positionCode);
      if (role) params.set("role", role);
      const qs = params.toString();
      const res = await fetch(`${API}/rubrics?${qs}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setRubrics(list);
      setSelected(chooseRubricForPosition(list, role, positionCode));
    } catch {
      setRubrics([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [role, positionCode]);

  useEffect(() => { loadRubrics(); }, [loadRubrics]);

  const activateRubric = async (rubricId) => {
    const res = await fetch(`${API}/rubrics/${rubricId}/activate`, { method:"POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Rubric activation failed");
      return null;
    }
    return data;
  };

  const generateFromJD = async (jobDescriptionOverride = "") => {
    setLoading(true);
    setRubricNotice("");
    try {
      const res = await fetch(`${API}/rubrics/draft`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ role, position_code:positionCode, skills, job_description:jobDescriptionOverride || jd }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || "Rubric generation failed");
        return;
      }
      const active = await activateRubric(data.id);
      const generated = active || data;
      const calibrated = {
        ...generated,
        items: calibrateItemsForGuide(generated.items || [], categoryMix, experienceLevel, jobDescriptionOverride || jd),
      };
      const saveRes = await fetch(`${API}/rubrics/${generated.id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(calibrated),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) {
        alert(saved.detail || "Rubric calibration failed");
        setSelected(generated);
        return;
      }
      const reactivated = await activateRubric(saved.id);
      setSelected(reactivated || saved);
      await loadRubrics();
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (index, key, value) => {
    setRubricNotice("");
    setSelected(prev => {
      const items = [...(prev?.items || [])];
      items[index] = { ...items[index], [key]: key === "weight" ? Number(value) : value };
      return { ...prev, items };
    });
  };

  const rebalanceWeights = (items) => calibrateItemsForGuide(items || [], categoryMix, experienceLevel, jd);

  const balanceSelectedWeights = () => {
    setRubricNotice("");
    setSelected(prev => ({ ...prev, items:rebalanceWeights(prev?.items || []) }));
  };

  const removeItem = (index) => {
    setRubricNotice("");
    setSelected(prev => {
      const items = (prev?.items || []).filter((_, itemIndex) => itemIndex !== index);
      return { ...prev, items: rebalanceWeights(items) };
    });
  };

  const uploadAndGenerate = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await uploadJobDescriptionFile(file);
      const saveJD = await fetch(`${API}/update-position-skills`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ position_code:positionCode, role, skills, job_description:text }),
      });
      if (!saveJD.ok) {
        const err = await saveJD.json();
        throw new Error(err.detail || "Could not save uploaded job description");
      }
      onJDUploaded?.(text);
      await generateFromJD(text);
    } catch (err) {
      alert(err.message || "Could not upload job description");
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setRubricNotice("");
    setSelected(prev => ({
      ...prev,
      items: rebalanceWeights([
        ...(prev?.items || []),
        {
          category:"technical",
          skill:"",
          required_level:levelForExperience("technical", experienceLevel),
          weight:10,
          beginner_benchmark:"",
          competent_benchmark:"",
          expert_benchmark:"",
          evidence_guidance:"",
        },
      ]),
    }));
  };

  const addGuidedSkill = (skill) => {
    setRubricNotice("");
    const inferred = inferRubricSkill(skill.label);
    setSelected(prev => ({
      ...prev,
      items: rebalanceWeights([
        ...(prev?.items || []),
        {
          category:skill.category || inferred.category || "technical",
          skill:skill.label || "",
          required_level:levelForExperience(skill.category || inferred.category || "technical", experienceLevel),
          weight:10,
          beginner_benchmark:"",
          competent_benchmark:"",
          expert_benchmark:"",
          evidence_guidance:`Evaluate ${skill.label} using evidence from the interview and resume.`,
        },
      ]),
    }));
  };

  const saveRubric = async () => {
    if (!selected?.id) return;
    if (!weightTotalOk) {
      alert(`Rubric weights must total 100%. Current total is ${totalWeight.toFixed(2)}%.`);
      return;
    }
    if (!jd.trim() || !selected.items?.length || !categoryCounts.competency || !categoryCounts.non_technical) {
      setRubricNotice("");
      alert("Complete every activation check before saving this rubric.");
      return;
    }
    setLoading(true);
    setRubricNotice("");
    try {
      const res = await fetch(`${API}/rubrics/${selected.id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(selected),
      });
      const saved = await res.json();
      if (!res.ok) {
        alert(saved.detail || "Rubric save failed");
        return;
      }
      const active = await activateRubric(saved.id);
      setSelected(active || saved);
      await loadRubrics();
      setRubricNotice("Rubric saved and activated. Candidate scoring will use this version now.");
    } finally {
      setLoading(false);
    }
  };

  const activate = async () => {
    if (!selected?.id) return;
    setLoading(true);
    try {
      const data = await activateRubric(selected.id);
      if (data) setSelected(data);
      await loadRubrics();
    } finally {
      setLoading(false);
    }
  };

  const statusColor = selected?.status === "active" ? "#168740" : selected?.status === "needs_changes" ? "#56687A" : "#0A66C2";
  const items = selected?.items || [];
  const categoryCounts = items.reduce((acc, item) => {
    const key = item.category || "technical";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const guideSteps = [
    { id:1, label:"Source JD", description:"Confirm the JD and role signals", done:!!jd.trim() },
    { id:2, label:"Choose metrics", description:"Let Drishti identify scoring metrics", done:!!selected && items.length > 0 },
    { id:3, label:"Calibrate", description:"Set levels and weight percentages", done:!!selected && weightTotalOk && items.length > 0 },
    { id:4, label:"Activate", description:"Publish to candidate scoring", done:selected?.status === "active" && weightTotalOk },
  ];
  const categoryMixOk = Math.abs(categoryMixTotal - 100) < 0.01;
  const canGoNext = currentStep === 1 ? !!jd.trim() && categoryMixOk : currentStep === 2 ? !!selected : currentStep === 3 ? !!selected && weightTotalOk : false;
  const nextStep = () => setCurrentStep(step => Math.min(4, step + 1));
  const previousStep = () => setCurrentStep(step => Math.max(1, step - 1));

  return (
    <GuidedRubricWizard
      role={role}
      positionCode={positionCode}
      jd={jd}
      skills={skills}
      selected={selected}
      items={items}
      loading={loading}
      totalWeight={totalWeight}
      weightTotalOk={weightTotalOk}
      statusColor={statusColor}
      guidance={guidance}
      guideMode={guideMode}
      setGuideMode={setGuideMode}
      experienceLevel={experienceLevel}
      setExperienceLevel={setExperienceLevel}
      categoryMix={categoryMix}
      updateCategoryMix={updateCategoryMix}
      categoryMixTotal={categoryMixTotal}
      currentStep={currentStep}
      setCurrentStep={setCurrentStep}
      guideSteps={guideSteps}
      categoryCounts={categoryCounts}
      canGoNext={canGoNext}
      previousStep={previousStep}
      nextStep={nextStep}
      generateFromJD={generateFromJD}
      uploadAndGenerate={uploadAndGenerate}
      addGuidedSkill={addGuidedSkill}
      addItem={addItem}
      updateItem={updateItem}
      removeItem={removeItem}
      balanceSelectedWeights={balanceSelectedWeights}
      saveRubric={saveRubric}
      rubricNotice={rubricNotice}
    />
  );

  return (
    <div style={{ marginBottom:24, borderTop:"1px solid var(--l06)", paddingTop:18 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:10 }}>
        <div>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>JD Scoring Rubric</div>
          <div style={{ display:"none", color:"var(--t3)", fontSize:12, marginTop:3 }}>
            {selected ? `v${selected.version} · ${selected.items?.length || 0} items` : "No rubric yet"}
          </div>
          <div style={{ color:"var(--t3)", fontSize:12, marginTop:3 }}>
            {selected ? `${selected.items?.length || 0} items` : "No rubric yet"}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <label style={{ padding:"8px 12px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:9, cursor:loading?"not-allowed":"pointer", fontSize:12, fontWeight:800 }}>
            Upload JD
            <input type="file" accept=".txt,.md,.docx,.pdf" disabled={loading} style={{display:"none"}}
              onChange={async e=>{ await uploadAndGenerate(e.target.files?.[0]); e.target.value = ""; }}/>
          </label>
          <button onClick={selected ? saveRubric : () => generateFromJD()} disabled={loading}
            style={{ padding:"8px 12px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:9, cursor:loading?"not-allowed":"pointer", fontSize:12, fontWeight:800 }}>
            {selected ? "Save & Activate" : "Generate from JD"}
          </button>
        </div>
      </div>

      <DrishtiGuideCard
        analysis={guidance}
        loading={loading}
        selected={selected}
        weightTotalOk={weightTotalOk}
        guideMode={guideMode}
        setGuideMode={setGuideMode}
        onGenerate={() => generateFromJD()}
        onBalance={balanceSelectedWeights}
        onAddSkill={addGuidedSkill}
        onActivate={activate}
        onSave={saveRubric}
      />

      {selected && (
        <div style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:12, padding:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, gap:8 }}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <span style={{ color:statusColor, fontSize:12, fontWeight:800, textTransform:"uppercase" }}>{selected.status}</span>
              <span style={{ color:weightTotalOk ? "#168740" : "#CC1016", fontSize:12, fontWeight:800 }}>
                Total weight: {totalWeight.toFixed(2)}%
              </span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={addItem} style={{ padding:"6px 10px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:800 }}>+ Item</button>
              <button onClick={() => generateFromJD()} style={{ padding:"6px 10px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:800 }}>Regenerate from JD</button>
              {selected.status !== "active" && <button onClick={activate} style={{ padding:"6px 10px", background:"rgba(22,135,64,0.12)", color:"#168740", border:"1px solid rgba(22,135,64,0.25)", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:800 }}>Activate</button>}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 110px 90px 28px", gap:8, color:"var(--t3)", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.7 }}>
              <span>Metric</span>
              <span>Category</span>
              <span>Level</span>
              <span>Weight %</span>
              <span></span>
            </div>
            {(selected.items || []).map((item, index) => (
              <div key={item.id || index} style={{ display:"grid", gridTemplateColumns:"1fr 120px 110px 90px 28px", gap:8, alignItems:"center" }}>
                <input value={item.skill || ""} onChange={e=>updateItem(index,"skill",e.target.value)} placeholder="Skill or competency" style={S.formField}/>
                <select value={item.category || "technical"} onChange={e=>updateItem(index,"category",e.target.value)} style={S.formField}>
                  <option value="technical">Technical</option>
                  <option value="non_technical">Non-technical</option>
                  <option value="competency">Competency</option>
                </select>
                <select value={item.required_level || "Competent"} onChange={e=>updateItem(index,"required_level",e.target.value)} style={S.formField}>
                  <option>Beginner</option>
                  <option>Competent</option>
                  <option>Expert</option>
                </select>
                <input type="number" min="0" max="100" step="0.01" value={item.weight || 0} onChange={e=>updateItem(index,"weight",e.target.value)} style={S.formField}/>
                <button type="button" onClick={()=>removeItem(index)} title={`Remove ${item.skill || "rubric item"}`} aria-label={`Remove ${item.skill || "rubric item"}`}
                  style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",color:"#ef4444",border:"1px solid rgba(239,68,68,0.22)",borderRadius:"50%",cursor:"pointer",fontSize:13,fontWeight:800,lineHeight:1,opacity:0.82,justifySelf:"center"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(204,16,22,0.1)";e.currentTarget.style.opacity="1";e.currentTarget.style.transform="scale(1.04)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.opacity="0.82";e.currentTarget.style.transform="scale(1)";}}>
                  x
                </button>
              </div>
            ))}
          </div>

          <div style={{ color:weightTotalOk ? "var(--t3)" : "#CC1016", fontSize:11, lineHeight:1.55 }}>
            Metrics are generated directly from the job description and required skills. Edit any item above, then save to make it the active scoring rubric for this role.
            {!weightTotalOk && " Adjust weights so the total equals exactly 100%."}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionPanel({ row, onEdit, onDelete, onClose }) {
  const [skills, setSkills]             = useState([]);
  const [jd, setJD]                     = useState("");
  const [savedJD, setSavedJD]           = useState("");
  const [savingJD, setSavingJD]         = useState(false);
  const [jdSaveError, setJDSaveError]   = useState("");
  const [loadingSkills, setLoadingSkills] = useState(true);
  const posCount  = parseInt(row["# of Position"]||0);
  const submitted = parseInt(row["_candidate_count"]||0);

  useEffect(() => {
    setLoadingSkills(true); setSkills([]); setJD("");
    const code  = (row["Position Code"]||"").toString().trim();
    const role  = (row["Role"]||"").trim();
    const param = code ? `position_code=${encodeURIComponent(code)}` : `role=${encodeURIComponent(role)}`;
    fetch(`${API}/position-skills?${param}`)
      .then(r=>r.json())
      .then(d=>{
        const text = d.job_description || "";
        setSkills(d.skills||[]);
        setJD(text);
        setSavedJD(text);
      })
      .catch(()=>{})
      .finally(()=>setLoadingSkills(false));
  }, [row["Position Code"], row["Role"]]);

  const saveJobDescription = async (nextJD = jd, quiet = false) => {
    setSavingJD(true);
    setJDSaveError("");
    try {
      const res = await fetch(`${API}/update-position-skills`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          position_code: row["Position Code"] || "",
          role: row["Role"] || "",
          skills,
          job_description: nextJD,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.detail || "Could not save job description";
        setJDSaveError(message);
        if (!quiet) alert(message);
        return false;
      }
      setSavedJD(nextJD);
      return true;
    } catch {
      const message = "Network error while saving job description";
      setJDSaveError(message);
      if (!quiet) alert(message);
      return false;
    } finally {
      setSavingJD(false);
    }
  };

  useEffect(() => {
    if (loadingSkills || jd === savedJD) return;
    const timer = setTimeout(() => {
      saveJobDescription(jd, true);
    }, 900);
    return () => clearTimeout(timer);
  }, [jd, savedJD, loadingSkills]);

  const uploadPositionJD = async (file) => {
    if (!file) return;
    setSavingJD(true);
    try {
      const text = await uploadJobDescriptionFile(file);
      setJD(text);
      await saveJobDescription(text);
    } catch (err) {
      alert(err.message || "Could not upload job description");
    } finally {
      setSavingJD(false);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--pg-bg)" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 14px", borderBottom:"1px solid var(--l07)", flexShrink:0, background:"var(--hdr-bg)" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:14 }}>
          <div>
            <div style={{ color:"#0A66C2", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, marginBottom:4 }}>Position Details</div>
            <div style={{ color:"var(--t1)", fontSize:20, fontWeight:800, letterSpacing:0, lineHeight:1.2 }}>{row["Role"]||"—"}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8, flexWrap:"wrap" }}>
              <span style={{ color:"#0A66C2", fontSize:12, fontFamily:"monospace", background:"rgba(10,102,194,0.1)", border:"1px solid rgba(10,102,194,0.2)", borderRadius:6, padding:"2px 8px" }}>{row["Position Code"]||"—"}</span>
              <TypeBadge value={row["New/Replacement"]}/>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:"var(--l04)", border:"1px solid var(--l08)", color:"var(--t3)", borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
            onMouseEnter={e=>e.currentTarget.style.background="var(--l09)"}
            onMouseLeave={e=>e.currentTarget.style.background="var(--l04)"}>✕</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
          {[
            { label:"Open Positions", value:posCount,  color:"#168740" },
            { label:"Submitted",      value:submitted, color:"#0A66C2" },
            { label:"Fill Rate",      value:(posCount>0?Math.round((submitted/posCount)*100):0)+"%", color:"#38434F" },
          ].map(s=>(
            <div key={s.label} style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:10, padding:"10px 14px" }}>
              <div style={{ color:"var(--t3)", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:3 }}>{s.label}</div>
              <div style={{ color:s.color, fontSize:24, fontWeight:800, lineHeight:1, letterSpacing:-1 }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ height:4, background:"var(--l07)", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${posCount>0?Math.min((submitted/posCount)*100,100):0}%`, background:"linear-gradient(90deg,#0A66C2,#168740)", borderRadius:2, boxShadow:"0 0 8px rgba(10,102,194,0.4)", transition:"width 0.8s ease" }}/>
        </div>
        <div style={{ color:"var(--t3)", fontSize:10, marginTop:4 }}>
          {submitted===0?"Awaiting submissions":submitted>=posCount?"Position filled":"In progress"}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex:1, overflowY:"auto", padding:"20px" }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Position Info</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"10px 16px" }}>
            {DETAIL_FIELDS.map(key=>(
              <div key={key} style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:10, padding:"10px 14px" }}>
                <div style={{ color:"var(--t3)", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, marginBottom:5 }}>{key}</div>
                <div style={{ color:"var(--t2)", fontSize:13 }}>
                  {key==="New/Replacement"?<TypeBadge value={row[key]}/>:(row[key]||"—")}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10 }}>
            <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Job Description</div>
            {!loadingSkills && (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {jdSaveError ? (
                  <span style={{color:"#CC1016",fontSize:11,fontWeight:800}}>Save failed</span>
                ) : savingJD ? (
                  <span style={{color:"#0A66C2",fontSize:11,fontWeight:800}}>Saving...</span>
                ) : jd !== savedJD ? (
                  <span style={{color:"#38434F",fontSize:11,fontWeight:800}}>Autosaving...</span>
                ) : (
                  <span style={{color:"#168740",fontSize:11,fontWeight:800}}>Saved</span>
                )}
                <label style={{padding:"6px 10px",background:"rgba(10,102,194,0.1)",color:"#0A66C2",border:"1px solid rgba(10,102,194,0.25)",borderRadius:8,cursor:savingJD?"not-allowed":"pointer",fontSize:11,fontWeight:800}}>
                  Upload JD
                  <input type="file" accept=".txt,.md,.docx,.pdf" disabled={savingJD} style={{display:"none"}}
                    onChange={async e=>{ await uploadPositionJD(e.target.files?.[0]); e.target.value = ""; }}/>
                </label>
              </div>
            )}
          </div>
          {loadingSkills ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, color:"var(--t3)", fontSize:12 }}><div style={S.spinner}/>Loading...</div>
          ) : (
            <textarea value={jd} onChange={e=>setJD(e.target.value)}
              placeholder="Paste, edit, or upload the job description here..."
              rows={8}
              style={{width:"100%",minHeight:180,background:"var(--l03)",border:"1px solid var(--l07)",borderRadius:12,padding:"14px 16px",fontSize:13,color:"var(--t2)",lineHeight:1.7,resize:"vertical",outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
          )}
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Required Skills</div>
          {!loadingSkills && (skills.length>0 ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {skills.map((skill,i)=>(
                <span key={i} style={{ display:"inline-flex", alignItems:"center", padding:"4px 11px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:20, fontSize:12, fontWeight:600 }}>{skill}</span>
              ))}
            </div>
          ) : (
            <div style={{ color:"var(--t3)", fontSize:12 }}>No skills defined yet. Use Edit to add required skills.</div>
          ))}
        </div>

        {!loadingSkills && <RubricPanel row={row} skills={skills} jd={jd} onJDUploaded={setJD}/>}

        <div style={{ display:"flex", gap:10, paddingTop:16, borderTop:"1px solid var(--l06)" }}>
          <button onClick={onEdit}
            style={{ flex:1, padding:"10px 0", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:700 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.2)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(10,102,194,0.1)"}> âœ Edit Requirement</button>
          <button onClick={onDelete}
            style={{ flex:1, padding:"10px 0", background:"rgba(204,16,22,0.08)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:700 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(204,16,22,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(204,16,22,0.08)"}> ✕ Delete Position</button>
        </div>
      </div>
    </div>
  );
}

export default function NewRequirements() {
  const navigate = useNavigate();
  const { authData, session } = useAuth();
  const isAdmin = session?.role === "admin";

  const [data,setData]               = useState([]);
  const [search,setSearch]           = useState("");
  const [typeFilter,setTypeFilter]   = useState("");
  const [filterAccount,setFilterAccount] = useState("");
  const [filterLob,setFilterLob]     = useState("");
  const [expandedRow,setExpandedRow] = useState(null);
  const [editingRow,setEditingRow]   = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const [toast,setToast]             = useState(null);
  const [loading,setLoading]         = useState(true);
  const [showAddModal,setShowAddModal] = useState(false);

  const showToast = (msg,type="success") => setToast({message:msg,type});

  const filterAccounts = isAdmin
    ? Object.keys(authData.accounts || {})
    : [...new Set((session?.workspaces || []).map(w => w.account))];
  const filterLobs = filterAccount ? (authData.accounts?.[filterAccount]?.lobs || []) : [];

  const fetchRequirements = useCallback(()=>{
    setLoading(true);
    const headers = filterAccount ? { "X-Accounts": filterAccount } : {};
    fetch(`${API}/requirements-with-candidates`, { headers }).then(r=>r.json())
      .then(d=>{setData(d);setLoading(false);})
      .catch(e=>{console.error(e);setLoading(false);});
  },[filterAccount, isAdmin]);

  useEffect(()=>{fetchRequirements();},[fetchRequirements]);

  // data is already all roles from Dashboard — no candidate-name filtering needed
  const requirementRows = data;

  const filtered = requirementRows.filter(row=>{
    const text = search.toLowerCase();
    const matchSearch =
      (row["Role"]||"").toLowerCase().includes(text)||
      (row["Manager"]||"").toLowerCase().includes(text)||
      (row["Position Code"]||"").toString().toLowerCase().includes(text)||
      (row["Location"]||"").toLowerCase().includes(text);
    const matchType    = typeFilter ? (row["New/Replacement"]||"").toLowerCase()===typeFilter.toLowerCase() : true;
    const matchAccount = filterAccount ? (row["_account_name"]||"") === filterAccount : true;
    const matchLob     = filterLob ? (row["lob_name"]||"") === filterLob : true;
    return matchSearch && matchType && matchAccount && matchLob;
  }).reverse();

  const replacementCount = requirementRows.filter(r=>(r["New/Replacement"]||"").toLowerCase()==="replacement").length;
  const newCount         = requirementRows.length - replacementCount;

  const handleDelete = async (role)=>{
    try {
      const res = await fetch(`${API}/delete-position?role=${encodeURIComponent(role)}`,{method:"DELETE"});
      const json = await res.json();
      if (!res.ok){ showToast(json.detail||"Delete failed","error"); return; }
      setDeleteTarget(null);
      fetchRequirements();
      showToast(`"${role}" deleted · ${json.candidates_retained} candidate(s) retained, ${json.candidates_auto_deleted} auto-removed`);
    } catch { showToast("Network error","error"); }
  };

  const handleSave = async (formData,original,skills,jobDescription,selAccount,selLob)=>{
    const rawCode = (formData["Position Code"]||"").toString().trim();
    if (!rawCode){showToast("Position Code is required.","error");return;}
    try {
      const excelPayload = {};
      EDITABLE_FIELDS.forEach(({key})=>{
        let val = formData[key]??"";
        if (key==="Position Code"&&val!==""){const n=parseFloat(String(val).trim());val=isNaN(n)?val:n;}
        if (key==="# of Position"&&val!==""){const n=parseInt(String(val).trim(),10);val=isNaN(n)?val:n;}
        excelPayload[key]=val;
      });
      excelPayload["_original_position_code"]=(original["Position Code"]||"").toString().trim();
      if (selAccount) excelPayload["account_name"] = selAccount;
      if (selLob !== undefined) excelPayload["lob_name"] = selLob;
      const res = await fetch(`${API}/update-new-requirement`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(excelPayload)});
      if (!res.ok){let msg="Save failed";try{const err=await res.json();msg=err.detail||msg;}catch{}showToast(msg,"error");return;}
      await fetch(`${API}/update-position-skills`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({position_code:formData["Position Code"]||"",role:formData["Role"]||"",skills,job_description:jobDescription})});
      setEditingRow(null);fetchRequirements();showToast("Requirement updated successfully ✅");
    } catch(err){console.error(err);showToast("Network error. Is the backend running?","error");}
  };

  const panelOpen = expandedRow !== null && !!filtered[expandedRow];
  const sharedStyles = (
    <style>{`
      @keyframes spin   { to { transform: rotate(360deg); } }
      @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      ::-webkit-scrollbar { width:8px; height:8px; }
      ::-webkit-scrollbar-track { background:var(--l03); border-radius:6px; }
      ::-webkit-scrollbar-thumb { background:rgba(10,102,194,0.55); border-radius:6px; border:1px solid rgba(10,102,194,0.2); }
      ::-webkit-scrollbar-thumb:hover { background:rgba(10,102,194,0.85); }
    `}</style>
  );
  const modals = (
    <>
      {editingRow&&<EditModal row={editingRow} onSave={handleSave} onCancel={()=>setEditingRow(null)}/>}
      {deleteTarget&&<DeleteConfirmModal role={deleteTarget} candidateCount={(requirementRows.find(r=>r["Role"]===deleteTarget)||{})["_candidate_count"]||0} onConfirm={()=>handleDelete(deleteTarget)} onCancel={()=>setDeleteTarget(null)}/>}
      {showAddModal&&<AddPositionModal onSave={()=>{setShowAddModal(false);fetchRequirements();showToast("Position added successfully ✅");}} onCancel={()=>setShowAddModal(false)}/>}
      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}
    </>
  );

  if (panelOpen) {
    const selRow = filtered[expandedRow];
    const replacementCount2 = requirementRows.filter(r=>(r["New/Replacement"]||"").toLowerCase()==="replacement").length;
    const newCount2 = requirementRows.length - replacementCount2;
    return (
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", position:"relative" }}>
        {sharedStyles}
        <div style={S.gridOverlay}/>

        {/* ── LEFT COLUMN ── */}
        <div style={{ width:"50%", display:"flex", flexDirection:"column", borderRight:"1px solid var(--l07)", overflow:"hidden", position:"relative", zIndex:1 }}>

          {/* Compact header */}
          <div style={{ padding:"12px 18px 10px", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:10 }}>
              <div>
                <div style={{ color:"#004182", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1.5, marginBottom:1 }}>ATS · Positions</div>
                <h1 style={{ color:"var(--t1)", fontSize:17, fontWeight:800, margin:0, letterSpacing:0 }}>Position Management</h1>
              </div>
              <button onClick={()=>setShowAddModal(true)}
                style={{ padding:"7px 14px", background:"linear-gradient(135deg,#0A66C2,#004182)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, boxShadow:"0 4px 12px rgba(10,102,194,0.25)", whiteSpace:"nowrap", flexShrink:0 }}
                onMouseEnter={e=>e.currentTarget.style.opacity="0.88"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                + Add Position
              </button>
            </div>

            {/* Compact stats */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:10 }}>
              {[
                { label:"Total",        value:requirementRows.length, color:"#0A66C2" },
                { label:"New",          value:newCount2,              color:"#168740" },
                { label:"Replacements", value:replacementCount2,      color:"#38434F" },
              ].map(s=>(
                <div key={s.label} style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:10, padding:"8px 12px", position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", top:-12, right:-12, width:40, height:40, borderRadius:"50%", background:s.color+"22", filter:"blur(10px)" }}/>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"var(--t3)", marginBottom:3 }}>{s.label}</div>
                  <div style={{ fontSize:24, fontWeight:800, color:s.color, lineHeight:1, letterSpacing:-1 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Compact filters + search */}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {[
                  {label:`All·${requirementRows.length}`,value:"",color:"#0A66C2",bg:"rgba(10,102,194,0.2)",border:"rgba(10,102,194,0.4)"},
                  {label:`New·${newCount2}`,value:"new",color:"#168740",bg:"rgba(22,135,64,0.15)",border:"rgba(22,135,64,0.35)"},
                  {label:`Replacement·${replacementCount2}`,value:"replacement",color:"#38434F",bg:"rgba(56,67,79,0.15)",border:"rgba(56,67,79,0.35)"},
                ].map(pill=>{
                  const active=typeFilter===pill.value;
                  return (
                    <button key={pill.value} onClick={()=>setTypeFilter(active?"":pill.value)}
                      style={{ padding:"3px 10px", borderRadius:20, cursor:"pointer", fontSize:10, fontWeight:700, background:active?pill.bg:"var(--l03)", color:active?pill.color:"var(--t3)", border:`1px solid ${active?pill.border:"var(--l08)"}`, display:"flex", alignItems:"center", gap:3 }}>
                      {active&&<GlowDot color={pill.color} size={4}/>}{pill.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {filterAccounts.length > 0 && (
                  <select value={filterAccount} onChange={e=>{setFilterAccount(e.target.value);setFilterLob("");}}
                    style={{ flex:"0 0 auto", padding:"5px 8px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:filterAccount?"#0A66C2":"var(--t3)", fontSize:11, fontWeight:filterAccount?700:400, outline:"none", cursor:"pointer" }}>
                    <option value="">All accounts</option>
                    {filterAccounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
                  </select>
                )}
                {filterLobs.length > 0 && (
                  <select value={filterLob} onChange={e=>setFilterLob(e.target.value)}
                    style={{ flex:"0 0 auto", padding:"5px 8px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:filterLob?"#0A66C2":"var(--t3)", fontSize:11, fontWeight:filterLob?700:400, outline:"none", cursor:"pointer" }}>
                    <option value="">All LOBs</option>
                    {filterLobs.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
                  </select>
                )}
                <div style={{ position:"relative", flex:1 }}>
                  <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--t3)", fontSize:12, pointerEvents:"none" }}>⌕</span>
                  <input type="text" placeholder="Search role, manager, location..." value={search} onChange={e=>setSearch(e.target.value)}
                    style={{ padding:"6px 10px 6px 28px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:12, width:"100%", outline:"none", boxSizing:"border-box" }}
                    onFocus={e=>e.target.style.borderColor="rgba(10,102,194,0.5)"} onBlur={e=>e.target.style.borderColor="var(--l08)"}/>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable table */}
          <div style={{ flex:1, overflow:"auto", borderTop:"1px solid var(--l07)" }}>
            {loading ? (
              <div style={{ textAlign:"center", padding:"60px 0" }}><div style={S.spinner}/></div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:"60px 0", color:"var(--t3)", fontSize:13 }}>No requirements found</div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                <thead>
                  <tr>
                    {MAIN_COLUMNS.map(col=>(
                      <th key={col.key} style={{ width:col.width, padding:"10px 14px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", whiteSpace:"nowrap", position:"sticky", top:0, zIndex:3 }}>{col.label}</th>
                    ))}
                    <th style={{ width:"7%", padding:"10px 14px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", position:"sticky", top:0, zIndex:3 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row,index)=>{
                    const isSel = expandedRow===index;
                    const isNew = (row["New/Replacement"]||"").toLowerCase()==="new";
                    const accentColor = isNew?"#168740":"#38434F";
                    return (
                      <tr key={`req-${index}`} onClick={()=>setExpandedRow(isSel?null:index)}
                        style={{ borderBottom:"1px solid var(--l05)", cursor:"pointer",
                          background:isSel?"rgba(10,102,194,0.08)":"transparent",
                          borderLeft:isSel?"3px solid #0A66C2":"3px solid transparent" }}
                        onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background="var(--l03)";}}
                        onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background="transparent";}}>
                        <td style={{ padding:"10px 14px", overflow:"hidden" }}>
                          <span style={{ color:"#0A66C2", fontWeight:700, fontSize:11, fontFamily:"monospace", background:"rgba(10,102,194,0.08)", border:"1px solid rgba(10,102,194,0.18)", borderRadius:6, padding:"2px 6px" }}>{row["Position Code"]||"—"}</span>
                        </td>
                        <td style={{ padding:"10px 14px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:3, height:28, borderRadius:2, background:`linear-gradient(180deg,${accentColor},transparent)`, flexShrink:0 }}/>
                            <span style={{ color:"var(--t1)", fontWeight:700, fontSize:12, overflow:"hidden", textOverflow:"ellipsis" }}>{row["Role"]||"—"}</span>
                          </div>
                        </td>
                        <td style={{ padding:"10px 14px", fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["Manager"]||"—"}</td>
                        <td style={{ padding:"10px 14px", fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["Location"]||"—"}</td>
                        <td style={{ padding:"10px 14px" }}><span style={{ color:"#168740", fontWeight:800, fontSize:18 }}>{row["# of Position"]||"0"}</span></td>
                        <td style={{ padding:"10px 14px" }}><TypeBadge value={row["New/Replacement"]}/></td>
                        <td style={{ padding:"10px 14px" }}>
                          {(row["_candidate_count"]||0)>0
                            ? <span style={{ color:"#0A66C2", fontSize:12, fontWeight:600 }}>{row["_candidate_count"]} submitted</span>
                            : <span style={{ color:"var(--t3)", fontSize:12 }}>None yet</span>}
                        </td>
                        <td style={{ padding:"10px 14px", fontSize:11, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["_account_name"]||"—"}</td>
                        <td style={{ padding:"10px 14px", fontSize:11, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["lob_name"]||"—"}</td>
                        <td style={{ padding:"10px 14px" }}>
                          <button onClick={e=>{e.stopPropagation();setDeleteTarget(row["Role"]);}}
                            style={{ padding:"4px 8px", background:"rgba(204,16,22,0.07)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:7, cursor:"pointer", fontSize:12 }}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(204,16,22,0.18)"}
                            onMouseLeave={e=>e.currentTarget.style.background="rgba(204,16,22,0.07)"}> ✕ </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ width:"50%", overflow:"hidden", display:"flex", flexDirection:"column", position:"relative", zIndex:1 }}>
          <PositionPanel
            row={selRow}
            onEdit={()=>{ setEditingRow(selRow); setExpandedRow(null); }}
            onDelete={()=>setDeleteTarget(selRow["Role"])}
            onClose={()=>setExpandedRow(null)}
          />
        </div>

        {modals}
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:var(--l03); border-radius:6px; }
        ::-webkit-scrollbar-thumb { background:rgba(10,102,194,0.55); border-radius:6px; border:1px solid rgba(10,102,194,0.2); }
        ::-webkit-scrollbar-thumb:hover { background:rgba(10,102,194,0.85); }
        input[type="date"]::-webkit-calendar-picker-indicator { filter:invert(0.5); }
      `}</style>
      <div style={S.gridOverlay}/>

      {/* HEADER */}
      <div style={{marginBottom:14,position:"relative",zIndex:1,animation:"fadeUp 0.4s ease",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,padding:"0 36px"}}>
        <div>
          <div style={{color:"#004182",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:2,marginBottom:2}}>ATS · Positions</div>
          <h1 style={{color:"var(--t1)",fontSize:20,fontWeight:800,margin:0,letterSpacing:0}}>Position Management</h1>
        </div>
        <button onClick={()=>setShowAddModal(true)}
          style={{padding:"8px 16px",background:"linear-gradient(135deg,#0A66C2,#004182)",color:"white",border:"none",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:12,boxShadow:"0 4px 12px rgba(10,102,194,0.3)",whiteSpace:"nowrap",flexShrink:0}}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.88"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          + Add Position
        </button>
      </div>

      {/* FILTER + SEARCH */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12,flexWrap:"wrap",position:"relative",zIndex:1,padding:"0 36px"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[
            {label:`All · ${requirementRows.length}`,value:"",       color:"#0A66C2",bg:"rgba(10,102,194,0.2)", border:"rgba(10,102,194,0.4)", glow:"rgba(10,102,194,0.2)" },
            {label:`New · ${newCount}`,               value:"new",   color:"#168740",bg:"rgba(22,135,64,0.15)",border:"rgba(22,135,64,0.35)",glow:"rgba(22,135,64,0.2)" },
            {label:`Replacement · ${replacementCount}`,value:"replacement",color:"#38434F",bg:"rgba(56,67,79,0.15)",border:"rgba(56,67,79,0.35)",glow:"rgba(56,67,79,0.2)"},
          ].map(pill=>{
            const active=typeFilter===pill.value;
            return (
              <button key={pill.value} onClick={()=>setTypeFilter(active?"":pill.value)}
                style={{padding:"5px 14px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:700,background:active?pill.bg:"var(--l03)",color:active?pill.color:"var(--t3)",border:`1px solid ${active?pill.border:"var(--l08)"}`,boxShadow:active?`0 0 12px ${pill.glow}`:"none",display:"flex",alignItems:"center",gap:5}}>
                {active&&<GlowDot color={pill.color} size={5}/>}
                {pill.label}
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          {filterAccounts.length > 0 && (
            <select value={filterAccount} onChange={e=>{setFilterAccount(e.target.value);setFilterLob("");}}
              style={{padding:"8px 10px",background:"var(--l04)",border:"1px solid var(--l08)",borderRadius:10,color:filterAccount?"#0A66C2":"var(--t3)",fontSize:12,fontWeight:filterAccount?700:400,outline:"none",cursor:"pointer"}}>
              <option value="">All accounts</option>
              {filterAccounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
            </select>
          )}
          {filterLobs.length > 0 && (
            <select value={filterLob} onChange={e=>setFilterLob(e.target.value)}
              style={{padding:"8px 10px",background:"var(--l04)",border:"1px solid var(--l08)",borderRadius:10,color:filterLob?"#0A66C2":"var(--t3)",fontSize:12,fontWeight:filterLob?700:400,outline:"none",cursor:"pointer"}}>
              <option value="">All LOBs</option>
              {filterLobs.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
            </select>
          )}
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"var(--t3)",fontSize:14,pointerEvents:"none"}}>⌕</span>
            <input type="text" placeholder="Search role, manager, location..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{padding:"9px 14px 9px 34px",background:"var(--l04)",border:"1px solid var(--l08)",borderRadius:10,color:"var(--t1)",fontSize:13,width:250,outline:"none"}}
              onFocus={e=>e.target.style.borderColor="rgba(10,102,194,0.5)"}
              onBlur={e=>e.target.style.borderColor="var(--l08)"}/>
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div style={{flex:1,minHeight:0,background:"var(--l02)",borderTop:"1px solid var(--l07)",overflow:"auto",position:"relative",zIndex:1}}>
        {loading?(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={S.spinner}/>
            <div style={{color:"#004182",fontSize:14,fontWeight:700,marginTop:20}}>Loading requirements...</div>
          </div>
        ):filtered.length===0?(
          <div style={{textAlign:"center",padding:"80px 0"}}>
            <div style={{fontSize:48,marginBottom:12,opacity:0.12,color:"#0A66C2"}}>◈</div>
            <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No requirements found</div>
            <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>Adjust your search or filter</div>
          </div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
            <thead>
              <tr>
                {/* table headers bumped #334155 → #64748b */}
                {MAIN_COLUMNS.map(col=>(
                  <th key={col.key} style={{width:col.width,padding:"14px 18px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,background:"var(--hdr-bg)",borderBottom:"1px solid var(--l08)",color:"var(--t3)",whiteSpace:"nowrap",position:"sticky",top:0,zIndex:3}}>
                    {col.label}
                  </th>
                ))}
                <th style={{width:"6%",padding:"14px 18px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,background:"var(--hdr-bg)",borderBottom:"1px solid var(--l08)",color:"var(--t3)",position:"sticky",top:0,zIndex:3}}>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row,index)=>{
                const isExpanded  = expandedRow===index;
                const isNew       = (row["New/Replacement"]||"").toLowerCase()==="new";
                const accentColor = isNew?"#168740":"#38434F";
                return (
                  <React.Fragment key={`req-${index}`}>
                    <tr onClick={()=>setExpandedRow(isExpanded?null:index)}
                      style={{borderBottom:isExpanded?"none":"1px solid var(--l05)",cursor:"pointer",background:isExpanded?"rgba(10,102,194,0.05)":"transparent",transition:"background 0.15s"}}
                      onMouseEnter={e=>{if(!isExpanded)e.currentTarget.style.background="var(--l03)";}}
                      onMouseLeave={e=>{if(!isExpanded)e.currentTarget.style.background="transparent";}}>
                      <td style={{padding:"14px 18px",overflow:"hidden"}}>
                        <span style={{color:"#0A66C2",fontWeight:700,fontSize:13,fontFamily:"monospace",background:"rgba(10,102,194,0.08)",border:"1px solid rgba(10,102,194,0.18)",borderRadius:6,padding:"2px 8px"}}>
                          {row["Position Code"]||"—"}
                        </span>
                      </td>
                      <td style={{padding:"14px 18px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:3,height:32,borderRadius:2,background:`linear-gradient(180deg,${accentColor},transparent)`,flexShrink:0}}/>
                          <span style={{color:"var(--t1)",fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis"}}>{row["Role"]||"—"}</span>
                        </div>
                      </td>
                      {/* manager/location bumped #64748b → #94a3b8 for better visibility */}
                      <td style={{padding:"14px 18px",fontSize:13,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row["Manager"]||"—"}</td>
                      <td style={{padding:"14px 18px",fontSize:13,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row["Location"]||"—"}</td>
                      <td style={{padding:"14px 18px"}}>
                        <span style={{color:"#168740",fontWeight:800,fontSize:20,textShadow:"0 0 12px rgba(22,135,64,0.4)"}}>{row["# of Position"]||"0"}</span>
                      </td>
                      <td style={{padding:"14px 18px"}}><TypeBadge value={row["New/Replacement"]}/></td>
                      <td style={{padding:"14px 18px"}}>
                        {(row["_candidate_count"]||0)>0
                          ? <span style={{color:"#0A66C2",fontSize:12,fontWeight:600}}>{row["_candidate_count"]} submitted</span>
                          : <span style={{color:"var(--t3)",fontSize:12}}>None yet</span>}
                      </td>
                      <td style={{padding:"14px 18px",fontSize:12,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row["_account_name"]||"—"}</td>
                      <td style={{padding:"14px 18px",fontSize:12,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row["lob_name"]||"—"}</td>
                      <td style={{padding:"14px 18px"}}>
                        <button onClick={e=>{e.stopPropagation();setDeleteTarget(row["Role"]);}}
                          style={{padding:"5px 10px",background:"rgba(204,16,22,0.08)",color:"#CC1016",border:"1px solid rgba(204,16,22,0.2)",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700}}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(204,16,22,0.18)"}
                          onMouseLeave={e=>e.currentTarget.style.background="rgba(204,16,22,0.08)"}>
                          ✕
                        </button>
                      </td>
                    </tr>
                    {isExpanded&&(
                      <DetailPanel row={row} onEdit={()=>{setEditingRow(row);setExpandedRow(null);}}/>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editingRow&&<EditModal row={editingRow} onSave={handleSave} onCancel={()=>setEditingRow(null)}/>}
      {deleteTarget&&(
        <DeleteConfirmModal
          role={deleteTarget}
          candidateCount={(requirementRows.find(r=>r["Role"]===deleteTarget)||{})["_candidate_count"]||0}
          onConfirm={()=>handleDelete(deleteTarget)}
          onCancel={()=>setDeleteTarget(null)}
        />
      )}
      {showAddModal&&<AddPositionModal onSave={()=>{setShowAddModal(false);fetchRequirements();showToast("Position added successfully ✅");}} onCancel={()=>setShowAddModal(false)}/>}
      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}
    </div>
  );
}

const S = {
  root:{ height:"100vh", display:"flex", flexDirection:"column", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", padding:"16px 0 0", position:"relative", overflowX:"hidden" },
  gridOverlay:{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:`linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px)`, backgroundSize:"40px 40px" },
  overlay:{ position:"fixed", inset:0, background:"var(--overlay-bg)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 },
  modal:{ background:"var(--pg-bg)", border:"1px solid var(--l09)", borderRadius:22, width:"100%", maxWidth:480, maxHeight:"92vh", overflowY:"auto", boxShadow:"0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(10,102,194,0.1)" },
  modalHead:{ padding:"22px 24px 18px", borderBottom:"1px solid var(--l07)", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"var(--pg-bg)", borderRadius:"22px 22px 0 0", zIndex:1 },
  eyebrow:{ color:"#0A66C2", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2 },
  closeBtn:{ background:"var(--l04)", border:"1px solid var(--l07)", color:"var(--t3)", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" },
  /* sectionLabel bumped #334155 → #64748b — fixes ROLE, POSITION CODE, OPEN POSITIONS, TYPE, POSITION FILL RATE, WIPPX, CATEGORY etc. */
  sectionLabel:{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:10 },
  formField:{ width:"100%", padding:"10px 12px", marginBottom:4, background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:13, outline:"none", boxSizing:"border-box" },
  spinner:{ width:28, height:28, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.15)", borderTopColor:"#0A66C2", animation:"spin 0.7s linear infinite", margin:"0 auto" },
};

