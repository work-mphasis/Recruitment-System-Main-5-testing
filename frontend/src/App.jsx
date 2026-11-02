// frontend/src/App.jsx
import React from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { AuthProvider, useAuth } from "./AuthContext";

import Dashboard           from "./pages/Dashboard";
import Candidates          from "./pages/Candidates";
import NewRequirements     from "./pages/NewRequirements";
import ClientReport        from "./pages/ClientReport";
import MphasisTransformer  from "./pages/MphasisTransformer";
import ATSCopilot        from "./components/ATSCopilot";
import Login             from "./pages/Login";
import ManageAccounts    from "./pages/ManageAccounts";
import ManagePrivileges  from "./pages/ManagePrivileges";
import AccountSwitcher   from "./pages/AccountSwitcher";

const NAV_LINKS = [
  { to:"/",                    label:"Dashboard",          pageKey:"dashboard"           },
  { to:"/new-requirements",    label:"Position Management",pageKey:"position-management" },
  { to:"/candidates",          label:"Candidates",         pageKey:"candidates"          },
  { to:"/mphasis-transformer", label:"Mphasis Transformer",pageKey:"mphasis-transformer" },
  { to:"/client-report",       label:"Client Report",      pageKey:"client-report"       },
];

const NAV_FONT = "'Open Sans','Segoe UI','Helvetica Neue',Arial,sans-serif";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button onClick={toggle} title={isDark ? "Switch to Light" : "Switch to Dark"}
      style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 11px", background:"transparent", border:"1px solid var(--nav-border)", borderRadius:16, cursor:"pointer", color:"var(--t3)", fontSize:12, fontWeight:600, transition:"all 0.15s", fontFamily:NAV_FONT }}
      onMouseEnter={e=>{ e.currentTarget.style.color="var(--t2)"; e.currentTarget.style.borderColor="var(--t3)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.color="var(--t3)"; e.currentTarget.style.borderColor="var(--nav-border)"; }}>
      {isDark ? "☀ Light" : "🌙 Dark"}
    </button>
  );
}

function AppNav() {
  const { theme }  = useTheme();
  const { session, isAdmin, hasPrivilege, logout } = useAuth();
  const isDark     = theme === "dark";
  const location   = useLocation();

  return (
    <nav style={{ height:52, background:"var(--nav-bg)", borderBottom:"1px solid var(--nav-border)", display:"flex", alignItems:"center", padding:"0 20px", position:"sticky", top:0, zIndex:200, boxShadow: isDark ? "none" : "0 1px 3px rgba(0,0,0,0.06)", fontFamily:NAV_FONT }}>

      {/* Brand */}
      <Link to="/" style={{ display:"flex", alignItems:"center", gap:8, textDecoration:"none", marginRight:20, flexShrink:0 }}>
        <div style={{ width:32, height:32, borderRadius:6, background:"#0A66C2", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:13, letterSpacing:0.5, flexShrink:0 }}>AT</div>
        <span style={{ fontWeight:700, color:"var(--t1)", fontSize:15 }}>ATS</span>
      </Link>

      {/* Primary nav links */}
      {NAV_LINKS.filter(() => hasPrivilege()).map(({ to, label }) => {
        const active = location.pathname === to;
        return (
          <Link key={to} to={to}
            style={{ textDecoration:"none", padding:"0 10px", height:"100%", display:"flex", alignItems:"center", fontSize:13, fontWeight:active?600:400, color:active?"#0A66C2":"var(--t3)", borderBottom:active?"2px solid #0A66C2":"2px solid transparent", transition:"color 0.15s", whiteSpace:"nowrap" }}
            onMouseEnter={e=>{ if(!active) e.currentTarget.style.color="var(--t2)"; }}
            onMouseLeave={e=>{ if(!active) e.currentTarget.style.color="var(--t3)"; }}>
            {label}
          </Link>
        );
      })}

      {/* Admin link */}
      {isAdmin && (() => {
        const active = location.pathname.startsWith("/manage");
        return (
          <Link to="/manage-accounts"
            style={{ textDecoration:"none", padding:"0 10px", height:"100%", display:"flex", alignItems:"center", fontSize:13, fontWeight:active?600:400, color:active?"#0A66C2":"var(--t3)", borderBottom:active?"2px solid #0A66C2":"2px solid transparent", transition:"color 0.15s", whiteSpace:"nowrap" }}
            onMouseEnter={e=>{ if(!active) e.currentTarget.style.color="var(--t2)"; }}
            onMouseLeave={e=>{ if(!active) e.currentTarget.style.color="var(--t3)"; }}>
            Administration
          </Link>
        );
      })()}

      {/* Right controls */}
      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
        {session && (
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px", background: isDark ? "rgba(255,255,255,0.06)" : "#EEF3F8", border:"1px solid var(--nav-border)", borderRadius:16, fontSize:12, fontWeight:600, color:"var(--t2)", whiteSpace:"nowrap" }}>
            <div style={{ width:22, height:22, borderRadius:"50%", background:"#0A66C2", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:11, fontWeight:700, flexShrink:0 }}>
              {(isAdmin ? "A" : session.username[0]).toUpperCase()}
            </div>
            {isAdmin ? "Admin" : session.username}
          </div>
        )}
        <ThemeToggle />
        <button onClick={logout}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 11px", background:"transparent", border:"1px solid var(--nav-border)", borderRadius:16, cursor:"pointer", color:"var(--t3)", fontSize:12, fontWeight:600, transition:"all 0.15s", fontFamily:NAV_FONT }}
          onMouseEnter={e=>{ e.currentTarget.style.borderColor="#CC1016"; e.currentTarget.style.color="#CC1016"; }}
          onMouseLeave={e=>{ e.currentTarget.style.borderColor="var(--nav-border)"; e.currentTarget.style.color="var(--t3)"; }}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

function AccessDenied() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"60vh", fontFamily:NAV_FONT, gap:12 }}>
      <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(204,16,22,0.07)", border:"1px solid rgba(204,16,22,0.18)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:"#CC1016" }}>🔒</div>
      <div style={{ fontSize:18, fontWeight:700, color:"var(--t1)" }}>Access Denied</div>
      <div style={{ fontSize:13, color:"var(--t3)" }}>You don't have permission to view this page.</div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { session } = useAuth();
  if (!session) return <AccessDenied />;
  return children;
}

function AdminRoute({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function AppShell() {
  const { session, loadingAuth, isAdmin } = useAuth();
  if (loadingAuth) return (
    <div style={{ minHeight:"100vh", background:"var(--pg-bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:NAV_FONT }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:36, height:36, border:"3px solid rgba(10,102,194,0.15)", borderTopColor:"#0A66C2", borderRadius:"50%", animation:"spin 0.7s linear infinite", margin:"0 auto 14px" }}/>
        <div style={{ color:"var(--t3)", fontSize:13 }}>Loading…</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (!session) return <Login />;

  return (
    <div style={{ minHeight:"100vh", background:"var(--pg-bg)" }}>
      <AppNav />
      <Routes key={session.username}>
        <Route path="/"                  element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/new-requirements"  element={<ProtectedRoute><NewRequirements /></ProtectedRoute>} />
        <Route path="/candidates"        element={<ProtectedRoute><Candidates /></ProtectedRoute>} />
        <Route path="/resumes"           element={<Navigate to="/" replace />} />
        <Route path="/mphasis-transformer" element={<ProtectedRoute><MphasisTransformer /></ProtectedRoute>} />
        <Route path="/client-report"     element={<ProtectedRoute><ClientReport /></ProtectedRoute>} />
        <Route path="/manage-accounts"   element={<AdminRoute><ManageAccounts /></AdminRoute>} />
        <Route path="/manage-privileges" element={<AdminRoute><ManagePrivileges /></AdminRoute>} />
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
      <ATSCopilot />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
