import { useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export default function SubmitCandidateModal({ role, onClose }) {
  const [form, setForm] = useState({
    candidateName: "",
    profileSharedOn: "",
    assessedBy: "",
    assessmentDate: "",
    status: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    if (!form.candidateName || !form.status) {
      setError("Candidate Name and Stage are required.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/submit-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...form }),
      });
      if (res.ok) {
        alert("Candidate Submitted Successfully ✅");
        onClose();
      } else {
        const err = await res.json();
        setError(err.detail || "Submit failed.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2>Submit Candidate - {role}</h2>
        <input name="candidateName" placeholder="Candidate Name *" onChange={handleChange} />
        <input type="date" name="profileSharedOn" onChange={handleChange} />
        <input name="assessedBy" placeholder="Assessed By" onChange={handleChange} />
        <input type="date" name="assessmentDate" onChange={handleChange} />
        <select name="status" onChange={handleChange}>
          <option value="">Select Stage *</option>
          <optgroup label="Interview Stages">
            {["L1 Scheduled","Client Interview Scheduled","DM Interview Scheduled","Selected"].map(s=><option key={s}>{s}</option>)}
          </optgroup>
          <optgroup label="Rejected">
            {["L1 Reject","Client Reject","DM Reject","Rejected"].map(s=><option key={s}>{s}</option>)}
          </optgroup>
        </select>
        {error && <div style={{color:"#CC1016",fontSize:13,marginTop:6}}>{error}</div>}
        <div className="modal-buttons">
          <button onClick={handleSubmit} disabled={submitting}>{submitting?"Submitting...":"Submit"}</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

