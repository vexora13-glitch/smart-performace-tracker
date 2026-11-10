import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import { VexoraBrand } from './design/Brand';
import { VexoraPageTransition, VexoraReveal } from './design/motion';
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
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Trash2,
  Folder,
  Video,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import { accessMap, db, loadPortal, unread, unwrap } from './services/portal';
import { ASK_EVENT, Vexbot } from './vexbot/Vexbot';
import { VexbotAdmin } from './components/VexbotAdmin';
import { emptyData, type PortalData, type Profile } from './types/portal';
import { Login } from './components/Login';
import { ClientDialog } from './components/ClientDialog';
import { DeleteClientsDialog } from './components/DeleteClientsDialog';
import { Workspace } from './components/Workspace';
import { Chat } from './components/Chat';
import { AdminActivityOverview, NotificationBell } from './components/AdminNotifications';
import { useAdminInsights } from './services/use-admin-insights';
import { ClientActivity, ClientConversations } from './components/ClientInsights';
import {
  clearActivityQueue,
  insightHash,
  recordLogout,
  trackActivity,
  type InsightTarget,
} from './services/activity';
import './components/insights.css';
import './App.css';

type Page = 'Dashboard' | 'Clients' | 'Messages' | 'Vexbot';
export type WorkspaceSection =
  'Overview' | 'Documents' | 'Videos' | 'Workspace' | 'Project Updates' | 'Team & Contacts';
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<PortalData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('Dashboard');
  const [section, setSection] = useState<WorkspaceSection>(() =>
    window.location.hash.startsWith('#video=') ? 'Videos' : 'Workspace',
  );
  const [presentationTitle, setPresentationTitle] = useState('');
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [deletingClients, setDeletingClients] = useState<string[] | null>(null);
  const [clientNotice, setClientNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [clientTab, setClientTab] = useState<InsightTarget['tab']>('workspace');
  const [insightTarget, setInsightTarget] = useState<InsightTarget | null>(null);
  const adminInsights = useAdminInsights(profile?.role === 'admin', profile?.id);
  const adminTimezone = adminInsights.overview?.timezone || 'Pacific/Auckland';
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    const openLink = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const client = params.get('client');
      if (!client || !data.clients.some((c) => c.id === client)) return;
      const raw = params.get('tab');
      const tab: InsightTarget['tab'] =
        raw === 'conversations' || raw === 'messages' || raw === 'activity' ? raw : 'workspace';
      setWorkspace(client);
      setPage('Dashboard');
      setClientTab(tab);
      setInsightTarget({
        workspace: client,
        tab,
        conversation: params.get('conversation') || undefined,
        thread: params.get('thread') || undefined,
        message: params.get('message') || undefined,
        activity: params.get('activity') || undefined,
      });
    };
    openLink();
    window.addEventListener('hashchange', openLink);
    return () => window.removeEventListener('hashchange', openLink);
  }, [profile?.role, data.clients]);
  useEffect(() => {
    if (profile?.role !== 'client' || !workspace) return;
    trackActivity({ event: 'workspace_opened', workspace_id: workspace }, `workspace:${workspace}`);
  }, [profile?.role, workspace]);
  useEffect(() => {
    if (profile?.role !== 'client' || !workspace || !session) return;
    try {
      const claims = JSON.parse(
        atob(session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')),
      );
      const key = `vexora-login:${profile.id}:${claims.session_id || session.user.id}`;
      if (!sessionStorage.getItem(key)) {
        trackActivity({ event: 'login', workspace_id: workspace });
        sessionStorage.setItem(key, '1');
      }
    } catch {
      /* Session privacy settings do not affect portal access. */
    }
  }, [profile?.id, profile?.role, workspace, session]);
  const mobileMenu = useRef<HTMLDialogElement>(null);
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
        clearActivityQueue();
        setProfile(null);
        setData(emptyData);
        setWorkspace(null);
        setPage('Dashboard');
        setSelectedClients([]);
        setDeletingClients(null);
        setClientNotice('');
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
    const openSharedVideo = () => {
      const id = new URLSearchParams(window.location.hash.slice(1)).get('video');
      const file = data.files.find((file) => file.id === id && file.mime_type.startsWith('video/'));
      if (!file) return;
      setWorkspace(file.workspace_id);
      setSection('Videos');
      setPage('Dashboard');
    };
    window.addEventListener('hashchange', openSharedVideo);
    return () => window.removeEventListener('hashchange', openSharedVideo);
  }, [data.files]);
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
      const own = (await db()
        .from('portal_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()) as { data: Profile | null; error: { message: string } | null };
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
          next.files.find(
            (file) => file.id === new URLSearchParams(window.location.hash.slice(1)).get('video'),
          )?.workspace_id ??
            (ownProfile.role === 'client'
              ? ((next.clients.find((row) => row.id === ownProfile.id) ?? next.clients[0])?.id ??
                null)
              : null),
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
    if (profile?.role === 'client' && workspace) await recordLogout(workspace);
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
      <div className="loading" role="status" aria-live="polite">
        <span className="brand-mark">V</span>
        <p>Opening your workspace…</p>
        <div className="loading-skeleton" aria-hidden="true" />
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
  const listedClients = clients.slice(0, page === 'Dashboard' ? 5 : undefined);
  const selected = selectedClients.filter((id) => data.clients.some((client) => client.id === id));
  const allListedSelected =
    listedClients.length > 0 && listedClients.every((client) => selected.includes(client.id));
  function selectClient(id: string) {
    setSelectedClients((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }
  function navigate(next: Page) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setClientTab('workspace');
    setInsightTarget(null);
    setPresentationTitle('');
    if (next === 'Dashboard') setSection('Workspace');
    mobileMenu.current?.close();
    setPage(next);
    if (admin) setWorkspace(null);
    setSearch('');
    setSelectedClients([]);
    setClientNotice('');
  }
  function navigateWorkspace(next: WorkspaceSection) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setClientTab('workspace');
    setInsightTarget(null);
    setPresentationTitle('');
    mobileMenu.current?.close();
    setSection(next);
    setPage('Dashboard');
    if (!workspace) setWorkspace(ownWorkspaces[0]?.id ?? data.clients[0]?.id ?? null);
  }
  const portalNavigation = [
    { label: 'Dashboard' as const, icon: LayoutDashboard },
    ...(admin ? [{ label: 'Clients' as const, icon: Users }] : []),
    { label: 'Messages' as const, icon: MessageSquare },
    { label: 'Documents' as const, icon: Folder },
    { label: 'Videos' as const, icon: Video },
    { label: 'VexBot' as const, icon: Bot },
  ];
  function navigationActive(label: (typeof portalNavigation)[number]['label']) {
    if (label === 'Documents' || label === 'Videos')
      return page === 'Dashboard' && !!client && section === label;
    if (label === 'VexBot') return page === 'Vexbot';
    return (
      page === label &&
      (label !== 'Dashboard' || !client || !['Documents', 'Videos'].includes(section))
    );
  }
  function portalNavigate(label: (typeof portalNavigation)[number]['label']) {
    if (label === 'VexBot' && !admin) {
      window.dispatchEvent(
        new CustomEvent(ASK_EVENT, {
          detail: { workspace: workspace ?? ownWorkspaces[0]?.id ?? null, question: '' },
        }),
      );
      mobileMenu.current?.close();
    } else if (label === 'Documents' || label === 'Videos') navigateWorkspace(label);
    else {
      setSection('Workspace');
      navigate(label === 'VexBot' ? 'Vexbot' : label);
    }
  }
  return (
    <div className={`app-layout ${collapsed ? 'is-collapsed' : ''}`}>
      <a href="#portal-main" className="skip-link">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="Vexora portal home"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('Dashboard');
          }}
        >
          <VexoraBrand />
        </a>
        <LayoutGroup id="portal-navigation">
          <nav aria-label="Main navigation">
            {portalNavigation.map(({ label, icon: Icon }) => {
              const active = navigationActive(label);
              return (
                <button
                  key={label}
                  className={`nav-item ${active ? 'active' : ''}`}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  title={label}
                  onClick={() => portalNavigate(label)}
                >
                  <Icon size={27} />
                  <span className="nav-copy">{label}</span>
                  {label === 'Messages' && totalUnread > 0 && (
                    <span className="nav-count">{totalUnread}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </LayoutGroup>
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
              <small>
                {admin ? 'Administrator' : readOnly ? 'Read-only access' : 'Client workspace'}
              </small>
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
            <button
              className="icon-button collapse-button"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <button
              className="icon-button mobile-menu-button"
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              onClick={() => mobileMenu.current?.showModal()}
            >
              <Menu size={19} />
            </button>
            <button className="text-button breadcrumb-prefix" onClick={() => navigate('Dashboard')}>
              Home
            </button>{' '}
            <ChevronRight size={16} />{' '}
            {client && page !== 'Messages' && (
              <>
                <span>{section}</span>
                <ChevronRight size={16} />
              </>
            )}
            <strong>
              {client && section === 'Videos' && presentationTitle
                ? presentationTitle
                : client?.company || (page === 'Dashboard' ? 'Dashboard' : page)}
            </strong>
          </span>
          <span className="topbar-right">
            {admin && (
              <NotificationBell
                clients={data.clients}
                timezone={adminTimezone}
                unread={adminInsights.overview?.counts.unread || 0}
                onChange={adminInsights.refresh}
                onNavigate={(target) => {
                  window.location.hash = insightHash(target);
                  void refresh();
                }}
              />
            )}
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
            <span className="header-profile">
              <span className="avatar">
                {profile.display_name
                  .split(' ')
                  .map((name) => name[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <strong>{profile.display_name}</strong>
            </span>
            <button
              aria-label="Refresh portal"
              className="icon-button"
              onClick={() => refresh().catch((error) => setError(error.message))}
            >
              <RefreshCw size={16} />
            </button>
            <button aria-label="Sign out" className="secondary topbar-logout" onClick={signOut}>
              <LogOut size={15} />
              <span>Log out</span>
            </button>
          </span>
        </header>
        <main id="portal-main" tabIndex={-1}>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button className="text-button" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}
          <VexoraPageTransition identity={`${page}:${client?.id ?? ''}`}>
            {admin && page === 'Vexbot' ? (
              <VexbotAdmin clients={data.clients} profiles={data.profiles} />
            ) : client && page !== 'Messages' ? (
              <>
                {admin && (
                  <nav className="client-profile-tabs" aria-label="Client administration profile">
                    {(['workspace', 'activity', 'conversations', 'messages'] as const).map(
                      (tab) => (
                        <button
                          key={tab}
                          className="secondary"
                          aria-current={clientTab === tab ? 'page' : undefined}
                          onClick={() => {
                            setClientTab(tab);
                            setInsightTarget(null);
                            window.location.hash = insightHash({ workspace: client.id, tab });
                          }}
                        >
                          {tab === 'conversations'
                            ? 'VexBot Conversations'
                            : tab[0].toUpperCase() + tab.slice(1)}
                        </button>
                      ),
                    )}
                  </nav>
                )}
                {admin && clientTab === 'activity' ? (
                  <ClientActivity
                    key={client.id}
                    workspace={client.id}
                    timezone={adminTimezone}
                    highlight={insightTarget?.activity}
                  />
                ) : admin && clientTab === 'conversations' ? (
                  <ClientConversations
                    key={client.id}
                    workspace={client.id}
                    timezone={adminTimezone}
                    selected={insightTarget?.conversation}
                    onSelect={(id) => {
                      window.location.hash = insightHash({
                        workspace: client.id,
                        tab: 'conversations',
                        conversation: id,
                      });
                    }}
                  />
                ) : admin && clientTab === 'messages' ? (
                  <Chat
                    key={client.id}
                    profile={profile}
                    data={data}
                    refresh={refresh}
                    workspaceId={client.id}
                    initialThread={insightTarget?.thread}
                    initialMessage={insightTarget?.message}
                    onThreadSelect={(thread) => {
                      window.location.hash = insightHash({
                        workspace: client.id,
                        tab: 'messages',
                        thread,
                      });
                    }}
                  />
                ) : (
                  <Workspace
                    key={client.id}
                    client={client}
                    profile={profile}
                    data={data}
                    readOnly={readOnly}
                    refresh={refresh}
                    section={section}
                    onPresentationTitle={setPresentationTitle}
                    onManage={() => setDialog(client.id)}
                    onMessages={() => setPage('Messages')}
                    onBack={
                      admin
                        ? () => {
                            window.history.replaceState(
                              null,
                              '',
                              window.location.pathname + window.location.search,
                            );
                            setWorkspace(null);
                            setInsightTarget(null);
                            setClientTab('workspace');
                          }
                        : undefined
                    }
                  />
                )}
                {!admin && (
                  <p className="activity-privacy">
                    Relevant portal activity and VexBot text conversations and available voice
                    transcripts are recorded and available to authorised Vexora administrators for
                    client support and follow-up. The portal does not store raw microphone audio.
                  </p>
                )}
              </>
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
                    <VexoraReveal>
                      <section className="overview-strip" aria-label="Workspace overview">
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
                    </VexoraReveal>
                    <VexoraReveal delay={0.04}>
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
                        <div className="orb orb-one" aria-hidden="true" />
                        <div className="orb orb-two" aria-hidden="true" />
                        <span className="banner-tag">
                          <span className="status-dot" /> Your client hub
                        </span>
                      </section>
                    </VexoraReveal>
                  </>
                )}
                {admin && page === 'Dashboard' && (
                  <AdminActivityOverview
                    overview={adminInsights.overview}
                    error={adminInsights.error}
                    onRefresh={adminInsights.refresh}
                    clients={data.clients}
                    timezone={adminTimezone}
                    onNavigate={(target) => {
                      window.location.hash = insightHash(target);
                      void refresh();
                    }}
                  />
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
                    {admin && listedClients.length > 0 && (
                      <div className="client-selection-toolbar">
                        <label className="client-selection">
                          <input
                            type="checkbox"
                            aria-label={
                              search
                                ? 'Select all matching clients'
                                : page === 'Dashboard'
                                  ? 'Select listed clients'
                                  : 'Select all clients'
                            }
                            checked={allListedSelected}
                            ref={(input) => {
                              if (input)
                                input.indeterminate =
                                  !allListedSelected &&
                                  listedClients.some((client) => selected.includes(client.id));
                            }}
                            onChange={() =>
                              setSelectedClients((current) =>
                                allListedSelected
                                  ? current.filter(
                                      (id) => !listedClients.some((client) => client.id === id),
                                    )
                                  : [
                                      ...new Set([
                                        ...current,
                                        ...listedClients.map((client) => client.id),
                                      ]),
                                    ],
                              )
                            }
                          />
                          {search
                            ? 'Select all matches'
                            : page === 'Dashboard'
                              ? 'Select listed clients'
                              : 'Select all'}
                        </label>
                        <span role="status">{selected.length} selected</span>
                        <button
                          className="danger-button"
                          disabled={!selected.length}
                          onClick={() => setDeletingClients(selected)}
                        >
                          <Trash2 size={16} /> Delete selected
                        </button>
                      </div>
                    )}
                    {clientNotice && (
                      <p className="notice" role="status">
                        {clientNotice}
                      </p>
                    )}
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
                        listedClients.map((row) => (
                          <div className="client-list-entry" key={row.id}>
                            {admin && (
                              <input
                                className="client-checkbox"
                                type="checkbox"
                                aria-label={`Select ${row.company}`}
                                checked={selected.includes(row.id)}
                                onChange={() => selectClient(row.id)}
                              />
                            )}
                            <button
                              className="client-row"
                              key={row.id}
                              onClick={() => {
                                window.history.replaceState(
                                  null,
                                  '',
                                  window.location.pathname + window.location.search,
                                );
                                setClientTab('workspace');
                                setInsightTarget(null);
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
                            {admin && (
                              <button
                                className="icon-button client-delete"
                                aria-label={`Delete ${row.company}`}
                                title={`Delete ${row.company}`}
                                onClick={() => setDeletingClients([row.id])}
                              >
                                <Trash2 size={17} />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                  {page === 'Dashboard' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Messages{' '}
                            {totalUnread > 0 && <span className="count">{totalUnread}</span>}
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
                            {unread(row.id, data, profile.id) > 0 && (
                              <span className="unread-dot" />
                            )}
                            <ChevronRight size={16} />
                          </button>
                        ))
                      )}
                    </section>
                  )}
                </div>
              </>
            )}
          </VexoraPageTransition>
          <footer>
            <span>
              VEXORA <span className="footer-dot">/</span> Built for better connections.
            </span>
            <span>Private. Personal. All in one place.</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={mobileMenu}
        className="mobile-navigation"
        aria-labelledby="mobile-navigation-title"
      >
        <div className="panel-heading">
          <h2 id="mobile-navigation-title">Your workspace</h2>
          <button
            className="icon-button"
            aria-label="Close navigation menu"
            onClick={() => mobileMenu.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Mobile navigation">
          {portalNavigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className="secondary"
              aria-current={navigationActive(label) ? 'page' : undefined}
              onClick={() => portalNavigate(label)}
            >
              <Icon size={20} />
              {label}
              {label === 'Messages' && totalUnread > 0 && (
                <span className="nav-count">{totalUnread}</span>
              )}
            </button>
          ))}
        </nav>
      </dialog>
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
      {deletingClients && (
        <DeleteClientsDialog
          clients={data.clients.filter((client) => deletingClients.includes(client.id))}
          onClose={() => setDeletingClients(null)}
          onDeleted={async (ids) => {
            setSelectedClients((current) => current.filter((id) => !ids.includes(id)));
            if (ids.length) {
              // Clear deleted workspace data immediately, even if the refresh fails.
              setData((current) => {
                const conversations = new Set(
                  current.conversations
                    .filter((row) => ids.includes(row.workspace_id))
                    .map((row) => row.id),
                );
                return {
                  profiles: current.profiles.filter((row) => !ids.includes(row.id)),
                  clients: current.clients.filter((row) => !ids.includes(row.id)),
                  conversations: current.conversations.filter((row) => !conversations.has(row.id)),
                  messages: current.messages.filter(
                    (row) => !conversations.has(row.conversation_id),
                  ),
                  reads: current.reads.filter(
                    (row) => !conversations.has(row.conversation_id) && !ids.includes(row.user_id),
                  ),
                  files: current.files.filter((row) => !ids.includes(row.workspace_id)),
                  announcements: current.announcements.filter(
                    (row) => !ids.includes(row.workspace_id),
                  ),
                  members: current.members.filter(
                    (row) => !ids.includes(row.workspace_id) && !ids.includes(row.user_id),
                  ),
                };
              });
              setClientNotice(
                `${ids.length} ${ids.length === 1 ? 'client permanently deleted' : 'clients permanently deleted'}. Files removed and platform access revoked.`,
              );
            }
            await refresh().catch(() =>
              setError('Refresh is unavailable. Please refresh the portal to update the list.'),
            );
          }}
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
