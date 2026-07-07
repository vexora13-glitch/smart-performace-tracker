import { AlertCircle, LogIn, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { hasSupabaseConfig, supabase, supabaseConfigError } from '../lib/supabase'

type LoginPageProps = {
  onSignedIn: (session: Session) => void
}

function getLoginErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes('invalid login') || normalizedMessage.includes('invalid credentials')) {
    return 'Email or password is incorrect.'
  }

  return `Sign in failed: ${message}`
}

export function LoginPage({ onSignedIn }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(supabaseConfigError)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    if (!hasSupabaseConfig || !supabase) {
      setErrorMessage(supabaseConfigError ?? 'Supabase configuration is missing.')
      return
    }

    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password to sign in.')
      return
    }

    setIsSubmitting(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setErrorMessage(getLoginErrorMessage(error.message))
        return
      }

      if (!data.session) {
        setErrorMessage('Sign in completed, but Supabase did not return a session. Try again.')
        return
      }

      onSignedIn(data.session)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-panel__brand" aria-hidden="true">
          <span>SP</span>
          <ShieldCheck size={24} />
        </div>
        <div className="auth-panel__header">
          <p className="eyebrow">Smart Performance</p>
          <h1 id="login-title">Sign in</h1>
          <p>Use your Supabase email and password to load saved performance data.</p>
        </div>

        {errorMessage ? (
          <div className="auth-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              autoComplete="email"
              disabled={isSubmitting || !hasSupabaseConfig}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              disabled={isSubmitting || !hasSupabaseConfig}
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={isSubmitting || !hasSupabaseConfig} type="submit">
            <LogIn size={18} aria-hidden="true" />
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
