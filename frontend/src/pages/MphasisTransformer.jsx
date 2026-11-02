import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

const API  = import.meta.env.VITE_API_URL ?? "";
const FONT = "'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif";

// ── helpers ───────────────────────────────────────────────────────────────────

let _uid = 0;
const uid = () => String(++_uid);

function slugify(text) {
  return (text || "").replace(/[^\w\s]/g, "").trim()
    .split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "").join("");
}

const INDIA_KEYWORDS = [
  "india","bangalore","bengaluru","hyderabad","mumbai","pune","chennai",
  "delhi","noida","gurgaon","gurugram","kolkata","ahmedabad","offshore","off shore",
];

function locationLabel(location) {
  const loc = (location || "").toLowerCase();
  if (!loc || loc === "nan") return "";
  return INDIA_KEYWORDS.some(k => loc.includes(k)) ? "Offshore" : "Onsite";
}

const SENIORITY_PATTERNS = [
  [/principal/i, "Senior"], [/\bstaff\b/i, "Senior"], [/senior/i, "Senior"],
  [/\bsr\b/i, "Senior"],    [/\blead\b/i,  "Senior"],
  [/associate/i, "Junior"], [/junior/i,    "Junior"], [/\bjr\b/i, "Junior"],
];

function buildFilename(name, role, location, expLabel) {
  const firstName = (name || "Resume").trim().split(/\s+/)[0].replace(/[^\w]/g, "");
  const parts = [firstName || "Resume"];
  let cleanRole = (role || "").trim();
  let seniority = expLabel || "";
  for (const [re, label] of SENIORITY_PATTERNS) {
    if (re.test(cleanRole)) {
      seniority = label;
      cleanRole = cleanRole.replace(re, "").replace(/\s+/g, " ").trim();
      break;
    }
  }
  if (cleanRole && !seniority) seniority = "Mid";
  if (cleanRole)   parts.push(slugify(cleanRole));
  const locLabel = locationLabel(location);
  if (locLabel)    parts.push(locLabel);
  if (seniority)   parts.push(seniority);
  return parts.join("_") + ".docx";
}

function guessName(filename) {
  let base = filename.replace(/\.[^.]+$/, "").replace(/[_\-\.]+/g, " ").trim();
  base = base.replace(/\b(resume|cv|curriculum|vitae|updated|new|final|original|fsd|ssd|mphasis|mid|senior|junior|sr|jr|java|python|spring|angular|react|node|sql|aws|api|net|php|dot)\b/gi, "").trim();
  // Stop at the first numeric token — everything before it is the candidate name
  const words = base.split(/\s+/).filter(Boolean);
  const nameTokens = [];
  for (const w of words) {
    if (/\d/.test(w)) break;
    nameTokens.push(w);
  }
  const tokens = nameTokens.length ? nameTokens : words;
  return tokens.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "Candidate";
}

const STATUS_META = {
  ready:        { label:"Ready",         color:"#6B7280" },
  uploading:    { label:"Uploading…",    color:"#0A66C2", spin:true },
  transforming: { label:"Transforming…", color:"#F59E0B", spin:true },
  done:         { label:"Done",          color:"#16A34A" },
  needs_review: { label:"Needs Review",  color:"#D97706" },
  failed:       { label:"Failed",        color:"#CC1016" },
};

// ── atoms ─────────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.ready;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, fontWeight:600, color:m.color }}>
      <span style={{
        width:8, height:8, borderRadius:"50%", flexShrink:0,
        background: m.spin ? "transparent" : m.color,
        border: m.spin ? `2px solid ${m.color}` : "none",
        borderTopColor: m.spin ? "transparent" : undefined,
        animation: m.spin ? "spin 0.75s linear infinite" : "none",
        display:"inline-block",
      }}/>
      {m.label}
    </span>
  );
}

function Btn({ children, onClick, primary, small, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? "5px 12px" : "7px 16px",
      fontSize: small ? 12 : 13, fontWeight:600,
      border: primary ? "none" : "1px solid var(--nav-border)",
      borderRadius:7, cursor: disabled ? "not-allowed" : "pointer",
      background: primary ? "#0A66C2" : "var(--bg1)",
      color: primary ? "#fff" : "var(--t2)",
      fontFamily:FONT, opacity: disabled ? 0.5 : 1,
      whiteSpace:"nowrap", transition:"opacity 0.15s",
    }}
    onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.opacity="0.82"; }}
    onMouseLeave={e=>{ e.currentTarget.style.opacity=disabled?"0.5":"1"; }}>
      {children}
    </button>
  );
}

function Chip({ label, color }) {
  return (
    <span style={{ fontSize:12, fontWeight:600, color, background:`${color}1A`,
      border:`1px solid ${color}50`, borderRadius:20, padding:"3px 10px" }}>
      {label}
    </span>
  );
}

function Checkbox({ checked, indeterminate, onChange }) {
  const color = checked || indeterminate ? "#0A66C2" : "var(--nav-border)";
  return (
    <div onClick={onChange} style={{
      width:16, height:16, borderRadius:4, flexShrink:0, cursor:"pointer",
      border:`2px solid ${color}`,
      background: checked ? "#0A66C2" : "var(--bg1)",
      display:"flex", alignItems:"center", justifyContent:"center",
      transition:"all 0.12s",
    }}>
      {checked     && <span style={{ color:"#fff", fontSize:10, fontWeight:800, lineHeight:1 }}>✓</span>}
      {indeterminate && !checked && <span style={{ color:"#0A66C2", fontSize:12, fontWeight:800, lineHeight:1 }}>−</span>}
    </div>
  );
}

function SummaryModal({ name, role, text, onClose }) {
  const download = () => {
    const content = `Candidate Summary\n${"=".repeat(50)}\nName: ${name}\nRole: ${role || "N/A"}\n${"=".repeat(50)}\n\n${text}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${name.replace(/\s+/g, "_")}_Summary.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"var(--bg1)", border:"1px solid var(--nav-border)",
        borderRadius:14, padding:28, maxWidth:640, width:"92%", maxHeight:"82vh",
        display:"flex", flexDirection:"column", gap:16,
        boxShadow:"0 12px 48px rgba(0,0,0,0.28)", fontFamily:FONT,
      }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontWeight:700, fontSize:17, color:"var(--t1)", letterSpacing:-0.2 }}>{name}</div>
            {role && <div style={{ fontSize:12, color:"#0A66C2", marginTop:3, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>{role}</div>}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer",
            color:"var(--t3)", fontSize:20, lineHeight:1, padding:"2px 6px", borderRadius:4, marginLeft:12 }}
            onMouseEnter={e => e.currentTarget.style.color="#CC1016"}
            onMouseLeave={e => e.currentTarget.style.color="var(--t3)"}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", fontSize:13, lineHeight:1.9, color:"var(--t1)",
          border:"1px solid var(--nav-border)", borderRadius:8, padding:"16px 18px",
          background:"var(--bg2)", whiteSpace:"pre-wrap" }}>
          {text}
        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <Btn small onClick={download}>Download .txt</Btn>
          <Btn small onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DropZone({ onFiles }) {
  const [over, setOver] = useState(false);
  const ref = useRef(null);

  const handle = files => {
    const valid = [...files].filter(f => /\.(docx|pdf)$/i.test(f.name));
    if (valid.length) onFiles(valid);
  };

  return (
    <div onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      style={{
        border:`2px dashed ${over ? "#0A66C2" : "var(--nav-border)"}`,
        borderRadius:12, padding:"40px 24px", textAlign:"center",
        background: over ? "rgba(10,102,194,0.05)" : "var(--bg1)",
        cursor:"pointer", transition:"all 0.15s", userSelect:"none",
      }}>
      <div style={{ fontSize:34, marginBottom:10 }}>📂</div>
      <div style={{ fontSize:15, fontWeight:700, color:"var(--t1)", marginBottom:5 }}>
        Drop resume files here
      </div>
      <div style={{ fontSize:12, color:"var(--t3)" }}>
        Click to browse &nbsp;·&nbsp; DOCX &amp; PDF &nbsp;·&nbsp; Multiple files at once
      </div>
      <input ref={ref} type="file" multiple accept=".docx,.pdf"
        style={{ display:"none" }} onChange={e => handle(e.target.files)} />
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function MphasisTransformer() {
  const [editing,   setEditing]   = useState(new Set());
  const toggleEdit = id => setEditing(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const [summaries, setSummaries] = useState({});
  const [modal,     setModal]     = useState(null);

  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem("mphasis_items");
      if (!saved) return [];
      return JSON.parse(saved)
        .filter(it => it.status === "done" || it.status === "needs_review")
        .map(it => ({ ...it, id: uid(), file: null, parsing: false }));
    } catch { return []; }
  });
  const [selected, setSelected] = useState(new Set());
  const itemsRef                = useRef(items);
  itemsRef.current              = items;

  // Persist to localStorage whenever items change
  useEffect(() => {
    const serializable = items.map(({ file, ...rest }) => rest);
    localStorage.setItem("mphasis_items", JSON.stringify(serializable));
  }, [items]);

  const toggleSelect = id => setSelected(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const allIds      = items.map(it => it.id);
  const someSelected = allIds.some(id => selected.has(id));
  const allSelected  = allIds.length > 0 && allIds.every(id => selected.has(id));
  const toggleAll    = () => setSelected(allSelected ? new Set() : new Set(allIds));

  // ── polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      const active = itemsRef.current.filter(it => it.status === "transforming");
      for (const it of active) {
        try {
          const res  = await fetch(`${API}/resume-versions/${encodeURIComponent(it.name)}`);
          if (!res.ok) continue;
          const data = await res.json();
          const st   = data.formatting_status;
          if (st === "ready") {
            setItems(prev => prev.map(i => i.id === it.id
              ? { ...i, status:"done", versions:data } : i));
          } else if (st === "needs_review") {
            setItems(prev => prev.map(i => i.id === it.id
              ? { ...i, status:"needs_review", versions:data } : i));
          } else if (st === "failed") {
            setItems(prev => prev.map(i => i.id === it.id
              ? { ...i, status:"failed", error: data.formatting_error || "Transformation failed" } : i));
          }
        } catch {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ── parse fields from resume ──────────────────────────────────────────────
  const parseFile = useCallback(async (id, file) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/parse-resume-fields`, { method:"POST", body:fd });
      if (!res.ok) throw new Error("parse failed");
      const data = await res.json();
      const yrs = data.experience_years;
      const expLabel = yrs == null ? "" : yrs < 3 ? "Junior" : yrs < 6 ? "Mid" : "Senior";
      const parsedName = data.name
        && data.name.length < 50
        && !/\d/.test(data.name)
        && !/^(resume|name\s*:|curriculum)/i.test(data.name.trim())
        && !/\b(year|with|experience|developer|engineer|analyst|snowflake|python|java)\b/i.test(data.name)
        ? data.name : "";

      setItems(prev => prev.map(i => i.id === id ? {
        ...i, parsing:false,
        name:     parsedName || i.name,
        role:     data.role     || "",
        location: data.location || "",
        expLabel,
      } : i));
    } catch {
      setItems(prev => prev.map(i => i.id === id ? { ...i, parsing:false } : i));
    }
  }, []);

  // ── add files ─────────────────────────────────────────────────────────────
  const addFiles = useCallback(files => {
    const next = files.map(file => ({
      id:       uid(),
      file,
      fileName: file.name,
      name:     guessName(file.name),
      role:     "",
      location: "",
      expLabel: "",
      status:   "ready",
      parsing:  true,
      error:    "",
      versions: null,
    }));
    setItems(prev => [...next, ...prev]);
    next.forEach(item => parseFile(item.id, item.file));
  }, [parseFile]);

  // ── transform ─────────────────────────────────────────────────────────────
  const transform = async (id) => {
    const it = itemsRef.current.find(i => i.id === id);
    if (!it || !it.name.trim()) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, status:"uploading", error:"" } : i));
    try {
      const fd = new FormData();
      fd.append("candidate_name", it.name.trim());
      fd.append("file", it.file);
      const res = await fetch(`${API}/upload-resume`, { method:"POST", body:fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setItems(prev => prev.map(i => i.id === id
          ? { ...i, status:"failed", error: err.detail || "Upload failed" } : i));
        return;
      }
      setItems(prev => prev.map(i => i.id === id ? { ...i, status:"transforming" } : i));
    } catch {
      setItems(prev => prev.map(i => i.id === id ? { ...i, status:"failed", error:"Network error" } : i));
    }
  };

  // ── download ──────────────────────────────────────────────────────────────
  const download = async (it) => {
    if (!it.versions?.transformed_filename) return;
    try {
      const res  = await fetch(`${API}/download-resume/${encodeURIComponent(it.versions.transformed_filename)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = buildFilename(it.name, it.role, it.location, it.expLabel);
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error("Download failed", e); }
  };

  // ── bulk actions ──────────────────────────────────────────────────────────
  const transformAll = () =>
    itemsRef.current
      .filter(it => (it.status === "ready" || it.status === "failed") && !it.parsing && it.name.trim())
      .forEach(it => transform(it.id));

  const downloadAll = async () => {
    for (const it of itemsRef.current.filter(it => it.status === "done" || it.status === "needs_review")) {
      await download(it);
      await new Promise(r => setTimeout(r, 350));
    }
  };

  // ── summary ───────────────────────────────────────────────────────────────
  const generateSummary = async (it) => {
    if (summaries[it.id]?.loading) return;
    if (summaries[it.id]?.text) { setModal({ name:it.name, role:it.role, text:summaries[it.id].text }); return; }
    setSummaries(prev => ({ ...prev, [it.id]:{ loading:true, text:"", error:"" } }));
    try {
      const fd = new FormData();
      if (it.file) {
        fd.append("file", it.file);
      } else {
        fd.append("candidate_name", it.name.trim());
      }
      const res  = await fetch(`${API}/generate-resume-summary`, { method:"POST", body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      setSummaries(prev => ({ ...prev, [it.id]:{ loading:false, text:data.summary, error:"" } }));
      setModal({ name:it.name, role:it.role, text:data.summary });
    } catch (e) {
      setSummaries(prev => ({ ...prev, [it.id]:{ loading:false, text:"", error:String(e.message) } }));
    }
  };

  const removeItem = id => {
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    setEditing(prev => { const s = new Set(prev); s.delete(id); return s; });
    setItems(prev => prev.filter(it => it.id !== id));
  };

  const downloadSelected = async () => {
    const toDownload = itemsRef.current.filter(it =>
      selected.has(it.id) && (it.status === "done" || it.status === "needs_review")
    );
    for (const it of toDownload) {
      await download(it);
      await new Promise(r => setTimeout(r, 350));
    }
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const ready        = items.filter(it => (it.status === "ready" || it.status === "failed") && !it.parsing && it.name.trim()).length;
  const active       = items.filter(it => it.status === "uploading" || it.status === "transforming").length;
  const done         = items.filter(it => it.status === "done"  || it.status === "needs_review").length;
  const failed       = items.filter(it => it.status === "failed").length;
  const selectedDone = items.filter(it => selected.has(it.id) && (it.status === "done" || it.status === "needs_review")).length;

  const th = { padding:"10px 14px", fontSize:11, fontWeight:700, color:"var(--t3)",
    textTransform:"uppercase", letterSpacing:0.7, borderBottom:"1px solid var(--nav-border)",
    background:"var(--bg2)", textAlign:"left", whiteSpace:"nowrap" };
  const td = { padding:"10px 14px", borderBottom:"1px solid var(--nav-border)", verticalAlign:"middle" };

  return (
    <div style={{ maxWidth:960, margin:"0 auto", padding:"28px 24px", fontFamily:FONT }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page header */}
      <div style={{ marginBottom:22 }}>
        <div style={{ fontSize:22, fontWeight:800, color:"var(--t1)", letterSpacing:-0.3 }}>
          Mphasis Resume Transformer
        </div>
        <div style={{ fontSize:13, color:"var(--t3)", marginTop:4 }}>
          Upload resumes — role, location and seniority are read automatically from each file.
        </div>
      </div>

      <div style={{ visibility: modal ? "hidden" : "visible" }}>
        <DropZone onFiles={addFiles} />
      </div>

      {items.length > 0 && (
        <div style={{ marginTop:24 }}>

          {/* Stats + bulk actions */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <div style={{ display:"flex", gap:8, flex:1, flexWrap:"wrap" }}>
              {ready  > 0 && <Chip label={`${ready} ready`}        color="#6B7280" />}
              {active > 0 && <Chip label={`${active} in progress`} color="#0A66C2" />}
              {done   > 0 && <Chip label={`${done} done`}          color="#16A34A" />}
              {failed > 0 && <Chip label={`${failed} failed`}      color="#CC1016" />}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {ready > 0 && <Btn primary onClick={transformAll}>Transform All ({ready})</Btn>}
              {selectedDone > 0 && <Btn primary onClick={downloadSelected}>Download Selected ({selectedDone})</Btn>}
              {done  > 0 && <Btn onClick={downloadAll}>Download All ({done})</Btn>}
            </div>
          </div>

          {/* Table */}
          <div style={{ border:"1px solid var(--nav-border)", borderRadius:10, overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed", minWidth:820 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width:40, textAlign:"center" }}>
                    <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onChange={toggleAll} />
                  </th>
                  <th style={{ ...th, width:150 }}>File</th>
                  <th style={{ ...th, width:140 }}>Candidate Name</th>
                  <th style={{ ...th }}>Detected Info</th>
                  <th style={{ ...th, width:100 }}>Status</th>
                  <th style={{ ...th, width:190 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const locked  = it.status === "uploading" || it.status === "transforming";
                  const isDone  = it.status === "done" || it.status === "needs_review";
                  const canTx   = it.file && (it.status === "ready" || it.status === "failed") && !it.parsing && it.name.trim();
                  const dispName = it.file?.name || it.fileName || "unknown";
                  const fname   = buildFilename(it.name, it.role, it.location, it.expLabel);

                  return (
                    <tr key={it.id}
                      onMouseEnter={e => e.currentTarget.style.background="var(--bg2)"}
                      onMouseLeave={e => e.currentTarget.style.background=""}>

                      <td style={{ ...td, textAlign:"center" }}>
                        <Checkbox checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} />
                      </td>

                      {/* File */}
                      <td style={td}>
                        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                          <span style={{ fontSize:17, flexShrink:0 }}>{/\.pdf$/i.test(dispName) ? "📄" : "ðŸ“"}</span>
                          <span title={dispName} style={{ fontSize:11, color:"var(--t2)", lineHeight:1.4,
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:145 }}>
                            {dispName}
                          </span>
                        </div>
                      </td>

                      {/* Name */}
                      <td style={td}>
                        <input value={it.name}
                          onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, name:e.target.value } : i))}
                          disabled={locked}
                          placeholder="Candidate name"
                          style={{ width:"100%", border:"1px solid var(--nav-border)", borderRadius:6,
                            padding:"5px 8px", fontSize:12, background:"var(--bg1)", color:"var(--t1)",
                            outline:"none", fontFamily:FONT, boxSizing:"border-box",
                            opacity: locked ? 0.5 : 1 }}
                          onFocus={e => { e.target.style.borderColor="#0A66C2"; e.target.style.boxShadow="0 0 0 2px rgba(10,102,194,0.12)"; }}
                          onBlur={e  => { e.target.style.borderColor="var(--nav-border)"; e.target.style.boxShadow="none"; }}
                        />
                      </td>

                      {/* Detected info */}
                      <td style={td}>
                        {it.parsing ? (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, color:"#0A66C2", fontWeight:600 }}>
                            <span style={{ width:8, height:8, borderRadius:"50%", border:"2px solid #0A66C2", borderTopColor:"transparent", animation:"spin 0.75s linear infinite", display:"inline-block" }}/>
                            Reading resume…
                          </span>
                        ) : (it.role || it.location || it.expLabel) ? (
                          editing.has(it.id) ? (
                            /* ── Edit mode ── */
                            <div style={{ fontSize:12 }}>
                              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                <input
                                  value={it.role} disabled={locked}
                                  onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, role:e.target.value } : i))}
                                  placeholder="Role (e.g. Senior Consultant)"
                                  style={{ border:"1px solid var(--nav-border)", borderRadius:5, padding:"4px 7px",
                                    fontSize:11, background:"var(--bg1)", color:"var(--t1)",
                                    outline:"none", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}
                                  onFocus={e => e.target.style.borderColor="#0A66C2"}
                                  onBlur={e  => e.target.style.borderColor="var(--nav-border)"}
                                />
                                <input
                                  value={it.location} disabled={locked}
                                  onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, location:e.target.value } : i))}
                                  placeholder="Location (e.g. Edison, NJ)"
                                  style={{ border:"1px solid var(--nav-border)", borderRadius:5, padding:"4px 7px",
                                    fontSize:11, background:"var(--bg1)", color:"var(--t1)",
                                    outline:"none", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}
                                  onFocus={e => e.target.style.borderColor="#0A66C2"}
                                  onBlur={e  => e.target.style.borderColor="var(--nav-border)"}
                                />
                                <select
                                  value={it.expLabel} disabled={locked}
                                  onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, expLabel:e.target.value } : i))}
                                  style={{ border:"1px solid var(--nav-border)", borderRadius:5, padding:"4px 7px",
                                    fontSize:11, background:"var(--bg1)", color:"var(--t1)",
                                    outline:"none", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}>
                                  <option value="">— Seniority —</option>
                                  <option value="Junior">Junior</option>
                                  <option value="Mid">Mid</option>
                                  <option value="Senior">Senior</option>
                                </select>
                              </div>
                              {(it.role || it.location) && (
                                <div style={{ marginTop:5, fontSize:10, color:"var(--t3)", fontFamily:"monospace" }}>{fname}</div>
                              )}
                              <button onClick={() => toggleEdit(it.id)}
                                style={{ marginTop:6, fontSize:11, fontWeight:600, color:"#16A34A",
                                  background:"none", border:"1px solid #16A34A", borderRadius:5,
                                  padding:"3px 10px", cursor:"pointer", fontFamily:FONT }}>
                                ✓ Done
                              </button>
                            </div>
                          ) : (
                            /* ── Read-only view + Edit button ── */
                            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:6 }}>
                              <div style={{ fontSize:12, lineHeight:1.7 }}>
                                {it.role && (
                                  <div><span style={{ color:"var(--t3)" }}>Role: </span><span style={{ color:"var(--t1)", fontWeight:600 }}>{it.role}</span></div>
                                )}
                                {it.location && (
                                  <div>
                                    <span style={{ color:"var(--t3)" }}>Location: </span>
                                    <span style={{ color:"var(--t1)", fontWeight:600 }}>{it.location}</span>
                                    <span style={{ marginLeft:5, fontSize:11, fontWeight:700,
                                      color: locationLabel(it.location) === "Offshore" ? "#0A66C2" : "#16A34A" }}>
                                      ({locationLabel(it.location) || "—"})
                                    </span>
                                  </div>
                                )}
                                {it.expLabel && (
                                  <div><span style={{ color:"var(--t3)" }}>Seniority: </span><span style={{ color:"var(--t1)", fontWeight:600 }}>{it.expLabel}</span></div>
                                )}
                                <div style={{ marginTop:4, fontSize:10, color:"var(--t3)", fontFamily:"monospace", overflowWrap:"break-word", wordBreak:"break-all" }}>{fname}</div>
                              </div>
                              {!locked && (
                                <button onClick={() => toggleEdit(it.id)} title="Edit detected info"
                                  style={{ background:"none", border:"none", cursor:"pointer", color:"var(--t3)",
                                    fontSize:13, padding:"2px 4px", lineHeight:1, borderRadius:4, flexShrink:0, marginTop:2 }}
                                  onMouseEnter={e => e.currentTarget.style.color="#0A66C2"}
                                  onMouseLeave={e => e.currentTarget.style.color="var(--t3)"}>
                                  âœ
                                </button>
                              )}
                            </div>
                          )
                        ) : (
                          /* Detection failed — show manual inputs as fallback */
                          <div style={{ fontSize:12 }}>
                            <div style={{ color:"#D97706", fontSize:11, fontWeight:600, marginBottom:6 }}>
                              ⚠ Not detected — enter manually:
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                              <input
                                value={it.role} disabled={locked}
                                onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, role:e.target.value } : i))}
                                placeholder="Role (e.g. Senior Consultant)"
                                style={{ border:"1px solid var(--nav-border)", borderRadius:5, padding:"4px 7px",
                                  fontSize:11, background:"var(--bg1)", color:"var(--t1)",
                                  outline:"none", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}
                                onFocus={e => e.target.style.borderColor="#0A66C2"}
                                onBlur={e  => e.target.style.borderColor="var(--nav-border)"}
                              />
                              <input
                                value={it.location} disabled={locked}
                                onChange={e => setItems(prev => prev.map(i => i.id === it.id ? { ...i, location:e.target.value } : i))}
                                placeholder="Location (e.g. Edison, NJ)"
                                style={{ border:"1px solid var(--nav-border)", borderRadius:5, padding:"4px 7px",
                                  fontSize:11, background:"var(--bg1)", color:"var(--t1)",
                                  outline:"none", fontFamily:FONT, width:"100%", boxSizing:"border-box" }}
                                onFocus={e => e.target.style.borderColor="#0A66C2"}
                                onBlur={e  => e.target.style.borderColor="var(--nav-border)"}
                              />
                            </div>
                            {(it.role || it.location) && (
                              <div style={{ marginTop:5, fontSize:10, color:"var(--t3)", fontFamily:"monospace" }}>{fname}</div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={td}>
                        <StatusBadge status={it.status} />
                        {it.status === "failed" && it.error && (
                          <div style={{ fontSize:10, color:"#CC1016", marginTop:3, maxWidth:120, wordBreak:"break-word", lineHeight:1.4 }}>
                            {it.error}
                          </div>
                        )}
                        {it.status === "needs_review" && (
                          <div style={{ fontSize:10, color:"#D97706", marginTop:2 }}>Review recommended</div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={td}>
                        <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap" }}>
                          {it.file && (it.status === "ready" || it.status === "failed") && (
                            <Btn small primary onClick={() => transform(it.id)} disabled={!canTx}>
                              {it.status === "failed" ? "Retry" : "Transform"}
                            </Btn>
                          )}
                          {isDone && (
                            <Btn small onClick={() => download(it)}>Download</Btn>
                          )}
                          {(isDone || it.file) && (() => {
                            const s = summaries[it.id];
                            const label = s?.loading ? "Generating…"
                              : s?.text    ? "Summary ✓"
                              : s?.error   ? "Retry Summary"
                              : "Summary";
                            return (
                              <Btn small onClick={() => generateSummary(it)} disabled={s?.loading}>
                                {label}
                              </Btn>
                            );
                          })()}
                          {!locked && (
                            <button onClick={() => removeItem(it.id)} title="Remove"
                              style={{ background:"none", border:"none", cursor:"pointer",
                                color:"var(--t3)", fontSize:14, padding:"2px 4px", lineHeight:1, borderRadius:4 }}
                              onMouseEnter={e => e.currentTarget.style.color="#CC1016"}
                              onMouseLeave={e => e.currentTarget.style.color="var(--t3)"}>
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div style={{ marginTop:48, textAlign:"center", color:"var(--t3)", fontSize:13 }}>
          <div style={{ fontSize:38, marginBottom:10 }}>🗂</div>
          Drop resume files above to get started.
        </div>
      )}

      {modal && (
        <SummaryModal
          name={modal.name}
          role={modal.role}
          text={modal.text}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

