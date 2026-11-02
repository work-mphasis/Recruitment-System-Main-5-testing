import { createContext, useContext, useState, useEffect } from "react";
import { setAccountsList, setWriteAccount, clearAccounts } from "./fetchWithAccount";

const API = import.meta.env.VITE_API_URL ?? "";

const AuthContext = createContext(null);

function loadSession() {
  try {
    const sess = JSON.parse(localStorage.getItem("ats_session"));
    // Reject sessions from the old account-scoped system
    if (!sess || sess.account !== undefined) {
      localStorage.removeItem("ats_session");
      return null;
    }
    if (sess.role === "admin") {
      setAccountsList("__ALL__");
    } else if (sess.workspaces?.length > 0) {
      const names = [...new Set(sess.workspaces.map(w => w.account))];
      setAccountsList(names);
      setWriteAccount(names.length === 1 ? names[0] : null);
    }
    return sess;
  }
  catch { return null; }
}

export function AuthProvider({ children }) {
  const [authData,    setAuthData]    = useState({ clusters: {}, accounts: {}, ungrouped: {}, users: [], access_map: {} });
  const [session,     setSession]     = useState(loadSession);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const fetchData = async () => {
    try {
      const res  = await fetch(`${API}/auth/data`);
      const data = await res.json();
      setAuthData(data);
    } catch { /* backend not ready */ }
    finally { setLoadingAuth(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const login = async (username, password) => {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        return { success: false, error: err.detail || "Login failed." };
      }
      const data = await res.json();
      const workspaces = data.workspaces || [];
      const sess = {
        username:         data.username,
        role:             data.role,
        workspaces,
        effectiveAccount: null,
        effectiveLob:     null,
      };
      if (data.role === "admin") {
        setAccountsList("__ALL__");
      } else if (workspaces.length > 0) {
        const names = [...new Set(workspaces.map(w => w.account))];
        setAccountsList(names);
        setWriteAccount(names.length === 1 ? names[0] : null);
      }
      setSession(sess);
      localStorage.setItem("ats_session", JSON.stringify(sess));
      return { success: true };
    } catch {
      return { success: false, error: "Cannot connect to server." };
    }
  };

  const logout = () => {
    clearAccounts();
    setSession(null);
    localStorage.removeItem("ats_session");
  };

  const selectWorkspace = (account, lob = null) => {
    setWriteAccount(account);
    const updated = { ...session, effectiveAccount: account, effectiveLob: lob };
    setSession(updated);
    localStorage.setItem("ats_session", JSON.stringify(updated));
  };

  const exitWorkspace = () => {
    setWriteAccount(null);
    const updated = { ...session, effectiveAccount: null, effectiveLob: null };
    setSession(updated);
    localStorage.setItem("ats_session", JSON.stringify(updated));
  };

  const isAdmin = session?.role === "admin";

  const hasPrivilege = () => {
    if (!session) return false;
    if (isAdmin) return true;
    // Non-admin users see nav if they have any workspaces assigned
    return (session.workspaces?.length ?? 0) > 0;
  };

  const api = async (url, method = "GET", body = null) => {
    try {
      const res = await fetch(`${API}${url}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = json.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) return detail.map(e => e.msg || JSON.stringify(e)).join(", ");
        return "Request failed.";
      }
      return null;
    } catch (e) {
      return e?.message || "Network error. Please try again.";
    }
  };

  // ── Clusters ──────────────────────────────────────────────────────
  const addCluster = async (name) => {
    const err = await api("/auth/clusters", "POST", { name });
    if (!err) await fetchData();
    return err;
  };

  const deleteCluster = async (name) => {
    const err = await api(`/auth/clusters/${encodeURIComponent(name)}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  // ── Cohorts ───────────────────────────────────────────────────────
  const addCohort = async (name, cluster_name) => {
    const err = await api("/auth/cohorts", "POST", { name, cluster_name });
    if (!err) await fetchData();
    return err;
  };

  const deleteCohort = async (name, cluster_name) => {
    const err = await api(`/auth/cohorts?name=${encodeURIComponent(name)}&cluster_name=${encodeURIComponent(cluster_name)}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  // ── Accounts ──────────────────────────────────────────────────────
  const addAccount = async (name, cluster_name = null, cohort_name = null) => {
    const err = await api("/auth/accounts", "POST", { name, cluster_name, cohort_name });
    if (!err) await fetchData();
    return err;
  };

  const deleteAccount = async (name) => {
    if (name === "Admin") return "Cannot delete Admin account.";
    const err = await api(`/auth/accounts/${encodeURIComponent(name)}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  // ── LOBs ──────────────────────────────────────────────────────────
  const addLob = async (name, account_name) => {
    const err = await api("/auth/lobs", "POST", { name, account_name });
    if (!err) await fetchData();
    return err;
  };

  const deleteLob = async (name, account_name) => {
    const err = await api(`/auth/lobs?name=${encodeURIComponent(name)}&account_name=${encodeURIComponent(account_name)}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  // ── Users ─────────────────────────────────────────────────────────
  const addUser = async (username, password, role = "user") => {
    const err = await api("/auth/users", "POST", { username, password, role });
    if (!err) await fetchData();
    return err;
  };

  const deleteUser = async (username) => {
    const err = await api(`/auth/users?username=${encodeURIComponent(username)}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  const updatePassword = async (username, password) => {
    if (!password.trim()) return "Password cannot be empty.";
    const err = await api("/auth/password", "PUT", { username, password });
    if (!err) await fetchData();
    return err;
  };

  // ── Access Assignments ────────────────────────────────────────────
  const addAccess = async (username, access_level, opts = {}) => {
    const err = await api("/auth/access", "POST", { username, access_level, ...opts });
    if (!err) await fetchData();
    return err;
  };

  const removeAccess = async (access_id) => {
    const err = await api(`/auth/access?access_id=${access_id}`, "DELETE");
    if (!err) await fetchData();
    return err;
  };

  return (
    <AuthContext.Provider value={{
      authData, session, isAdmin, loadingAuth,
      login, logout, hasPrivilege, fetchData,
      selectWorkspace, exitWorkspace,
      addCluster, deleteCluster,
      addCohort, deleteCohort,
      addAccount, deleteAccount,
      addLob, deleteLob,
      addUser, deleteUser, updatePassword,
      addAccess, removeAccess,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
