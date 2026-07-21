import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth, extractErrorMessage } from "../context/AuthContext";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Create your account</h1>
        <div className="subtitle">Join the team on Aurora Project Manager</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
