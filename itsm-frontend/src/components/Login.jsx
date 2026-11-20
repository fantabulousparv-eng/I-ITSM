import React, { useMemo, useState } from 'react';
import API, { errorMessage, saveSession } from '../services/api';
import { CATEGORIES } from '../lib/incident';

const STEPS = ['Report', 'Classify', 'Assign', 'Resolve', 'Close'];

const DEMO = [
  { role: 'Administrator', email: 'admin@itsm.local', password: 'Admin@1234' },
  { role: 'Technician', email: 'aisha.khan@itsm.local', password: 'Passw0rd123' },
  { role: 'Employee', email: 'grace.okafor@itsm.local', password: 'Passw0rd123' },
];

const EMPTY = {
  name: '',
  email: '',
  password: '',
  confirm: '',
  department: '',
  phone: '',
  experienceYears: '',
};

/** Rough client-side strength signal; the server remains the authority. */
function passwordStrength(password) {
  if (!password) return { score: 0, label: 'Enter a password', tone: '' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 2) return { score, label: 'Weak', tone: 'weak' };
  if (score <= 3) return { score, label: 'Fair', tone: 'fair' };
  return { score, label: 'Strong', tone: 'strong' };
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState('employee');
  const [skills, setSkills] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleSkill = (skill) =>
    setSkills((prev) => (prev.includes(skill) ? prev.filter((item) => item !== skill) : [...prev, skill]));

  const useDemo = (account) => {
    setMode('login');
    setError('');
    setFieldErrors({});
    setForm((prev) => ({ ...prev, email: account.email, password: account.password }));
  };

  /** Client-side checks mirroring the server rules, for instant feedback. */
  const validate = () => {
    const errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (mode === 'login') {
      if (!form.password) errors.password = 'Enter your password.';
    } else {
      if (form.name.trim().length < 2) errors.name = 'Enter your full name.';
      if (form.password.length < 8) errors.password = 'Use at least 8 characters.';
      if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
        errors.password = 'Mix letters and numbers.';
      }
      if (form.confirm !== form.password) errors.confirm = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!validate()) return;

    setBusy(true);
    try {
      const email = form.email.trim().toLowerCase();
      const response = mode === 'register'
        ? await API.post('/auth/register', {
            name: form.name.trim(),
            email,
            password: form.password,
            role,
            department: form.department.trim(),
            phone: form.phone.trim(),
            skills: role === 'technician' ? skills : [],
            experienceYears: role === 'technician' ? Number(form.experienceYears) || 0 : 0,
          })
        : await API.post('/auth/login', { email, password: form.password });

      saveSession({ token: response.data.token, user: response.data.user });
      onLoginSuccess(response.data.user);
    } catch (err) {
      if (err.response?.status === 409) {
        setFieldErrors({ email: 'That email is already registered. Try signing in instead.' });
      }
      setError(errorMessage(err, 'Could not sign you in. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div>
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <p className="eyebrow">I-ITSM</p>
          <h1>Incident desk for a living campus.</h1>
          <p className="lede">
            Report a broken service, watch its priority and SLA, and follow it until someone closes the loop.
          </p>
          <ol className="lifecycle">
            {STEPS.map((step) => <li key={step}><i />{step}</li>)}
          </ol>
        </div>
        <p>Employees, technicians, and administrators each get a different desk.</p>
      </aside>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
          <div className="switch" role="tablist">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setFieldErrors({}); }}>Sign in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setFieldErrors({}); }}>Create account</button>
          </div>
          <h2>{mode === 'login' ? 'Welcome back' : 'Join the desk'}</h2>
          <p className="sub">
            {mode === 'login'
              ? 'Use the account your team registered.'
              : 'Employees and technicians can self-register. Administrator accounts are provisioned by the service desk.'}
          </p>

          {error && <p className="alert" role="alert">{error}</p>}

          <div className="stack">
            {mode === 'register' && (
              <>
                <label>
                  Full name
                  <input value={form.name} onChange={set('name')} autoComplete="name" placeholder="Grace Okafor" />
                  {fieldErrors.name && <em className="field-error">{fieldErrors.name}</em>}
                </label>

                <div className="role-picker" role="radiogroup" aria-label="Role">
                  {[
                    { id: 'employee', title: 'Employee', blurb: 'Raise and track your own tickets.' },
                    { id: 'technician', title: 'Technician', blurb: 'Work the queue and resolve incidents.' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={role === option.id}
                      className={role === option.id ? 'role-card active' : 'role-card'}
                      onClick={() => setRole(option.id)}
                    >
                      <b>{option.title}</b>
                      <span>{option.blurb}</span>
                    </button>
                  ))}
                </div>

                <div className="row-3">
                  <label>Department<input value={form.department} onChange={set('department')} placeholder="Finance" /></label>
                  <label>Phone<input value={form.phone} onChange={set('phone')} placeholder="Optional" /></label>
                  {role === 'technician' && (
                    <label>Years of experience<input type="number" min="0" max="60" value={form.experienceYears} onChange={set('experienceYears')} placeholder="0" /></label>
                  )}
                </div>

                {role === 'technician' && (
                  <div className="skills">
                    <span className="skills-label">Skill areas (used to match you to incidents)</span>
                    <div className="chips">
                      {CATEGORIES.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={skills.includes(item) ? 'chip toggle active' : 'chip toggle'}
                          onClick={() => toggleSkill(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    {skills.length === 0 && <em className="field-error">Pick at least one area so work can be routed to you.</em>}
                  </div>
                )}
              </>
            )}

            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={set('email')}
                autoComplete="username"
                placeholder="you@itsm.local"
              />
              {fieldErrors.email && <em className="field-error">{fieldErrors.email}</em>}
            </label>

            <label>
              Password
              <span className="password">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={set('password')}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button type="button" onClick={() => setShowPassword((open) => !open)}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
              {fieldErrors.password && <em className="field-error">{fieldErrors.password}</em>}
              {mode === 'register' && form.password && (
                <span className="pw-meter" aria-live="polite">
                  <i className={`pw-bar ${strength.tone}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                  <em>{strength.label}</em>
                </span>
              )}
            </label>

            {mode === 'register' && (
              <label>
                Confirm password
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirm}
                  onChange={set('confirm')}
                  autoComplete="new-password"
                />
                {fieldErrors.confirm && <em className="field-error">{fieldErrors.confirm}</em>}
              </label>
            )}

            <button className="btn full" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create and sign in'}
            </button>
          </div>

          {mode === 'login' && (
            <div className="demo">
              <span>Demo accounts</span>
              <div className="chips">
                {DEMO.map((account) => (
                  <button key={account.email} type="button" className="chip toggle" onClick={() => useDemo(account)}>
                    {account.role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
