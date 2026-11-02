import { useState } from "react";
import { useAuth } from "../AuthContext";

const TABS = ["Cluster", "Cohort", "Account", "LOB", "Users", "Access"];
const TAB_MODAL = { Cluster:"cluster", Cohort:"cohort", Account:"account", LOB:"lob", Users:"user", Access:"access" };
const ACCESS_LEVELS = [
  { value:"cluster", label:"Cluster Level"  },
  { value:"cohort",  label:"Cohort Level"   },
  { value:"account", label:"Account Level"  },
  { value:"lob",     label:"LOB Level"      },
];
const TAB_BTN = {
  Cluster:{ label:"+ New Cluster",   grad:"linear-gradient(135deg,#0A66C2,#004182)" },
  Cohort: { label:"+ New Cohort",    grad:"linear-gradient(135deg,#0A66C2,#004182)" },
  Account:{ label:"+ New Account",   grad:"linear-gradient(135deg,#0A66C2,#004182)" },
  LOB:    { label:"+ New LOB",       grad:"linear-gradient(135deg,#168740,#0D6B35)" },
  Users:  { label:"+ Add User",      grad:"linear-gradient(135deg,#0A66C2,#004182)" },
  Access: { label:"+ Assign Access", grad:"linear-gradient(135deg,#38434F,#56687A)" },
};
const ACCENT = {
  Cluster:"#0A66C2", Cohort:"#0A66C2", Account:"#0A66C2",
  LOB:"#168740",     Users:"#0A66C2",  Access:"#38434F",
};

const TAB_COLOR = {
  Cluster: { bg:"rgba(10,102,194,0.15)",  border:"rgba(10,102,194,0.5)",   text:"#0A66C2", glow:"rgba(10,102,194,0.2)"   },
  Cohort:  { bg:"rgba(0,65,130,0.15)",  border:"rgba(0,65,130,0.5)",   text:"#0A66C2", glow:"rgba(0,65,130,0.2)"   },
  Account: { bg:"rgba(10,102,194,0.15)",  border:"rgba(10,102,194,0.5)",   text:"#0A66C2", glow:"rgba(10,102,194,0.2)"   },
  LOB:     { bg:"rgba(22,135,64,0.15)",  border:"rgba(22,135,64,0.5)",   text:"#168740", glow:"rgba(22,135,64,0.2)"   },
  Users:   { bg:"rgba(10,102,194,0.15)",  border:"rgba(10,102,194,0.5)",   text:"#0A66C2", glow:"rgba(10,102,194,0.2)"   },
  Access:  { bg:"rgba(56,67,79,0.15)",  border:"rgba(56,67,79,0.5)",   text:"#56687A", glow:"rgba(56,67,79,0.2)"   },
};

// ── Generic Modal shell ──────────────────────────────────────────────
function Modal({ eyebrow, title, onClose, children }) {
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <div>
            <div style={S.eyebrow}>{eyebrow}</div>
            <h3 style={{ color:"var(--t1)", margin:"3px 0 0", fontSize:18, fontWeight:800 }}>{title}</h3>
          </div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>
        <div style={{ padding:"20px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function EmptyState({ msg, sub }) {
  return (
    <div style={{ textAlign:"center", padding:"60px 0" }}>
      <div style={{ fontSize:40, opacity:0.1, color:"#0A66C2", marginBottom:12 }}>◈</div>
      <div style={{ fontSize:15, fontWeight:700, color:"var(--t2)", marginBottom:4 }}>{msg}</div>
      <div style={{ fontSize:12, color:"var(--t3)" }}>{sub}</div>
    </div>
  );
}

// ── List row ─────────────────────────────────────────────────────────
function ListRow({ accent = "#0A66C2", primary, primaryColor, secondary, secondaryParts, badge, actions }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid var(--l05)" }}
      onMouseEnter={e=>e.currentTarget.style.background="var(--l03)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
        <div style={{ width:3, height:28, borderRadius:2, background:`linear-gradient(180deg,${accent},transparent)`, flexShrink:0 }}/>
        <div style={{ minWidth:0 }}>
          <div style={{ fontWeight:700, color: primaryColor || "var(--t1)", fontSize:13 }}>{primary}</div>
          {secondaryParts
            ? <div style={{ fontSize:11, marginTop:2 }}>{secondaryParts.map((p,i)=><span key={i} style={{ color:p.color }}>{p.text}</span>)}</div>
            : secondary && <div style={{ fontSize:11, color:"var(--t3)", marginTop:2 }}>{secondary}</div>
          }
        </div>
        {badge && <span style={{ fontSize:10, padding:"2px 8px", background:badge.bg, color:badge.color, border:`1px solid ${badge.border}`, borderRadius:10, fontWeight:700, whiteSpace:"nowrap", marginLeft:4 }}>{badge.label}</span>}
      </div>
      <div style={{ display:"flex", gap:6, flexShrink:0, marginLeft:12 }}>{actions}</div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────
export default function ManageAccounts() {
  const {
    authData,
    addCluster, deleteCluster,
    addCohort,  deleteCohort,
    addAccount, deleteAccount,
    addLob,     deleteLob,
    addUser,    deleteUser, updatePassword,
    addAccess,  removeAccess,
  } = useAuth();

  const [activeTab,    setActiveTab]    = useState("Cluster");
  const [modal,        setModal]        = useState(null);
  const [delConfirm,   setDelConfirm]   = useState(null); // { what, onConfirm }
  const [saving,       setSaving]       = useState(false);
  const [formError,    setFormError]    = useState("");

  // Cluster form
  const [clName,  setClName]  = useState("");
  // Cohort form
  const [coCluster, setCoCluster] = useState("");
  const [coName,    setCoName]    = useState("");
  // Account form
  const [acCluster, setAcCluster] = useState("");
  const [acCohort,  setAcCohort]  = useState("");
  const [acName,    setAcName]    = useState("");
  // LOB form
  const [lbAccount, setLbAccount] = useState("");
  const [lbName,    setLbName]    = useState("");
  // User form
  const [uName,  setUName]  = useState("");
  const [uPass,  setUPass]  = useState("");
  const [editPw, setEditPw] = useState(null);
  const [editPwVal, setEditPwVal] = useState("");
  // Access form
  const [axUser,    setAxUser]    = useState("");
  const [axLevel,   setAxLevel]   = useState("account");
  const [axCluster, setAxCluster] = useState("");
  const [axCohort,  setAxCohort]  = useState("");
  const [axAccount, setAxAccount] = useState("");
  const [axLob,     setAxLob]     = useState("");
  const [axPerm,    setAxPerm]    = useState("read");
  const [editAccessId, setEditAccessId] = useState(null);

  const clusters  = Object.keys(authData.clusters  || {});
  const accounts  = Object.keys(authData.accounts  || {});
  const allUsers  = authData.users      || [];
  const accessMap = authData.access_map || {};

  const cohortsOf = (cl) => cl ? Object.keys(authData.clusters[cl]?.cohorts || {}) : [];
  const lobsOf    = (ac) => ac ? (authData.accounts[ac]?.lobs || []) : [];

  const closeModal = () => { setModal(null); setFormError(""); setSaving(false); setEditAccessId(null); };

  const submit = async (fn, reset) => {
    setSaving(true); setFormError("");
    const err = await fn();
    setSaving(false);
    if (err) { setFormError(err); return; }
    reset?.();
    closeModal();
  };

  const confirmDelete = (what, fn) =>
    setDelConfirm({ what, onConfirm: async () => {
      try {
        const err = await fn();
        if (err) alert(err);
      } catch (e) {
        alert("An error occurred: " + (e?.message || e));
      } finally {
        setDelConfirm(null);
      }
    }});

  const accessLabelParts = (a) => {
    if (a.access_level === "cluster") return [
      { text:"Cluster: ", color:"var(--t3)" },
      { text: a.cluster_name, color:"#0A66C2" },
    ];
    if (a.access_level === "cohort") return [
      { text:"Cohort: ", color:"var(--t3)" },
      { text: a.cohort_name, color:"#0A66C2" },
      { text:` (${a.cluster_name})`, color:"#0A66C2" },
    ];
    if (a.access_level === "account") return [
      { text:"Account: ", color:"var(--t3)" },
      { text: a.account_name, color:"#0A66C2" },
    ];
    if (a.access_level === "lob") return [
      { text:"LOB: ", color:"var(--t3)" },
      { text: a.lob_name, color:"#0D6B35" },
      { text:" @ ", color:"var(--t3)" },
      { text: a.account_name, color:"#0A66C2" },
    ];
    return [{ text: a.access_level, color:"var(--t3)" }];
  };

  // ── MODALS ─────────────────────────────────────────────────────────

  const renderModal = () => {
    if (!modal) return null;

    if (modal === "cluster") return (
      <Modal eyebrow="New Cluster" title="Create Cluster" onClose={closeModal}>
        <div style={S.sectionLabel}>Cluster Details</div>
        <div style={{ marginBottom:16 }}>
          <label style={S.fieldLabel}>Cluster Name</label>
          <input value={clName} onChange={e=>setClName(e.target.value)} placeholder="e.g. BFS 1"
            style={S.formField} autoFocus
            onKeyDown={e=>e.key==="Enter"&&submit(()=>addCluster(clName.trim()),()=>setClName(""))}/>
        </div>
        {formError && <div style={S.errorBox}>{formError}</div>}
        <div style={S.btnRow}>
          <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
          <button disabled={saving||!clName.trim()} onClick={()=>submit(()=>addCluster(clName.trim()),()=>setClName(""))}
            style={{ ...S.btnSave, opacity:saving||!clName.trim()?0.5:1 }}>
            {saving?"Creating...":"Create Cluster"}
          </button>
        </div>
      </Modal>
    );

    if (modal === "cohort") return (
      <Modal eyebrow="New Cohort" title="Create Cohort" onClose={closeModal}>
        <div style={S.sectionLabel}>Cohort Details</div>
        <div style={{ marginBottom:12 }}>
          <label style={S.fieldLabel}>Cluster</label>
          <select value={coCluster} onChange={e=>setCoCluster(e.target.value)} style={S.formField}>
            <option value="">Select cluster...</option>
            {clusters.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={S.fieldLabel}>Cohort Name</label>
          <input value={coName} onChange={e=>setCoName(e.target.value)} placeholder="e.g. Cohort 1"
            style={S.formField} autoFocus/>
        </div>
        {formError && <div style={S.errorBox}>{formError}</div>}
        <div style={S.btnRow}>
          <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
          <button disabled={saving||!coName.trim()} onClick={()=>submit(()=>addCohort(coName.trim(),coCluster),()=>setCoName(""))}
            style={{ ...S.btnSave, background:"linear-gradient(135deg,#0A66C2,#004182)", opacity:saving||!coName.trim()?0.5:1 }}>
            {saving?"Creating...":"Create Cohort"}
          </button>
        </div>
      </Modal>
    );

    if (modal === "account") {
      const cohortsForNew = cohortsOf(acCluster);
      return (
        <Modal eyebrow="New Account" title="Create Account" onClose={closeModal}>
          <div style={S.sectionLabel}>Account Details</div>
          <div style={{ marginBottom:12 }}>
            <label style={S.fieldLabel}>Cluster (optional)</label>
            <select value={acCluster} onChange={e=>{setAcCluster(e.target.value);setAcCohort("");}} style={S.formField}>
              <option value="">No cluster</option>
              {clusters.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {acCluster && (
            <div style={{ marginBottom:12 }}>
              <label style={S.fieldLabel}>Cohort (optional)</label>
              <select value={acCohort} onChange={e=>setAcCohort(e.target.value)} style={S.formField}>
                <option value="">No cohort</option>
                {cohortsForNew.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div style={{ marginBottom:16 }}>
            <label style={S.fieldLabel}>Account Name</label>
            <input value={acName} onChange={e=>setAcName(e.target.value)} placeholder="e.g. BNY"
              style={S.formField} autoFocus/>
          </div>
          {formError && <div style={S.errorBox}>{formError}</div>}
          <div style={S.btnRow}>
            <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
            <button disabled={saving||!acName.trim()} onClick={()=>submit(()=>addAccount(acName.trim(),acCluster||null,acCohort||null),()=>setAcName(""))}
              style={{ ...S.btnSave, background:"linear-gradient(135deg,#0A66C2,#004182)", opacity:saving||!acName.trim()?0.5:1 }}>
              {saving?"Creating...":"Create Account"}
            </button>
          </div>
        </Modal>
      );
    }

    if (modal === "lob") return (
      <Modal eyebrow="New LOB" title="Create Line of Business" onClose={closeModal}>
        <div style={S.sectionLabel}>LOB Details</div>
        <div style={{ marginBottom:12 }}>
          <label style={S.fieldLabel}>Account</label>
          <select value={lbAccount} onChange={e=>setLbAccount(e.target.value)} style={S.formField}>
            <option value="">Select account...</option>
            {accounts.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={S.fieldLabel}>LOB Name</label>
          <input value={lbName} onChange={e=>setLbName(e.target.value)} placeholder="e.g. Wealth"
            style={S.formField} autoFocus/>
        </div>
        {formError && <div style={S.errorBox}>{formError}</div>}
        <div style={S.btnRow}>
          <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
          <button disabled={saving||!lbName.trim()||!lbAccount} onClick={()=>submit(()=>addLob(lbName.trim(),lbAccount),()=>setLbName(""))}
            style={{ ...S.btnSave, background:"linear-gradient(135deg,#168740,#0D6B35)", opacity:saving||!lbName.trim()||!lbAccount?0.5:1 }}>
            {saving?"Creating...":"Create LOB"}
          </button>
        </div>
      </Modal>
    );

    if (modal === "user") return (
      <Modal eyebrow="New User" title="Add User" onClose={closeModal}>
        <div style={S.sectionLabel}>User Credentials</div>
        <div style={{ marginBottom:12 }}>
          <label style={S.fieldLabel}>Username</label>
          <input value={uName} onChange={e=>setUName(e.target.value)} placeholder="Username"
            style={S.formField} autoFocus/>
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={S.fieldLabel}>Password</label>
          <input type="password" value={uPass} onChange={e=>setUPass(e.target.value)} placeholder="Password"
            style={S.formField}/>
        </div>
        {formError && <div style={S.errorBox}>{formError}</div>}
        <div style={S.btnRow}>
          <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
          <button disabled={saving||!uName.trim()||!uPass.trim()} onClick={()=>submit(()=>addUser(uName.trim(),uPass.trim(),"user"),()=>{setUName("");setUPass("");})}
            style={{ ...S.btnSave, opacity:saving||!uName.trim()||!uPass.trim()?0.5:1 }}>
            {saving?"Adding...":"Add User"}
          </button>
        </div>
      </Modal>
    );

    if (modal === "access") {
      const cohortsForAx = cohortsOf(axCluster);
      const lobsForAx    = lobsOf(axAccount);
      const accountsForAx = axCluster
        ? Object.entries(authData.accounts || {}).filter(([,v])=>v.cluster_name===axCluster).map(([k])=>k)
        : accounts;
      return (
        <Modal eyebrow={editAccessId?"Edit Access":"Assign Access"} title={editAccessId?"Edit Access Assignment":"Assign Access to User"} onClose={closeModal}>
          <div style={S.sectionLabel}>User &amp; Permissions</div>
          <div style={{ marginBottom:12 }}>
            <label style={S.fieldLabel}>User</label>
            <select value={axUser} onChange={e=>setAxUser(e.target.value)} style={S.formField}>
              <option value="">Select user...</option>
              {allUsers.filter(u=>u.role!=="admin").map(u=><option key={u.username} value={u.username}>{u.username}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={S.fieldLabel}>Access Level</label>
            <select value={axLevel} onChange={e=>{setAxLevel(e.target.value);setAxCluster("");setAxCohort("");setAxAccount("");setAxLob("");}} style={S.formField}>
              {ACCESS_LEVELS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={S.fieldLabel}>Permission</label>
            <select value={axPerm} onChange={e=>setAxPerm(e.target.value)} style={S.formField}>
              <option value="read">Read</option>
              <option value="write">Read / Write</option>
            </select>
          </div>
          {["cluster","cohort","account","lob"].includes(axLevel) && (
            <div style={{ marginBottom:12 }}>
              <label style={S.fieldLabel}>Cluster</label>
              <select value={axCluster} onChange={e=>{setAxCluster(e.target.value);setAxCohort("");setAxAccount("");setAxLob("");}} style={S.formField}>
                <option value="">Select cluster...</option>
                {clusters.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {axLevel==="cohort"&&axCluster&&(
            <div style={{ marginBottom:12 }}>
              <label style={S.fieldLabel}>Cohort</label>
              <select value={axCohort} onChange={e=>setAxCohort(e.target.value)} style={S.formField}>
                <option value="">Select cohort...</option>
                {cohortsForAx.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {["account","lob"].includes(axLevel)&&(
            <div style={{ marginBottom:12 }}>
              <label style={S.fieldLabel}>Account</label>
              <select value={axAccount} onChange={e=>{setAxAccount(e.target.value);setAxLob("");}} style={S.formField}>
                <option value="">Select account...</option>
                {accountsForAx.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          {axLevel==="lob"&&axAccount&&(
            <div style={{ marginBottom:12 }}>
              <label style={S.fieldLabel}>LOB</label>
              <select value={axLob} onChange={e=>setAxLob(e.target.value)} style={S.formField}>
                <option value="">Select LOB...</option>
                {lobsForAx.map(l=><option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
          {formError && <div style={S.errorBox}>{formError}</div>}
          <div style={S.btnRow}>
            <button onClick={closeModal} style={S.btnCancel}>Cancel</button>
            <button disabled={saving||!axUser} onClick={()=>{
              if (axLevel==="cluster"&&!axCluster){setFormError("Please select a cluster.");return;}
              if (axLevel==="cohort"&&(!axCluster||!axCohort)){setFormError("Please select a cluster and cohort.");return;}
              if (axLevel==="account"&&!axAccount){setFormError("Please select an account.");return;}
              if (axLevel==="lob"&&(!axAccount||!axLob)){setFormError("Please select an account and LOB.");return;}
              if (editAccessId) {
                submit(async()=>{ const e1=await removeAccess(editAccessId); if(e1) return e1; return addAccess(axUser,axLevel,{cluster_name:axCluster||null,cohort_name:axCohort||null,account_name:axAccount||null,lob_name:axLob||null,permission:axPerm}); },null);
              } else {
                submit(()=>addAccess(axUser,axLevel,{cluster_name:axCluster||null,cohort_name:axCohort||null,account_name:axAccount||null,lob_name:axLob||null,permission:axPerm}),null);
              }
            }} style={{ ...S.btnSave, background:"linear-gradient(135deg,#38434F,#56687A)", boxShadow:"0 4px 16px rgba(56,67,79,0.3)", opacity:saving||!axUser?0.5:1 }}>
              {saving?(editAccessId?"Updating...":"Assigning..."):(editAccessId?"Update Access":"Assign Access")}
            </button>
          </div>
        </Modal>
      );
    }
    return null;
  };

  // ── TAB CONTENT ────────────────────────────────────────────────────

  const renderCluster = () => clusters.length === 0
    ? <EmptyState msg="No clusters yet" sub="Create your first cluster to get started"/>
    : (
      <div style={S.listBox}>
        {clusters.map(cl=>(
          <ListRow key={cl} accent={ACCENT.Cluster}
            primary={cl} primaryColor="#0A66C2"
            secondaryParts={[
              { text: String(Object.keys(authData.clusters[cl]?.cohorts||{}).length), color:"#0D6B35" },
              { text:" cohort(s)", color:"var(--t3)" },
            ]}
            actions={<button style={S.btnDel} onClick={()=>confirmDelete(`Delete cluster "${cl}" and all its data?`,()=>deleteCluster(cl))}>✕ Delete</button>}/>
        ))}
      </div>
    );

  const renderCohort = () => {
    const all = clusters.flatMap(cl=>Object.keys(authData.clusters[cl]?.cohorts||{}).map(co=>({cl,co})));
    return all.length === 0
      ? <EmptyState msg="No cohorts yet" sub="Create a cohort inside a cluster"/>
      : (
        <div style={S.listBox}>
          {all.map(({cl,co})=>(
            <ListRow key={`${cl}-${co}`} accent={ACCENT.Cohort}
              primary={co} primaryColor="#0A66C2"
              secondaryParts={[
                { text: cl, color:"#0A66C2" },
                { text:" · ", color:"var(--t3)" },
                { text: String(Object.keys(authData.clusters[cl].cohorts[co]?.accounts||{}).length), color:"#0D6B35" },
                { text:" account(s)", color:"var(--t3)" },
              ]}
              actions={<button style={S.btnDel} onClick={()=>confirmDelete(`Delete cohort "${co}"?`,()=>deleteCohort(co,cl))}>✕ Delete</button>}/>
          ))}
        </div>
      );
  };

  const renderAccount = () => accounts.length === 0
    ? <EmptyState msg="No accounts yet" sub="Create an account to start organising data"/>
    : (
      <div style={S.listBox}>
        {accounts.map(acc=>{
          const d=authData.accounts[acc];
          const clusterParts = d?.cluster_name
            ? [ { text: d.cluster_name, color:"#0A66C2" },
                ...(d.cohort_name ? [{ text:" › ", color:"var(--t3)" }, { text: d.cohort_name, color:"#0A66C2" }] : []) ]
            : [ { text:"No cluster", color:"var(--t3)" } ];
          const lobParts = (d?.lobs||[]).length
            ? [ { text:" · ", color:"var(--t3)" }, { text: String(d.lobs.length), color:"#0D6B35" }, { text:" LOB(s)", color:"var(--t3)" } ]
            : [];
          return (
            <ListRow key={acc} accent={ACCENT.Account}
              primary={acc} primaryColor="#0A66C2"
              secondaryParts={[...clusterParts, ...lobParts]}
              badge={acc==="Admin"?{label:"System",color:"#56687A",bg:"rgba(56,67,79,0.1)",border:"rgba(56,67,79,0.3)"}:null}
              actions={acc!=="Admin"&&<button style={S.btnDel} onClick={()=>confirmDelete(`Delete account "${acc}"?`,()=>deleteAccount(acc))}>✕ Delete</button>}/>
          );
        })}
      </div>
    );

  const renderLob = () => {
    const anyLobs = accounts.some(a=>(authData.accounts[a]?.lobs||[]).length>0);
    if (!anyLobs) return <EmptyState msg="No LOBs yet" sub="Create a line of business under an account"/>;
    return accounts.map(acc=>{
      const lobs=authData.accounts[acc]?.lobs||[];
      if (!lobs.length) return null;
      return (
        <div key={acc} style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:8, padding:"0 2px" }}>
            <span style={{ color:"var(--t3)" }}>Account: </span><span style={{ color:"#0A66C2" }}>{acc}</span>
          </div>
          <div style={S.listBox}>
            {lobs.map(lob=>(
              <ListRow key={lob} accent={ACCENT.LOB}
                primary={lob} primaryColor="#168740"
                actions={<button style={S.btnDel} onClick={()=>confirmDelete(`Delete LOB "${lob}" from ${acc}?`,()=>deleteLob(lob,acc))}>✕ Delete</button>}/>
            ))}
          </div>
        </div>
      );
    });
  };

  const renderUsers = () => allUsers.length === 0
    ? <EmptyState msg="No users yet" sub="Add the first user"/>
    : (
      <div style={S.listBox}>
        {allUsers.map(u=>(
          <div key={u.username} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid var(--l05)", flexWrap:"wrap", gap:8 }}
            onMouseEnter={e=>e.currentTarget.style.background="var(--l03)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
              <div style={{ width:34, height:34, borderRadius:9, background:u.role==="admin"?"linear-gradient(135deg,#38434F,#56687A)":"linear-gradient(135deg,#0A66C2,#004182)", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:13, flexShrink:0 }}>
                {u.username[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight:700, color: u.role==="admin"?"#56687A":"#0A66C2", fontSize:13 }}>{u.username}</div>
                <div style={{ fontSize:11, marginTop:2, color: u.role==="admin"?"#38434F":"#0A66C2" }}>{u.role==="admin"?"Administrator":"User"}</div>
              </div>
              {u.role==="admin"&&<span style={{ fontSize:10, padding:"2px 8px", background:"rgba(56,67,79,0.1)", color:"#56687A", border:"1px solid rgba(56,67,79,0.3)", borderRadius:10, fontWeight:700 }}>Admin</span>}
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
              {editPw===u.username?(
                <>
                  <input type="password" value={editPwVal} onChange={e=>setEditPwVal(e.target.value)} placeholder="New password" autoFocus
                    style={{ padding:"6px 10px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:12, width:130, outline:"none" }}/>
                  <button onClick={async()=>{const err=await updatePassword(editPw,editPwVal);if(err){alert(err);return;}setEditPw(null);setEditPwVal("");}}
                    style={{ padding:"6px 12px", background:"rgba(22,135,64,0.1)", color:"#168740", border:"1px solid rgba(22,135,64,0.25)", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>Save</button>
                  <button onClick={()=>{setEditPw(null);setEditPwVal("");}} style={S.btnDel}>Cancel</button>
                </>
              ):(
                <>
                  <button onClick={()=>{setEditPw(u.username);setEditPwVal("");}}
                    style={{ padding:"5px 12px", background:"rgba(10,102,194,0.08)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                    Change Password
                  </button>
                  {u.username!=="Admin"&&<button style={S.btnDel} onClick={()=>confirmDelete(`Delete user "${u.username}"?`,()=>deleteUser(u.username))}>✕ Remove</button>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    );

  const renderAccess = () => {
    const usersWithAccess = allUsers.filter(u => u.role !== "admin" && accessMap[u.username]?.length);
    if (!usersWithAccess.length) return <EmptyState msg="No access assigned" sub="Assign access to non-admin users"/>;

    const rows = usersWithAccess.flatMap(u =>
      (accessMap[u.username] || []).map(a => ({ user: u.username, ...a }))
    );

    const levelColor = { cluster:"#0A66C2", cohort:"#0A66C2", account:"#0A66C2", lob:"#168740" };
    const resourceLabel = (a) => {
      if (a.access_level === "cluster") return a.cluster_name || "—";
      if (a.access_level === "cohort")  return `${a.cohort_name || "—"} (${a.cluster_name || "—"})`;
      if (a.access_level === "account") return a.account_name || "—";
      if (a.access_level === "lob")     return `${a.lob_name || "—"} @ ${a.account_name || "—"}`;
      return "—";
    };

    const TH = ({ children, w }) => (
      <th style={{ width: w, padding:"10px 16px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, background:"var(--hdr-bg)", borderBottom:"1px solid var(--l08)", color:"var(--t3)", whiteSpace:"nowrap", position:"sticky", top:0, zIndex:3 }}>
        {children}
      </th>
    );

    return (
      <div style={{ background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:12, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
          <thead>
            <tr>
              <TH w="18%">User</TH>
              <TH w="12%">Level</TH>
              <TH w="30%">Resource</TH>
              <TH w="14%">Permission</TH>
              <TH w="26%">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              const isWrite = a.permission === "write";
              const lc = levelColor[a.access_level] || "#56687A";
              return (
                <tr key={i}
                  style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--l05)" : "none", transition:"background 0.12s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--l03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding:"11px 16px" }}>
                    <span style={{ color:"#0A66C2", fontWeight:700, fontSize:12 }}>{a.user}</span>
                  </td>
                  <td style={{ padding:"11px 16px" }}>
                    <span style={{ display:"inline-block", padding:"3px 10px", background:`${lc}18`, color:lc, border:`1px solid ${lc}44`, borderRadius:20, fontSize:11, fontWeight:700, textTransform:"capitalize" }}>
                      {a.access_level}
                    </span>
                  </td>
                  <td style={{ padding:"11px 16px", fontSize:12, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {resourceLabel(a)}
                  </td>
                  <td style={{ padding:"11px 16px" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", background:isWrite?"rgba(22,135,64,0.1)":"rgba(148,163,184,0.1)", color:isWrite?"#168740":"#94a3b8", border:`1px solid ${isWrite?"rgba(22,135,64,0.3)":"rgba(148,163,184,0.25)"}`, borderRadius:20, fontSize:11, fontWeight:700 }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:isWrite?"#168740":"#94a3b8", display:"inline-block" }}/>
                      {isWrite ? "Read/Write" : "Read"}
                    </span>
                  </td>
                  <td style={{ padding:"11px 16px" }}>
                    <div style={{ display:"flex", gap:6 }}>
                      <button style={S.btnEdit} onClick={()=>{ setAxUser(a.user); setAxLevel(a.access_level); setAxCluster(a.cluster_name||""); setAxCohort(a.cohort_name||""); setAxAccount(a.account_name||""); setAxLob(a.lob_name||""); setAxPerm(a.permission); setEditAccessId(a.id); setModal("access"); }}>✎ Edit</button>
                      <button style={S.btnDel} onClick={()=>confirmDelete("Remove this access?",()=>removeAccess(a.id))}>✕ Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderContent = () => {
    if (activeTab==="Cluster") return renderCluster();
    if (activeTab==="Cohort")  return renderCohort();
    if (activeTab==="Account") return renderAccount();
    if (activeTab==="LOB")     return renderLob();
    if (activeTab==="Users")   return renderUsers();
    if (activeTab==="Access")  return renderAccess();
  };

  const tabCount = () => {
    if (activeTab==="Cluster") return `${clusters.length} cluster(s)`;
    if (activeTab==="Cohort")  return `${clusters.reduce((s,cl)=>s+Object.keys(authData.clusters[cl]?.cohorts||{}).length,0)} cohort(s)`;
    if (activeTab==="Account") return `${accounts.length} account(s)`;
    if (activeTab==="LOB")     return `${accounts.reduce((s,a)=>s+(authData.accounts[a]?.lobs||[]).length,0)} LOB(s)`;
    if (activeTab==="Users")   return `${allUsers.length} user(s)`;
    if (activeTab==="Access")  return `${allUsers.filter(u=>u.role!=="admin"&&accessMap[u.username]?.length).flatMap(u=>accessMap[u.username]||[]).length} access entries`;
  };

  const cfg = TAB_BTN[activeTab];

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-track{background:var(--l03);border-radius:6px}
        ::-webkit-scrollbar-thumb{background:rgba(10,102,194,0.55);border-radius:6px;border:1px solid rgba(10,102,194,0.2)}
        ::-webkit-scrollbar-thumb:hover{background:rgba(10,102,194,0.85)}
      `}</style>
      <div style={S.gridOverlay}/>

      {/* ── HEADER ── */}
      <div style={{ padding:"0 36px", marginBottom:18, position:"relative", zIndex:1 }}>
        <div style={{ color:"#004182", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:2, marginBottom:14 }}>
          Admin · Administration
        </div>
        <div style={{ display:"flex", gap:3, background:"var(--l03)", border:"1px solid var(--l07)", borderRadius:12, padding:4, width:"fit-content" }}>
          {TABS.map(tab=>{
            const active = activeTab===tab;
            const tc = TAB_COLOR[tab];
            return (
              <button key={tab} onClick={()=>setActiveTab(tab)}
                style={{ padding:"6px 18px", background:active?tc.bg:"transparent", border:active?`1px solid ${tc.border}`:"1px solid transparent", borderRadius:9, cursor:"pointer", fontSize:12, fontWeight:active?800:500, color:active?tc.text:"var(--t3)", transition:"all 0.15s", whiteSpace:"nowrap", boxShadow:active?`0 0 12px ${tc.glow}`:"none" }}>
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex:1, overflow:"auto", padding:"0 36px 36px", position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"var(--t3)", textTransform:"uppercase", letterSpacing:1 }}>
            {tabCount()}
          </div>
          <button onClick={()=>setModal(TAB_MODAL[activeTab])}
            style={{ padding:"8px 16px", background:cfg.grad, color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, boxShadow:"0 4px 12px rgba(10,102,194,0.25)", whiteSpace:"nowrap" }}
            onMouseEnter={e=>e.currentTarget.style.opacity="0.88"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
            {cfg.label}
          </button>
        </div>

        {renderContent()}
      </div>

      {/* ── MODALS ── */}
      {renderModal()}

      {/* ── DELETE CONFIRM ── */}
      {delConfirm && (
        <div style={S.overlay}>
          <div style={{ ...S.modal, maxWidth:400 }}>
            <div style={{ padding:"32px 24px", textAlign:"center" }}>
              <div style={{ width:52, height:52, borderRadius:"50%", background:"rgba(204,16,22,0.1)", border:"1px solid rgba(204,16,22,0.3)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 18px", fontSize:20, color:"#CC1016" }}>✕</div>
              <h3 style={{ color:"var(--t1)", fontSize:17, fontWeight:800, margin:"0 0 10px" }}>Confirm Delete</h3>
              <p style={{ color:"var(--t2)", fontSize:13, margin:"0 0 22px", lineHeight:1.7 }}>{delConfirm.what}</p>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                <button onClick={()=>setDelConfirm(null)} style={{ padding:"9px 22px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:13 }}>Cancel</button>
                <button onClick={delConfirm.onConfirm} style={{ padding:"9px 22px", background:"linear-gradient(135deg,#CC1016,#b91c1c)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:13, boxShadow:"0 4px 14px rgba(204,16,22,0.3)" }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  root: { height:"100vh", display:"flex", flexDirection:"column", background:"var(--pg-bg)", fontFamily:"'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif", padding:"16px 0 0", position:"relative", overflowX:"hidden" },
  gridOverlay: { position:"fixed", inset:0, pointerEvents:"none", zIndex:0, backgroundImage:`linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px)`, backgroundSize:"40px 40px" },
  overlay: { position:"fixed", inset:0, background:"var(--overlay-bg)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 },
  modal: { background:"var(--pg-bg)", border:"1px solid var(--l09)", borderRadius:22, width:"100%", maxWidth:480, maxHeight:"92vh", overflowY:"auto", boxShadow:"0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(10,102,194,0.1)" },
  modalHead: { padding:"22px 24px 18px", borderBottom:"1px solid var(--l07)", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"var(--pg-bg)", borderRadius:"22px 22px 0 0", zIndex:1 },
  eyebrow: { color:"#0A66C2", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2 },
  closeBtn: { background:"var(--l04)", border:"1px solid var(--l07)", color:"var(--t3)", borderRadius:8, width:32, height:32, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" },
  sectionLabel: { color:"var(--t3)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:14 },
  fieldLabel: { color:"var(--t3)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, display:"block", marginBottom:5 },
  formField: { width:"100%", padding:"10px 12px", background:"var(--l04)", border:"1px solid var(--l08)", borderRadius:8, color:"var(--t1)", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" },
  errorBox: { background:"rgba(204,16,22,0.08)", border:"1px solid rgba(204,16,22,0.25)", borderRadius:8, padding:"8px 12px", color:"#CC1016", fontSize:12, marginBottom:12 },
  btnRow: { display:"flex", gap:10, marginTop:8 },
  btnCancel: { flex:1, padding:"11px", background:"var(--l04)", color:"var(--t2)", border:"1px solid var(--l08)", borderRadius:10, cursor:"pointer", fontWeight:600, fontSize:14 },
  btnSave: { flex:2, padding:"11px", background:"linear-gradient(135deg,#0A66C2,#004182)", color:"white", border:"none", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:14, boxShadow:"0 4px 16px rgba(10,102,194,0.3)" },
  listBox: { background:"var(--l02)", border:"1px solid var(--l07)", borderRadius:12, overflow:"hidden", marginBottom:4 },
  btnEdit: { padding:"5px 12px", background:"rgba(10,102,194,0.08)", color:"#0A66C2", border:"1px solid rgba(10,102,194,0.2)", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 },
  btnDel: { padding:"5px 12px", background:"rgba(204,16,22,0.07)", color:"#CC1016", border:"1px solid rgba(204,16,22,0.18)", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 },
};
