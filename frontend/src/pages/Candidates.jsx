import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../AuthContext";

const API = import.meta.env.VITE_API_URL ?? "";

// ── Mphasis filename helpers (mirrors MphasisTransformer.jsx logic) ────────────
const _INDIA_KW = [
  "india","bangalore","bengaluru","hyderabad","mumbai","pune","chennai",
  "delhi","noida","gurgaon","gurugram","kolkata","ahmedabad","offshore","off shore",
];
const _SENIORITY_RE = [
  [/principal/i,  "Senior"], [/\bstaff\b/i,  "Senior"], [/senior/i, "Senior"],
  [/\bsr\b/i,     "Senior"], [/\blead\b/i,   "Senior"],
  [/associate/i,  "Junior"], [/junior/i,     "Junior"], [/\bjr\b/i, "Junior"],
];
function _slugify(text) {
  return (text || "").replace(/[^\w\s]/g, "").trim()
    .split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : "").join("");
}
function _locLabel(location) {
  const loc = (location || "").toLowerCase();
  return _INDIA_KW.some(k => loc.includes(k)) ? "Offshore" : "Onsite";
}
function _buildMphasisFilename(name, role, location) {
  const firstName = (name || "Resume").trim().split(/\s+/)[0];
  const parts = [firstName];
  let cleanRole = role || "";
  let seniority = "";
  for (const [re, label] of _SENIORITY_RE) {
    if (re.test(cleanRole)) { seniority = label; cleanRole = cleanRole.replace(re, "").trim(); break; }
  }
  if (!seniority && cleanRole) seniority = "Mid";
  if (cleanRole)   parts.push(_slugify(cleanRole));
  const loc = (location || "").toLowerCase().trim();
  if (loc && loc !== "nan") parts.push(_locLabel(location));
  if (seniority)   parts.push(seniority);
  return parts.join("_") + ".docx";
}
// ──────────────────────────────────────────────────────────────────────────────

const PROGRESS_STAGES = ["L1 Scheduled","Client Interview Scheduled","DM Interview Scheduled","Selected"];
const REJECT_STAGES   = ["L1 Reject","Client Reject","DM Reject","Rejected"];
const ALL_STAGES      = [...PROGRESS_STAGES, ...REJECT_STAGES];

const STAGE_META = {
  "L1 Scheduled":               { color:"#0A66C2", glow:"rgba(10,102,194,0.3)",   bg:"rgba(10,102,194,0.1)",   border:"rgba(10,102,194,0.25)"  },
  "Client Interview Scheduled": { color:"#38434F", glow:"rgba(56,67,79,0.3)",   bg:"rgba(56,67,79,0.1)",   border:"rgba(56,67,79,0.25)"  },
  "DM Interview Scheduled":     { color:"#a78bfa", glow:"rgba(167,139,250,0.3)",  bg:"rgba(167,139,250,0.1)",  border:"rgba(167,139,250,0.25)" },
  "Selected":                   { color:"#168740", glow:"rgba(22,135,64,0.3)",   bg:"rgba(22,135,64,0.1)",   border:"rgba(22,135,64,0.25)"  },
  "L1 Reject":                  { color:"#CC1016", glow:"rgba(204,16,22,0.3)",  bg:"rgba(204,16,22,0.1)",  border:"rgba(204,16,22,0.25)" },
  "Client Reject":              { color:"#CC1016", glow:"rgba(204,16,22,0.3)",  bg:"rgba(204,16,22,0.1)",  border:"rgba(204,16,22,0.25)" },
  "DM Reject":                  { color:"#CC1016", glow:"rgba(204,16,22,0.3)",  bg:"rgba(204,16,22,0.1)",  border:"rgba(204,16,22,0.25)" },
  "Rejected":                   { color:"#6b7280", glow:"rgba(107,114,128,0.2)",  bg:"rgba(107,114,128,0.08)", border:"rgba(107,114,128,0.2)"  },
  "Submitted":                  { color:"var(--t2)", glow:"rgba(148,163,184,0.2)",  bg:"rgba(148,163,184,0.08)", border:"rgba(148,163,184,0.2)"  },
};

function nextInterviewStage(stage = "") {
  const index = PROGRESS_STAGES.indexOf(stage);
  if (index >= 0 && index < PROGRESS_STAGES.length - 1) return PROGRESS_STAGES[index + 1];
  if (stage === "Submitted") return "L1 Scheduled";
  return "Selected";
}

function rejectStageFor(stage = "") {
  if (stage.toLowerCase().includes("client")) return "Client Reject";
  if (stage.toLowerCase().includes("dm")) return "DM Reject";
  if (stage.toLowerCase().includes("l1")) return "L1 Reject";
  return "Rejected";
}

const AVATAR_PALETTE = [
  ["#0A66C2","#0A66C2"],["#0ea5e9","#0A66C2"],["#168740","#168740"],
  ["#38434F","#56687A"],["#0A66C2","#f472b6"],["#0A66C2","#a78bfa"],
  ["#14b8a6","#2dd4bf"],["#f97316","#fb923c"],
];
function avatarColors(name = "") {
  let h = 0; for (let c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function initials(name = "") {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

const HUMANIZED_TEST_LABELS = {
  "Codex QA": "Anika Rao",
  "Alex L1": "Alex Morgan",
  "Blair Client": "Blair Coleman",
  "Casey DM": "Casey Morgan",
  "Riley Reject": "Riley Bennett",
};
function humanizeName(value = "") {
  const cleaned = String(value || "").trim();
  return HUMANIZED_TEST_LABELS[cleaned] || cleaned;
}
function normalizeInterviewScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, parsed > 10 ? parsed / 10 : parsed));
}
function weightedSkillScore(score, weight) {
  return ((normalizeInterviewScore(score) / 10) * Number(weight || 0)).toFixed(2);
}
function editableScoreValue(value) {
  return value === "" || value === null || value === undefined ? "" : String(value);
}

const MAIN_COLUMNS = [
  { key:"Candidate Name",    label:"Candidate", width:"16%" },
  { key:"Role",              label:"Role",       width:"14%" },
  { key:"WIPPX",             label:"WIPPX",      width:"6%"  },
  { key:"Profile Shared on", label:"Shared On",  width:"9%"  },
  { key:"Status",            label:"Stage",      width:"20%" },
  { key:"account_name",      label:"Account",    width:"11%" },
  { key:"lob_name",          label:"LOB",        width:"8%"  },
];
const DETAIL_FIELDS = ["Position Code","Location","Manager","Assessed By","Assessment on/To be scheduled"];

function fmt(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
  catch { return d; }
}

function GlowDot({ color, size = 8 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:color, boxShadow:`0 0 ${size}px ${color}`, flexShrink:0 }} />;
}

function StageBadge({ status }) {
  const m = STAGE_META[status] || STAGE_META["Rejected"];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:m.color, fontSize:12, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%" }}>
      <GlowDot color={m.color} size={6}/>{status||"—"}
    </span>
  );
}

function getScoreStyle(s) {
  if (s>=75) return { color:"#168740", bg:"rgba(22,135,64,0.1)",  border:"rgba(22,135,64,0.25)",  label:"Strong"  };
  if (s>=50) return { color:"#38434F", bg:"rgba(56,67,79,0.1)",  border:"rgba(56,67,79,0.25)",  label:"Partial" };
  return           { color:"#CC1016", bg:"rgba(204,16,22,0.1)", border:"rgba(204,16,22,0.25)", label:"Low"     };
}

function matchPercent(value) {
  const numeric = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(numeric * 100)));
}

function lerp(start, end, ratio) {
  return Math.round(start + (end - start) * ratio);
}

function gradientColor(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stops = [
    { at:0, color:[248, 113, 113] },
    { at:50, color:[245, 158, 11] },
    { at:100, color:[16, 185, 129] },
  ];
  const start = clamped <= 50 ? stops[0] : stops[1];
  const end = clamped <= 50 ? stops[1] : stops[2];
  const ratio = (clamped - start.at) / (end.at - start.at);
  const [r, g, b] = start.color.map((channel, index) => lerp(channel, end.color[index], ratio));
  return { rgb:`rgb(${r}, ${g}, ${b})`, rgba:(alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

function courseMatchTone(percent) {
  const color = gradientColor(percent);
  if (percent >= 85) return {
    label:"Strongest",
    color:color.rgb,
    soft:color.rgba(0.07),
    fill:"var(--l03)",
    border:color.rgba(0.2),
    shadow:"rgba(15,23,42,0.04)",
  };
  if (percent >= 65) return {
    label:"Strong",
    color:color.rgb,
    soft:color.rgba(0.07),
    fill:"var(--l03)",
    border:color.rgba(0.18),
    shadow:"rgba(15,23,42,0.04)",
  };
  if (percent >= 40) return {
    label:"Moderate",
    color:color.rgb,
    soft:color.rgba(0.07),
    fill:"var(--l03)",
    border:color.rgba(0.18),
    shadow:"rgba(15,23,42,0.035)",
  };
  return {
    label:"Least",
    color:color.rgb,
    soft:color.rgba(0.07),
    fill:"var(--l03)",
    border:color.rgba(0.18),
    shadow:"rgba(15,23,42,0.03)",
  };
}

function ScoreRing({ score }) {
  const { color, label } = getScoreStyle(score);
  const r = 44, circ = 2 * Math.PI * r;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ position:"relative", width:108, height:108 }}>
        <svg width="108" height="108" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="54" cy="54" r={r} fill="none" style={{ stroke:"var(--l06)" }} strokeWidth="8"/>
          <circle cx="54" cy="54" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={circ-(score/100)*circ}
            strokeLinecap="round" style={{ transition:"stroke-dashoffset 1.2s ease", filter:`drop-shadow(0 0 6px ${color})` }}/>
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
        <span style={{ fontSize:12, color:"var(--t2)", fontWeight:500 }}>{label}</span>
        <span style={{ fontSize:12, color, fontWeight:700 }}>{score}/{maxScore}</span>
      </div>
      <div style={{ height:5, background:"var(--l05)", borderRadius:3, overflow:"hidden", marginBottom:4 }}>
        <div style={{ height:"100%", borderRadius:3, width:`${pct}%`, background:color, boxShadow:`0 0 8px ${color}`, transition:"width 1s ease" }}/>
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
    <div style={{ background:"var(--l02)", border:`1px solid ${ss.border}`, borderRadius:16, overflow:"hidden", marginBottom:20, boxShadow:`0 0 24px ${ss.bg}` }}>
      <div style={{ display:"grid", gridTemplateColumns:"130px 1fr", borderBottom:"1px solid var(--l06)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 0", borderRight:"1px solid var(--l06)", background:ss.bg }}>
          <ScoreRing score={result.overall}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:0.8 }}>Score breakdown</span>
            <span style={{ padding:"2px 10px", background:isAI?"rgba(10,102,194,0.15)":"rgba(100,116,139,0.1)", color:isAI?"#0A66C2":"var(--t2)", border:`1px solid ${isAI?"rgba(10,102,194,0.25)":"rgba(100,116,139,0.2)"}`, borderRadius:20, fontSize:11, fontWeight:700 }}>
              {isAI?`AI · ${result.model||"ollama"}`:"Keyword"}
            </span>
            {result.cached&&<span style={{ padding:"2px 8px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.2)", borderRadius:20, fontSize:10, fontWeight:700 }}>⚡ Cached</span>}
          </div>
          <BreakdownBar label="Skills"     score={result.skills?.score??0}    maxScore={60} color="#0A66C2" reasoning={result.skills?.reasoning}/>
          <BreakdownBar label="Experience" score={result.experience?.score??0} maxScore={20} color="#168740" reasoning={result.experience?.reasoning}/>
          <BreakdownBar label="Context"    score={result.context?.score??0}    maxScore={20} color="#0A66C2" reasoning={result.context?.reasoning}/>
        </div>
      </div>
      {result.summary&&<div style={{ padding:"12px 20px", background:"rgba(10,102,194,0.04)", fontSize:13, color:"var(--t2)", lineHeight:1.6, fontStyle:isAI?"normal":"italic" }}>{isAI?"AI: ":""}{result.summary}</div>}
      {(result.skills?.matched?.length>0||result.skills?.missing?.length>0)&&(
        <div style={{ padding:"14px 20px" }}>
          {result.skills.matched?.length>0&&<div style={{ marginBottom:12 }}><div style={{ fontSize:10, fontWeight:700, color:"#168740", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Matched ({result.skills.matched.length})</div><div>{result.skills.matched.map(s=><SkillPill key={s} skill={s}/>)}</div></div>}
          {result.skills.missing?.length>0&&<div><div style={{ fontSize:10, fontWeight:700, color:"#CC1016", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Missing ({result.skills.missing.length})</div><div>{result.skills.missing.map(s=><SkillPill key={s} skill={s} missing/>)}</div></div>}
        </div>
      )}
    </div>
  );
}

// ── AI Analysis Content — reusable, handles its own fetch/state ──
function TalentNextCoursesPanel({ gap, onRefresh, refreshing }) {
  const recommendations = gap?.ai_course_recommendations || gap?.recommendations || [];
  const catalog = gap?.catalog_status || {};
  const hasGap = Boolean(gap);
  return (
    <div style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:14, overflow:"hidden", marginBottom:20 }}>
      <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--l06)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <GlowDot color="#0A66C2" size={7}/>
            <span style={{ color:"var(--t3)", fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:1 }}>TalentNext Courses To Take</span>
          </div>
          <div style={{ color:"var(--t4)", fontSize:11, marginTop:5 }}>
            {catalog.loaded ? `AI-filtered from ${catalog.file_name || "TalentNext catalog"} - ${catalog.row_count || 0} rows` : "Excel catalog not loaded"}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
            <span style={{ color:"var(--t4)", fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:0.6 }}>Least</span>
            <div style={{ width:120, height:6, borderRadius:20, background:"linear-gradient(90deg, rgb(248, 113, 113), rgb(245, 158, 11), rgb(16, 185, 129))", boxShadow:"0 0 14px rgba(22,135,64,0.12)" }} />
            <span style={{ color:"var(--t4)", fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:0.6 }}>Strongest</span>
          </div>
        </div>
        <button onClick={onRefresh} disabled={refreshing}
          style={{ padding:"6px 12px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.24)", borderRadius:8, cursor:refreshing?"default":"pointer", fontSize:11, fontWeight:800 }}>
          {refreshing ? "Refreshing..." : "Refresh Catalog"}
        </button>
      </div>

      {!hasGap ? (
        <div style={{ padding:"16px 18px", color:"var(--t3)", fontSize:13, lineHeight:1.6 }}>
          No active scoring rubric is available for this role yet, so the AI tab cannot determine course gaps. Generate and activate the rubric from Position Management first.
        </div>
      ) : recommendations.length === 0 ? (
        <div style={{ padding:"16px 18px", color:"var(--t3)", fontSize:13, lineHeight:1.6 }}>
          No missing or below-level rubric skills produced TalentNext course matches for this candidate.
        </div>
      ) : (
        <div style={{ padding:18, display:"flex", flexDirection:"column", gap:12 }}>
          {recommendations.map((rec, idx) => {
            const recPercent = matchPercent(rec.match_confidence);
            const recTone = courseMatchTone(recPercent);
            return (
              <div key={`${rec.skill}-${idx}`} style={{ background:recTone.fill, border:"1px solid var(--l06)", borderLeft:`3px solid ${recTone.color}`, borderRadius:12, padding:14, boxShadow:`0 10px 24px ${recTone.shadow}` }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:10 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <div style={{ color:"var(--t2)", fontSize:14, fontWeight:800 }}>{rec.skill}</div>
                      <span style={{ padding:"3px 8px", background:"var(--l02)", color:"var(--t4)", border:"1px solid var(--l07)", borderRadius:20, fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:0.6 }}>{recTone.label}</span>
                    </div>
                    <div style={{ color:"var(--t4)", fontSize:11, marginTop:4 }}>
                      {rec.gap_type === "below_level" ? "Below required level" : "Missing skill"} - required {rec.required_level || "level"}{rec.observed_level ? `, observed ${rec.observed_level}` : ""}
                    </div>
                  </div>
                  <div style={{ minWidth:110, textAlign:"right" }}>
                    <span style={{ color:"var(--t2)", fontSize:12, fontWeight:800, whiteSpace:"nowrap" }}>
                      {recPercent}% match
                    </span>
                    <div style={{ height:4, background:"rgba(148,163,184,0.14)", borderRadius:20, overflow:"hidden", marginTop:7 }}>
                      <div style={{ width:`${recPercent}%`, height:"100%", background:recTone.color, borderRadius:20 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:10 }}>
                  {(rec.recommendations || []).slice(0, 3).map((course, courseIdx) => {
                    const coursePercent = matchPercent(course.ai_filter_score ?? course.match_confidence ?? rec.match_confidence);
                    const courseTone = courseMatchTone(coursePercent);
                    return (
                      <div key={`${course.sub_skill}-${courseIdx}`} style={{ position:"relative", background:"var(--l02)", border:"1px solid var(--l07)", borderLeft:`3px solid ${courseTone.color}`, borderRadius:10, padding:"12px 12px 11px", overflow:"hidden" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start", marginBottom:7 }}>
                          <div style={{ color:"var(--t2)", fontSize:12, fontWeight:800, lineHeight:1.25 }}>{course.sub_skill}</div>
                          <span style={{ flexShrink:0, padding:"3px 7px", background:courseTone.soft, color:courseTone.color, borderRadius:20, fontSize:9, fontWeight:800 }}>{coursePercent}%</span>
                        </div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                          {[course.proficiency, course.nomination_type, course.category].filter(Boolean).map(tag => (
                            <span key={tag} style={{ padding:"2px 7px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:20, fontSize:10, fontWeight:800 }}>{tag}</span>
                          ))}
                        </div>
                        <div style={{ height:3, background:"rgba(148,163,184,0.13)", borderRadius:20, overflow:"hidden", marginBottom:8 }}>
                          <div style={{ width:`${coursePercent}%`, height:"100%", background:courseTone.color, borderRadius:20 }} />
                        </div>
                        <div style={{ color:"var(--t4)", fontSize:10, lineHeight:1.45 }}>
                          {course.ai_filter_reason || course.match_reason || "Catalog match"}{course.target_proficiency ? ` - target ${course.target_proficiency}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AIAnalysisContent({ candidateName, role }) {
  const [loading,    setLoading]    = useState(true);
  const [summary,    setSummary]    = useState("");
  const [aiResult,   setAiResult]   = useState(null);
  const [error,      setError]      = useState("");
  const [rescoring,  setRescoring]  = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const filename = candidateName.replace(/ /g,"_") + ".docx";

  const fetchAiResult = async () => {
    const res = await fetch(`${API}/ai-profile-score/${filename}?role=${encodeURIComponent(role||"")}`);
    return await res.json();
  };

  useEffect(() => {
    (async () => {
      try {
        const encodedRole = encodeURIComponent(role||"");
        const [scoreStatus, cacheStatusRes] = await Promise.all([
          fetch(`${API}/ai-score-status/${filename}?role=${encodedRole}`).then(r=>r.json()).catch(()=>({ready:false})),
          fetch(`${API}/summary-cache-status?filename=${encodeURIComponent(filename)}&role=${encodedRole}`).then(r=>r.json()).catch(()=>({ready:false})),
        ]);
        const summaryReady = cacheStatusRes.ready === true;
        const noResume = (d) => d && (d.error || d.detail || "").toLowerCase().includes("not found");
        if (scoreStatus.ready && summaryReady) {
          setLoading(false);
          const [sR, scR] = await Promise.all([
            fetch(`${API}/generate-summary/${filename}`, {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({ job_description:"", force_refresh:false, role: role||"" }),
            }),
            fetchAiResult(),
          ]);
          const sumData = await sR.json();
          if (noResume(sumData) || noResume(scR)) { setError("no_resume"); return; }
          setSummary(sumData.summary || "No summary.");
          setAiResult(scR);
          return;
        }
        setLoading(true);
        const [sR, scR] = await Promise.all([
          fetch(`${API}/generate-summary/${filename}`, {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ job_description:"", force_refresh:false, role: role||"" }),
          }),
          fetchAiResult(),
        ]);
        const sumData = await sR.json();
        if (noResume(sumData) || noResume(scR)) { setError("no_resume"); return; }
        setSummary(sumData.summary || "No summary.");
        setAiResult(scR);
      } catch { setError("Failed to load analysis."); }
      finally  { setLoading(false); }
    })();
  }, [candidateName, role]);

  const handleRescore = async () => {
    setRescoring(true);
    try {
      const res  = await fetch(`${API}/rescore-resume?filename=${encodeURIComponent(filename)}&role=${encodeURIComponent(role||"")}`, { method:"POST" });
      const score = await res.json();
      if (!res.ok) { setError(score.detail || "Rescore failed."); return; }
      setAiResult(await fetchAiResult());
    } catch { setError("Rescore failed."); }
    finally { setRescoring(false); }
  };

  const refreshCatalog = async () => {
    setRefreshingCatalog(true);
    try {
      await fetch(`${API}/talentnext-catalog/refresh`, { method:"POST" });
      setAiResult(await fetchAiResult());
    } catch {
      setError("Catalog refresh failed.");
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const downloadAiReport = async () => {
    setDownloadingPdf(true);
    setError("");
    try {
      const res = await fetch(`${API}/download-ai-report/${encodeURIComponent(filename)}`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ role:role || "", summary, ai_result:aiResult || {} }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(()=>({}));
        setError(detail.detail || "PDF download failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${candidateName.replace(/[^A-Za-z0-9_.-]+/g, "_")}_ai_report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("PDF download failed.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const isKeywordCache = aiResult?.score?.source === "keyword_fallback" || aiResult?.source === "keyword_fallback";

  if (loading) return (
    <div style={{ textAlign:"center", padding:"60px 0" }}>
      <div style={S.spinner}/>
      <div style={{ color:"#0A66C2", fontSize:15, fontWeight:700, marginTop:20 }}>Analysing resume...</div>
      <div style={{ color:"var(--t3)", fontSize:13, marginTop:6 }}>Reading resume · Matching skills · Generating summary</div>
    </div>
  );
  if (error === "no_resume") return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, padding:"40px 24px", textAlign:"center" }}>
      <div style={{ fontSize:32, opacity:0.18 }}>📄</div>
      <div style={{ color:"var(--t2)", fontSize:14, fontWeight:700 }}>No resume uploaded</div>
      <div style={{ color:"var(--t3)", fontSize:13, maxWidth:320 }}>Upload a resume from the Resume tab to enable AI analysis, skill scoring, and TalentNext course recommendations.</div>
    </div>
  );
  if (error) return (
    <div style={{ padding:16, background:"rgba(204,16,22,0.06)", border:"1px solid rgba(204,16,22,0.2)", borderRadius:12, color:"#CC1016" }}>{error}</div>
  );
  return (
    <>
      {isKeywordCache&&(
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"10px 16px", background:"rgba(56,67,79,0.08)", border:"1px solid rgba(56,67,79,0.25)", borderRadius:12, marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>âš ï¸</span>
            <span style={{ fontSize:12, color:"#38434F", fontWeight:600 }}>Score was generated without Ollama. Rescore to get full AI-powered analysis.</span>
          </div>
          <button onClick={handleRescore} disabled={rescoring}
            style={{ padding:"6px 14px", background: rescoring?"rgba(10,102,194,0.2)":"linear-gradient(135deg,#0A66C2,#004182)", color: rescoring?"var(--t3)":"white", border:"none", borderRadius:8, cursor: rescoring?"not-allowed":"pointer", fontWeight:700, fontSize:12, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6 }}>
            {rescoring ? <><span style={{ display:"inline-block", width:10, height:10, border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"white", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/> Rescoring...</> : "⚡ Rescore with Ollama"}
          </button>
        </div>
      )}
      {aiResult&&!aiResult.error&&<AIMatchPanel result={aiResult}/>}
      {aiResult?.error&&<div style={{ padding:16, background:"rgba(56,67,79,0.06)", border:"1px solid rgba(56,67,79,0.2)", borderRadius:12, color:"#38434F", marginBottom:20 }}>{aiResult.error}</div>}
      <div style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:12, padding:20, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <GlowDot color="#0A66C2" size={7}/>
          <span style={S.sectionLabel}>Full Summary</span>
        </div>
        <textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={8}
          style={{ width:"100%", background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, color:"var(--t2)", fontSize:13, lineHeight:1.7, padding:14, resize:"vertical", outline:"none", boxSizing:"border-box", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif" }}/>
        <div style={{ marginTop:6, fontSize:11, color:"var(--t3)" }}>You can edit this summary before downloading the PDF.</div>
      </div>
      <TalentNextCoursesPanel gap={aiResult?.rubric_gap} onRefresh={refreshCatalog} refreshing={refreshingCatalog}/>
      <button onClick={downloadAiReport} disabled={downloadingPdf}
        style={{ width:"100%", padding:"12px", background:downloadingPdf?"rgba(5,150,105,0.45)":"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:10, cursor:downloadingPdf?"default":"pointer", fontWeight:700, fontSize:0, boxShadow:"0 4px 16px rgba(5,150,105,0.3)" }}>
        <span style={{ fontSize:14 }}>{downloadingPdf ? "Preparing AI PDF..." : "Download AI PDF"}</span>
        ↓ Download PDF
      </button>
    </>
  );
}

// ── AI Analysis Modal — used standalone if needed ──
function AIAnalysisModal({ candidateName, role, onClose }) {
  const filename = candidateName.replace(/ /g,"_") + ".docx";
  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth:800 }}>
        <div style={S.modalHead}>
          <div>
            <div style={S.eyebrow}>AI Resume Analysis</div>
            <h2 style={{ color:"var(--t1)", margin:"4px 0 0", fontSize:20, fontWeight:800, letterSpacing:0 }}>{candidateName}</h2>
            {role&&<div style={{ color:"#0A66C2", fontSize:12, marginTop:3, fontWeight:600 }}>{role}</div>}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <a href={`${API}/resumes/${filename}`} target="_blank" rel="noreferrer"
              style={{ padding:"7px 14px", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.25)", borderRadius:8, fontWeight:700, fontSize:12, textDecoration:"none" }}>
              ↓ Resume
            </a>
            <button onClick={onClose} style={S.closeBtn}>✕</button>
          </div>
        </div>
        <div style={{ padding:"24px 28px" }}>
          <AIAnalysisContent candidateName={candidateName} role={role}/>
        </div>
      </div>
    </div>
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

function PipelineProgress({ currentStage }) {
  const idx   = PROGRESS_STAGES.indexOf(currentStage);
  const isRej = REJECT_STAGES.includes(currentStage);
  return (
    <div style={{ marginBottom:20 }}>
      <div style={S.sectionLabel}>Interview Pipeline</div>
      <div style={{ display:"flex", alignItems:"flex-start", marginTop:12 }}>
        {PROGRESS_STAGES.map((stage,i)=>{
          const active   = i===idx && !isRej;
          const complete = idx>i && !isRej;
          const sc = STAGE_META[stage]?.color||"#0A66C2";
          return (
            <div key={stage} style={{ display:"flex", alignItems:"flex-start", flex:1 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:32, height:32, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, background:complete?sc:active?"rgba(10,102,194,0.2)":"var(--l06)", border:`2px solid ${complete?sc:active?"#0A66C2":"var(--l10)"}`, color:complete?"white":active?"#0A66C2":"var(--t2)", boxShadow:active?"0 0 16px rgba(10,102,194,0.5)":complete?`0 0 10px ${sc}`:"none", transition:"all 0.3s" }}>
                  {complete?"✓":i+1}
                </div>
                {/* pipeline step label — bumped from #334155 to #94a3b8 */}
                <div style={{ fontSize:9, marginTop:6, textAlign:"center", maxWidth:72, lineHeight:1.3, color:active?"var(--t1)":complete?sc:"var(--t2)", fontWeight:active?700:600 }}>
                  {stage.replace(" Scheduled","").replace(" Interview","")}
                </div>
              </div>
              {i<PROGRESS_STAGES.length-1&&(
                <div style={{ flex:1, height:2, margin:"15px 6px 0", borderRadius:1, background:complete?`linear-gradient(90deg,${sc},${STAGE_META[PROGRESS_STAGES[i+1]]?.color})`:"var(--l08)", transition:"background 0.5s" }}/>
              )}
            </div>
          );
        })}
        {isRej&&<div style={{ marginLeft:14, marginTop:6 }}><StageBadge status={currentStage}/></div>}
      </div>
    </div>
  );
}

function AuditTrail({ history, onDeleteLastStage }) {
  if (!history?.length) return null;
  const last = history.length-1;
  return (
    <div style={{ marginTop:18, paddingTop:18, borderTop:"1px solid var(--l06)" }}>
      <div style={S.sectionLabel}>Stage History</div>
      <div style={{ marginTop:10, position:"relative" }}>
        <div style={{ position:"absolute", left:11, top:8, bottom:8, width:1, background:"linear-gradient(180deg,rgba(10,102,194,0.4),rgba(10,102,194,0.05))" }}/>
        {history.map((entry,i)=>{
          const m      = STAGE_META[entry.stage]||STAGE_META["Rejected"];
          const isLast = i===last;
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:i<last?12:0, padding:isLast?"6px 10px 6px 6px":"0 0 0 6px", background:isLast?m.bg:"transparent", borderRadius:isLast?10:0, border:isLast?`1px solid ${m.border}`:"none" }}>
              <div style={{ width:12, height:12, borderRadius:"50%", flexShrink:0, background:m.color, boxShadow:`0 0 ${isLast?10:4}px ${m.color}`, zIndex:1 }}/>
              <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, flexWrap:"wrap" }}>
                <span style={{ color:m.color, fontSize:12, fontWeight:700 }}>{entry.stage}</span>
                {/* date badge — bumped from #334155 to #64748b */}
                <span style={{ color:"var(--t3)", fontSize:11, background:"var(--l05)", border:"1px solid var(--l10)", borderRadius:6, padding:"1px 8px" }}>{fmt(entry.date)}</span>
              </div>
              {isLast&&(
                <button onClick={()=>onDeleteLastStage(entry.stage)}
                  style={{ padding:"3px 10px", background:"rgba(204,16,22,0.08)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600 }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(204,16,22,0.18)"}
                  onMouseLeave={e=>e.currentTarget.style.background="rgba(204,16,22,0.08)"}>
                  ✕ Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageChanger({ currentStage, defaultInterviewer = "", onConfirm }) {
  const [sel,setSel]   = useState(currentStage);
  const [date,setDate] = useState(new Date().toISOString().split("T")[0]);
  const [interviewer,setInterviewer] = useState(defaultInterviewer);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:10, flexWrap:"wrap" }}>
      <div>
        <div style={S.sectionLabel}>Move to Stage</div>
        <select value={sel} onChange={e=>setSel(e.target.value)} style={S.miniSelect}>
          <optgroup label="Interview Stages" style={{ background:"var(--pg-bg)" }}>{PROGRESS_STAGES.map(s=><option key={s} value={s} style={{ background:"var(--pg-bg)" }}>{s}</option>)}</optgroup>
          <optgroup label="Rejected"         style={{ background:"var(--pg-bg)" }}>{REJECT_STAGES.map(s=><option key={s} value={s} style={{ background:"var(--pg-bg)" }}>{s}</option>)}</optgroup>
        </select>
      </div>
      <div>
        <div style={S.sectionLabel}>Date</div>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ ...S.miniSelect, colorScheme:"normal" }}/>
      </div>
      <div>
        <div style={S.sectionLabel}>Interviewer</div>
        <input value={interviewer} onChange={e=>setInterviewer(e.target.value)} placeholder="Interviewer name" style={{ ...S.miniSelect, minWidth:180 }}/>
      </div>
      <button onClick={()=>onConfirm(sel,date,interviewer)} disabled={!date}
        style={{ padding:"8px 18px", background:date?"linear-gradient(135deg,#0A66C2,#004182)":"rgba(10,102,194,0.1)", color:date?"white":"var(--t3)", border:"none", borderRadius:8, cursor:date?"pointer":"not-allowed", fontSize:13, fontWeight:700, boxShadow:date?"0 4px 14px rgba(10,102,194,0.35)":"none" }}>
        Confirm →
      </button>
    </div>
  );
}

function ProfileMatchingTab({ candidateName, candidateRole, submittedRoles, onResubmit }) {
  const [suggestions,  setSuggestions]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(null);
  const [submitStage,  setSubmitStage]  = useState("L1 Scheduled");
  const [submitDate,   setSubmitDate]   = useState(new Date().toISOString().split("T")[0]);
  const [expandedRole, setExpandedRole] = useState(null);

  useEffect(()=>{
    const fn = candidateName.replace(/ /g,"_")+".docx";
    setLoading(true);
    fetch(`${API}/role-suggestions/${fn}?current_role=${encodeURIComponent(candidateRole||"")}`)
      .then(r=>r.json())
      .then(d=>{ setSuggestions(d.suggestions||[]); setLoading(false); })
      .catch(()=>setLoading(false));
  },[candidateName, candidateRole]);

  function mc(pct) {
    if (pct>=70) return { color:"#168740", bg:"rgba(22,135,64,0.1)", border:"rgba(22,135,64,0.25)" };
    if (pct>=45) return { color:"#38434F", bg:"rgba(56,67,79,0.1)", border:"rgba(56,67,79,0.25)" };
    return { color:"#CC1016", bg:"rgba(204,16,22,0.1)", border:"rgba(204,16,22,0.25)" };
  }

  const handleSubmit = async (role)=>{
    setSubmitting(role);
    try {
      const res = await fetch(`${API}/submit-candidate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role,candidateName,profileSharedOn:submitDate,assessedBy:"",assessmentDate:"",status:submitStage,stageDate:submitDate})});
      if (res.ok) onResubmit(candidateName,role,submitStage);
      else { const err=await res.json(); alert(err.detail||"Failed"); }
    } catch { alert("Network error"); }
    finally { setSubmitting(null); }
  };

  if (loading) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
      <div style={S.spinner}/>
      <div style={{ color:"var(--t3)", fontSize:13 }}>Matching against open roles...</div>
    </div>
  );

  return (
    <div style={{ overflowY:"auto", padding:"16px 18px", flex:1 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
        <div style={S.sectionLabel}>Suitable for Other Roles</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <select value={submitStage} onChange={e=>setSubmitStage(e.target.value)} style={S.miniSelect}>
            {PROGRESS_STAGES.map(s=><option key={s} value={s} style={{background:"var(--pg-bg)"}}>{s}</option>)}
          </select>
          <input type="date" value={submitDate} onChange={e=>setSubmitDate(e.target.value)} style={{...S.miniSelect,colorScheme:"normal"}}/>
        </div>
      </div>

      {!suggestions.length ? (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"28px 16px", background:"rgba(100,116,139,0.06)", border:"1px solid rgba(100,116,139,0.18)", borderRadius:12, textAlign:"center" }}>
          <div style={{ fontSize:28, opacity:0.18 }}>◈</div>
          <span style={{ color:"var(--t2)", fontSize:13, fontWeight:700 }}>No suitable roles found</span>
          <span style={{ color:"var(--t3)", fontSize:12 }}>This candidate did not score above 30% for any other open position.</span>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {suggestions.map(({role,overall,matched,missing})=>{
            const m=mc(overall), isExp=expandedRole===role, isBusy=submitting===role;
            const alreadySubmitted = (submittedRoles||[]).map(r=>r.toLowerCase()).includes(role.toLowerCase());
            return (
              <div key={role} style={{ background:"var(--l02)", border:`1px solid ${m.border}`, borderRadius:12, overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", flexWrap:"wrap" }}>
                  <div style={{ flex:"1 1 120px", color:"var(--t1)", fontSize:13, fontWeight:700 }}>{role}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:60, height:4, background:"var(--l07)", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", borderRadius:2, width:`${overall}%`, background:m.color, boxShadow:`0 0 6px ${m.color}` }}/>
                    </div>
                    <span style={{ padding:"2px 8px", background:m.bg, color:m.color, border:`1px solid ${m.border}`, borderRadius:20, fontSize:11, fontWeight:800 }}>{overall}%</span>
                    {(matched.length>0||missing.length>0)&&(
                      <button onClick={()=>setExpandedRole(isExp?null:role)} style={{ background:"none", border:"none", color:"var(--t3)", cursor:"pointer", fontSize:11, padding:"2px 4px" }}>{isExp?"▲":"▼"}</button>
                    )}
                  </div>
                  {alreadySubmitted
                    ? <span style={{ padding:"5px 12px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.25)", borderRadius:8, fontSize:12, fontWeight:700 }}>✓ Submitted</span>
                    : <button onClick={()=>handleSubmit(role)} disabled={isBusy}
                        style={{ padding:"5px 12px", background:isBusy?"rgba(10,102,194,0.1)":"linear-gradient(135deg,#0A66C2,#004182)", color:isBusy?"var(--t3)":"white", border:"none", borderRadius:8, cursor:isBusy?"not-allowed":"pointer", fontSize:12, fontWeight:700, boxShadow:isBusy?"none":"0 4px 12px rgba(10,102,194,0.25)" }}>
                        {isBusy?"…":"↗ Submit"}
                      </button>
                  }
                </div>
                {isExp&&(
                  <div style={{ padding:"0 12px 12px", borderTop:"1px solid var(--l06)" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:10 }}>
                      {matched.length>0&&<div><div style={{ color:"#168740", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Matched</div><div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>{matched.map(s=><SkillPill key={s} skill={s}/>)}</div></div>}
                      {missing.length>0&&<div><div style={{ color:"#CC1016", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Missing</div><div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>{missing.map(s=><SkillPill key={s} skill={s} missing/>)}</div></div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrackTab({ row, history, isDeletedPosition, onEdit, onDelete, onStageConfirm, onDeleteLastStage }) {
  return (
    <div style={{ overflowY:"auto", padding:"20px 18px", flex:1 }}>
      <PipelineProgress currentStage={row["Status"]}/>
      <AuditTrail history={history} onDeleteLastStage={onDeleteLastStage}/>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:"10px 16px", margin:"18px 0" }}>
        {DETAIL_FIELDS.map(key=>(
          <div key={key}>
            <div style={{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, marginBottom:4 }}>{key}</div>
            <div style={{ color:"var(--t2)", fontSize:12 }}>{row[key]||"—"}</div>
          </div>
        ))}
      </div>
      <div style={{ paddingTop:16, borderTop:"1px solid var(--l06)" }}>
        <StageChanger currentStage={row["Status"]} defaultInterviewer={humanizeName(row["Assessed By"] || row["Manager"] || "")} onConfirm={onStageConfirm}/>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={onEdit}
            style={{ flex:1, padding:"8px 0", background:"rgba(10,102,194,0.1)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(10,102,194,0.1)"}> âœ Edit</button>
          <button onClick={onDelete}
            style={{ flex:1, padding:"8px 0", background:"rgba(204,16,22,0.08)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(204,16,22,0.18)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(204,16,22,0.08)"}> ✕ Delete</button>
        </div>
        {isDeletedPosition&&(
          <div style={{ marginTop:10, padding:"8px 12px", background:"rgba(56,67,79,0.08)", border:"1px solid rgba(56,67,79,0.25)", borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ color:"#56687A", fontSize:12, fontWeight:600 }}>⚠ Position deleted — use Profile Matching tab to re-submit.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteModal({ candidateName, onConfirm, onCancel }) {
  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth:420, textAlign:"center", border:"1px solid rgba(204,16,22,0.25)" }}>
        <div style={{ padding:36 }}>
          <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(204,16,22,0.1)", border:"1px solid rgba(204,16,22,0.3)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", fontSize:22, boxShadow:"0 0 20px rgba(204,16,22,0.2)" }}>✕</div>
          <h3 style={{ color:"var(--t1)", fontSize:18, fontWeight:800, margin:"0 0 8px" }}>Delete Candidate</h3>
          <p style={{ color:"var(--t2)", fontSize:14, margin:"0 0 28px", lineHeight:1.6 }}>Remove <strong style={{ color:"#CC1016" }}>{candidateName}</strong>?<br/>Resume and stage history will also be deleted.</p>
          <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
            <button onClick={onCancel} style={{ padding:"10px 24px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
            <button onClick={onConfirm} style={{ padding:"10px 24px", background:"linear-gradient(135deg,#CC1016,#b91c1c)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, boxShadow:"0 4px 16px rgba(204,16,22,0.3)" }}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({ row, onSave, onCancel }) {
  const [form,setForm] = useState({...row, stageDate:new Date().toISOString().split("T")[0]});
  const keys = ["Candidate Name","Profile Shared on","Assessed By","Assessment on/To be scheduled","Status"];
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <div><div style={S.eyebrow}>Edit Candidate</div><h3 style={{ color:"var(--t1)", margin:"3px 0 0", fontSize:18, fontWeight:800 }}>{row["Candidate Name"]}</h3></div>
          <button onClick={onCancel} style={S.closeBtn}>✕</button>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <div style={{ background:"var(--l02)", border:"1px solid rgba(10,102,194,0.15)", borderRadius:12, padding:"14px 16px", marginBottom:18 }}>
            <PipelineProgress currentStage={form["Status"]}/>
          </div>
          <div style={{ background:"var(--l02)", border:"1px solid var(--l08)", borderRadius:10, padding:"12px 16px", marginBottom:18 }}>
            <div style={S.sectionLabel}>Position Info</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 16px", marginTop:8 }}>
              {/* key labels and values bumped from #334155/#64748b → #64748b/#94a3b8 */}
              {["Role","WIPPX","Location","Manager"].map(k=><div key={k}><span style={{ color:"var(--t3)", fontSize:11 }}>{k}: </span><span style={{ color:"var(--t2)", fontSize:12, fontWeight:600 }}>{k==="Manager" ? humanizeName(row[k]) || "—" : row[k]||"—"}</span></div>)}
            </div>
          </div>
          {keys.map(key=>(
            <div key={key} style={{ marginBottom:14 }}>
              {/* form labels bumped from #334155 → #64748b */}
              <label style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, display:"block", marginBottom:5 }}>{key}</label>
              {key==="Status" ? (
                <>
                  <select value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} style={S.formField}>
                    <optgroup label="Interview Stages" style={{ background:"var(--pg-bg)" }}>{PROGRESS_STAGES.map(s=><option key={s} value={s} style={{ background:"var(--pg-bg)" }}>{s}</option>)}</optgroup>
                    <optgroup label="Rejected"         style={{ background:"var(--pg-bg)" }}>{REJECT_STAGES.map(s=><option key={s} value={s} style={{ background:"var(--pg-bg)" }}>{s}</option>)}</optgroup>
                  </select>
                  {form["Status"]&&<div style={{ marginTop:8 }}><StageBadge status={form["Status"]}/></div>}
                  <div style={{ marginTop:12 }}>
                    <label style={{ color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, display:"block", marginBottom:5 }}>Stage Date</label>
                    <input type="date" value={form.stageDate||""} onChange={e=>setForm({...form,stageDate:e.target.value})} style={{ ...S.formField, colorScheme:"normal" }}/>
                  </div>
                </>
              ) : <input value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} style={S.formField}/>}
            </div>
          ))}
          <div style={{ display:"flex", gap:10, marginTop:8 }}>
            <button onClick={onCancel} style={{ flex:1, padding:"11px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600 }}>Cancel</button>
            <button onClick={()=>onSave(form)} style={{ flex:2, padding:"11px", background:"linear-gradient(135deg,#0A66C2,#004182)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, boxShadow:"0 4px 16px rgba(10,102,194,0.3)" }}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumePreviewTab({ candidateName }) {
  const [loaded,  setLoaded]  = useState(false);
  const [error,   setError]   = useState(false);
  const filename = candidateName.replace(/ /g,"_") + ".docx";
  const src = `${API}/get-resume-html/${encodeURIComponent(filename)}`;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--l06)", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <span style={{ color:"var(--t3)", fontSize:12, fontWeight:600, flex:1 }}>Resume Preview</span>
        <a href={`${API}/download-resume/${filename}`} download target="_blank" rel="noreferrer"
          style={{ padding:"7px 16px", background:"linear-gradient(135deg,#0ea5e9,#0284c7)", color:"white", borderRadius:8, fontSize:12, fontWeight:700, textDecoration:"none", display:"flex", alignItems:"center", gap:6, boxShadow:"0 4px 12px rgba(14,165,233,0.3)" }}>
          ↓ Download Resume
        </a>
      </div>
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        {!loaded && !error && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"var(--pg-bg)", zIndex:1 }}>
            <div style={S.spinner}/>
            <div style={{ color:"#0A66C2", fontSize:13, marginTop:16 }}>Loading resume...</div>
          </div>
        )}
        {error ? (
          <div style={{ padding:20 }}>
            <div style={{ padding:14, background:"rgba(204,16,22,0.06)", border:"1px solid rgba(204,16,22,0.2)", borderRadius:10, color:"#CC1016", fontSize:13 }}>
              Could not render resume. <a href={`${API}/download-resume/${filename}`} download style={{ color:"#0A66C2" }}>Download it instead.</a>
            </div>
          </div>
        ) : (
          <iframe
            src={src}
            title="Resume Preview"
            onLoad={()=>setLoaded(true)}
            onError={()=>{ setError(true); setLoaded(true); }}
            style={{ width:"100%", height:"100%", border:"none", background:"#ffffff" }}
            sandbox="allow-same-origin allow-scripts"
          />
        )}
      </div>
    </div>
  );
}

function ResumeVersionButton({ active, disabled, title, subtitle, onClick, href, onDownload }) {
  const border = disabled ? "var(--l07)" : active ? "rgba(10,102,194,0.45)" : "var(--l08)";
  const bg = disabled ? "var(--l03)" : active ? "rgba(10,102,194,0.14)" : "var(--l04)";
  const color = disabled ? "var(--t4)" : active ? "#0A66C2" : "var(--t2)";
  const dlStyle = { color:"#0A66C2", fontSize:11, fontWeight:700, textDecoration:"none", whiteSpace:"nowrap", background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:"inherit" };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ flex:1, minWidth:150, padding:"10px 12px", background:bg, border:`1px solid ${border}`, borderRadius:10, textAlign:"left", cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.65:1 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <span style={{ color, fontSize:12, fontWeight:800 }}>{title}</span>
        {onDownload ? (
          <button type="button" style={dlStyle} onClick={e=>{e.stopPropagation(); onDownload();}}>Download</button>
        ) : href&&(
          <a href={href} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={dlStyle}>
            Download
          </a>
        )}
      </div>
      <div style={{ color:disabled?"var(--t4)":"var(--t3)", fontSize:11, marginTop:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{subtitle}</div>
    </button>
  );
}

function ResumeFrame({ filename, url, label }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isDocx = filename?.toLowerCase().endsWith(".docx");
  const src = isDocx ? `${API}/get-resume-html/${encodeURIComponent(filename)}` : url;

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  if (!filename || !url) {
    return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:24, color:"var(--t3)", fontSize:13, textAlign:"center" }}>
        Resume version is not available yet.
      </div>
    );
  }

  return (
    <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
      {!loaded && !error && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"var(--pg-bg)", zIndex:1 }}>
          <div style={S.spinner}/>
          <div style={{ color:"#0A66C2", fontSize:13, marginTop:16 }}>Loading {label}...</div>
        </div>
      )}
      {error ? (
        <div style={{ padding:20 }}>
          <div style={{ padding:14, background:"rgba(204,16,22,0.06)", border:"1px solid rgba(204,16,22,0.2)", borderRadius:10, color:"#CC1016", fontSize:13 }}>
            Could not render this resume. <a href={url} target="_blank" rel="noreferrer" style={{ color:"#0A66C2" }}>Open it instead.</a>
          </div>
        </div>
      ) : (
        <iframe
          src={src}
          title={`${label} Preview`}
          onLoad={()=>setLoaded(true)}
          onError={()=>{ setError(true); setLoaded(true); }}
          style={{ width:"100%", height:"100%", border:"none", background:"#ffffff" }}
        />
      )}
    </div>
  );
}

function ResumeVersionsTab({ candidateName, role, location }) {
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("transformed");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const downloadMphasis = async () => {
    if (!versions?.transformed_filename) return;
    try {
      const res = await fetch(`${API}/download-resume/${encodeURIComponent(versions.transformed_filename)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = _buildMphasisFilename(candidateName, role, location);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) { console.error("Mphasis download failed", e); }
  };

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/resume-versions/${encodeURIComponent(candidateName)}`);
      if (!res.ok) throw new Error("Resume versions unavailable");
      const data = await res.json();
      setVersions(data);
      setSelectedVersion(prev => {
        if (prev === "transformed" && !data.transformed_filename && data.original_filename) return "original";
        if (prev === "original" && !data.original_filename && data.transformed_filename) return "transformed";
        if (!data[`${prev}_filename`]) return data.transformed_filename ? "transformed" : "original";
        return prev;
      });
    } catch {
      setVersions(null);
    } finally {
      setLoading(false);
    }
  }, [candidateName]);

  useEffect(() => {
    setLoading(true);
    setVersions(null);
    setSelectedVersion("transformed");
    loadVersions();
  }, [candidateName, loadVersions]);

  useEffect(() => {
    if (!versions || ["ready","completed","needs_review","failed"].includes(versions.formatting_status)) return;
    const timer = setInterval(loadVersions, 4000);
    return () => clearInterval(timer);
  }, [versions, loadVersions]);

  const retrySanitization = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`${API}/reformat-resume`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ candidate_name: candidateName }),
      });
      if (!res.ok) throw new Error("Retry failed");
      const data = await res.json();
      setVersions(prev => ({
        ...(prev || {}),
        formatting_status:data.formatting_status || "pending",
        formatting_error:"",
      }));
      setSelectedVersion("original");
      setTimeout(loadVersions, 1200);
    } catch {
      setVersions(prev => ({
        ...(prev || {}),
        formatting_status:"failed",
        formatting_error:"Could not start sanitization retry.",
      }));
    } finally {
      setRetrying(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("candidate_name", candidateName);
      fd.append("file", file);
      const res = await fetch(`${API}/upload-resume`, { method:"POST", body:fd });
      if (!res.ok) { setUploadMsg("Upload failed. Try again."); return; }
      setUploadMsg("Uploaded! Mphasis sanitization running in background...");
      setTimeout(loadVersions, 1500);
    } catch { setUploadMsg("Upload failed."); }
    finally { setUploading(false); }
  };

  const status = versions?.formatting_status || "";
  const isNotGenerated = status === "failed" && (versions?.formatting_error || "").toLowerCase().includes("not been generated");
  const statusText = status === "ready" || status === "completed" ? "Mphasis resume ready"
    : status === "needs_review" ? "Mphasis resume needs review"
    : isNotGenerated ? "Mphasis resume not generated"
    : status === "failed" ? "Sanitization failed"
    : status === "validating" ? "Validating sanitized resume"
    : status === "running" ? "Mphasis sanitization in progress"
    : status === "pending" ? "Mphasis sanitization queued"
    : "Resume files";
  const validation = versions?.validation || {};
  const confidence = versions?.validation_confidence || validation.confidence || "";
  const confidenceColor = confidence === "High" ? "#168740" : confidence === "Medium" ? "#56687A" : "#CC1016";
  const activeFilename = selectedVersion === "original" ? versions?.original_filename : versions?.transformed_filename;
  const activeUrl = selectedVersion === "original" ? versions?.original_url : versions?.transformed_url;
  const activeLabel = selectedVersion === "original" ? "original resume" : "Mphasis resume";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--l06)", display:"flex", flexDirection:"column", gap:10, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ color:"var(--t3)", fontSize:12, fontWeight:700, flex:1 }}>Resume Preview</span>
          {versions?.formatting_error&&<span style={{ color:"#CC1016", fontSize:11, fontWeight:700 }}>{versions.formatting_error}</span>}
          {!versions?.formatting_error&&<span style={{ color:(status==="ready"||status==="completed")?"#168740":status==="failed"?"#CC1016":"#56687A", fontSize:11, fontWeight:700 }}>{statusText}</span>}
          {(isNotGenerated || status==="failed" || status==="needs_review")&&(
            <button onClick={retrySanitization} disabled={retrying}
              style={{ padding:"6px 12px", background:retrying?"rgba(10,102,194,0.08)":"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.28)", borderRadius:8, cursor:retrying?"default":"pointer", fontSize:11, fontWeight:800, whiteSpace:"nowrap" }}>
              {retrying ? "Starting..." : "Retry Sanitization"}
            </button>
          )}
        </div>
        {confidence&&(
          <div style={{ padding:"9px 11px", background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, color:"var(--t3)", fontSize:12 }}>
            Content preservation: <span style={{ color:confidenceColor, fontWeight:800 }}>{confidence}</span>
            {validation.score!==undefined&&validation.score!==null ? ` · ${validation.score}% verified` : ""}
            {validation.issues?.length ? ` · ${validation.issues[0]}` : ""}
          </div>
        )}
        {loading ? (
          <div style={{ padding:10, background:"var(--l04)", border:"1px solid var(--l07)", borderRadius:10, color:"var(--t3)", fontSize:12 }}>Loading resume versions...</div>
        ) : (
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <ResumeVersionButton
              active={selectedVersion==="original"}
              disabled={!versions?.original_filename}
              title="Original Resume"
              subtitle={versions?.original_filename || "No original file found"}
              href={versions?.original_url}
              onClick={()=>setSelectedVersion("original")}
            />
            <ResumeVersionButton
              active={selectedVersion==="transformed"}
              disabled={!versions?.transformed_filename}
              title="Mphasis Resume"
              subtitle={versions?.transformed_filename || (isNotGenerated ? "Not generated yet" : status==="failed" ? "Sanitization failed" : "Sanitizing in background")}
              onDownload={versions?.transformed_filename ? downloadMphasis : undefined}
              onClick={()=>setSelectedVersion("transformed")}
            />
          </div>
        )}
      </div>
      {!loading && !versions?.original_filename && !versions?.transformed_filename ? (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:32, textAlign:"center" }}>
          <div style={{ fontSize:40, opacity:0.12 }}>📄</div>
          <div style={{ color:"var(--t2)", fontSize:14, fontWeight:700 }}>No resume uploaded yet</div>
          <div style={{ color:"var(--t3)", fontSize:13, maxWidth:300 }}>Upload a .docx or .pdf file to enable resume preview, AI analysis, and Mphasis sanitization.</div>
          <label style={{ padding:"10px 24px", background:"linear-gradient(135deg,#0A66C2,#004182)", color:"white", borderRadius:10, cursor:uploading?"not-allowed":"pointer", fontWeight:700, fontSize:13, boxShadow:"0 4px 14px rgba(10,102,194,0.3)", opacity:uploading?0.7:1 }}>
            {uploading ? "Uploading..." : "Upload Resume"}
            <input type="file" accept=".docx,.pdf" style={{ display:"none" }} disabled={uploading} onChange={e=>handleUpload(e.target.files[0])}/>
          </label>
          {uploadMsg && <div style={{ color:uploadMsg.includes("failed")?"#CC1016":"#168740", fontSize:12, fontWeight:600 }}>{uploadMsg}</div>}
        </div>
      ) : (
        <ResumeFrame filename={activeFilename} url={activeUrl} label={activeLabel}/>
      )}
    </div>
  );
}

function PreviousStageScoreItem({ score, rubricItems = [] }) {
  const [open, setOpen] = useState(false);
  const overall = Number(score.overall_score || 0);
  const tone = overall >= 75
    ? { color:"#168740", bg:"rgba(22,135,64,0.08)", border:"rgba(22,135,64,0.22)" }
    : overall >= 50
      ? { color:"#38434F", bg:"rgba(56,67,79,0.08)", border:"rgba(56,67,79,0.22)" }
      : { color:"#CC1016", bg:"rgba(204,16,22,0.08)", border:"rgba(204,16,22,0.22)" };
  const rubricById = new Map((rubricItems || []).map(item => [Number(item.id), item]));
  const itemRows = (score.item_scores || []).slice(0, 5).map(item => {
    const rubricItem = rubricById.get(Number(item.rubric_item_id));
    return {
      skill:item.skill || rubricItem?.skill || "Skill",
      score:normalizeInterviewScore(item.score),
      evidence:item.evidence || item.notes || "",
    };
  });
  return (
    <div
      onMouseEnter={()=>setOpen(true)}
      onMouseLeave={()=>setOpen(false)}
      style={{ display:"grid", gridTemplateColumns:"18px minmax(150px,1fr) auto", columnGap:8, alignItems:"center", minWidth:260, position:"relative", padding:"4px 6px", borderRadius:14, cursor:"default" }}
    >
      <span style={{ width:18, height:18, borderRadius:"50%", background:tone.color, border:"3px solid var(--pg-bg)", boxShadow:`0 0 0 2px ${tone.border}`, zIndex:1 }}/>
      <div style={{ minWidth:0, zIndex:1 }}>
        <div style={{ color:"var(--t1)", fontSize:12, fontWeight:800, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{score.stage || "Previous stage"}</div>
        <div style={{ color:"var(--t3)", fontSize:11, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{humanizeName(score.scorer) || "No interviewer"} - {score.reviewer_type || "Reviewer"}</div>
      </div>
      <div style={{ color:tone.color, background:tone.bg, border:`1px solid ${tone.border}`, borderRadius:999, padding:"5px 10px", fontSize:15, fontWeight:950, zIndex:1 }}>{score.overall_score}</div>
      {open && (
        <div style={{ position:"absolute", left:8, top:42, width:340, maxWidth:"min(340px, 82vw)", background:"var(--pg-bg)", border:"1px solid var(--l08)", borderRadius:14, boxShadow:"0 22px 55px rgba(15,23,42,0.22)", padding:14, zIndex:50 }}>
          <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", marginBottom:10 }}>
            <div>
              <div style={{ color:"var(--t3)", fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:0.8 }}>Previous stage</div>
              <div style={{ color:"var(--t1)", fontSize:14, fontWeight:950, marginTop:2 }}>{score.stage || "Interview"}</div>
              <div style={{ color:"var(--t3)", fontSize:11, marginTop:2 }}>{humanizeName(score.scorer) || "No interviewer"} · {score.reviewer_type || "Reviewer"}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:tone.color, fontSize:22, fontWeight:950, lineHeight:1 }}>{score.overall_score}</div>
              <div style={{ color:"var(--t4)", fontSize:9, fontWeight:800, marginTop:2 }}>overall</div>
            </div>
          </div>
          <div style={{ height:4, background:"var(--l06)", borderRadius:20, overflow:"hidden", marginBottom:10 }}>
            <div style={{ width:`${Math.max(0, Math.min(100, overall))}%`, height:"100%", background:tone.color, borderRadius:20 }}/>
          </div>
          {(score.recommendation || score.notes) && (
            <div style={{ background:"var(--l03)", border:"1px solid var(--l06)", borderRadius:10, padding:10, marginBottom:10 }}>
              {score.recommendation && <div style={{ color:"var(--t2)", fontSize:11, fontWeight:800, marginBottom:4 }}>{score.recommendation}</div>}
              {score.notes && <div style={{ color:"var(--t3)", fontSize:11, lineHeight:1.45 }}>{score.notes}</div>}
            </div>
          )}
          {itemRows.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {itemRows.map((item, idx) => (
                <div key={`${item.skill}-${idx}`} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"start", padding:"7px 0", borderTop:idx ? "1px solid var(--l05)" : "none" }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ color:"var(--t2)", fontSize:11, fontWeight:800, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.skill}</div>
                    {item.evidence && <div style={{ color:"var(--t4)", fontSize:10, lineHeight:1.35, marginTop:2, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{item.evidence}</div>}
                  </div>
                  <span style={{ color:tone.color, background:tone.bg, border:`1px solid ${tone.border}`, borderRadius:8, padding:"3px 7px", fontSize:11, fontWeight:950 }}>{item.score}/10</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color:"var(--t4)", fontSize:11 }}>No skill-level comments were saved for this stage.</div>
          )}
        </div>
      )}
    </div>
  );
}

function RubricScoreTab({ row, history = [], onStageDecision }) {
  const [rubric, setRubric] = useState(null);
  const [scores, setScores] = useState([]);
  const [allScores, setAllScores] = useState([]);
  const currentStage = row["Status"] || "L1 Scheduled";
  const trackEntry = [...(history || [])].reverse().find(entry => (entry.stage || "").trim() === currentStage.trim()) || [...(history || [])].reverse()[0] || {};
  const trackScorer = humanizeName(trackEntry.interviewer || trackEntry.scorer || trackEntry.assessed_by || trackEntry.assessedBy || row["Assessed By"] || row["Manager"] || "");
  const defaultScorer = trackScorer;
  const [form, setForm] = useState({ scorer:defaultScorer, recommendation:"", notes:"" });
  const [itemScores, setItemScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("Saved");
  const [dirty, setDirty] = useState(false);
  const autosaveTimer = useRef(null);
  const role = row["Role"] || "";
  const positionCode = row["Position Code"] || "";
  const candidateName = row["Candidate Name"] || "";
  const interviewerName = trackScorer || form.scorer || "";
  const reviewerType = (() => {
    const stage = currentStage.toLowerCase();
    if (stage.includes("client")) return "Client";
    if (stage.includes("dm") || stage.includes("l2")) return "L2";
    return "L1";
  })();
  const interviewType = (() => {
    const stage = currentStage.toLowerCase();
    if (stage.includes("client")) return "Client Interview";
    if (stage.includes("dm") || stage.includes("l2")) return "L2 / DM Interview";
    if (stage.includes("l1")) return "L1 Interview";
    return currentStage;
  })();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const rubricQuery = positionCode
          ? `position_code=${encodeURIComponent(positionCode)}&role=${encodeURIComponent(role)}`
          : `role=${encodeURIComponent(role)}`;
        const activeRes = await fetch(`${API}/rubrics/active?${rubricQuery}`);
        const active = activeRes.ok ? await activeRes.json() : null;
        const scoreRes = await fetch(`${API}/candidate-rubric-score?candidate_name=${encodeURIComponent(candidateName)}&role=${encodeURIComponent(role)}&stage=${encodeURIComponent(currentStage)}`);
        const allScoreRes = await fetch(`${API}/candidate-rubric-score?candidate_name=${encodeURIComponent(candidateName)}&role=${encodeURIComponent(role)}`);
        const savedScores = scoreRes.ok ? await scoreRes.json() : [];
        const savedAllScores = allScoreRes.ok ? await allScoreRes.json() : [];
        if (!alive) return;
        const savedList = Array.isArray(savedScores) ? savedScores : [];
        const savedAllList = Array.isArray(savedAllScores) ? savedAllScores : [];
        const latestScore = savedList[0] || null;
        const savedByItem = new Map((latestScore?.item_scores || []).map(s => [Number(s.rubric_item_id), s]));
        setRubric(active);
        setScores(savedList);
        setAllScores(savedAllList);
        if (latestScore) {
          setForm({
            scorer:defaultScorer || latestScore.scorer || "",
            recommendation:latestScore.recommendation || "",
            notes:latestScore.notes || "",
          });
        } else {
          setForm(prev => ({
            ...prev,
            scorer:prev.scorer || defaultScorer,
          }));
        }
        setItemScores((active?.items || []).map(item => ({
          rubric_item_id:item.id,
          skill:item.skill,
          score:normalizeInterviewScore(savedByItem.get(Number(item.id))?.score || 1),
          observed_level:savedByItem.get(Number(item.id))?.observed_level || "None",
          evidence:savedByItem.get(Number(item.id))?.evidence || "",
          notes:savedByItem.get(Number(item.id))?.notes || "",
        })));
        setDirty(false);
      } catch {
        if (alive) {
          setRubric(null);
          setScores([]);
          setAllScores([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [role, positionCode, candidateName, defaultScorer, row["Status"]]);

  const updateScore = (index, key, value) => {
    setItemScores(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
    setDirty(true);
  };

  const commitScore = (index) => {
    setItemScores(prev => {
      const next = [...prev];
      next[index] = { ...next[index], score:normalizeInterviewScore(next[index]?.score) };
      return next;
    });
  };

  const saveScore = async (recommendationOverride = form.recommendation) => {
    if (!rubric) return;
    setSaveState("Saving...");
    try {
      const res = await fetch(`${API}/candidate-rubric-score`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          candidate_name:candidateName,
          role,
          position_code:row["Position Code"] || "",
          stage:currentStage,
          scorer:interviewerName,
          reviewer_type:reviewerType,
          rubric_id:rubric.id,
          recommendation:recommendationOverride,
          notes:form.notes,
          item_scores:itemScores.map(score => ({ ...score, score:normalizeInterviewScore(score.score) })),
        }),
      });
      const saved = await res.json();
      setScores(prev => [saved, ...prev.filter(score => Number(score.id) !== Number(saved.id))]);
      setAllScores(prev => [saved, ...prev.filter(score => Number(score.id) !== Number(saved.id))]);
      setSaveState("Saved");
      setDirty(false);
      return saved;
    } catch {
      setSaveState("Save failed");
      return null;
    }
  };

  useEffect(() => {
    if (!rubric || loading || !dirty) return;
    setSaveState("Autosaving...");
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveScore();
    }, 700);
    return () => clearTimeout(autosaveTimer.current);
  }, [itemScores, form.notes, rubric?.id, currentStage, candidateName, role, loading, dirty]);

  const decideStage = async (targetStage) => {
    clearTimeout(autosaveTimer.current);
    const saved = await saveScore(targetStage === rejectStage ? "Reject" : `Proceed to ${targetStage}`);
    if (saved && onStageDecision) {
      onStageDecision(targetStage, new Date().toISOString().split("T")[0], interviewerName);
    }
  };

  const normalizeStageName = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const previousStageScores = allScores.filter(score => normalizeStageName(score.stage) !== normalizeStageName(currentStage));
  const nextStage = nextInterviewStage(currentStage);
  const rejectStage = rejectStageFor(currentStage);

  if (loading) return <div style={{ padding:24, color:"var(--t3)" }}><div style={S.spinner}/>Loading rubric...</div>;
  if (!rubric) {
    return (
      <div style={{ padding:24, color:"var(--t3)", lineHeight:1.6 }}>
        No active validated rubric found for this role. Create and activate one from Position Management before scoring interviews.
      </div>
    );
  }

  return (
    <div style={{ padding:18, overflowY:"auto", flex:1 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:14 }}>
        <div>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:1 }}>Rubric Score</div>
          <div style={{ color:"var(--t1)", fontSize:16, fontWeight:800, marginTop:3 }}>{rubric.role}</div>
          {rubric.position_code && <div style={{ color:"var(--t3)", fontSize:11, marginTop:3 }}>Pulled from Position Management - {rubric.position_code}</div>}
        </div>
        {scores[0] && <div style={{ color:"#168740", fontSize:24, fontWeight:800 }}>{scores[0].overall_score}</div>}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:12, padding:14, border:"1px solid rgba(129,140,248,0.18)", borderRadius:16, background:"linear-gradient(135deg,rgba(10,102,194,0.12),rgba(20,184,166,0.08))", boxShadow:"0 14px 34px rgba(15,23,42,0.08)" }}>
        <div style={{ width:42, height:42, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"white", fontSize:13, fontWeight:800, background:"linear-gradient(135deg,#0A66C2,#14b8a6)", boxShadow:"0 10px 20px rgba(10,102,194,0.22)" }}>
          {initials(interviewerName || "NA")}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.8 }}>Current interviewer</div>
          <input
            value={form.scorer}
            onChange={e => { setForm(prev => ({...prev, scorer: e.target.value})); setDirty(true); }}
            placeholder="Not assigned"
            style={{ color:"var(--t1)", fontSize:16, fontWeight:800, marginTop:2, background:"transparent", border:"none", borderBottom:"1px solid rgba(129,140,248,0.35)", outline:"none", width:"100%", padding:"2px 0" }}
          />
        </div>
      </div>

      {previousStageScores.length > 0 && (
        <div style={{ marginBottom:12, padding:"12px 2px 2px", borderTop:"1px solid rgba(129,140,248,0.18)", background:"transparent" }}>
          <div style={{ color:"var(--t3)", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Previous stage scores</div>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", overflow:"visible", paddingBottom:8 }}>
            {previousStageScores.map(score => (
              <PreviousStageScoreItem key={score.id} score={score} rubricItems={rubric.items || []}/>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {(rubric.items || []).map((item, index) => (
          <div key={item.id} style={{ background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:12, padding:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:8 }}>
              <div>
                <div style={{ color:"var(--t1)", fontSize:13, fontWeight:800 }}>{item.skill}</div>
                <div style={{ color:"var(--t3)", fontSize:11, marginTop:2 }}>
                  {item.category} · Required {item.required_level} · Weight {item.weight}% · Weighted {weightedSkillScore(itemScores[index]?.score || 1, item.weight)} pts
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                <label style={{ color:"var(--t3)", fontSize:9, fontWeight:800, textTransform:"uppercase", letterSpacing:0.7 }}>Score 1-10</label>
                <input type="number" min="1" max="10" step="1" value={editableScoreValue(itemScores[index]?.score)} onChange={e=>updateScore(index,"score",e.target.value)} onBlur={()=>commitScore(index)}
                  style={{ ...S.formField, width:86, marginBottom:0, textAlign:"center", fontWeight:800 }}/>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"130px 1fr", gap:8 }}>
              <select value={itemScores[index]?.observed_level || "None"} onChange={e=>updateScore(index,"observed_level",e.target.value)} style={S.formField}>
                <option>None</option><option>Beginner</option><option>Competent</option><option>Expert</option>
              </select>
              <input value={itemScores[index]?.evidence || ""} onChange={e=>updateScore(index,"evidence",e.target.value)} placeholder="Evidence or interview observation" style={S.formField}/>
            </div>
          </div>
        ))}
      </div>

      <textarea value={form.notes} onChange={e=>{setForm({...form,notes:e.target.value});setDirty(true);}} rows={3} placeholder="Overall notes"
        style={{ ...S.formField, marginTop:12, resize:"vertical" }}/>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginTop:10, flexWrap:"wrap" }}>
        <span style={{ color:saveState==="Save failed"?"#CC1016":"var(--t3)", fontSize:11, fontWeight:800 }}>{saveState}</span>
        <div style={{ display:"flex", gap:10, flex:1, justifyContent:"flex-end" }}>
          <button onClick={()=>decideStage(rejectStage)} disabled={saveState==="Saving..."}
            style={{ minWidth:150, padding:"11px 16px", background:"rgba(204,16,22,0.12)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.35)", borderRadius:10, cursor:saveState==="Saving..."?"not-allowed":"pointer", fontWeight:800 }}>
            Reject
          </button>
          <button onClick={()=>decideStage(nextStage)} disabled={saveState==="Saving..."}
            style={{ minWidth:220, padding:"11px 16px", background:"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:10, cursor:saveState==="Saving..."?"not-allowed":"pointer", fontWeight:800 }}>
            Proceed to {nextStage}
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidatePanel({ row, history, isDeletedPosition, tab, onTabChange, onClose, onEdit, onDelete, onStageConfirm, onDeleteLastStage, onResubmit, submittedRoles }) {
  const [c1,c2] = avatarColors(row["Candidate Name"]||"");
  const TABS = [
    ["rubric","Rubric"],
    ["resume","📄 Resume"],
    ["ai","✦ Scoring"],
    ["match","◈ Matching"],
    ["track","▶ Track"],
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--pg-bg)" }}>
      <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--l07)", flexShrink:0, background:"var(--hdr-bg)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${c1},${c2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"white", flexShrink:0, boxShadow:`0 3px 10px ${c1}66` }}>
            {initials(row["Candidate Name"]||"")}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"var(--t1)", fontWeight:800, fontSize:14, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row["Candidate Name"]||"—"}</div>
            <div style={{ color:"#0A66C2", fontSize:11, fontWeight:600, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row["Role"]||"—"}</div>
          </div>
          <button onClick={onClose}
            style={{ background:"var(--l04)", border:"1px solid var(--l08)", color:"var(--t3)", borderRadius:8, width:28, height:28, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
            onMouseEnter={e=>e.currentTarget.style.background="var(--l09)"}
            onMouseLeave={e=>e.currentTarget.style.background="var(--l04)"}>✕</button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap", marginBottom:10 }}>
          <StageBadge status={row["Status"]}/>
          {row["WIPPX"]&&<span style={{ color:"var(--t3)", fontSize:11, fontFamily:"monospace", background:"var(--l05)", border:"1px solid var(--l09)", borderRadius:6, padding:"2px 8px" }}>{row["WIPPX"]}</span>}
          {row["Profile Shared on"]&&<span style={{ color:"var(--t3)", fontSize:11 }}>{fmt(row["Profile Shared on"])}</span>}
        </div>
        <div style={{ display:"flex", gap:2, background:"var(--l03)", borderRadius:10, padding:3 }}>
          {TABS.map(([key,label])=>(
            <button key={key} onClick={()=>onTabChange(key)}
              style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", cursor:"pointer", fontSize:11, fontWeight:700, transition:"all 0.15s",
                background:tab===key?"rgba(10,102,194,0.2)":"transparent",
                color:tab===key?"#0A66C2":"var(--t3)",
                boxShadow:tab===key?"0 0 10px rgba(10,102,194,0.15)":"none" }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
        {tab==="resume" && <ResumeVersionsTab candidateName={row["Candidate Name"]} role={row["Role"]} location={row["Location"]}/>}
        {tab==="ai"     && <div style={{ padding:"18px", overflowY:"auto", flex:1 }}><AIAnalysisContent candidateName={row["Candidate Name"]} role={row["Role"]}/></div>}
        {tab==="match"  && <ProfileMatchingTab candidateName={row["Candidate Name"]} candidateRole={row["Role"]} submittedRoles={submittedRoles||[]} onResubmit={onResubmit}/>}
        {tab==="rubric" && <RubricScoreTab row={row} history={history} onStageDecision={onStageConfirm}/>}
        {tab==="track"  && <TrackTab row={row} history={history} isDeletedPosition={isDeletedPosition} onEdit={onEdit} onDelete={onDelete} onStageConfirm={onStageConfirm} onDeleteLastStage={onDeleteLastStage}/>}
      </div>
    </div>
  );
}

function StatBar({ data }) {
  const selected = data.filter(r=>r["Status"]==="Selected").length;
  const rejected = data.filter(r=>REJECT_STAGES.includes(r["Status"])).length;
  const pipeline = data.filter(r=>PROGRESS_STAGES.includes(r["Status"])&&r["Status"]!=="Selected").length;
  const stats = [
    { label:"Total",    value:data.length, color:"#0A66C2", accent:"rgba(129,140,248,0.15)" },
    { label:"Pipeline", value:pipeline,    color:"#0A66C2", accent:"rgba(10,102,194,0.15)"  },
    { label:"Selected", value:selected,    color:"#168740", accent:"rgba(22,135,64,0.15)"  },
    { label:"Rejected", value:rejected,    color:"#CC1016", accent:"rgba(204,16,22,0.15)" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
      {stats.map(s=>(
        <div key={s.label} style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:12, padding:"12px 16px", position:"relative", overflow:"hidden", transition:"all 0.2s", cursor:"default" }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=s.color+"55";e.currentTarget.style.transform="translateY(-2px)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--l07)";e.currentTarget.style.transform="translateY(0)";}}>
          <div style={{ position:"absolute", top:-12, right:-12, width:50, height:50, borderRadius:"50%", background:s.accent, filter:"blur(14px)" }}/>
          <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"var(--t3)", marginBottom:6 }}>{s.label}</div>
          <div style={{ fontSize:26, fontWeight:800, color:s.color, lineHeight:1, letterSpacing:-1 }}>{s.value}</div>
          <div style={{ marginTop:8, height:2, background:"var(--l07)", borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${Math.min((s.value/Math.max(data.length,1))*100,100)}%`, background:s.color, borderRadius:2, boxShadow:`0 0 6px ${s.color}`, transition:"width 1s ease" }}/>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Candidates() {
  const { authData, session } = useAuth();
  const isAdmin = session?.role === "admin";
  const [data,setData]                     = useState([]);
  const [allHistory,setAllHistory]         = useState({});
  const [deletedPositions,setDeletedPos]   = useState({});
  const [search,setSearch]                 = useState("");
  const [stageFilter,setStageFilter]       = useState("");
  const [roleSearch,setRoleSearch]         = useState("");
  const [roleFilter,setRoleFilter]         = useState("");
  const [roleDropOpen,setRoleDropOpen]     = useState(false);
  const [selectedRow,setSelectedRow]       = useState(null);
  const [selectedTab,setSelectedTab]       = useState("resume");
  const [editingRow,setEditingRow]         = useState(null);
  const [deleteTarget,setDeleteTarget]     = useState(null);
  const [toast,setToast]                   = useState(null);
  const [loading,setLoading]               = useState(true);
  const [showSubmitModal,setShowSubmitModal] = useState(false);
  const [submitForm,setSubmitForm]           = useState({ role:"", candidateName:"", profileSharedOn:"", assessedBy:"", assessmentDate:"", status:"" });
  const [submitFile,setSubmitFile]           = useState(null);
  const [submitting,setSubmitting]           = useState(false);
  const [positions,setPositions]             = useState([]);
  const [submitAccount,setSubmitAccount]     = useState("");
  const [submitLob,setSubmitLob]             = useState("");
  const [submitAccPositions,setSubmitAccPositions] = useState(null);

  const showToast = (msg,type="success") => setToast({message:msg,type});

  const fetchCandidates = useCallback(()=>{
    setLoading(true);
    return fetch(`${API}/view-candidates`)
      .then(r=>r.json())
      .then(d=>{
        const rows = Array.isArray(d) ? d : Array.isArray(d?.value) ? d.value : [];
        setData(rows);
        setLoading(false);
        return rows;
      })
      .catch(()=>{setLoading(false);return [];});
  },[]);
  const fetchHistory = useCallback(()=>{
    fetch(`${API}/all-stage-history`).then(r=>r.json()).then(setAllHistory).catch(console.error);
  },[]);
  const fetchDeletedPositions = useCallback(()=>{
    fetch(`${API}/deleted-positions`).then(r=>r.json()).then(setDeletedPos).catch(()=>{});
  },[]);
  const fetchPositions = useCallback(()=>{
    fetch(`${API}/positions`).then(r=>r.json()).then(setPositions).catch(()=>{});
  },[]);
  useEffect(()=>{fetchCandidates();fetchHistory();fetchDeletedPositions();fetchPositions();},[]);

  useEffect(()=>{
    setSubmitLob("");
    if (!submitAccount) { setSubmitAccPositions(null); return; }
    const headers = isAdmin ? { "X-Account": submitAccount } : {};
    fetch(`${API}/positions`, { headers })
      .then(r=>r.json())
      .then(setSubmitAccPositions)
      .catch(()=>setSubmitAccPositions([]));
  }, [submitAccount]);

  const submitAccounts = isAdmin ? Object.keys(authData?.accounts || {}) : [...new Set((session?.workspaces||[]).map(w=>w.account))];
  const submitLobList  = submitAccount ? (authData?.accounts?.[submitAccount]?.lobs || []) : [];
  const basePositions  = submitAccPositions !== null ? submitAccPositions : positions;
  // Map role → owning account from positions that have _account_name
  const roleToAccount  = Object.fromEntries(positions.filter(p=>p._account_name).map(p=>[(p["Role"]||"").trim(), p._account_name]));
  const submitRoles    = [...new Set(
    basePositions
      .filter(p => !submitLob || (p["lob_name"] || "") === submitLob)
      .map(r => (r["Role"] || "").trim())
      .filter(Boolean)
  )].sort();

  // Page-level account + LOB filter
  const [filterAccount, setFilterAccount] = useState("");
  const [filterLob,     setFilterLob]     = useState("");
  const [filterAccData, setFilterAccData] = useState(null);
  const [filterAccPos,  setFilterAccPos]  = useState(null);

  const filterAccounts = isAdmin ? Object.keys(authData?.accounts || {}) : [...new Set((session?.workspaces||[]).map(w=>w.account))];
  const filterLobs     = filterAccount ? (authData?.accounts?.[filterAccount]?.lobs || []) : [];

  useEffect(() => {
    if (!filterAccount) { setFilterAccData(null); setFilterAccPos(null); setFilterLob(""); return; }
    // Use X-Accounts (not X-Account) so fetchWithAccount.js doesn't override it with __ALL__
    const headers = { "X-Accounts": filterAccount };
    Promise.all([
      fetch(`${API}/view-candidates`, { headers }).then(r => r.json()).catch(() => []),
      fetch(`${API}/positions`,       { headers }).then(r => r.json()).catch(() => []),
    ]).then(([cands, pos]) => { setFilterAccData(cands); setFilterAccPos(pos); });
    setFilterLob("");
  }, [filterAccount]);

  const activeCandidates = filterAccData !== null ? filterAccData : data;
  const activePositions  = filterAccPos  !== null ? filterAccPos  : positions;
  const rolesForLob      = filterLob
    ? new Set(activePositions.filter(p=>(p["lob_name"]||"")===filterLob).map(p=>(p["Role"]||"").trim()).filter(Boolean))
    : null;

  const allRoles = [...new Set(activePositions.map(r=>(r["Role"]||"").trim()).filter(Boolean))].sort();
  const roleSuggestions = roleSearch.trim()
    ? allRoles.filter(r=>r.toLowerCase().includes(roleSearch.toLowerCase()))
    : allRoles;

  const filtered = activeCandidates
    .filter(row=>{
      const n = (row["Candidate Name"]||"").toLowerCase().includes(search.toLowerCase());
      const s = stageFilter ? row["Status"]===stageFilter : true;
      const r = roleFilter  ? (row["Role"]||"").trim()===roleFilter : true;
      const l = filterLob ? (row["lob_name"]||"").trim() === filterLob : true;
      return n&&s&&r&&l;
    })
    .sort((a,b)=>{
      const da = new Date(a["Profile Shared on"]||0);
      const db = new Date(b["Profile Shared on"]||0);
      return db - da;
    });

  const handleStageConfirm = (row,ns,sd,interviewer="")=>{
    const p = new URLSearchParams({wippx:row["WIPPX"],candidate_name:row["Candidate Name"],status:ns,stage_date:sd,interviewer});
    fetch(`${API}/update-candidate-status?${p}`,{method:"PUT"}).then(r=>r.json())
      .then(d=>{
        if(d.error){showToast(d.error,"error");return;}
        fetchCandidates();fetchHistory();showToast(`${row["Candidate Name"]} → ${ns}`);
      })
      .catch(()=>showToast("Stage update failed","error"));
  };
  const handleDelLastStage = (cn,stage)=>{
    fetch(`${API}/delete-last-stage?candidate_name=${encodeURIComponent(cn)}&stage=${encodeURIComponent(stage)}`,{method:"DELETE"})
      .then(async r=>{ const d=await r.json(); if(!r.ok) throw new Error(d.detail||"Failed"); return d; })
      .then(()=>{fetchHistory();showToast(`Removed "${stage}"`);})
      .catch(e=>showToast(e.message||"Could not remove stage","error"));
  };
  const handleSave = (u)=>{
    fetch(`${API}/update-candidate`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(u)})
      .then(r=>r.json()).then(()=>{setEditingRow(null);fetchCandidates();fetchHistory();showToast("Candidate updated");}).catch(()=>showToast("Update failed","error"));
  };
  const confirmDelete = async ()=>{
    const {wippx,candidateName,role}=deleteTarget;
    try {
      const res = await fetch(`${API}/delete-candidate?wippx=${encodeURIComponent(wippx)}&candidate_name=${encodeURIComponent(candidateName)}&role=${encodeURIComponent(role||"")}`,{method:"DELETE"});
      if (!res.ok) {
        const body = await res.json().catch(()=>({detail:"Unknown error"}));
        showToast(body.detail || "Delete failed","error");
        return;
      }
      const body = await res.json().catch(()=>({}));
      if (body.resume_deleted === false) {
        // Other submissions remain — do NOT delete the resume files
      } else {
        await fetch(`${API}/delete-resume?candidate_name=${encodeURIComponent(candidateName)}`,{method:"DELETE"}).catch(()=>{});
      }
      setDeleteTarget(null);
      showToast(`${candidateName} deleted`);
      setTimeout(()=>window.location.reload(), 800);
    } catch(e) { showToast(e.message||"Delete failed","error"); }
  };
  const handleResubmit = (name,role,stage)=>{
    fetchCandidates();fetchHistory();showToast(`${name} re-submitted to "${role}" as ${stage}`);
  };

  const uploadResumeAfterSubmit = async (candidateName, file)=>{
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("candidate_name", candidateName);
      fd.append("file", file);
      const up = await fetch(`${API}/upload-resume`,{method:"POST",body:fd});
      if (!up.ok) {
        showToast(`Candidate submitted, but resume upload failed for ${candidateName}`,"error");
        return;
      }
      showToast(`Resume upload started for ${candidateName}. Mphasis sanitization will continue in background.`);
      fetchCandidates();
    } catch {
      showToast(`Candidate submitted, but resume upload failed for ${candidateName}`,"error");
    }
  };

  const handleSubmitCandidate = async (e)=>{
    e.preventDefault();
    if (!submitForm.role||!submitForm.candidateName||!submitForm.status){ showToast("Role, Candidate Name and Stage are required","error"); return; }
    setSubmitting(true);
    try {
      const resumeFile = submitFile;
      const res = await fetch(`${API}/submit-candidate`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ role:submitForm.role, candidateName:submitForm.candidateName, profileSharedOn:submitForm.profileSharedOn, assessedBy:submitForm.assessedBy, assessmentDate:submitForm.assessmentDate, status:submitForm.status, account_name:submitAccount||undefined, lob_name:submitLob||undefined }),
      });
      if (res.ok){
        setShowSubmitModal(false);
        const submittedName = submitForm.candidateName;
        const submittedRole = submitForm.role;
        if (resumeFile) {
          uploadResumeAfterSubmit(submittedName, resumeFile);
        }
        setSubmitForm({role:"",candidateName:"",profileSharedOn:"",assessedBy:"",assessmentDate:"",status:""});
        setSubmitFile(null);
        setSearch("");
        setStageFilter("");
        setRoleFilter("");
        setRoleSearch("");
        const latest = await fetchCandidates();
        fetchHistory();
        const nextRows = latest
          .filter(r=>r["Candidate Name"]&&String(r["Candidate Name"]).trim())
          .sort((a,b)=>new Date(b["Profile Shared on"]||0)-new Date(a["Profile Shared on"]||0));
        const nextRow = nextRows.find(r=>
          String(r["Candidate Name"]||"").trim().toLowerCase() === submittedName.trim().toLowerCase() &&
          String(r["Role"]||"").trim().toLowerCase() === submittedRole.trim().toLowerCase()
        );
        setSelectedRow(nextRow ? rowKey(nextRow) : null);
        setSelectedTab("resume");
        showToast(`${submitForm.candidateName} submitted to "${submitForm.role}" ✅`);
      } else {
        const err = await res.json();
        showToast(err.detail||"Submit failed","error");
      }
    } catch { showToast("Network error","error"); }
    finally { setSubmitting(false); }
  };

  const rowKey   = r => `${r["Candidate Name"]}|${r["Role"]}`;
  const selRow   = selectedRow ? (filtered.find(r => rowKey(r) === selectedRow) || data.find(r => rowKey(r) === selectedRow) || null) : null;
  const panelOpen = !!selRow;

  if (panelOpen) {
    return (
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", position:"relative" }}>
        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          ::-webkit-scrollbar{width:8px;height:8px}
          ::-webkit-scrollbar-track{background:var(--l03);border-radius:6px}
          ::-webkit-scrollbar-thumb{background:rgba(10,102,194,0.55);border-radius:6px;border:1px solid rgba(10,102,194,0.2)}
          ::-webkit-scrollbar-thumb:hover{background:rgba(10,102,194,0.85)}
          ::-webkit-scrollbar-corner{background:transparent}
          input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
        `}</style>
        <div style={S.gridOverlay}/>

        {/* ── LEFT COLUMN ── */}
        <div style={{ width:"50%", display:"flex", flexDirection:"column", borderRight:"1px solid var(--l07)", overflow:"hidden", position:"relative", zIndex:1 }}>

          {/* Compact header */}
          <div style={{ padding:"12px 18px 10px", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:10 }}>
              <div>
                <div style={{ color:"#004182", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1.5, marginBottom:1 }}>ATS · Candidates</div>
                <h1 style={{ color:"var(--t1)", fontSize:17, fontWeight:800, margin:0, letterSpacing:0 }}>Candidate Management</h1>
              </div>
              <button onClick={()=>{ const role=roleFilter||""; setSubmitForm(f=>({...f,role})); if(isAdmin&&role&&roleToAccount[role]) setSubmitAccount(roleToAccount[role]); setShowSubmitModal(true); }}
                style={{ padding:"7px 14px", background:"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, boxShadow:"0 4px 12px rgba(5,150,105,0.25)", whiteSpace:"nowrap", flexShrink:0 }}
                onMouseEnter={e=>e.currentTarget.style.opacity="0.88"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                + Submit
              </button>
            </div>

            {/* Compact stats */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
              {[
                { label:"Total",    value:data.length,                                                                            color:"#0A66C2" },
                { label:"Pipeline", value:data.filter(r=>PROGRESS_STAGES.includes(r["Status"])&&r["Status"]!=="Selected").length, color:"#0A66C2" },
                { label:"Selected", value:data.filter(r=>r["Status"]==="Selected").length,                                        color:"#168740" },
                { label:"Rejected", value:data.filter(r=>REJECT_STAGES.includes(r["Status"])).length,                             color:"#CC1016" },
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
                <button onClick={()=>setStageFilter("")} style={{ padding:"3px 10px", borderRadius:20, cursor:"pointer", fontSize:10, fontWeight:700, background:!stageFilter?"rgba(10,102,194,0.2)":"var(--l03)", color:!stageFilter?"#0A66C2":"var(--t3)", border:`1px solid ${!stageFilter?"rgba(10,102,194,0.4)":"var(--l08)"}`, boxShadow:!stageFilter?"0 0 8px rgba(10,102,194,0.15)":"none" }}>All·{data.length}</button>
                {ALL_STAGES.map(stage=>{
                  const m=STAGE_META[stage], active=stageFilter===stage, cnt=data.filter(r=>r["Status"]===stage).length;
                  if (!cnt&&!active) return null;
                  return (
                    <button key={stage} onClick={()=>setStageFilter(active?"":stage)}
                      style={{ padding:"3px 9px", borderRadius:20, cursor:"pointer", fontSize:10, fontWeight:700, background:active?m.bg:"var(--l03)", color:active?m.color:"var(--t3)", border:`1px solid ${active?m.border:"var(--l08)"}`, display:"flex", alignItems:"center", gap:3 }}>
                      {active&&<GlowDot color={m.color} size={4}/>}{stage}·{cnt}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:6, position:"relative", zIndex:10, flexWrap:"wrap" }}>
                {filterAccounts.length > 0 && (
                  <select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)}
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
                  <input type="text" placeholder="Search candidates..." value={search} onChange={e=>setSearch(e.target.value)}
                    style={{ padding:"6px 10px 6px 28px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:12, width:"100%", outline:"none", boxSizing:"border-box" }}
                    onFocus={e=>e.target.style.borderColor="rgba(10,102,194,0.5)"} onBlur={e=>e.target.style.borderColor="var(--l08)"}/>
                </div>
                <div style={{ position:"relative", flex:1 }}>
                  <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--t3)", fontSize:11, pointerEvents:"none" }}>◈</span>
                  <input type="text" placeholder="Filter by role..." value={roleFilter?roleFilter:roleSearch}
                    onChange={e=>{setRoleSearch(e.target.value);setRoleFilter("");setRoleDropOpen(true);}}
                    onFocus={()=>setRoleDropOpen(true)} onBlur={()=>setTimeout(()=>setRoleDropOpen(false),150)}
                    style={{ padding:"6px 26px 6px 28px", background:roleFilter?"rgba(10,102,194,0.12)":"var(--l04)", border:`1px solid ${roleFilter?"rgba(10,102,194,0.45)":"var(--l08)"}`, borderRadius:8, color:roleFilter?"#0A66C2":"var(--t1)", fontSize:12, width:"100%", outline:"none", boxSizing:"border-box" }}/>
                  {roleFilter&&<button onClick={()=>{setRoleFilter("");setRoleSearch("");}} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--t3)", cursor:"pointer", fontSize:13, lineHeight:1, padding:2 }}>✕</button>}
                  {roleDropOpen&&roleSuggestions.length>0&&!roleFilter&&(
                    <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"var(--drop-bg)", border:"1px solid rgba(10,102,194,0.3)", borderRadius:8, zIndex:50, maxHeight:180, overflowY:"auto", boxShadow:"0 12px 40px rgba(0,0,0,0.6)" }}>
                      {roleSuggestions.map(role=>(
                        <div key={role} onMouseDown={()=>{setRoleFilter(role);setRoleSearch("");setRoleDropOpen(false);}}
                          style={{ padding:"7px 12px", cursor:"pointer", fontSize:12, color:"var(--t2)", borderBottom:"1px solid var(--l07)" }}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.12)"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          <span style={{ color:"#0A66C2", marginRight:6, fontSize:10 }}>◈</span>{role}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable table */}
          <div style={{ flex:1, overflow:"auto", borderTop:"1px solid var(--l07)" }}>
            {loading ? (
              <div style={{ textAlign:"center", padding:"60px 0" }}><div style={S.spinner}/><div style={{ color:"#004182", fontSize:13, fontWeight:700, marginTop:16 }}>Loading candidates...</div></div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:"60px 0" }}>
                <div style={{ fontSize:40, marginBottom:10, opacity:0.12, color:"#0A66C2" }}>◈</div>
                <div style={{ fontSize:14, fontWeight:700, color:"var(--t3)" }}>No candidates found</div>
                <div style={{ fontSize:12, color:"var(--t4)", marginTop:4 }}>Adjust your search or stage filter</div>
              </div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                <thead>
                  <tr>
                    {MAIN_COLUMNS.map(col=>(
                      <th key={col.key} style={{ width:col.width, padding:"10px 14px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", whiteSpace:"nowrap", position:"sticky", top:0, zIndex:3 }}>{col.label}</th>
                    ))}
                    <th style={{ width:"14%", padding:"10px 14px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", position:"sticky", top:0, zIndex:3 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row,idx)=>{
                    const hist=allHistory[row["Candidate Name"]]||[];
                    const isRej=REJECT_STAGES.includes(row["Status"]);
                    const isDelPos=Object.keys(deletedPositions).includes((row["Role"]||"").trim());
                    const isSel=selectedRow===rowKey(row);
                    const [c1,c2]=avatarColors(row["Candidate Name"]||"");
                    const m=STAGE_META[row["Status"]]||STAGE_META["Rejected"];
                    return (
                      <tr key={`r-${idx}`} onClick={()=>{if(isSel){setSelectedRow(null);}else{setSelectedRow(rowKey(row));setSelectedTab("resume");}}}
                        style={{ borderBottom:"1px solid var(--l05)", cursor:"pointer",
                          background:isSel?"rgba(10,102,194,0.08)":isDelPos?"rgba(56,67,79,0.04)":"transparent",
                          borderLeft:isSel?"3px solid #0A66C2":isDelPos?"3px solid rgba(56,67,79,0.5)":"3px solid transparent" }}
                        onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background=isDelPos?"rgba(56,67,79,0.08)":"var(--l03)";}}
                        onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background=isDelPos?"rgba(56,67,79,0.04)":"transparent";}}>
                        <td style={{ padding:"10px 14px", overflow:"hidden" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:30, height:30, borderRadius:9, background:`linear-gradient(135deg,${c1},${c2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"white", flexShrink:0, boxShadow:`0 3px 8px ${c1}66` }}>
                              {initials(row["Candidate Name"]||"")}
                            </div>
                            <div style={{ overflow:"hidden" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                <span style={{ color:"var(--t1)", fontWeight:700, fontSize:12, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row["Candidate Name"]||"—"}</span>
                                {isDelPos&&<span style={{ padding:"1px 5px", background:"rgba(56,67,79,0.12)", color:"#56687A", border:"1px solid rgba(56,67,79,0.3)", borderRadius:20, fontSize:9, fontWeight:700, whiteSpace:"nowrap" }}>Pos. Deleted</span>}
                              </div>
                              {row["Location"]&&<div style={{ color:"var(--t3)", fontSize:10, marginTop:1 }}>{row["Location"]}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding:"10px 14px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          <span style={{ color:isDelPos?"#56687A":"#0A66C2", fontSize:12, fontWeight:600, textDecoration:isDelPos?"line-through":"none", opacity:isDelPos?0.7:1 }}>{row["Role"]||"—"}</span>
                        </td>
                        <td style={{ padding:"10px 14px" }}>
                          <span style={{ color:"var(--t3)", fontSize:10, fontFamily:"monospace", background:"var(--l05)", border:"1px solid var(--l09)", borderRadius:6, padding:"2px 6px" }}>{row["WIPPX"]||"—"}</span>
                        </td>
                        <td style={{ padding:"10px 14px", fontSize:11, color:"var(--t3)", whiteSpace:"nowrap" }}>{fmt(row["Profile Shared on"])}</td>
                        <td style={{ padding:"10px 14px", overflow:"hidden" }}><StageBadge status={row["Status"]}/></td>
                        <td style={{ padding:"10px 14px", fontSize:11, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["account_name"]||"—"}</td>
                        <td style={{ padding:"10px 14px", fontSize:11, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["lob_name"]||"—"}</td>
                        <td style={{ padding:"10px 14px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <button onClick={e=>{e.stopPropagation();setDeleteTarget({wippx:row["WIPPX"],candidateName:row["Candidate Name"],role:row["Role"]});}}
                              style={{ padding:"4px 8px", background:"rgba(204,16,22,0.07)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:7, cursor:"pointer", fontSize:12, lineHeight:1 }}
                              onMouseEnter={e=>{e.currentTarget.style.background="rgba(204,16,22,0.18)";e.currentTarget.style.borderColor="rgba(204,16,22,0.4)";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="rgba(204,16,22,0.07)";e.currentTarget.style.borderColor="rgba(204,16,22,0.18)";}}>
                              🗑
                            </button>
                            {hist.length>0&&<span style={{ padding:"2px 6px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:20, fontSize:9, fontWeight:700 }}>{hist.length}</span>}
                            {(isRej||isDelPos)&&<span style={{ padding:"2px 6px", background:isDelPos?"rgba(56,67,79,0.12)":m.bg, color:isDelPos?"#56687A":m.color, border:`1px solid ${isDelPos?"rgba(56,67,79,0.3)":m.border}`, borderRadius:20, fontSize:9, fontWeight:700 }}>↗</span>}
                          </div>
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
          <CandidatePanel
            row={selRow}
            history={allHistory[selRow["Candidate Name"]]||[]}
            isDeletedPosition={Object.keys(deletedPositions).includes((selRow["Role"]||"").trim())}
            tab={selectedTab}
            onTabChange={setSelectedTab}
            onClose={()=>setSelectedRow(null)}
            onEdit={()=>{setEditingRow(selRow);setSelectedRow(null);}}
            onDelete={()=>setDeleteTarget({wippx:selRow["WIPPX"],candidateName:selRow["Candidate Name"],role:selRow["Role"]})}
            onStageConfirm={(s,d,i)=>handleStageConfirm(selRow,s,d,i)}
            onDeleteLastStage={stage=>handleDelLastStage(selRow["Candidate Name"],stage)}
            onResubmit={handleResubmit}
            submittedRoles={data.filter(r=>String(r["Candidate Name"]||"").trim().toLowerCase()===String(selRow["Candidate Name"]||"").trim().toLowerCase()).map(r=>r["Role"]||"")}
          />
        </div>

        {editingRow   && <EditModal row={editingRow} onSave={handleSave} onCancel={()=>setEditingRow(null)}/>}
        {deleteTarget && <DeleteModal candidateName={deleteTarget.candidateName} onConfirm={confirmDelete} onCancel={()=>setDeleteTarget(null)}/>}
        {toast        && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}
        {showSubmitModal&&(
          <div style={S.overlay}>
            <div style={{...S.modal,maxWidth:500}}>
              <div style={S.modalHead}>
                <div>
                  <div style={S.eyebrow}>New Submission</div>
                  <h3 style={{color:"var(--t1)",margin:"3px 0 0",fontSize:18,fontWeight:800}}>Submit Candidate</h3>
                </div>
                <button onClick={()=>setShowSubmitModal(false)} style={S.closeBtn}>✕</button>
              </div>
              <form onSubmit={handleSubmitCandidate} style={{padding:"20px 24px"}}>
                {isAdmin && submitAccounts.length > 0 && (
                  <div style={{marginBottom:14}}>
                    <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Account</label>
                    <select value={submitAccount} onChange={e=>setSubmitAccount(e.target.value)} style={S.formField}>
                      <option value="" style={{background:"var(--pg-bg)"}}>All accounts</option>
                      {submitAccounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
                    </select>
                  </div>
                )}
                {submitLobList.length > 0 && (
                  <div style={{marginBottom:14}}>
                    <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>LOB</label>
                    <select value={submitLob} onChange={e=>setSubmitLob(e.target.value)} style={S.formField}>
                      <option value="" style={{background:"var(--pg-bg)"}}>All LOBs</option>
                      {submitLobList.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
                    </select>
                  </div>
                )}
                <div style={{marginBottom:14}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Role *</label>
                  <select value={submitForm.role} onChange={e=>setSubmitForm({...submitForm,role:e.target.value})} style={S.formField} required>
                    <option value="" style={{background:"var(--pg-bg)"}}>Select a role…</option>
                    {submitRoles.map(r=><option key={r} value={r} style={{background:"var(--pg-bg)"}}>{r}</option>)}
                  </select>
                </div>
                {[
                  {key:"candidateName",   label:"Candidate Name *", type:"text",  required:true},
                  {key:"profileSharedOn", label:"Profile Shared On", type:"date",  required:false},
                  {key:"assessedBy",      label:"Assessed By",       type:"text",  required:false},
                  {key:"assessmentDate",  label:"Assessment Date",   type:"date",  required:false},
                ].map(({key,label,type,required})=>(
                  <div key={key} style={{marginBottom:14}}>
                    <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>{label}</label>
                    <input type={type} value={submitForm[key]} onChange={e=>setSubmitForm({...submitForm,[key]:e.target.value})}
                      style={{...S.formField,colorScheme:"normal"}} required={required}/>
                  </div>
                ))}
                <div style={{marginBottom:14}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Stage *</label>
                  <select value={submitForm.status} onChange={e=>setSubmitForm({...submitForm,status:e.target.value})} style={S.formField} required>
                    <option value="" style={{background:"var(--pg-bg)"}}>Select stage…</option>
                    <optgroup label="Interview Stages" style={{background:"var(--pg-bg)"}}>
                      {["L1 Scheduled","Client Interview Scheduled","DM Interview Scheduled","Selected"].map(s=><option key={s} style={{background:"var(--pg-bg)"}}>{s}</option>)}
                    </optgroup>
                    <optgroup label="Rejected" style={{background:"var(--pg-bg)"}}>
                      {["L1 Reject","Client Reject","DM Reject","Rejected"].map(s=><option key={s} style={{background:"var(--pg-bg)"}}>{s}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div style={{marginBottom:20}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Resume (.docx, .pdf)</label>
                  <input type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setSubmitFile(e.target.files[0])} style={{color:"var(--t2)",fontSize:13}}/>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button type="button" onClick={()=>setShowSubmitModal(false)} style={{flex:1,padding:"11px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:10,cursor:"pointer",fontWeight:600}}>Cancel</button>
                  <button type="submit" disabled={submitting} style={{flex:2,padding:"11px",background:submitting?"rgba(5,150,105,0.4)":"linear-gradient(135deg,#0D6B35,#047857)",color:"white",border:"none",borderRadius:10,cursor:submitting?"not-allowed":"pointer",fontWeight:700,boxShadow:"0 4px 16px rgba(5,150,105,0.3)"}}>
                    {submitting?"Submitting…":"Submit Candidate"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

        /* ── Scrollbar — thicker and more visible ── */
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-track{background:var(--l03);border-radius:6px}
        ::-webkit-scrollbar-thumb{background:rgba(10,102,194,0.55);border-radius:6px;border:1px solid rgba(10,102,194,0.2)}
        ::-webkit-scrollbar-thumb:hover{background:rgba(10,102,194,0.85)}
        ::-webkit-scrollbar-corner{background:transparent}

        input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
      `}</style>
      <div style={S.gridOverlay}/>

      {/* HEADER */}
      <div style={{ marginBottom:14, position:"relative", zIndex:1, animation:"fadeUp 0.4s ease", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, padding:"0 36px" }}>
        <div>
          <div style={{ color:"#004182", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:2, marginBottom:2 }}>ATS · Candidates</div>
          <h1 style={{ color:"var(--t1)", fontSize:20, fontWeight:800, margin:0, letterSpacing:0 }}>Candidate Management</h1>
        </div>
        <button onClick={()=>{ const role=roleFilter||""; setSubmitForm(f=>({...f,role})); if(isAdmin&&role&&roleToAccount[role]) setSubmitAccount(roleToAccount[role]); setShowSubmitModal(true); }}
          style={{ padding:"8px 16px", background:"linear-gradient(135deg,#0D6B35,#047857)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, boxShadow:"0 4px 12px rgba(5,150,105,0.3)", whiteSpace:"nowrap" }}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.88"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          + Submit Candidate
        </button>
      </div>

      <div style={{ position:"relative", zIndex:1, padding:"0 36px" }}><StatBar data={data}/></div>

      {/* FILTER + SEARCH */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap", position:"relative", zIndex:10, padding:"0 36px" }}>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {/* inactive filter pill text bumped #334155 → #64748b */}
          <button onClick={()=>setStageFilter("")} style={{ padding:"5px 14px", borderRadius:20, cursor:"pointer", fontSize:11, fontWeight:700, background:!stageFilter?"rgba(10,102,194,0.2)":"var(--l03)", color:!stageFilter?"#0A66C2":"var(--t3)", border:`1px solid ${!stageFilter?"rgba(10,102,194,0.4)":"var(--l08)"}`, boxShadow:!stageFilter?"0 0 12px rgba(10,102,194,0.2)":"none" }}>All · {data.length}</button>
          {ALL_STAGES.map(stage=>{
            const m=STAGE_META[stage], active=stageFilter===stage, cnt=data.filter(r=>r["Status"]===stage).length;
            if (!cnt&&!active) return null;
            return (
              <button key={stage} onClick={()=>setStageFilter(active?"":stage)}
                style={{ padding:"5px 12px", borderRadius:20, cursor:"pointer", fontSize:11, fontWeight:700, background:active?m.bg:"var(--l03)", color:active?m.color:"var(--t3)", border:`1px solid ${active?m.border:"var(--l08)"}`, boxShadow:active?`0 0 10px ${m.glow}`:"none", display:"flex", alignItems:"center", gap:5 }}>
                {active&&<GlowDot color={m.color} size={5}/>}{stage} · {cnt}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {filterAccounts.length > 0 && (
            <select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)}
              style={{ padding:"8px 10px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:10, color:filterAccount?"#0A66C2":"var(--t3)", fontSize:12, fontWeight:filterAccount?700:400, outline:"none", cursor:"pointer" }}>
              <option value="">All accounts</option>
              {filterAccounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
            </select>
          )}
          {filterLobs.length > 0 && (
            <select value={filterLob} onChange={e=>setFilterLob(e.target.value)}
              style={{ padding:"8px 10px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:10, color:filterLob?"#0A66C2":"var(--t3)", fontSize:12, fontWeight:filterLob?700:400, outline:"none", cursor:"pointer" }}>
              <option value="">All LOBs</option>
              {filterLobs.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
            </select>
          )}
          {/* Candidate name search */}
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--t3)", fontSize:14, pointerEvents:"none" }}>⌕</span>
            <input type="text" placeholder="Search candidates..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{ padding:"9px 14px 9px 34px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:10, color:"var(--t1)", fontSize:13, width:200, outline:"none" }}
              onFocus={e=>e.target.style.borderColor="rgba(10,102,194,0.5)"} onBlur={e=>e.target.style.borderColor="var(--l08)"}/>
          </div>

          {/* Role autocomplete search */}
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--t3)", fontSize:13, pointerEvents:"none" }}>◈</span>
            <input
              type="text"
              placeholder="Filter by role..."
              value={roleFilter ? roleFilter : roleSearch}
              onChange={e=>{ setRoleSearch(e.target.value); setRoleFilter(""); setRoleDropOpen(true); }}
              onFocus={()=>setRoleDropOpen(true)}
              onBlur={()=>setTimeout(()=>setRoleDropOpen(false),150)}
              style={{ padding:"9px 32px 9px 32px", background: roleFilter?"rgba(10,102,194,0.12)":"var(--l04)", border:`1px solid ${roleFilter?"rgba(10,102,194,0.45)":"var(--l08)"}`, borderRadius:10, color: roleFilter?"#0A66C2":"var(--t1)", fontSize:13, width:210, outline:"none", boxShadow: roleFilter?"0 0 10px rgba(10,102,194,0.15)":"none" }}
            />
            {roleFilter&&(
              <button onClick={()=>{ setRoleFilter(""); setRoleSearch(""); }}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--t3)", cursor:"pointer", fontSize:14, lineHeight:1, padding:2 }}>✕</button>
            )}
            {roleDropOpen && roleSuggestions.length>0 && !roleFilter && (
              <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, background:"var(--drop-bg)", border:"1px solid rgba(10,102,194,0.3)", borderRadius:10, zIndex:50, maxHeight:220, overflowY:"auto", boxShadow:"0 12px 40px rgba(0,0,0,0.6)" }}>
                {roleSuggestions.map(role=>(
                  <div key={role} onMouseDown={()=>{ setRoleFilter(role); setRoleSearch(""); setRoleDropOpen(false); }}
                    style={{ padding:"9px 14px", cursor:"pointer", fontSize:13, color:"var(--t2)", borderBottom:"1px solid var(--l07)" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(10,102,194,0.12)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{ color:"#0A66C2", marginRight:8, fontSize:11 }}>◈</span>{role}
                    <span style={{ float:"right", color:"var(--t4)", fontSize:11 }}>{data.filter(r=>r["Role"]===role).length} candidates</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TABLE + PANEL */}
      <div style={{ display:"flex", gap:14, alignItems:"stretch", flex:1, minHeight:0 }}>
      <div style={{ flex:1, minWidth:0, background:"var(--l02)", borderTop:"1px solid var(--l07)", overflow:"auto", position:"relative", zIndex:0 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}><div style={S.spinner}/><div style={{ color:"#004182", fontSize:14, fontWeight:700, marginTop:20 }}>Loading candidates...</div></div>
        ) : filtered.length===0 ? (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ fontSize:48, marginBottom:12, opacity:0.12, color:"#0A66C2" }}>◈</div>
            <div style={{ fontSize:16, fontWeight:700, color:"var(--t3)" }}>No candidates found</div>
            <div style={{ fontSize:13, color:"var(--t4)", marginTop:4 }}>Adjust your search or stage filter</div>
          </div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <thead>
              <tr>
                {/* table header text bumped #334155 → #64748b */}
                {MAIN_COLUMNS.map(col=>(
                  <th key={col.key} style={{ width:col.width, padding:"14px 18px", textAlign:"left", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", whiteSpace:"nowrap", position:"sticky", top:0, zIndex:3 }}>{col.label}</th>
                ))}
                <th style={{ width:"14%", padding:"14px 18px", textAlign:"left", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", position:"sticky", top:0, zIndex:3 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row,idx)=>{
                const hist     = allHistory[row["Candidate Name"]]||[];
                const isRej    = REJECT_STAGES.includes(row["Status"]);
                const isDelPos = Object.keys(deletedPositions).includes((row["Role"]||"").trim());
                const isSel    = selectedRow===rowKey(row);
                const [c1,c2]  = avatarColors(row["Candidate Name"]||"");
                const m        = STAGE_META[row["Status"]]||STAGE_META["Rejected"];
                return (
                    <tr key={`r-${idx}`} onClick={()=>{ if(isSel){setSelectedRow(null);}else{setSelectedRow(rowKey(row));setSelectedTab("resume");} }}
                      style={{ borderBottom:"1px solid var(--l05)", cursor:"pointer",
                        background: isSel?"rgba(10,102,194,0.08)":isDelPos?"rgba(56,67,79,0.04)":"transparent",
                        borderLeft: isSel?"3px solid #0A66C2":isDelPos?"3px solid rgba(56,67,79,0.5)":"3px solid transparent" }}
                      onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background=isDelPos?"rgba(56,67,79,0.08)":"var(--l03)"; }}
                      onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background=isDelPos?"rgba(56,67,79,0.04)":"transparent"; }}>
                      <td style={{ padding:"14px 18px", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:38, height:38, borderRadius:11, background:`linear-gradient(135deg,${c1},${c2})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"white", flexShrink:0, boxShadow:`0 4px 12px ${c1}66` }}>
                            {initials(row["Candidate Name"]||"")}
                          </div>
                          <div style={{ overflow:"hidden" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <span style={{ color:"var(--t1)", fontWeight:700, fontSize:13, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row["Candidate Name"]||"—"}</span>
                              {isDelPos&&<span style={{ padding:"1px 7px", background:"rgba(56,67,79,0.12)", color:"#56687A", border:"1px solid rgba(56,67,79,0.3)", borderRadius:20, fontSize:9, fontWeight:700, whiteSpace:"nowrap" }}>Position Deleted</span>}
                            </div>
                            {row["Location"]&&<div style={{ color:"var(--t3)", fontSize:11, marginTop:1 }}>{row["Location"]}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:"14px 18px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        <span style={{ color: isDelPos?"#56687A":"#0A66C2", fontSize:13, fontWeight:600, textDecoration:isDelPos?"line-through":"none", opacity:isDelPos?0.7:1 }}>{row["Role"]||"—"}</span>
                      </td>
                      <td style={{ padding:"14px 18px" }}>
                        <span style={{ color:"var(--t3)", fontSize:11, fontFamily:"monospace", background:"var(--l05)", border:"1px solid var(--l09)", borderRadius:6, padding:"2px 8px" }}>{row["WIPPX"]||"—"}</span>
                      </td>
                      {/* date text bumped #475569 → #64748b */}
                      <td style={{ padding:"14px 18px", fontSize:12, color:"var(--t3)", whiteSpace:"nowrap" }}>{fmt(row["Profile Shared on"])}</td>
                      <td style={{ padding:"14px 18px", overflow:"hidden" }}><StageBadge status={row["Status"]}/></td>
                      <td style={{ padding:"14px 18px", fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["account_name"]||"—"}</td>
                      <td style={{ padding:"14px 18px", fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row["lob_name"]||"—"}</td>
                      <td style={{ padding:"14px 18px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <button onClick={e=>{e.stopPropagation();setDeleteTarget({wippx:row["WIPPX"],candidateName:row["Candidate Name"],role:row["Role"]});}}
                            style={{ padding:"5px 10px", background:"rgba(204,16,22,0.07)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:8, cursor:"pointer", fontSize:13, lineHeight:1 }}
                            title="Delete candidate"
                            onMouseEnter={e=>{e.currentTarget.style.background="rgba(204,16,22,0.18)";e.currentTarget.style.borderColor="rgba(204,16,22,0.4)";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="rgba(204,16,22,0.07)";e.currentTarget.style.borderColor="rgba(204,16,22,0.18)";}}>
                            🗑
                          </button>
                          {hist.length>0&&<span style={{ padding:"3px 8px", background:"rgba(10,102,194,0.12)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.22)", borderRadius:20, fontSize:10, fontWeight:700 }}>{hist.length}</span>}
                          {(isRej||isDelPos)&&<span style={{ padding:"3px 8px", background:isDelPos?"rgba(56,67,79,0.12)":m.bg, color:isDelPos?"#56687A":m.color, border:`1px solid ${isDelPos?"rgba(56,67,79,0.3)":m.border}`, borderRadius:20, fontSize:10, fontWeight:700 }}>↗</span>}
                        </div>
                      </td>
                    </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Right panel */}
      {selRow && (
        <div style={{ flex:1, minWidth:0, background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:18, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          <CandidatePanel
            row={selRow}
            history={allHistory[selRow["Candidate Name"]]||[]}
            isDeletedPosition={Object.keys(deletedPositions).includes((selRow["Role"]||"").trim())}
            tab={selectedTab}
            onTabChange={setSelectedTab}
            onClose={()=>setSelectedRow(null)}
            onEdit={()=>{ setEditingRow(selRow); setSelectedRow(null); }}
            onDelete={()=>setDeleteTarget({ wippx:selRow["WIPPX"], candidateName:selRow["Candidate Name"], role:selRow["Role"] })}
            onStageConfirm={(s,d,i)=>handleStageConfirm(selRow,s,d,i)}
            onDeleteLastStage={stage=>handleDelLastStage(selRow["Candidate Name"],stage)}
            onResubmit={handleResubmit}
            submittedRoles={data.filter(r=>String(r["Candidate Name"]||"").trim().toLowerCase()===String(selRow["Candidate Name"]||"").trim().toLowerCase()).map(r=>r["Role"]||"")}
          />
        </div>
      )}
      </div>{/* end TABLE + PANEL flex */}

      {editingRow   && <EditModal row={editingRow} onSave={handleSave} onCancel={()=>setEditingRow(null)}/>}
      {deleteTarget && <DeleteModal candidateName={deleteTarget.candidateName} onConfirm={confirmDelete} onCancel={()=>setDeleteTarget(null)}/>}
      {toast        && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}

      {showSubmitModal&&(
        <div style={S.overlay}>
          <div style={{...S.modal,maxWidth:500}}>
            <div style={S.modalHead}>
              <div>
                <div style={S.eyebrow}>New Submission</div>
                <h3 style={{color:"var(--t1)",margin:"3px 0 0",fontSize:18,fontWeight:800}}>Submit Candidate</h3>
              </div>
              <button onClick={()=>setShowSubmitModal(false)} style={S.closeBtn}>✕</button>
            </div>
            <form onSubmit={handleSubmitCandidate} style={{padding:"20px 24px"}}>
              {isAdmin && submitAccounts.length > 0 && (
                <div style={{marginBottom:14}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Account</label>
                  <select value={submitAccount} onChange={e=>setSubmitAccount(e.target.value)} style={S.formField}>
                    <option value="" style={{background:"var(--pg-bg)"}}>All accounts</option>
                    {submitAccounts.map(a=><option key={a} value={a} style={{background:"var(--pg-bg)"}}>{a}</option>)}
                  </select>
                </div>
              )}
              {submitLobList.length > 0 && (
                <div style={{marginBottom:14}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>LOB</label>
                  <select value={submitLob} onChange={e=>setSubmitLob(e.target.value)} style={S.formField}>
                    <option value="" style={{background:"var(--pg-bg)"}}>All LOBs</option>
                    {submitLobList.map(l=><option key={l} value={l} style={{background:"var(--pg-bg)"}}>{l}</option>)}
                  </select>
                </div>
              )}
              <div style={{marginBottom:14}}>
                <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Role *</label>
                <select value={submitForm.role} onChange={e=>setSubmitForm({...submitForm,role:e.target.value})} style={S.formField} required>
                  <option value="" style={{background:"var(--pg-bg)"}}>Select a role…</option>
                  {submitRoles.map(r=><option key={r} value={r} style={{background:"var(--pg-bg)"}}>{r}</option>)}
                </select>
              </div>
              {[
                {key:"candidateName",   label:"Candidate Name *", type:"text",  required:true},
                {key:"profileSharedOn", label:"Profile Shared On", type:"date",  required:false},
                {key:"assessedBy",      label:"Assessed By",       type:"text",  required:false},
                {key:"assessmentDate",  label:"Assessment Date",   type:"date",  required:false},
              ].map(({key,label,type,required})=>(
                <div key={key} style={{marginBottom:14}}>
                  <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>{label}</label>
                  <input type={type} value={submitForm[key]} onChange={e=>setSubmitForm({...submitForm,[key]:e.target.value})}
                    style={{...S.formField,colorScheme:"normal"}} required={required}/>
                </div>
              ))}
              <div style={{marginBottom:14}}>
                <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Stage *</label>
                <select value={submitForm.status} onChange={e=>setSubmitForm({...submitForm,status:e.target.value})} style={S.formField} required>
                  <option value="" style={{background:"var(--pg-bg)"}}>Select stage…</option>
                  <optgroup label="Interview Stages" style={{background:"var(--pg-bg)"}}>
                    {["L1 Scheduled","Client Interview Scheduled","DM Interview Scheduled","Selected"].map(s=><option key={s} style={{background:"var(--pg-bg)"}}>{s}</option>)}
                  </optgroup>
                  <optgroup label="Rejected" style={{background:"var(--pg-bg)"}}>
                    {["L1 Reject","Client Reject","DM Reject","Rejected"].map(s=><option key={s} style={{background:"var(--pg-bg)"}}>{s}</option>)}
                  </optgroup>
                </select>
              </div>
              <div style={{marginBottom:20}}>
                <label style={{color:"var(--t3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>Resume (.docx, .pdf)</label>
                <input type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setSubmitFile(e.target.files[0])} style={{color:"var(--t2)",fontSize:13}}/>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button type="button" onClick={()=>setShowSubmitModal(false)} style={{flex:1,padding:"11px",background:"var(--l04)",color:"var(--t2)",border:"1px solid var(--l08)",borderRadius:10,cursor:"pointer",fontWeight:600}}>Cancel</button>
                <button type="submit" disabled={submitting} style={{flex:2,padding:"11px",background:submitting?"rgba(5,150,105,0.4)":"linear-gradient(135deg,#0D6B35,#047857)",color:"white",border:"none",borderRadius:10,cursor:submitting?"not-allowed":"pointer",fontWeight:700,boxShadow:"0 4px 16px rgba(5,150,105,0.3)"}}>
                  {submitting?"Submitting…":"Submit Candidate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
  /* sectionLabel bumped #334155 → #64748b — this fixes INTERVIEW PIPELINE, STAGE HISTORY, MOVE TO STAGE, DATE labels */
  sectionLabel:{ color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 },
  formField:{ width:"100%", padding:"10px 12px", marginBottom:4, background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:13, outline:"none", boxSizing:"border-box" },
  miniSelect:{ padding:"7px 11px", background:"var(--l04)", border:"1px solid var(--l09)", borderRadius:8, color:"var(--t2)", fontSize:12, outline:"none", cursor:"pointer" },
  spinner:{ width:30, height:30, borderRadius:"50%", border:"2px solid rgba(10,102,194,0.15)", borderTopColor:"#0A66C2", animation:"spin 0.7s linear infinite", margin:"0 auto" },
};

