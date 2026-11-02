import { useState } from "react";
import { useAuth } from "../AuthContext";

const FONT = "'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif";

export default function Login() {
  const { loadingAuth, login } = useAuth();

  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [showPass,   setShowPass]   = useState(false);
  const [error,      setError]      = useState("");
  const [shaking,    setShaking]    = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  const fieldStyle = {
    width: "100%", padding: "10px 12px",
    background: "#F3F6F9",
    border: "1px solid #D0D7DE",
    borderRadius: 8, color: "var(--t1)", fontSize: 14, outline: "none",
    boxSizing: "border-box", fontFamily: FONT, transition: "border-color 0.2s, box-shadow 0.2s",
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F3F2EF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:FONT }}>

      <div style={{ width:"100%", maxWidth:400, padding:"0 20px", animation: shaking ? "shake 0.5s ease" : "none" }}>

        {/* Brand */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:52, height:52, background:"#0A66C2", borderRadius:10, marginBottom:14 }}>
            <span style={{ color:"white", fontWeight:800, fontSize:16, letterSpacing:0.5 }}>AT</span>
          </div>
          <div style={{ fontSize:20, fontWeight:700, color:"#1D2226", marginBottom:2 }}>ATS Platform</div>
          <div style={{ fontSize:13, color:"#56687A" }}>Sign in to continue</div>
        </div>

        {/* Card */}
        <div style={{ background:"#FFFFFF", border:"1px solid #D0D7DE", borderRadius:12, padding:"28px 24px", boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
          <form onSubmit={handleSubmit}>

            {/* Username */}
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#38434F", marginBottom:6 }}>Username</label>
              <input type="text" value={username} onChange={e => { setUsername(e.target.value); setError(""); }}
                placeholder="Enter your username" style={fieldStyle} autoFocus
                onFocus={e => { e.target.style.borderColor="#0A66C2"; e.target.style.boxShadow="0 0 0 2px rgba(10,102,194,0.12)"; }}
                onBlur={e  => { e.target.style.borderColor="#D0D7DE"; e.target.style.boxShadow="none"; }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#38434F", marginBottom:6 }}>Password</label>
              <div style={{ position:"relative" }}>
                <input type={showPass ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="Enter your password" style={{ ...fieldStyle, paddingRight:42 }}
                  onFocus={e => { e.target.style.borderColor="#0A66C2"; e.target.style.boxShadow="0 0 0 2px rgba(10,102,194,0.12)"; }}
                  onBlur={e  => { e.target.style.borderColor="#D0D7DE"; e.target.style.boxShadow="none"; }}
                />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#56687A", fontSize:14, padding:0, lineHeight:1 }}>
                  {showPass ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ marginBottom:14, padding:"9px 12px", background:"rgba(204,16,22,0.06)", border:"1px solid rgba(204,16,22,0.2)", borderRadius:8, color:"#CC1016", fontSize:13, fontWeight:500 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting || loadingAuth}
              style={{ width:"100%", padding:"11px", background: submitting ? "#B5BEC6" : "#0A66C2", color:"white", border:"none", borderRadius:8, fontSize:14, fontWeight:600, cursor: submitting ? "not-allowed" : "pointer", transition:"background 0.15s", fontFamily:FONT }}
              onMouseEnter={e => { if (!submitting) e.currentTarget.style.background="#004182"; }}
              onMouseLeave={e => { if (!submitting) e.currentTarget.style.background="#0A66C2"; }}>
              {loadingAuth ? "Loading…" : submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div style={{ textAlign:"center", marginTop:18, fontSize:12, color:"#56687A" }}>
          Recruitment Management System
        </div>
      </div>

      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}
