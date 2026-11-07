import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../services/portal';
import type { Client, Profile } from '../types/portal';
export function ClientDialog({
  client,
  profile,
  onClose,
  onSaved,
}: {
  client?: Client;
  profile?: Profile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await api(
        'clients',
        client
          ? {
              id: client.id,
              action: 'details',
              company: form.get('company'),
              display_name: form.get('display_name'),
            }
          : Object.fromEntries(form),
        client ? 'PATCH' : 'POST',
      );
      setNotice(
        client ? 'Client details saved.' : 'Client created. Share the initial password securely.',
      );
      await onSaved();
      if (!client) onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(
        'clients',
        { id: client?.id, action: 'password', password: new FormData(target).get('password') },
        'PATCH',
      );
      target.reset();
      setNotice('Password replaced. Share the new password securely.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleStatus() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('clients', { id: client?.id, action: 'status', active: !profile?.active }, 'PATCH');
      await onSaved();
      setNotice(profile?.active ? 'Workspace access disabled.' : 'Workspace access restored.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="client-dialog"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="panel-heading">
        <div>
          <div className="eyebrow">CLIENT CONNECTIONS</div>
          <h2>{client ? 'Manage client' : 'A new connection.'}</h2>
        </div>
        <button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          Company
          <input name="company" defaultValue={client?.company} required maxLength={160} />
        </label>
        <label>
          Contact name
          <input
            name="display_name"
            defaultValue={profile?.display_name}
            required
            maxLength={120}
          />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            defaultValue={client?.email}
            required
            readOnly={!!client}
            autoComplete="off"
          />
        </label>
        {!client && (
          <label>
            Initial password
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
            <small>
              12+ characters, including uppercase, lowercase and a number. Share securely with the
              client.
            </small>
          </label>
        )}
        <button disabled={busy} type="submit">
          {busy ? 'Savingâ€¦' : client ? 'Save details' : 'Create client & workspace'}
        </button>
      </form>
      {client && (
        <>
          <div className="dialog-divider" />
          <form onSubmit={resetPassword}>
            <h3>Credential recovery</h3>
            <label>
              New password
              <input
                type="password"
                name="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
              <small>12+ characters with uppercase, lowercase and a number.</small>
            </label>
            <button className="secondary" disabled={busy}>
              Replace password
            </button>
          </form>
          <div className="dialog-divider" />
          <h3>Workspace access</h3>
          <p>
            Inactive clients immediately lose database and new file access. Previously issued file
            links expire within one hour.
          </p>
          <button className="secondary" disabled={busy} onClick={toggleStatus}>
            {profile?.active ? 'Disable client access' : 'Restore client access'}
          </button>
        </>
      )}
    </dialog>
  );
}
