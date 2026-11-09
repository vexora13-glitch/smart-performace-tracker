import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../services/portal';
import type { Client } from '../types/portal';

export function DeleteClientsDialog({
  clients,
  onClose,
  onDeleted,
}: {
  clients: Client[];
  onClose: () => void;
  onDeleted: (ids: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [remaining, setRemaining] = useState(clients);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    returnFocus.current ??= document.activeElement as HTMLElement | null;
    element.showModal();
    cancel.current?.focus();
    return () => {
      // Wait until unmount removes the modal's inert state; Strict Mode also reruns this effect.
      queueMicrotask(() => {
        if (element.isConnected) return;
        const target = returnFocus.current?.isConnected
          ? returnFocus.current
          : document.getElementById('portal-main');
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  async function remove() {
    if (busy || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const result = (await api(
        'clients',
        { ids: remaining.map((client) => client.id), confirm: 'DELETE' },
        'DELETE',
      )) as { deleted: string[]; failed: string[] };
      const pending = remaining.filter((client) => !result.deleted.includes(client.id));
      setRemaining(pending);
      await onDeleted(result.deleted);
      if (!pending.length) onClose();
      else
        setError(
          'Deletion is incomplete for the clients listed below. Their access remains revoked. Retry to finish removing their files and accounts.',
        );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="client-dialog delete-clients-dialog"
      aria-labelledby="delete-clients-title"
      aria-describedby="delete-clients-warning"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <div className="panel-heading">
        <h2 id="delete-clients-title">
          <AlertTriangle size={22} /> Delete{' '}
          {remaining.length === 1 ? 'client' : `${remaining.length} clients`}?
        </h2>
      </div>
      <p id="delete-clients-warning">
        This permanently deletes the selected clients, their workspaces, messages and all uploaded
        files, including Vexbot uploads and knowledge. This information cannot be recovered. Their
        platform access will be revoked until they are registered again. Team members will lose
        access to these workspaces.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <ul className="deletion-client-list">
        {remaining.map((client) => (
          <li key={client.id}>
            {client.company} <small>{client.email}</small>
          </li>
        ))}
      </ul>
      <label className="client-selection deletion-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I understand this cannot be undone.
      </label>
      <div className="button-row">
        <button ref={cancel} className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="danger-button"
          disabled={busy || !confirmed}
          onClick={() => void remove()}
        >
          {busy ? 'Deleting…' : error ? 'Retry deletion' : 'Permanently delete'}
        </button>
      </div>
    </dialog>
  );
}
