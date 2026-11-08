import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Users,
  ShieldCheck,
  RefreshCw,
  Plus,
  Search,
  ChevronRight,
  Bot,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import { accessMap, db, loadPortal, unread, unwrap } from './services/portal';
import { Vexbot } from './vexbot/Vexbot';
import { VexbotAdmin } from './components/VexbotAdmin';
import { emptyData, type PortalData, type Profile } from './types/portal';
import { Login } from './components/Login';
import { ClientDialog } from './components/ClientDialog';
import { Workspace } from './components/Workspace';
import { Chat } from './components/Chat';
import './App.css';

type Page = 'Dashboard' | 'Clients' | 'Messages' | 'Vexbot';
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<PortalData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('Dashboard');
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then((result) => {
      if (active) {
        setSession(result.data.session);
        if (result.error) {
          setError(result.error.message);
          setLoading(false);
        }
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setData(emptyData);
        setWorkspace(null);
        setPage('Dashboard');
        setLoading(false);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  const userId = session?.user.id;
  const refresh = useCallback(async () => {
    const next = await loadPortal();
    setData(next);
  }, []);
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setProfile(null);
    setData(emptyData);
    (async () => {
      const own = (
        await db().from('portal_profiles').select('*').eq('id', userId).maybeSingle()
      ) as { data: Profile | null; error: { message: string } | null };
      if (own.error) throw new Error(own.error.message);
      if (!own.data)
        throw new Error(
          'This account has not been given portal access yet. Please contact Vexora.',
        );
      if (!own.data.active)
        throw new Error('Your portal account is inactive. Please contact Vexora.');
      const ownProfile = own.data;
      const next = await loadPortal();
      if (active) {
        setProfile(ownProfile);
        setData(next);
        // Clients open their own workspace, or the first one they are a member of.
        setWorkspace(
          ownProfile.role === 'client'
            ? ((next.clients.find((row) => row.id === ownProfile.id) ?? next.clients[0])?.id ??
                null)
            : null,
        );
      }
    })()
      .catch((error) => {
        if (active) setError(`Portal access unavailable. ${error.message}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, retry]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const own = unwrap(
          await db().from('portal_profiles').select('*').eq('id', profile.id).maybeSingle(),
        ) as Profile | null;
        if (!own?.active) {
          if (active) {
            setProfile(null);
            setData(emptyData);
            setError('Your portal account is inactive. Please contact Vexora.');
          }
          return;
        }
        const next = await loadPortal();
        if (active) {
          setData(next);
          setError('');
        }
      } catch {
        if (active) setError('Updates are unavailable. Check your connection and refresh.');
      }
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [profile]);
  async function signOut() {
    const result = await db().auth.signOut({ scope: 'local' });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSession(null);
    setProfile(null);
    setData(emptyData);
  }
  if (!hasSupabaseConfig) return <Login configured={false} />;
  if (loading)
    return (
      <div className="loading">
        <span className="brand-mark">V</span>
        <p>Opening your workspace…</p>
      </div>
    );
  if (!session) return <Login configured />;
  if (!profile)
    return (
      <div className="access-error panel">
        <ShieldCheck size={30} />
        <h1>Portal access</h1>
        <p role="alert">
          {error ||
            'This account has not been assigned a portal workspace. Contact Vexora for access.'}
        </p>
        <button onClick={() => setRetry((value) => value + 1)}>Try again</button>
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  const admin = profile.role === 'admin';
  const client = data.clients.find((row) => row.id === workspace);
  const access = accessMap(profile, data);
  const readOnly = !admin && !!workspace && access[workspace] === 'read';
  const ownWorkspaces = admin ? [] : data.clients.filter((row) => access[row.id]);
  const vexbotPage =
    page === 'Vexbot' ? 'Vexbot' : client && page !== 'Messages' ? 'Workspace' : page;
  const totalUnread = data.conversations.reduce(
    (sum, row) => sum + unread(row.id, data, profile.id),
    0,
  );
  const clients = data.clients.filter((row) =>
    `${row.company} ${row.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  function navigate(next: Page) {
    setPage(next);
    if (admin) setWorkspace(null);
    setSearch('');
  }
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('Dashboard');
          }}
        >
          <span className="brand-mark">V</span>
          <span>
            vexora<span className="brand-dot">.</span>
            <small>CLIENT PORTAL</small>
          </span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            ['Dashboard', ...(admin ? ['Clients'] : []), 'Messages', ...(admin ? ['Vexbot'] : [])] as Page[]
          ).map((item) => {
            const Icon =
              item === 'Dashboard'
                ? LayoutDashboard
                : item === 'Clients'
                  ? Users
                  : item === 'Vexbot'
                    ? Bot
                    : MessageSquare;
            return (
              <button
                key={item}
                className={`nav-item ${page === item ? 'active' : ''}`}
                onClick={() => navigate(item)}
              >
                <Icon size={19} />
                {item}
                {item === 'Messages' && totalUnread > 0 && (
                  <span className="nav-count">{totalUnread}</span>
                )}
              </button>
            );
          })}
        </nav>
        {/* Empty on purpose: Vexbot's perch between the navigation and the account block. */}
        <div className="vexbot-perch" data-vexbot-perch aria-hidden="true" />
        <div className="sidebar-bottom">
          <div className="secure-note">
            <ShieldCheck size={17} />
            <div>
              Private by design<small>Your work, in one secure place.</small>
            </div>
          </div>
          <div className="account">
            <span className="avatar">{profile.display_name.slice(0, 1)}</span>
            <div>
              {profile.display_name}
              <small>{admin ? 'Administrator' : readOnly ? 'Read-only access' : 'Client workspace'}</small>
            </div>
            <button aria-label="Sign out" className="icon-button" onClick={signOut}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} /> <strong>{client?.company || page}</strong>
          </span>
          <span className="topbar-right">
            {ownWorkspaces.length > 1 && (
              <select
                aria-label="Switch workspace"
                className="workspace-switch"
                value={workspace ?? ''}
                onChange={(event) => setWorkspace(event.target.value)}
              >
                {ownWorkspaces.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.company}
                    {access[row.id] === 'read' ? ' (read-only)' : ''}
                  </option>
                ))}
              </select>
            )}
            <span className="status-dot" />
            Vexora Client Portal
            <button
              aria-label="Refresh portal"
              className="icon-button"
              onClick={() => refresh().catch((error) => setError(error.message))}
            >
              <RefreshCw size={16} />
            </button>
            <button aria-label="Log out" className="secondary topbar-logout" onClick={signOut}>
              <LogOut size={15} />
              <span>Log out</span>
            </button>
          </span>
        </header>
        <main>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button className="text-button" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}
          {admin && page === 'Vexbot' ? (
            <VexbotAdmin clients={data.clients} profiles={data.profiles} />
          ) : client && page !== 'Messages' ? (
            <Workspace
              key={client.id}
              client={client}
              profile={profile}
              data={data}
              readOnly={readOnly}
              refresh={refresh}
              onManage={() => setDialog(client.id)}
              onMessages={() => setPage('Messages')}
              onBack={admin ? () => setWorkspace(null) : undefined}
            />
          ) : page === 'Messages' ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">KEEP THE CONVERSATION GOING</div>
                <h1>
                  Messages<span className="purple-dot">.</span>
                </h1>
                <p>Questions, updates and the next steps. All in one place.</p>
              </div>
              <Chat
                profile={profile}
                data={data}
                refresh={refresh}
                workspaceId={workspace || undefined}
                readOnly={readOnly}
              />
            </>
          ) : (
            <>
              <div className="page-heading heading-row">
                <div>
                  <div className="eyebrow">
                    {page === 'Dashboard'
                      ? 'A CLEAR VIEW OF WHAT’S NEXT'
                      : 'GREAT WORK STARTS WITH CONNECTION'}
                  </div>
                  <h1>
                    {page === 'Dashboard'
                      ? `Welcome back, ${profile.display_name.split(' ')[0]}`
                      : 'Your clients'}
                    <span className="purple-dot">.</span>
                  </h1>
                  <p>
                    {page === 'Dashboard'
                      ? 'Your clients, conversations and shared work. Connected.'
                      : 'Manage relationships and open a private client workspace.'}
                  </p>
                </div>
                {admin && (
                  <button onClick={() => setDialog('new')}>
                    <Plus size={17} />
                    Add client
                  </button>
                )}
              </div>
              {page === 'Dashboard' && (
                <>
                  <section className="overview-strip">
                    <div>
                      <span className="stat-icon">
                        <Users size={21} />
                      </span>
                      <div>
                        <small>Total clients</small>
                        <strong>{data.clients.length}</strong>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon">
                        <MessageSquare size={21} />
                      </span>
                      <div>
                        <small>Unread messages</small>
                        <strong>{totalUnread.toString().padStart(2, '0')}</strong>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon">
                        <ShieldCheck size={21} />
                      </span>
                      <div>
                        <small>Active workspaces</small>
                        <strong>
                          {data.clients
                            .filter((c) => data.profiles.find((p) => p.id === c.id)?.active)
                            .length.toString()
                            .padStart(2, '0')}
                        </strong>
                      </div>
                    </div>
                    <span className="overview-caption">
                      Good things happen
                      <br />
                      when we stay connected.
                    </span>
                  </section>
                  <section className="welcome-banner">
                    <div className="eyebrow">BUILT AROUND YOUR CLIENTS</div>
                    <h2>
                      A little clarity.
                      <br />A lot of possibility.
                    </h2>
                    <p>
                      Everything your clients need,
                      <br />
                      with a direct line to you.
                    </p>
                    <div className="orb orb-one" />
                    <div className="orb orb-two" />
                    <span className="banner-tag">
                      <span className="status-dot" /> Your client hub
                    </span>
                  </section>
                </>
              )}
              <div className={page === 'Dashboard' ? 'dashboard-panels' : ''}>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Clients <span className="count">{data.clients.length}</span>
                      </h2>
                      <p>A workspace for every relationship.</p>
                    </div>
                    {page === 'Dashboard' && (
                      <button className="text-button" onClick={() => navigate('Clients')}>
                        View all <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search clients"
                      placeholder="Search clients…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <div className="client-list">
                    {clients.length === 0 ? (
                      <div className="empty">
                        <Users size={27} />
                        <h3>{search ? 'No matching clients' : 'Meet your first client'}</h3>
                        <p>
                          {search
                            ? 'Try another company or email.'
                            : 'Add a client to give them a secure home for shared work.'}
                        </p>
                        {!search && (
                          <button onClick={() => setDialog('new')}>
                            <Plus size={16} />
                            Add client
                          </button>
                        )}
                      </div>
                    ) : (
                      clients.slice(0, page === 'Dashboard' ? 5 : undefined).map((row) => (
                        <button
                          className="client-row"
                          key={row.id}
                          onClick={() => {
                            setWorkspace(row.id);
                            setPage('Clients');
                          }}
                        >
                          <span className="avatar client-avatar">
                            {row.company.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="row-copy">
                            <strong>{row.company}</strong>
                            <small>{row.email}</small>
                          </span>
                          <span
                            className={`pill ${data.profiles.find((p) => p.id === row.id)?.active ? '' : 'muted'}`}
                          >
                            {data.profiles.find((p) => p.id === row.id)?.active
                              ? 'Active'
                              : 'Inactive'}
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))
                    )}
                  </div>
                </section>
                {page === 'Dashboard' && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          Messages {totalUnread > 0 && <span className="count">{totalUnread}</span>}
                        </h2>
                        <p>A direct line to your clients.</p>
                      </div>
                      <button className="text-button" onClick={() => navigate('Messages')}>
                        Inbox <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {data.conversations.length === 0 ? (
                      <div className="empty">
                        <MessageSquare size={27} />
                        <h3>Room for a conversation</h3>
                        <p>Client questions and your replies will appear here.</p>
                      </div>
                    ) : (
                      data.conversations.slice(0, 4).map((row) => (
                        <button
                          className="conversation-preview"
                          key={row.id}
                          onClick={() => {
                            setWorkspace(row.workspace_id);
                            setPage('Messages');
                          }}
                        >
                          <span className="avatar">
                            {data.clients
                              .find((c) => c.id === row.workspace_id)
                              ?.company.slice(0, 1)}
                          </span>
                          <span className="row-copy">
                            <strong>{row.subject}</strong>
                            <small>
                              {data.clients.find((c) => c.id === row.workspace_id)?.company}
                              {row.archived_at ? ' · Archived' : ''}
                            </small>
                          </span>
                          {unread(row.id, data, profile.id) > 0 && <span className="unread-dot" />}
                          <ChevronRight size={16} />
                        </button>
                      ))
                    )}
                  </section>
                )}
              </div>
            </>
          )}
          <footer>
            <span>
              VEXORA <span className="footer-dot">/</span> Built for better connections.
            </span>
            <span>Private. Personal. All in one place.</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <ClientDialog
          client={data.clients.find((c) => c.id === dialog)}
          profile={data.profiles.find((p) => p.id === dialog)}
          members={data.members.filter((m) => m.workspace_id === dialog)}
          profiles={data.profiles}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
      <Vexbot
        profile={profile}
        workspaces={data.clients}
        access={access}
        workspaceId={workspace}
        page={vexbotPage}
        onMessages={(target) => {
          if (admin) setWorkspace(target);
          setPage('Messages');
        }}
      />
    </div>
  );
}
