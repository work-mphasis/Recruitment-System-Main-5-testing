import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL ?? "";

const AVATAR_PALETTE = [
  ["#0A66C2","#0A66C2"], ["#0ea5e9","#0A66C2"], ["#168740","#168740"],
  ["#38434F","#56687A"], ["#0A66C2","#f472b6"], ["#0A66C2","#a78bfa"],
  ["#14b8a6","#2dd4bf"], ["#f97316","#fb923c"],
];
function avatarColors(name = "") {
  let h = 0; for (let c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function initials(name = "") {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getScoreStyle(score) {
  if (score >= 75) return { color: "#168740", bg: "rgba(22,135,64,0.1)",  border: "rgba(22,135,64,0.25)",  label: "Strong match"  };
  if (score >= 50) return { color: "#38434F", bg: "rgba(56,67,79,0.1)",  border: "rgba(56,67,79,0.25)",  label: "Partial match" };
  return               { color: "#CC1016", bg: "rgba(204,16,22,0.1)", border: "rgba(204,16,22,0.25)", label: "Low match"     };
}

function GlowDot({ color, size = 7 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, boxShadow:`0 0 ${size}px ${color}`, flexShrink:0 }} />;
}

function ResumeButton({ href, label, disabled = false }) {
  const style = {
    flex: 1,
    padding: "9px",
    borderRadius: 9,
    fontWeight: 600,
    fontSize: 12,
    textDecoration: "none",
    textAlign: "center",
    display: "block",
    transition: "all 0.15s",
  };

  if (disabled) {
    return (
      <span style={{ ...style, background:"var(--l03)", color:"var(--t4)", border:"1px solid var(--l06)" }}>
        {label}
      </span>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ ...style, background:"var(--l04)", color:"var(--t3)", border:"1px solid var(--l07)" }}
      onMouseEnter={e=>{e.currentTarget.style.background="var(--l08)";e.currentTarget.style.color="var(--t2)";}}
      onMouseLeave={e=>{e.currentTarget.style.background="var(--l04)";e.currentTarget.style.color="var(--t3)";}}>
      {label}
    </a>
  );
}

function ScoreRing({ score }) {
  const { color, label } = getScoreStyle(score);
  const r = 44, circ = 2 * Math.PI * r;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ position:"relative", width:108, height:108 }}>
        <svg width="108" height="108" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="54" cy="54" r={r} fill="none" style={{ stroke:"var(--l06)" }} strokeWidth="8" />
          <circle cx="54" cy="54" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={circ-(score/100)*circ}
            strokeLinecap="round" style={{ transition:"stroke-dashoffset 1.2s ease", filter:`drop-shadow(0 0 6px ${color})` }} />
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:26, fontWeight:800, color, lineHeight:1 }}>{score}</span>
          <span style={{ fontSize:10, color:"var(--t4)", marginTop:2 }}>/100</span>
        </div>
      </div>
      <span style={{ marginTop:8, fontSize:11, fontWeight:700, color, letterSpacing:0.5, textTransform:"uppercase" }}>{label}</span>
    </div>
  );
}

function BreakdownBar({ label, score, maxScore, color, reasoning }) {
  const pct = Math.round((score/maxScore)*100);
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:12, color:"var(--t3)", fontWeight:500 }}>{label}</span>
        <span style={{ fontSize:12, color, fontWeight:700 }}>{score}/{maxScore}</span>
      </div>
      <div style={{ height:5, background:"var(--l05)", borderRadius:3, overflow:"hidden", marginBottom:4 }}>
        <div style={{ height:"100%", borderRadius:3, width:`${pct}%`, background:color, boxShadow:`0 0 8px ${color}`, transition:"width 1s ease" }} />
      </div>
      {reasoning && <div style={{ fontSize:11, color:"var(--t3)", fontStyle:"italic", lineHeight:1.5 }}>{reasoning}</div>}
    </div>
  );
}

function SkillPill({ skill, missing }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", margin:"2px 3px", padding:"3px 10px", background:missing?"rgba(204,16,22,0.08)":"rgba(22,135,64,0.08)", color:missing?"#CC1016":"#168740", border:`1px solid ${missing?"rgba(204,16,22,0.2)":"rgba(22,135,64,0.2)"}`, borderRadius:20, fontSize:11, fontWeight:600 }}>
      {skill}
    </span>
  );
}

function AIMatchPanel({ result }) {
  const ss   = getScoreStyle(result.overall);
  const isAI = result.source === "ollama";
  return (
    <div style={{ background:"var(--l03)", border:`1px solid ${ss.border}`, borderRadius:16, overflow:"hidden", marginBottom:20, boxShadow:`0 0 24px ${ss.bg}` }}>
      <div style={{ display:"grid", gridTemplateColumns:"130px 1fr", borderBottom:"1px solid var(--l06)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 0", borderRight:"1px solid var(--l06)", background:ss.bg }}>
          <ScoreRing score={result.overall} />
        </div>
        <div style={{ padding:"20px 24px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"var(--t4)", textTransform:"uppercase", letterSpacing:0.8 }}>Score breakdown</span>
            <span style={{ padding:"2px 10px", background:isAI?"rgba(10,102,194,0.15)":"rgba(100,116,139,0.1)", color:isAI?"#0A66C2":"var(--t3)", border:`1px solid ${isAI?"rgba(10,102,194,0.25)":"rgba(100,116,139,0.2)"}`, borderRadius:20, fontSize:11, fontWeight:700 }}>
              {isAI?`AI · ${result.model||"ollama"}`:"Keyword"}
            </span>
            {result.cached && <span style={{ padding:"2px 8px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)", borderRadius:20, fontSize:10, fontWeight:700 }}>⚡ Cached</span>}
          </div>
          <BreakdownBar label="Skills"     score={result.skills?.score??0}    maxScore={60} color="#0A66C2" reasoning={result.skills?.reasoning} />
          <BreakdownBar label="Experience" score={result.experience?.score??0} maxScore={20} color="#168740" reasoning={result.experience?.reasoning} />
          <BreakdownBar label="Context"    score={result.context?.score??0}    maxScore={20} color="#0A66C2" reasoning={result.context?.reasoning} />
          {result.experience?.years_detected && (
            <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:6, padding:"3px 10px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)", borderRadius:20, fontSize:11, fontWeight:600 }}>
              <GlowDot color="#168740" size={5}/> {result.experience.years_detected} yrs detected
            </div>
          )}
        </div>
      </div>
      {result.summary && (
        <div style={{ padding:"12px 20px", background:"rgba(10,102,194,0.04)", borderBottom:"1px solid var(--l07)", fontSize:13, color:"var(--t3)", lineHeight:1.6, fontStyle:isAI?"normal":"italic" }}>
          {isAI?"AI: ":""}{result.summary}
        </div>
      )}
      {(result.skills?.matched?.length>0||result.skills?.missing?.length>0)&&(
        <div style={{ padding:"14px 20px" }}>
          {result.skills.matched?.length>0&&<div style={{ marginBottom:12 }}><div style={{ fontSize:10, fontWeight:700, color:"#168740", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Matched ({result.skills.matched.length})</div><div>{result.skills.matched.map(s=><SkillPill key={s} skill={s}/>)}</div></div>}
          {result.skills.missing?.length>0&&<div><div style={{ fontSize:10, fontWeight:700, color:"#CC1016", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Missing ({result.skills.missing.length})</div><div>{result.skills.missing.map(s=><SkillPill key={s} skill={s} missing/>)}</div></div>}
        </div>
      )}
    </div>
  );
}

function OllamaStatus({ status }) {
  if (!status||(status.running&&status.models?.length>0)) return null;
  return (
    <div style={{ padding:"10px 16px", marginBottom:20, background:status.running?"rgba(56,67,79,0.08)":"rgba(204,16,22,0.08)", border:`1px solid ${status.running?"rgba(56,67,79,0.25)":"rgba(204,16,22,0.25)"}`, borderRadius:10, fontSize:12, color:status.running?"#38434F":"#CC1016", display:"flex", alignItems:"center", gap:8 }}>
      <GlowDot color={status.running?"#38434F":"#CC1016"} size={6}/>
      {!status.running?"Ollama is not running — summaries will use keyword fallback. Start with: ollama serve":"Ollama is running but no models are pulled. Run: ollama pull llama3"}
    </div>
  );
}

function CacheProgressBar({ cacheStatus, regenerating }) {
  if (!cacheStatus) return null;
  const { total, done, pending } = cacheStatus;
  if (total === 0) return null;
  const pct    = Math.round((done / total) * 100);
  const allDone = pending === 0;
  return (
    <div style={{ marginBottom:20, padding:"12px 16px", background:"rgba(10,102,194,0.06)", border:`1px solid ${allDone?"rgba(22,135,64,0.25)":"rgba(10,102,194,0.2)"}`, borderRadius:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!allDone && regenerating && (
            <div style={{ width:12, height:12, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.2)", borderTopColor:"#0A66C2", animation:"spin 0.7s linear infinite", flexShrink:0 }} />
          )}
          <GlowDot color={allDone?"#168740":"#0A66C2"} size={6}/>
          <span style={{ fontSize:12, fontWeight:700, color:allDone?"#168740":"#0A66C2" }}>
            {allDone ? `All ${total} summaries ready` : `Generating summaries — ${done} / ${total} done`}
          </span>
        </div>
        <span style={{ fontSize:11, color:"var(--t4)" }}>{pct}% complete</span>
      </div>
      <div style={{ height:4, background:"var(--l05)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:allDone?"#168740":"linear-gradient(90deg,#0A66C2,#0A66C2)", borderRadius:2, boxShadow:allDone?"0 0 8px #168740":"0 0 8px #0A66C2", transition:"width 0.8s ease" }}/>
      </div>
      {!allDone && <div style={{ fontSize:11, color:"var(--t4)", marginTop:6 }}>{pending} resume{pending!==1?"s":""} remaining — open any candidate to see their updated summary as it completes.</div>}
    </div>
  );
}

function SkillGapPanel({ result }) {
  const gap = result?.rubric_gap;
  const analysis = gap?.skill_gap || gap;
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(() => {
    fetch(`${API}/talentnext-catalog/status`)
      .then(r=>r.json())
      .then(setCatalogStatus)
      .catch(()=>setCatalogStatus({ loaded:false, error:"Catalog status unavailable" }));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const refreshCatalog = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/talentnext-catalog/refresh`, { method:"POST" });
      setCatalogStatus(await res.json());
    } catch {
      setCatalogStatus({ loaded:false, error:"Catalog refresh failed" });
    } finally {
      setRefreshing(false);
    }
  };

  const groups = analysis?.groups || {};
  const groupEntries = [
    ["technical", "Technical"],
    ["non_technical", "Non-technical"],
    ["competency", "Competency"],
  ];
  const recommendations = analysis?.recommendations || [];

  return (
    <div style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:14, overflow:"hidden", marginBottom:20 }}>
      <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--l06)", background:"var(--l02)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <GlowDot color="#0A66C2" size={7}/>
          <span style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Skill Gap & Learning Path</span>
          {analysis?.rubric && (
            <span style={{ padding:"2px 8px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:20, fontSize:10, fontWeight:700 }}>
              {analysis.rubric.role} v{analysis.rubric.version}
            </span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ color:catalogStatus?.loaded?"#168740":"#38434F", fontSize:11, fontWeight:700 }}>
            {catalogStatus?.loaded ? `${catalogStatus.row_count || 0} TalentNext rows` : (catalogStatus?.error || "Catalog not loaded")}
          </span>
          <button onClick={refreshCatalog} disabled={refreshing}
            style={{ padding:"4px 12px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:8, cursor:refreshing?"default":"pointer", fontSize:11, fontWeight:700 }}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {!gap ? (
        <div style={{ padding:"18px 20px", color:"var(--t3)", fontSize:13, lineHeight:1.7 }}>
          No active rubric was found for this role yet. Activate a validated rubric from Requirements to unlock skill gap recommendations.
        </div>
      ) : (
        <div style={{ padding:20 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0, 1fr))", gap:10, marginBottom:16 }}>
            {groupEntries.map(([key, label]) => {
              const items = groups[key] || [];
              const gapItems = items.filter(item => item.gap_type && item.gap_type !== "met");
              return (
                <div key={key} style={{ background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, padding:12, minHeight:90 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <span style={{ color:"var(--t2)", fontSize:12, fontWeight:800 }}>{label}</span>
                    <span style={{ color:gapItems.length?"#38434F":"#168740", fontSize:11, fontWeight:800 }}>{gapItems.length}</span>
                  </div>
                  {gapItems.length ? (
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {gapItems.slice(0, 5).map(item => (
                        <div key={item.skill} style={{ fontSize:11, color:"var(--t3)", lineHeight:1.45 }}>
                          <b style={{ color:"var(--t2)" }}>{item.skill}</b>
                          <span style={{ color:"var(--t4)" }}> {item.observed_level || "Missing"} to {item.required_level}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:"var(--t4)", lineHeight:1.6 }}>No gaps detected in this group.</div>
                  )}
                </div>
              );
            })}
          </div>

          {recommendations.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {recommendations.map((rec, idx) => (
                <div key={`${rec.skill}-${idx}`} style={{ background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, padding:12 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginBottom:8 }}>
                    <div>
                      <div style={{ color:"var(--t2)", fontSize:13, fontWeight:800 }}>{rec.skill}</div>
                      <div style={{ color:"var(--t4)", fontSize:11, marginTop:2 }}>{rec.gap_type} gap in {rec.category || "General"}</div>
                    </div>
                    <span style={{ color:"#0A66C2", fontSize:11, fontWeight:800 }}>
                      {Math.round((rec.match_confidence || 0) * 100)}% match
                    </span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))", gap:8 }}>
                    {(rec.recommendations || []).slice(0, 3).map((course, courseIdx) => (
                      <div key={`${course.sub_skill}-${courseIdx}`} style={{ background:"var(--l03)", border:"1px solid var(--l06)", borderRadius:8, padding:"9px 10px" }}>
                        <div style={{ color:"var(--t2)", fontSize:12, fontWeight:800, marginBottom:6 }}>{course.sub_skill}</div>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {[course.proficiency, course.nomination_type, course.category].filter(Boolean).map(tag => (
                            <span key={tag} style={{ padding:"2px 7px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:20, fontSize:10, fontWeight:700 }}>{tag}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color:"var(--t4)", fontSize:12 }}>No TalentNext learning recommendations were produced for this resume.</div>
          )}
        </div>
      )}
    </div>
  );
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackScoreFromGap(gap, message = "AI score is still warming up; showing rubric-based fit.") {
  if (!gap) return { error: message };
  const technical = gap.groups?.technical || [];
  const nonTechnical = gap.groups?.non_technical || [];
  const competency = gap.groups?.competency || [];
  const totalWeight = arr => arr.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const totalScore = arr => arr.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return {
    overall: Math.round(gap.overall || 0),
    source: "rubric",
    model: "rubric",
    cached: false,
    summary: message,
    skills: {
      score: Math.round(totalScore(technical)),
      matched: technical.filter(item => item.gap_type === "met").map(item => item.skill),
      missing: (gap.gaps || []).map(item => item.skill),
      reasoning: gap.summary || "Rubric-based technical skill comparison.",
    },
    experience: {
      score: Math.round(totalScore(nonTechnical)),
      reasoning: `${nonTechnical.length} non-technical rubric item(s) evaluated.`,
    },
    context: {
      score: Math.round(totalScore(competency)),
      reasoning: `${competency.length} competency rubric item(s) evaluated.`,
    },
    rubric_gap: { skill_gap: gap },
    rubric_score: {
      overall: gap.overall,
      max_score: totalWeight([...technical, ...nonTechnical, ...competency]),
    },
  };
}

export default function Resumes() {
  const [data, setData]                           = useState([]);
  const [loading, setLoading]                     = useState(true);
  const [summary, setSummary]                     = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedRole, setSelectedRole]           = useState("");
  const [showModal, setShowModal]                 = useState(false);
  const [analyzing, setAnalyzing]                 = useState(false);
  const [search, setSearch]                       = useState("");
  const [aiResult, setAiResult]                   = useState(null);
  const [ollamaStatus, setOllamaStatus]           = useState(null);
  const [selectedModel, setSelectedModel]         = useState("llama3");
  const [jdCache, setJdCache]                     = useState({});
  const [cacheStatus, setCacheStatus]             = useState(null);
  const [regenerating, setRegenerating]           = useState(false);
  const pollRef                                   = useRef(null);
  const navigate = useNavigate();

  const fetchResumes = useCallback(() => {
    fetch(`${API}/resumes-list`).then(r=>r.json())
      .then(d=>{setData(d);setLoading(false);})
      .catch(()=>setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API}/ollama-status`).then(r=>r.json())
      .then(d=>{ setOllamaStatus(d); if(d.models?.length>0){setSelectedModel(d.models[0]);} })
      .catch(()=>setOllamaStatus({running:false,models:[]}));
  }, []);

  useEffect(() => {
    fetchResumes();
    const timer = setInterval(fetchResumes, 5000);
    return () => clearInterval(timer);
  }, [fetchResumes]);

  const fetchCacheStatus = async () => {
    try {
      const res = await fetch(`${API}/summary-cache-status`);
      const d   = await res.json();
      setCacheStatus(d);
      return d;
    } catch { return null; }
  };

  useEffect(() => { fetchCacheStatus(); }, []);

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const status = await fetchCacheStatus();
      if (status && status.pending === 0) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setRegenerating(false);
      }
    }, 4000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleRegenerateAll = async () => {
    if (!window.confirm(`This will regenerate summaries for all ${data.length} resumes. Continue?`)) return;
    setRegenerating(true);
    setCacheStatus(prev => prev ? { ...prev, done: 0, pending: prev.total } : null);
    try {
      await fetch(`${API}/regenerate-all-summaries`, { method: "POST" });
      startPolling();
    } catch (e) {
      console.error(e);
      setRegenerating(false);
    }
  };

  const getJD = async (role) => {
    if (!role) return "";
    if (jdCache[role] !== undefined) return jdCache[role];
    try {
      const res  = await fetch(`${API}/position-skills?role=${encodeURIComponent(role)}`);
      const data = await res.json();
      const jd   = data.job_description || "";
      setJdCache(prev => ({ ...prev, [role]: jd }));
      return jd;
    } catch { return ""; }
  };

  const closeModal = () => { setShowModal(false); setSummary(""); setAiResult(null); };

  // ── Cache-first: instant on 2nd click, spinner only on 1st ──
  const handleAnalyse = async (filename, candidateName, candidateRole = "") => {
    setSelectedCandidate(candidateName);
    setSelectedRole(candidateRole);
    setShowModal(true);

    try {
      const gapPromise = candidateRole
        ? fetch(`${API}/skill-gap-analysis/${encodeURIComponent(filename)}?role=${encodeURIComponent(candidateRole)}`)
            .then(r=>r.ok ? r.json() : null)
            .catch(()=>null)
        : Promise.resolve(null);

      // Check both caches before deciding to show spinner
      const [scoreStatus, cacheStatusRes] = await Promise.all([
        fetch(`${API}/ai-score-status/${filename}`).then(r=>r.json()).catch(()=>({ready:false})),
        fetch(`${API}/summary-cache-status`).then(r=>r.json()).catch(()=>({pending_files:[filename]})),
      ]);

      const summaryReady = cacheStatusRes.pending_files
        ? !cacheStatusRes.pending_files.includes(filename)
        : false;

      if (scoreStatus.ready && summaryReady) {
        // ── Both cached — load instantly, NO spinner ──
        setAnalyzing(false);
        const [scoreData, summaryRes, gapData] = await Promise.all([
          fetchJsonWithTimeout(`${API}/ai-profile-score/${encodeURIComponent(filename)}?role=${encodeURIComponent(candidateRole)}&model=${encodeURIComponent(selectedModel)}`)
            .catch(()=>null),
          fetch(`${API}/generate-summary/${filename}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_description: "", force_refresh: false }),
          }),
          gapPromise,
        ]);
        setAiResult(scoreData
          ? (gapData && !scoreData.rubric_gap ? { ...scoreData, rubric_gap:{ skill_gap:gapData } } : scoreData)
          : fallbackScoreFromGap(gapData));
        const sd = await summaryRes.json();
        setSummary(sd.summary || "");
        return;
      }

      // ── Not cached yet — show spinner and generate ──
      setAnalyzing(true);
      setSummary("");
      setAiResult(null);

      const [jdText, scoreData, gapData] = await Promise.all([
        getJD(candidateRole),
        fetchJsonWithTimeout(`${API}/ai-profile-score/${encodeURIComponent(filename)}?role=${encodeURIComponent(candidateRole)}&model=${encodeURIComponent(selectedModel)}`)
          .catch(()=>null),
        gapPromise,
      ]);
      setAiResult(scoreData
        ? (gapData && !scoreData.rubric_gap ? { ...scoreData, rubric_gap:{ skill_gap:gapData } } : scoreData)
        : fallbackScoreFromGap(gapData));
      setAnalyzing(false);

      const summaryRes = await fetch(`${API}/generate-summary/${filename}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ job_description: jdText, force_refresh: false }),
      });
      if (summaryRes.ok) {
        const sd = await summaryRes.json();
        setSummary(sd.summary || "");
      } else {
        const sd = await fetch(`${API}/generate-summary/${filename}`).then(r=>r.json());
        setSummary(sd.summary || "");
      }
    } catch (err) {
      console.error("[Resumes] handleAnalyse:", err);
      setSummary("Error generating analysis. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRefreshSummary = async () => {
    if (!selectedCandidate) return;
    const filename = selectedCandidate.replace(/ /g, "_") + ".docx";
    setAnalyzing(true);
    try {
      const jdText = await getJD(selectedRole);
      const res    = await fetch(`${API}/generate-summary/${filename}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ job_description: jdText, force_refresh: true }),
      });
      const sd = await res.json();
      setSummary(sd.summary || "");
      fetchCacheStatus();
    } catch (e) { console.error(e); }
    finally { setAnalyzing(false); }
  };

  const handleRetrySanitization = async (candidateName) => {
    try {
      await fetch(`${API}/reformat-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_name: candidateName }),
      });
      fetchResumes();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = data.filter(r => r.candidate.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-thumb { background:rgba(10,102,194,0.3); border-radius:4px; }
      `}</style>
      <div style={S.gridOverlay}/>

      {/* HEADER */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:28, position:"relative", zIndex:1, animation:"fadeUp 0.4s ease", flexWrap:"wrap", gap:16 }}>
        <div>
          <button onClick={()=>navigate("/")} style={{ background:"var(--l04)", border:"1px solid var(--l08)", color:"var(--t3)", padding:"7px 16px", borderRadius:8, cursor:"pointer", fontSize:13, marginBottom:16, display:"inline-flex", alignItems:"center", gap:6 }}
            onMouseEnter={e=>{e.currentTarget.style.background="var(--l08)";e.currentTarget.style.color="var(--t2)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="var(--l04)";e.currentTarget.style.color="var(--t3)";}}>
            â† Dashboard
          </button>
          <div style={{ color:"#004182", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:2, marginBottom:6 }}>ATS · Resumes</div>
          <h1 style={{ color:"var(--t1)", fontSize:30, fontWeight:800, margin:0, letterSpacing:-1 }}>Resume Intelligence</h1>
          <p style={{ color:"var(--t4)", margin:"6px 0 0", fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
            {data.length} resume{data.length!==1?"s":""} on file
            {ollamaStatus?.running&&(
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 10px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)", borderRadius:20, fontSize:11, fontWeight:700 }}>
                <GlowDot color="#168740" size={5}/> Ollama ready
              </span>
            )}
          </p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:10 }}>
          <button onClick={handleRegenerateAll} disabled={regenerating}
            style={{ padding:"9px 18px", background:regenerating?"rgba(10,102,194,0.1)":"linear-gradient(135deg,#0A66C2,#004182)", color:regenerating?"#004182":"white", border:`1px solid ${regenerating?"rgba(10,102,194,0.3)":"transparent"}`, borderRadius:10, cursor:regenerating?"not-allowed":"pointer", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", gap:7, boxShadow:regenerating?"none":"0 4px 14px rgba(10,102,194,0.3)", transition:"all 0.2s" }}>
            {regenerating
              ? <><div style={{ width:12, height:12, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.2)", borderTopColor:"#0A66C2", animation:"spin 0.7s linear infinite" }}/> Generating...</>
              : <> ↺ Regenerate All Summaries</>}
          </button>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--t4)", fontSize:14, pointerEvents:"none" }}>⌕</span>
            <input type="text" placeholder="Search candidates..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{ padding:"9px 14px 9px 34px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:10, color:"var(--t1)", fontSize:13, width:230, outline:"none" }}
              onFocus={e=>e.target.style.borderColor="rgba(10,102,194,0.5)"}
              onBlur={e=>e.target.style.borderColor="var(--l08)"}/>
          </div>
        </div>
      </div>

      <OllamaStatus status={ollamaStatus}/>

      <div style={{ position:"relative", zIndex:1 }}>
        <CacheProgressBar cacheStatus={cacheStatus} regenerating={regenerating}/>
      </div>

      {/* CARDS */}
      {loading ? (
        <div style={{ textAlign:"center", marginTop:80, position:"relative", zIndex:1 }}>
          <div style={S.spinner}/><div style={{ color:"#004182", fontSize:14, fontWeight:700, marginTop:20 }}>Loading resumes...</div>
        </div>
      ) : filtered.length===0 ? (
        <div style={{ textAlign:"center", marginTop:80, position:"relative", zIndex:1 }}>
          <div style={{ fontSize:48, marginBottom:12, opacity:0.12, color:"#0A66C2" }}>◈</div>
          <div style={{ fontSize:18, fontWeight:700, color:"var(--t3)" }}>No resumes found</div>
          <div style={{ fontSize:14, marginTop:4, color:"var(--t4)" }}>Upload resumes when submitting candidates</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:18, position:"relative", zIndex:1 }}>
          {filtered.map((row,index)=>{
            const filename = row.analysis_filename || row.transformed_filename || row.original_filename || row.url.split("/").pop();
            const [c1,c2]  = avatarColors(row.candidate);
            const status = row.formatting_status || "";
            const statusLabel = status === "ready" || status === "completed" ? "Ready"
              : status === "needs_review" ? "Needs Review"
              : status === "validating" ? "Validating"
              : status === "running" ? "Sanitizing"
              : status === "pending" ? "Queued"
              : status === "failed" ? "Failed"
              : "Uploaded";
            const statusStyle = status === "ready" || status === "completed"
              ? { background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)" }
              : status === "needs_review"
                ? { background:"rgba(56,67,79,0.1)", color:"#56687A", border:"1px solid rgba(56,67,79,0.2)" }
              : status === "failed"
                ? { background:"rgba(204,16,22,0.1)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.2)" }
                : { background:"rgba(56,67,79,0.1)", color:"#56687A", border:"1px solid rgba(56,67,79,0.2)" };
            const subtitle = row.transformed_filename
              ? "Original and Mphasis resumes available"
              : row.original_filename
                ? "Mphasis sanitization in background"
                : "Resume uploaded";
            const validation = row.validation || {};
            const confidence = row.validation_confidence || validation.confidence || "";
            const confidenceStyle = confidence === "High"
              ? { background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)" }
              : confidence === "Medium"
                ? { background:"rgba(56,67,79,0.1)", color:"#56687A", border:"1px solid rgba(56,67,79,0.2)" }
                : { background:"rgba(204,16,22,0.1)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.2)" };
            return (
              <div key={index}
                style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:18, padding:22, transition:"all 0.2s ease", position:"relative", overflow:"hidden" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=c1+"55";e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow=`0 12px 32px ${c1}22`;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--l07)";e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:`linear-gradient(90deg,${c1},${c2})`, borderRadius:"18px 18px 0 0" }}/>
                <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18, marginTop:8 }}>
                  <div style={{ width:52, height:52, borderRadius:14, background:`linear-gradient(135deg,${c1},${c2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, fontWeight:800, color:"white", flexShrink:0, boxShadow:`0 6px 16px ${c1}55` }}>
                    {initials(row.candidate)}
                  </div>
                  <div style={{ overflow:"hidden", flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <div style={{ color:"var(--t1)", fontWeight:800, fontSize:15, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row.candidate}</div>
                      <span style={{ ...statusStyle, padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:800 }}>{statusLabel}</span>
                    </div>
                    <div style={{ color:"var(--t4)", fontSize:11, marginTop:3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{subtitle}</div>
                    {row.role&&(
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:4, padding:"2px 8px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:20, fontSize:11, fontWeight:600 }}>
                        <GlowDot color="#0A66C2" size={4}/> {row.role}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ height:1, background:"var(--l05)", marginBottom:16 }}/>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <button onClick={()=>handleAnalyse(filename,row.candidate,row.role||"")}
                    style={{ width:"100%", padding:"11px", background:`linear-gradient(135deg,${c1},${c2})`, color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13, boxShadow:`0 4px 16px ${c1}44`, transition:"opacity 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.opacity="0.85"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                    {ollamaStatus?.running?"AI Analysis":"Profile Analysis"}
                  </button>
                  <a href={row.url} target="_blank" rel="noreferrer"
                    style={{ display:"none" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="var(--l08)";e.currentTarget.style.color="var(--t2)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="var(--l04)";e.currentTarget.style.color="var(--t3)";}}>
                    ↓ Download Resume
                  </a>
                  {row.formatting_error&&(
                    <div style={{ padding:"10px 12px", background:"rgba(204,16,22,0.08)", border:"1px solid rgba(204,16,22,0.18)", borderRadius:10, color:"#CC1016", fontSize:12 }}>
                      {row.formatting_error}
                    </div>
                  )}
                  {(status==="failed"||status==="needs_review")&&(
                    <button type="button" onClick={()=>handleRetrySanitization(row.candidate)}
                      style={{ width:"100%", padding:"9px 11px", background:"rgba(56,67,79,0.1)", color:"#56687A", border:"1px solid rgba(56,67,79,0.25)", borderRadius:9, cursor:"pointer", fontWeight:800, fontSize:12 }}>
                      Retry Sanitization
                    </button>
                  )}
                  {confidence&&(
                    <div style={{ padding:"9px 11px", background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:9, color:"var(--t3)", fontSize:12 }}>
                      Content preservation: <span style={{ color:confidenceStyle.color, fontWeight:800 }}>{confidence}</span>
                      {validation.score!==undefined&&validation.score!==null ? ` · ${validation.score}%` : ""}
                    </div>
                  )}
                  <div style={{ display:"flex", gap:8 }}>
                    <ResumeButton href={row.original_url} label="Original Resume" disabled={!row.original_url}/>
                    <ResumeButton href={row.transformed_url} label="Mphasis Resume" disabled={!row.transformed_url}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL */}
      {showModal&&(
        <div style={S.overlay}>
          <div style={{ ...S.modal, maxWidth:820 }}>
            <div style={{ ...S.modalHead, background:"var(--pg-bg)" }}>
              <div>
                <div style={S.eyebrow}>{ollamaStatus?.running?"AI Resume Analysis":"Profile Analysis"}</div>
                <h2 style={{ color:"var(--t1)", margin:"4px 0 0", fontSize:22, fontWeight:800, letterSpacing:0 }}>{selectedCandidate}</h2>
                {selectedRole&&(
                  <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:4, padding:"2px 10px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:20, fontSize:12, fontWeight:600 }}>
                    <GlowDot color="#0A66C2" size={5}/> {selectedRole}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <a href={`${API}/download-resume/${selectedCandidate.replace(/ /g,"_")}.docx`} target="_blank" rel="noreferrer"
                  style={{ padding:"7px 14px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:8, fontWeight:700, fontSize:12, textDecoration:"none" }}>
                  ↓ Resume
                </a>
                <button onClick={closeModal} style={S.closeBtn}>✕</button>
              </div>
            </div>
            <div style={{ padding:"24px 28px" }}>
              {analyzing ? (
                <div style={{ textAlign:"center", padding:"70px 0" }}>
                  <div style={{ position:"relative", width:72, height:72, margin:"0 auto 24px" }}>
                    <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.15)", borderTopColor:"#0A66C2", animation:"spin 0.8s linear infinite" }}/>
                    <div style={{ position:"absolute", inset:8, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.1)", borderTopColor:"#0A66C2", animation:"spin 1.2s linear infinite reverse" }}/>
                    <div style={{ position:"absolute", inset:16, borderRadius:"50%", border:"2px solid rgba(22,135,64,0.1)", borderTopColor:"#168740", animation:"spin 1.8s linear infinite" }}/>
                  </div>
                  <div style={{ color:"#0A66C2", fontSize:16, fontWeight:700 }}>
                    Analysing resume...
                  </div>
                  <div style={{ color:"var(--t4)", fontSize:13, marginTop:8, lineHeight:1.6 }}>
                    Reading resume · Detecting experience &amp; education · Matching skills to JD
                  </div>
                </div>
              ) : (
                <>
                  {aiResult&&!aiResult.error&&<AIMatchPanel result={aiResult}/>}
                  {aiResult&&!aiResult.error&&<SkillGapPanel result={aiResult}/>}
                  {aiResult?.error&&(
                    <div style={{ padding:"14px 18px", background:"rgba(56,67,79,0.06)", border:"1px solid rgba(56,67,79,0.2)", borderRadius:12, color:"#38434F", fontSize:13, marginBottom:20 }}>{aiResult.error}</div>
                  )}
                  <div style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:14, overflow:"hidden", marginBottom:20 }}>
                    <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--l06)", background:"var(--l02)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <GlowDot color="#0A66C2" size={7}/>
                        <span style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Candidate Summary</span>
                        {ollamaStatus?.running&&<span style={{ padding:"2px 8px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:20, fontSize:10, fontWeight:700 }}>AI</span>}
                      </div>
                      <button onClick={handleRefreshSummary}
                        style={{ padding:"4px 12px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700 }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.2)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(10,102,194,0.1)"}>
                        ↺ Refresh
                      </button>
                    </div>
                    <div style={{ padding:"10px 20px", background:"rgba(22,135,64,0.03)", borderBottom:"1px solid var(--l07)", display:"flex", gap:16, flexWrap:"wrap" }}>
                      {["Experience","Education","Skills","JD Alignment"].map(tag=>(
                        <span key={tag} style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, color:"#168740", fontWeight:600 }}>
                          <GlowDot color="#168740" size={4}/> {tag}
                        </span>
                      ))}
                    </div>
                    <div style={{ padding:20 }}>
                      <textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={11}
                        style={{ width:"100%", background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, color:"var(--t2)", fontSize:14, lineHeight:1.8, padding:"14px 16px", resize:"vertical", outline:"none", boxSizing:"border-box", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif" }}/>
                      <div style={{ marginTop:8, fontSize:11, color:"var(--t4)" }}>You can edit this summary before downloading the PDF.</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:12 }}>
                    <button onClick={()=>window.open(`${API}/download-summary/${selectedCandidate.replace(/ /g,"_")}.docx`,"_blank")}
                      style={{ flex:1, padding:"12px", background:"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:14, boxShadow:"0 4px 16px rgba(5,150,105,0.3)" }}>
                      ↓ Download PDF Summary
                    </button>
                    <button onClick={closeModal}
                      style={{ padding:"12px 24px", background:"var(--l04)", color:"var(--t3)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:14 }}>
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  root:{ minHeight:"100vh", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", padding:"32px 36px", position:"relative", overflowX:"hidden" },
  gridOverlay:{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:`linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px)`, backgroundSize:"40px 40px" },
  overlay:{ position:"fixed", inset:0, background:"var(--overlay-bg)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 },
  modal:{ background:"var(--pg-bg)", border:"1px solid var(--l09)", borderRadius:22, width:"100%", maxWidth:480, maxHeight:"92vh", overflowY:"auto", boxShadow:"0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(10,102,194,0.1)" },
  modalHead:{ padding:"22px 28px 18px", borderBottom:"1px solid var(--l07)", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, borderRadius:"22px 22px 0 0", zIndex:1 },
  eyebrow:{ color:"#0A66C2", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2 },
  closeBtn:{ background:"var(--l04)", border:"1px solid var(--l07)", color:"var(--t3)", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" },
  spinner:{ width:30, height:30, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.15)", borderTopColor:"#0A66C2", animation:"spin 0.7s linear infinite", margin:"0 auto" },
};

