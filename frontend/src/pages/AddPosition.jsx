import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL ?? "";

const darkInput = {
  width: "100%",
  padding: "10px 12px",
  marginBottom: 12,
  background: "var(--l06)",
  border: "1px solid var(--l10)",
  borderRadius: 8,
  color: "var(--t1)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const darkSelect = {
  ...darkInput,
  cursor: "pointer",
};

export default function AddPosition() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    position_code: "",
    wippx: "",
    category: "",
    pod_name: "",
    manager: "",
    replacement_new: "New",
    role: "",
    location: "",
    positions: "",
    job_description: "",
  });

  const [skills, setSkills]           = useState([]);
  const [skillInput, setSkillInput]   = useState("");
  const [showSkillInput, setShowSkillInput] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed) {
      setSkills((s) => [...s, trimmed]);
      setSkillInput("");
      setShowSkillInput(false);
    }
  };

  const removeSkill = (i) => setSkills((s) => s.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const required = ["position_code", "wippx", "role", "location", "positions"];
    for (const key of required) {
      if (!form[key] || String(form[key]).trim() === "") {
        setError(`"${key.replace(/_/g, " ")}" is required`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position_code:   form.position_code.trim(),
          wippx:           form.wippx.trim(),
          category:        form.category.trim(),
          pod_name:        form.pod_name.trim(),
          manager:         form.manager.trim(),
          replacement_new: form.replacement_new,
          role:            form.role.trim(),
          location:        form.location.trim(),
          positions:       parseInt(form.positions, 10),
          job_description: form.job_description.trim(),
          skills,
        }),
      });

      if (res.ok) {
        navigate("/");
      } else {
        const data = await res.json();
        setError(data.detail || "Failed to add position");
      }
    } catch (err) {
      setError("Network error — is the backend running?");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--pg-bg)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: "30px",
      }}
    >
      {/* Back */}
      <button
        onClick={() => navigate("/")}
        style={{
          background: "var(--l06)",
          border: "1px solid var(--l10)",
          color: "var(--t3)",
          padding: "7px 16px",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 13,
          marginBottom: 20,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        â† Dashboard
      </button>

      <div
        style={{
          background: "var(--l03)",
          border: "1px solid var(--l08)",
          borderRadius: 20,
          padding: 28,
          maxWidth: 560,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              color: "#0A66C2",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            New position
          </div>
          <h1
            style={{
              color: "var(--t1)",
              fontSize: 22,
              fontWeight: 800,
              margin: "4px 0 0",
            }}
          >
            Add Position
          </h1>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(204,16,22,0.12)",
              border: "1px solid rgba(204,16,22,0.3)",
              color: "#CC1016",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* ── Section: Position Details ── */}
          <div
            style={{
              color: "var(--t3)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 12,
            }}
          >
            Position details
          </div>

          <Label>Position Code *</Label>
          <input style={darkInput} placeholder="e.g. 995549" value={form.position_code} onChange={set("position_code")} />

          <Label>WIPPX *</Label>
          <input style={darkInput} placeholder="WIPPX code" value={form.wippx} onChange={set("wippx")} />

          <Label>Category</Label>
          <input style={darkInput} placeholder="e.g. Technology" value={form.category} onChange={set("category")} />

          <Label>POD Name</Label>
          <input style={darkInput} placeholder="POD / team name" value={form.pod_name} onChange={set("pod_name")} />

          <Label>Manager</Label>
          <input style={darkInput} placeholder="Hiring manager" value={form.manager} onChange={set("manager")} />

          <Label>Type</Label>
          <select style={darkSelect} value={form.replacement_new} onChange={set("replacement_new")}>
            <option style={{ background: "#1e293b" }}>New</option>
            <option style={{ background: "#1e293b" }}>Replacement</option>
          </select>

          <Label>Role *</Label>
          <input style={darkInput} placeholder="Job title / role" value={form.role} onChange={set("role")} />

          <Label>Location *</Label>
          <input style={darkInput} placeholder="City or remote" value={form.location} onChange={set("location")} />

          <Label># Positions *</Label>
          <input
            style={darkInput}
            type="number"
            min="1"
            placeholder="Number of openings"
            value={form.positions}
            onChange={set("positions")}
          />

          {/* ── Divider ── */}
          <div
            style={{
              height: 1,
              background: "var(--l07)",
              margin: "20px 0 18px",
            }}
          />

          {/* ── Section: JD & Skills ── */}
          <div
            style={{
              color: "var(--t3)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 12,
            }}
          >
            Job description &amp; skills
          </div>

          <Label>Job Description</Label>
          <textarea
            value={form.job_description}
            onChange={set("job_description")}
            placeholder="Paste or type the job description here..."
            rows={5}
            style={{
              ...darkInput,
              resize: "vertical",
              lineHeight: 1.6,
              fontFamily: "inherit",
            }}
          />

          <Label>Required Skills</Label>

          {/* Skill tags */}
          {skills.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
              }}
            >
              {skills.map((skill, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 10px",
                    background: "rgba(10,102,194,0.15)",
                    color: "#0A66C2",
                    border: "1px solid rgba(10,102,194,0.25)",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(i)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#0A66C2",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Inline skill input */}
          {showSkillInput && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
                placeholder={`Skill ${skills.length + 1} (press Enter)`}
                autoFocus
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "var(--l08)",
                  border: "1px solid rgba(10,102,194,0.35)",
                  borderRadius: 8,
                  color: "var(--t1)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={addSkill}
                style={{
                  padding: "8px 16px",
                  background: "linear-gradient(135deg, #0A66C2, #004182)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => {
                  setSkillInput("");
                  setShowSkillInput(false);
                }}
                style={{
                  padding: "8px 12px",
                  background: "var(--l06)",
                  color: "var(--t3)",
                  border: "1px solid var(--l10)",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            </div>
          )}

          {!showSkillInput && (
            <button
              type="button"
              onClick={() => setShowSkillInput(true)}
              style={{
                padding: "7px 14px",
                background: "rgba(10,102,194,0.1)",
                color: "#0A66C2",
                border: "1px dashed rgba(10,102,194,0.35)",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginBottom: 16,
              }}
            >
              + Add Skill {skills.length > 0 ? `(${skills.length} added)` : ""}
            </button>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "12px",
              background: submitting
                ? "rgba(10,102,194,0.4)"
                : "linear-gradient(135deg, #0A66C2, #004182)",
              color: submitting ? "#475569" : "white",
              border: "none",
              borderRadius: 10,
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {submitting ? "Saving..." : "Save Position"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <label
      style={{
        color: "var(--t3)",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        display: "block",
        marginBottom: 5,
      }}
    >
      {children}
    </label>
  );
}

