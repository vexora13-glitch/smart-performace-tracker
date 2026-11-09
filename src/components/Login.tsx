import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { db, unwrap } from '../services/portal';
import { VexoraBrand } from '../design/Brand';
import { VexoraReveal } from '../design/motion';
export function Login({ configured }: { configured: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      unwrap(
        await db().auth.signInWithPassword({
          email: String(form.get('email')).trim(),
          password: String(form.get('password')),
        }),
      );
    } catch {
      setError('Unable to sign in. Check your email and password, or contact Vexora for help.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <a href="https://vexoradigital.com" className="brand" aria-label="Vexora Digital website">
          <VexoraBrand subtitle="DIGITAL" />
        </a>
        <div className="story-content">
          <div className="eyebrow">A SPACE TO MOVE FORWARD</div>
          <h1>
            Good work.
            <br />
            Great connections<span>.</span>
          </h1>
          <p>
            Your documents, updates and conversations.
            <br />
            One private space. A clearer way forward.
          </p>
          <div className="story-orbit" aria-hidden="true">
            <img src="/brand/vexora-logo.png" alt="" />
          </div>
        </div>
        <span className="story-footer">A little clarity. A lot of possibility.</span>
      </section>
      <section className="login-form-area">
        <VexoraReveal className="login-card">
          <span className="login-icon">
            <LockKeyhole size={23} />
          </span>
          <div className="eyebrow">VEXORA CLIENT PORTAL</div>
          <h2>Your workspace awaits.</h2>
          <p>Sign in to pick up where we left off.</p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="you@company.com"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <span className="password-field">
                <input
                  type={show ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? 'Hide password' : 'Show password'}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {error && (
              <div role="alert" className="notice error">
                {error}
              </div>
            )}
            {!configured && (
              <div role="alert" className="notice error">
                The portal is awaiting configuration. Please contact Vexora.
              </div>
            )}
            <button disabled={busy || !configured} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-help">
            Need access or help with your password?
            <br />
            <a href="mailto:allan@vexoradigital.com">
              Contact your Vexora administrator <ArrowRight size={13} />
            </a>
          </p>
          <div className="login-security">
            <ShieldCheck size={15} /> A private space for you and Vexora.
          </div>
        </VexoraReveal>
      </section>
    </div>
  );
}
