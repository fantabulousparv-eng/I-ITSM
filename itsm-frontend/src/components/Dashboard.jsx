import React, { useCallback, useEffect, useMemo, useState } from 'react';
import API, { errorMessage, eventsUrl } from '../services/api';
import SupportChat from './SupportChat';
import {
  CATEGORIES,
  CLOSED_STATUSES,
  LEVELS,
  OPEN_STATUSES,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  STATUSES,
  STATUS_LABEL,
  canAssign,
  duplicateMatches,
  formatDuration,
  formatWhen,
  isClosed,
  nextActions,
  predictPriority,
  priorityScore,
  refId,
  slaInfo,
} from '../lib/incident';

const PAGE_SIZE = 12;

const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'priority', label: 'Priority' },
  { id: 'sla-due', label: 'SLA deadline' },
  { id: 'updated', label: 'Recently updated' },
];

const SLA_FILTERS = [
  { id: 'ON_TRACK', label: 'On track' },
  { id: 'AT_RISK', label: 'At risk' },
  { id: 'BREACHED', label: 'Breached' },
  { id: 'MET', label: 'Met' },
];

const ASSIGNMENT_STRATEGIES = [
  { id: 'composite', label: 'Composite (best overall fit)' },
  { id: 'skill-based', label: 'Skill match' },
  { id: 'load-based', label: 'Lightest workload' },
  { id: 'experience-based', label: 'Service experience' },
  { id: 'round-robin', label: 'Round robin' },
];

const EMPTY_FILTERS = {
  q: '',
  status: '',
  priority: '',
  category: '',
  service: '',
  technician: '',
  from: '',
  to: '',
  slaStatus: '',
};

const COPY = {
  employee: { title: 'Employee desk', blurb: 'Report what broke and follow it until it is closed.' },
  technician: { title: 'Technician desk', blurb: 'Pick up assigned work, investigate, and resolve it.' },
  admin: { title: 'Operations desk', blurb: 'Triage, assign, watch SLAs, and keep services current.' },
};

/** Normalise a notification from either the REST list or the SSE frame. */
function normalizeNotification(raw) {
  return {
    id: raw.id || raw._id,
    event: raw.event,
    title: raw.title,
    message: raw.message,
    severity: raw.severity || 'info',
    incidentRef: raw.incidentRef || raw.incident?.incidentId || '',
    incidentId: raw.incident?._id || raw.incident || null,
    createdAt: raw.createdAt || raw.deliveredAt,
    read: Boolean(raw.read),
  };
}

export default function Dashboard({ user, token, onLogout }) {
  const role = user?.role || 'employee';
  const userId = String(user?._id || '');

  const [view, setView] = useState('queue');
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [services, setServices] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [sort, setSort] = useState('newest');
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);

  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [toast, setToast] = useState('');

  const isStaff = role === 'admin' || role === 'technician';

  /* ----------------------------------------------------------------- ticking */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (message) => setToast(message);
  const refresh = () => setReload((n) => n + 1);

  /* ------------------------------------------------------------ reference data */
  useEffect(() => {
    let cancel = false;
    API.get('/incidents/meta')
      .then(({ data }) => {
        if (cancel) return;
        setServices(data.services || []);
        setTechnicians(data.technicians || []);
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [reload]);

  /* ------------------------------------------------------------- incident queue */
  useEffect(() => {
    let cancel = false;
    setLoading(true);

    const params = { limit: PAGE_SIZE, page, sort };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    if (unassignedOnly) params.technician = 'unassigned';

    API.get('/incidents', { params })
      .then(({ data }) => {
        if (cancel) return;
        setIncidents(data.items || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
        setError('');
      })
      .catch((err) => {
        if (!cancel) setError(errorMessage(err, 'Could not load the incident queue.'));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => { cancel = true; };
  }, [filters, page, sort, unassignedOnly, reload]);

  /* Debounce the free-text search so typing does not spam the API. */
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchText ? prev : { ...prev, q: searchText }));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  /* ----------------------------------------------------------- global analytics */
  useEffect(() => {
    if (!isStaff) return undefined;
    let cancel = false;
    API.get('/analytics/overview', { params: { days: 14 } })
      .then(({ data }) => { if (!cancel) setOverview(data); })
      .catch(() => { if (!cancel) setOverview(null); });
    return () => { cancel = true; };
  }, [isStaff, reload]);

  /* --------------------------------------------------------------- selected ticket */
  useEffect(() => {
    if (!selectedId) { setSelected(null); return undefined; }
    let cancel = false;
    API.get(`/incidents/${selectedId}`)
      .then(({ data }) => { if (!cancel) setSelected(data.incident); })
      .catch(() => { if (!cancel) setSelected(null); });
    return () => { cancel = true; };
  }, [selectedId, reload]);

  /* ---------------------------------------------------------------- notifications */
  const loadNotifications = useCallback(() => {
    API.get('/notifications', { params: { limit: 30 } })
      .then(({ data }) => {
        setNotifications((data.notifications || []).map(normalizeNotification));
        setUnread(data.unread || 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  /* Live push over Server-Sent Events (the real-time notification leg). */
  useEffect(() => {
    if (!token) return undefined;
    const source = new EventSource(eventsUrl(token));

    source.addEventListener('notification', (frame) => {
      try {
        const incoming = normalizeNotification(JSON.parse(frame.data));
        setNotifications((prev) => [incoming, ...prev.filter((item) => item.id !== incoming.id)].slice(0, 40));
        setUnread((count) => count + 1);
        setToast(incoming.title);
        // Workflow events change the queue, so refresh it as well.
        if (String(incoming.event || '').startsWith('incident.') || String(incoming.event || '').startsWith('sla.')) {
          setReload((n) => n + 1);
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    return () => source.close();
  }, [token]);

  const markRead = async (id) => {
    try {
      await API.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
      setUnread((count) => Math.max(0, count - 1));
    } catch { /* non-critical */ }
  };

  const markAllRead = async () => {
    try {
      await API.post('/notifications/read-all');
      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setUnread(0);
    } catch { /* non-critical */ }
  };

  /* -------------------------------------------------------------------- helpers */
  const applyFilter = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchText('');
    setUnassignedOnly(false);
    setSort('newest');
    setPage(1);
  };

  const kpis = useMemo(() => {
    if (overview) {
      return {
        scope: 'All incidents',
        matching: overview.totals.all,
        open: overview.totals.open,
        unassigned: overview.totals.unassigned,
        risk: overview.sla.atRisk + overview.sla.breached,
      };
    }
    const open = incidents.filter((item) => !isClosed(item.status)).length;
    return {
      scope: 'Current page',
      matching: total,
      open,
      unassigned: incidents.filter((item) => !item.assignedTechnician).length,
      risk: incidents.filter((item) => ['at-risk', 'violated'].includes(slaInfo(item, now).state)).length,
    };
  }, [overview, incidents, total, now]);

  const nav = [
    { id: 'queue', label: 'Queue' },
    { id: 'chat', label: 'Support chat' },
    ...(role === 'employee' || role === 'admin' ? [{ id: 'report', label: 'Report' }] : []),
    { id: 'insights', label: 'Insights' },
    ...(role === 'admin' ? [{ id: 'services', label: 'Services' }] : []),
  ];
  const copy = COPY[role] || COPY.employee;

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>I-ITSM</strong><span>{role}</span></div>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <b>{user?.name || 'User'}</b>
            <span>{user?.department || 'Signed in'}</span>
          </div>
          <button className="btn ghost" type="button" onClick={onLogout}>Log out</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="top">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.blurb}</p>
          </div>
          <div className="top-actions">
            <div className="bell">
              <button className="btn ghost small" type="button" onClick={() => setBellOpen((open) => !open)}>
                Alerts{unread ? ` (${unread})` : ''}
              </button>
              {unread > 0 && <i className="dot" />}
              {bellOpen && (
                <div className="bell-panel">
                  <div className="bell-head">
                    <b>Notifications</b>
                    {unread > 0 && <button type="button" className="link" onClick={markAllRead}>Mark all read</button>}
                  </div>
                  {notifications.length === 0 ? <p className="muted">No alerts yet.</p> : notifications.map((item) => (
                    <button
                      type="button"
                      className={item.read ? 'notice' : 'notice unread'}
                      key={item.id}
                      onClick={() => {
                        if (!item.read) markRead(item.id);
                        if (item.incidentId) setSelectedId(item.incidentId);
                        setBellOpen(false);
                      }}
                    >
                      <span className={`sev ${item.severity}`} />
                      <span>
                        <b>{item.title}</b>
                        <span className="muted">{item.message}</span>
                        <time>{formatWhen(item.createdAt)}</time>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn danger small" type="button" onClick={onLogout}>Log out</button>
          </div>
        </header>

        {error && <p className="banner" role="alert">{error}</p>}

        {view === 'chat' && <SupportChat />}
        {view === 'queue' && (
          <>
            <div className="kpis">
              <article className="kpi"><span>{kpis.scope}</span><strong>{kpis.matching}</strong></article>
              <article className="kpi"><span>Open</span><strong>{kpis.open}</strong></article>
              <article className="kpi rose"><span>Unassigned</span><strong>{kpis.unassigned}</strong></article>
              <article className="kpi amber"><span>SLA risk</span><strong>{kpis.risk}</strong></article>
            </div>

            <div className="panel">
              <div className="toolbar">
                <div className="scope">
                  <button type="button" className={!unassignedOnly ? 'active' : ''} onClick={() => { setUnassignedOnly(false); setPage(1); }}>
                    {role === 'admin' ? 'All incidents' : 'My view'}
                  </button>
                  {role === 'admin' && (
                    <button type="button" className={unassignedOnly ? 'active' : ''} onClick={() => { setUnassignedOnly(true); setPage(1); }}>
                      Unassigned
                    </button>
                  )}
                </div>
                <div className="toolbar-right">
                  <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort">
                    {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <button className="btn ghost small" type="button" onClick={resetFilters}>Reset</button>
                </div>
              </div>

              <div className="filters">
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search id, title or description"
                  aria-label="Search incidents"
                />
                <select value={filters.status} onChange={(e) => applyFilter({ status: e.target.value })} aria-label="Status">
                  <option value="">Any status</option>
                  {STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
                </select>
                <select value={filters.priority} onChange={(e) => applyFilter({ priority: e.target.value })} aria-label="Priority">
                  <option value="">Any priority</option>
                  {PRIORITIES.map((item) => <option key={item} value={item}>{item} · {PRIORITY_LABEL[item]}</option>)}
                </select>
                <select value={filters.category} onChange={(e) => applyFilter({ category: e.target.value })} aria-label="Category">
                  <option value="">Any category</option>
                  {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select value={filters.slaStatus} onChange={(e) => applyFilter({ slaStatus: e.target.value })} aria-label="SLA status">
                  <option value="">Any SLA</option>
                  {SLA_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <select value={filters.service} onChange={(e) => applyFilter({ service: e.target.value })} aria-label="Service">
                  <option value="">Any service</option>
                  {services.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                </select>
                {role === 'admin' && (
                  <select value={filters.technician} onChange={(e) => applyFilter({ technician: e.target.value })} aria-label="Technician">
                    <option value="">Any technician</option>
                    <option value="unassigned">Unassigned</option>
                    {technicians.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                  </select>
                )}
                <label className="date-filter">
                  From
                  <input type="date" value={filters.from} onChange={(e) => applyFilter({ from: e.target.value })} />
                </label>
                <label className="date-filter">
                  To
                  <input type="date" value={filters.to} onChange={(e) => applyFilter({ to: e.target.value })} />
                </label>
              </div>

              {loading && incidents.length === 0 ? <p className="muted">Loading the desk…</p> : null}
              {!loading && incidents.length === 0 ? (
                <p className="empty">Nothing matches these filters. {role === 'employee' ? 'Report an incident to start the queue.' : ''}</p>
              ) : incidents.map((incident) => {
                const clock = slaInfo(incident, now);
                return (
                  <button className="ticket" key={incident._id} type="button" onClick={() => setSelectedId(incident._id)}>
                    <span><b className={`prio ${incident.priority}`}>{incident.priority}</b><small>{incident.incidentId}</small></span>
                    <span>
                      <b>{incident.title}</b>
                      <small>{incident.category} · {incident.affectedService?.name || 'Service pending'}
                        {incident.assignedTechnician ? ` · ${incident.assignedTechnician.name}` : ' · unassigned'}</small>
                    </span>
                    <span className="chip">{STATUS_LABEL[incident.status] || incident.status}</span>
                    <span className={`chip ${clock.state}`}>{clock.label}</span>
                  </button>
                );
              })}

              {pages > 1 && (
                <div className="pager">
                  <button className="btn ghost small" type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button>
                  <span className="muted">Page {page} of {pages} · {total} incidents</span>
                  <button className="btn ghost small" type="button" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Next</button>
                </div>
              )}
            </div>
          </>
        )}

        {view === 'report' && (role === 'employee' || role === 'admin') && (
          <ReportForm
            services={services}
            incidents={incidents}
            canManage={role === 'admin'}
            onCreated={(incident) => {
              notify(`${incident.incidentId} opened as ${incident.priority}`);
              setView('queue');
              refresh();
            }}
            onNeedServices={() => setView('services')}
          />
        )}

        {view === 'insights' && (
          <Insights
            role={role}
            overview={overview}
            incidents={incidents}
            now={now}
            onOpen={(id) => setSelectedId(id)}
            reload={reload}
          />
        )}

        {view === 'services' && role === 'admin' && (
          <Services
            services={services}
            onSaved={(message) => {
              notify(message);
              refresh();
            }}
          />
        )}
      </section>

      {selected && (
        <IncidentDrawer
          incident={selected}
          role={role}
          userId={userId}
          services={services}
          technicians={technicians}
          now={now}
          onClose={() => setSelectedId(null)}
          onChanged={(message) => {
            notify(message);
            refresh();
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ reporting */

function ReportForm({ services, incidents, canManage, onCreated, onNeedServices }) {
  const user = JSON.parse(localStorage.getItem('itsm.session') || '{}')?.user;
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Software',
    serviceId: '',
    impact: 'Medium',
    urgency: 'Medium',
    affectedUsers: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm((prev) => (prev.serviceId || !services[0]?._id ? prev : { ...prev, serviceId: services[0]._id }));
  }, [services]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const selectedService = services.find((item) => item._id === form.serviceId);
  const criticality = selectedService?.baseCriticality || 'Medium';
  const score = priorityScore(form.impact, form.urgency, criticality);
  const preview = predictPriority(form.impact, form.urgency, criticality);
  const matches = duplicateMatches(`${form.title} ${form.description}`, incidents);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await API.post('/incidents', {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        affectedService: form.serviceId,
        reporter: user?._id,
        impact: form.impact,
        urgency: form.urgency,
        affectedUsers: Number(form.affectedUsers) || 1,
      });
      setForm((prev) => ({ ...prev, title: '', description: '', affectedUsers: 1 }));
      onCreated(data.incident);
    } catch (err) {
      setError(errorMessage(err, 'Could not open the incident.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2">
      <form className="panel stack" onSubmit={submit}>
        <h2>Report an incident</h2>
        <p className="muted">
          The desk classifies it, finds the affected service, scores the impact, sets the SLA and assigns an
          engineer automatically.
        </p>
        {error && <p className="alert">{error}</p>}
        <label>Title<input value={form.title} onChange={set('title')} required minLength={8} placeholder="VPN keeps disconnecting" /></label>
        <label>What happened<textarea value={form.description} onChange={set('description')} required minLength={15} /></label>
        <div className="row-3">
          <label>Category
            <select value={form.category} onChange={set('category')}>
              {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Impact
            <select value={form.impact} onChange={set('impact')}>
              {LEVELS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Urgency
            <select value={form.urgency} onChange={set('urgency')}>
              {LEVELS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="row-3">
          <label>Affected service
            <select value={form.serviceId} onChange={set('serviceId')} required disabled={services.length === 0}>
              {services.length === 0 && <option value="">No services yet</option>}
              {services.map((service) => (
                <option key={service._id} value={service._id}>{service.name} · {service.baseCriticality}</option>
              ))}
            </select>
          </label>
          <label>People affected
            <input type="number" min="1" value={form.affectedUsers} onChange={set('affectedUsers')} />
          </label>
          <label>Service criticality
            <input value={criticality} readOnly disabled />
          </label>
        </div>
        <p>
          Priority score <b>{score}</b> (impact × urgency × criticality) → <span className={`chip ${preview}`}>{preview}</span>
        </p>
        <button className="btn" type="submit" disabled={busy || services.length === 0}>
          {busy ? 'Submitting…' : 'Submit incident'}
        </button>
        {services.length === 0 && (
          <div className="muted">
            An administrator needs to register a service before tickets can be filed.
            {canManage && <button className="btn ghost small" type="button" onClick={onNeedServices}>Open services</button>}
          </div>
        )}
      </form>
      <aside className="panel">
        <h2>Possible duplicates</h2>
        {matches.length === 0 ? <p className="muted">Keep writing. Similar open incidents will show up here.</p> : (
          <div className="hint">
            <h3>These look related</h3>
            {matches.map(({ incident, score: overlap }) => (
              <p key={incident._id}>
                <b>{incident.incidentId}</b> {incident.title}
                <span>{Math.round(overlap * 100)}% overlap · {STATUS_LABEL[incident.status]}</span>
              </p>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------- insights */

function Bars({ rows }) {
  if (rows.length === 0) return <p className="muted">No incidents in this view yet.</p>;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span>{row.label}</span>
          <div className="bar-track"><i style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Insights({ role, overview, incidents, now, onOpen, reload }) {
  const [watchlist, setWatchlist] = useState([]);
  const [activity, setActivity] = useState([]);
  const isStaff = role === 'admin' || role === 'technician';

  useEffect(() => {
    if (!isStaff) return undefined;
    let cancel = false;
    Promise.all([
      API.get('/analytics/sla-watchlist', { params: { limit: 10 } }),
      API.get('/analytics/activity', { params: { limit: 12 } }),
    ])
      .then(([watch, feed]) => {
        if (cancel) return;
        setWatchlist(watch.data.items || []);
        setActivity(feed.data.entries || []);
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [isStaff, reload]);

  const localBars = (pick) => {
    const counts = {};
    incidents.forEach((incident) => {
      const key = pick(incident);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };

  const byStatus = overview
    ? overview.byStatus.filter((row) => row.count > 0).map((row) => ({ label: STATUS_LABEL[row.key] || row.key, value: row.count }))
    : localBars((incident) => STATUS_LABEL[incident.status] || incident.status);

  const byPriority = overview
    ? overview.byPriority.map((row) => ({ label: row.key, value: row.count }))
    : localBars((incident) => incident.priority);

  const byCategory = overview
    ? overview.byCategory.map((row) => ({ label: row.category, value: row.count }))
    : localBars((incident) => incident.category);

  const byService = overview
    ? overview.byService.map((row) => ({ label: row.name, value: row.count }))
    : localBars((incident) => incident.affectedService?.name || 'Unknown');

  const slaRows = overview
    ? [
        { label: 'Met', value: overview.sla.met },
        { label: 'At risk', value: overview.sla.atRisk },
        { label: 'Breached', value: overview.sla.breached },
      ]
    : localBars((incident) => slaInfo(incident, now).state);

  return (
    <div className="stack-lg">
      {overview && (
        <div className="kpis">
          <article className="kpi"><span>Total logged</span><strong>{overview.totals.all}</strong></article>
          <article className="kpi"><span>SLA compliance</span><strong>{overview.sla.complianceRate}%</strong></article>
          <article className="kpi amber"><span>MTTR</span><strong>{formatDuration((overview.timing.mttrMinutes || 0) * 60000)}</strong></article>
          <article className="kpi rose"><span>Breached</span><strong>{overview.sla.breached}</strong></article>
        </div>
      )}

      <div className="grid-2">
        <section className="panel"><h2>By status</h2><Bars rows={byStatus} /></section>
        <section className="panel"><h2>By priority</h2><Bars rows={byPriority} /></section>
        <section className="panel"><h2>By category</h2><Bars rows={byCategory} /></section>
        <section className="panel"><h2>SLA posture</h2><Bars rows={slaRows} /></section>
      </div>

      <section className="panel"><h2>Busiest services</h2><Bars rows={byService} /></section>

      {isStaff && (
        <div className="grid-2">
          <section className="panel">
            <h2>SLA watchlist</h2>
            {watchlist.length === 0 ? <p className="muted">Nothing is close to breaching.</p> : (
              <div className="watchlist">
                {watchlist.map((row) => (
                  <button type="button" key={row._id} className="watch-row" onClick={() => onOpen(row._id)}>
                    <span><b className={`prio ${row.priority}`}>{row.priority}</b> {row.incidentId}</span>
                    <span className="muted">{row.title}</span>
                    <span className={`chip ${row.state === 'BREACHED' ? 'violated' : 'at-risk'}`}>
                      {row.state === 'BREACHED' ? `Overdue ${formatDuration(row.remainingMinutes * 60000)}` : `${formatDuration(row.remainingMinutes * 60000)} left`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Recent activity</h2>
            {activity.length === 0 ? <p className="muted">No activity recorded yet.</p> : (
              <ol className="audit">
                {activity.map((entry) => (
                  <li key={entry._id}>
                    <time>{formatWhen(entry.createdAt)}</time>
                    <div><b>{entry.actorName}</b> · {entry.action}</div>
                    <div className="muted">{entry.description}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {overview && overview.technicians.length > 0 && (
        <section className="panel">
          <h2>Technician workload</h2>
          <div className="table">
            <div className="table-head">
              <span>Technician</span><span>Assigned</span><span>Resolved</span><span>Open</span><span>SLA compliance</span>
            </div>
            {overview.technicians.map((row) => (
              <div className="table-row" key={row.technicianId}>
                <span><b>{row.name}</b><small className="muted">{row.email}</small></span>
                <span>{row.assigned}</span>
                <span>{row.resolved}</span>
                <span>{row.open}</span>
                <span>{row.slaComplianceRate}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- services */

function Services({ services, onSaved }) {
  const [form, setForm] = useState({ name: '', code: '', category: 'Application', baseCriticality: 'High', keywords: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await API.post('/services', {
        name: form.name.trim(),
        code: form.code.trim(),
        category: form.category,
        baseCriticality: form.baseCriticality,
        keywords: form.keywords.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setForm({ name: '', code: '', category: 'Application', baseCriticality: 'High', keywords: '' });
      onSaved('Service added to the catalogue');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the service.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2">
      <form className="panel stack" onSubmit={submit}>
        <h2>Add a service</h2>
        {error && <p className="alert">{error}</p>}
        <label>Name<input value={form.name} onChange={set('name')} required placeholder="Payment application" /></label>
        <label>Code<input value={form.code} onChange={set('code')} placeholder="PAYMENT" /></label>
        <label>Category
          <select value={form.category} onChange={set('category')}>
            {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Business criticality
          <select value={form.baseCriticality} onChange={set('baseCriticality')}>
            {LEVELS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Keywords<input value={form.keywords} onChange={set('keywords')} placeholder="payment, invoice, checkout" /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save service'}</button>
      </form>
      <section className="panel">
        <h2>Catalog ({services.length})</h2>
        <div className="catalog">
          {services.map((service) => (
            <div className="catalog-row" key={service._id}>
              <b>{service.name}</b>
              <span className="muted">{service.category} · {service.baseCriticality}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ incident drawer */

function IncidentDrawer({ incident, role, userId, services, technicians, now, onClose, onChanged }) {
  const [audit, setAudit] = useState([]);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState({ summary: '', rootCause: '', actionTaken: '' });
  const [verificationNote, setVerificationNote] = useState('');
  const [feedback, setFeedback] = useState({ rating: 5, comment: '' });
  const [classify, setClassify] = useState({ category: incident.category, service: refId(incident.affectedService) });
  const [strategy, setStrategy] = useState('composite');
  const [candidates, setCandidates] = useState([]);
  const [manualTechnician, setManualTechnician] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clock = slaInfo(incident, now);
  const owns = refId(incident.reporter) === userId;
  const assignedToMe = refId(incident.assignedTechnician) === userId;
  const canWork = role === 'admin' || (role === 'technician' && assignedToMe);
  const steps = canWork || (role === 'employee' && owns) ? nextActions(role, incident.status) : [];

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancel = false;
    API.get(`/incidents/${incident._id}/audit`)
      .then(({ data }) => { if (!cancel) setAudit(data.entries || []); })
      .catch(() => { if (!cancel) setAudit([]); });
    setClassify({ category: incident.category, service: refId(incident.affectedService) });
    setResolution({ summary: incident.resolution?.summary || '', rootCause: incident.resolution?.rootCause || '', actionTaken: incident.resolution?.actionTaken || '' });
    setVerificationNote(incident.closure?.verificationNote || '');
    setFeedback({ rating: incident.feedback?.rating || 5, comment: incident.feedback?.comment || '' });
    setError('');
    return () => { cancel = true; };
  }, [incident._id, incident.category, incident.affectedService, incident.resolution, incident.closure, incident.feedback]);

  useEffect(() => {
    if (role !== 'admin') return undefined;
    let cancel = false;
    API.get(`/incidents/${incident._id}/technicians`, { params: { strategy } })
      .then(({ data }) => { if (!cancel) setCandidates(data.candidates || []); })
      .catch(() => { if (!cancel) setCandidates([]); });
    return () => { cancel = true; };
  }, [role, incident._id, strategy]);

  const run = async (work, message) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onChanged(message);
    } catch (err) {
      setError(errorMessage(err, 'That update was rejected.'));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (target) => run(
    () => API.patch(`/incidents/${incident._id}/status`, {
      status: target,
      note: note.trim() || undefined,
      resolution: target === 'RESOLVED'
        ? {
            summary: resolution.summary.trim(),
            rootCause: resolution.rootCause.trim(),
            actionTaken: resolution.actionTaken.trim(),
          }
        : undefined,
      verificationNote: target === 'VERIFIED' ? verificationNote.trim() : undefined,
    }),
    `${incident.incidentId} is now ${STATUS_LABEL[target]}`
  );

  const requireResolution = steps.includes('RESOLVED') && resolution.summary.trim().length < 10;

  return (
    <div className="drawer-back" onClick={onClose}>
      <article className="drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={incident.title}>
        <header>
          <div>
            <span className={`chip ${incident.priority}`}>{incident.priority} · {PRIORITY_LABEL[incident.priority]}</span>
            <h2>{incident.title}</h2>
            <p className="muted">{incident.incidentId} · {incident.category} · opened {formatWhen(incident.createdAt)}</p>
          </div>
          <button className="btn ghost small" type="button" onClick={onClose}>Close</button>
        </header>

        <p className="drawer-body">{incident.description}</p>

        <div className="meta">
          <div><span>Status</span><b>{STATUS_LABEL[incident.status]}</b></div>
          <div><span>SLA</span><b className={`chip ${clock.state}`}>{clock.label}</b></div>
          <div><span>Affected service</span><b>{incident.affectedService?.name || '—'}</b></div>
          <div><span>Business criticality</span><b>{incident.businessCriticality}</b></div>
          <div><span>Impact / urgency</span><b>{incident.impact} / {incident.urgency}</b></div>
          <div><span>People affected</span><b>{incident.affectedUsers}</b></div>
          <div><span>Reporter</span><b>{incident.reporter?.name || 'Unknown'}</b></div>
          <div><span>Technician</span><b>{incident.assignedTechnician?.name || 'Unassigned'}</b></div>
          <div><span>Priority score</span><b>{incident.priorityScore} <small className="muted">{incident.priorityStrategy}</small></b></div>
          <div><span>Classification</span><b>{incident.classification?.method} · {Math.round((incident.classification?.confidence || 0) * 100)}%</b></div>
          <div><span>Respond by</span><b>{formatWhen(incident.sla?.responseDueAt)}</b></div>
          <div><span>Resolve by</span><b>{formatWhen(incident.sla?.resolutionDueAt)}</b></div>
        </div>

        {incident.classification?.matchedKeywords?.length > 0 && (
          <p className="muted small-note">Matched keywords: {incident.classification.matchedKeywords.join(', ')}</p>
        )}

        {incident.assignment?.reasons?.length > 0 && (
          <p className="muted small-note">
            Assignment: {incident.assignment.strategy} · {incident.assignment.reasons.join('; ')}
          </p>
        )}

        {incident.resolution?.summary && (
          <div className="hint">
            <h3>Resolution</h3>
            <p>{incident.resolution.summary}</p>
            {incident.resolution.rootCause && <p className="muted">Root cause: {incident.resolution.rootCause}</p>}
            {incident.resolution.actionTaken && <p className="muted">Action: {incident.resolution.actionTaken}</p>}
            <p className="muted">Resolved {formatWhen(incident.resolution.resolvedAt)}</p>
          </div>
        )}

        {incident.closure?.closedAt && (
          <p className="muted small-note">
            Closed {formatWhen(incident.closure.closedAt)} · {incident.closure.closureCode}
            {incident.closure.verificationNote ? ` · ${incident.closure.verificationNote}` : ''}
          </p>
        )}

        {incident.feedback?.rating && (
          <p className="muted small-note">Satisfaction: {incident.feedback.rating}/5 {incident.feedback.comment && `— ${incident.feedback.comment}`}</p>
        )}

        {error && <p className="alert">{error}</p>}

        {/* ---------------------------------------------------- admin tooling */}
        {role === 'admin' && (
          <details className="tool" open={!incident.assignedTechnician}>
            <summary>Classification &amp; assignment</summary>
            <div className="tool-body">
              <div className="row-3">
                <label>Category
                  <select value={classify.category} onChange={(e) => setClassify((prev) => ({ ...prev, category: e.target.value }))}>
                    {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>Service
                  <select value={classify.service} onChange={(e) => setClassify((prev) => ({ ...prev, service: e.target.value }))}>
                    {services.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                  </select>
                </label>
                <label>Strategy
                  <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                    {ASSIGNMENT_STRATEGIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="actions">
                <button
                  className="btn ghost small"
                  type="button"
                  disabled={busy}
                  onClick={() => run(
                    () => API.post(`/incidents/${incident._id}/classify`, { category: classify.category, service: classify.service }),
                    `${incident.incidentId} reclassified`
                  )}
                >
                  Apply classification
                </button>
              </div>

              <span className="skills-label">Suitable technicians (ranked)</span>
              {candidates.length === 0 ? <p className="muted">No technicians available.</p> : (
                <div className="candidates">
                  {candidates.slice(0, 5).map((entry) => (
                    <button
                      type="button"
                      key={entry.technician._id}
                      className="candidate"
                      disabled={busy || isClosed(incident.status)}
                      onClick={() => run(
                        () => API.post(`/incidents/${incident._id}/assign`, { technicianId: entry.technician._id, strategy }),
                        `${incident.incidentId} assigned to ${entry.technician.name}`
                      )}
                    >
                      <span>
                        <b>{entry.technician.name}</b>
                        <small className="muted">
                          fit {entry.score} · load {entry.technician.workloadCount}/{entry.technician.capacity}
                          {' · '}{(entry.technician.skills || []).slice(0, 3).join(', ') || 'general'}
                        </small>
                        {entry.reasons?.length > 0 && <small className="muted">{entry.reasons.join('; ')}</small>}
                      </span>
                      <span className="btn ghost small">Assign</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="row-3">
                <label>Manual override
                  <select value={manualTechnician} onChange={(e) => setManualTechnician(e.target.value)}>
                    <option value="">Choose a technician…</option>
                    {technicians.map((tech) => (
                      <option key={tech._id} value={tech._id}>{tech.name} · load {tech.workloadCount}</option>
                    ))}
                  </select>
                </label>
                <label>&nbsp;
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !manualTechnician || isClosed(incident.status)}
                    onClick={() => run(
                      () => API.post(`/incidents/${incident._id}/assign`, { technicianId: manualTechnician }),
                      `${incident.incidentId} reassigned`
                    )}
                  >
                    Assign manually
                  </button>
                </label>
              </div>
            </div>
          </details>
        )}

        {role === 'technician' && !incident.assignedTechnician && !isClosed(incident.status) && (
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => run(
              () => API.post(`/incidents/${incident._id}/assign`, { technicianId: userId }),
              `${incident.incidentId} claimed`
            )}
          >
            Claim this incident
          </button>
        )}

        {/* ------------------------------------------------------- lifecycle */}
        {steps.includes('RESOLVED') && (
          <div className="stack">
            <label>Resolution summary
              <textarea value={resolution.summary} onChange={(e) => setResolution((prev) => ({ ...prev, summary: e.target.value }))} minLength={10} />
            </label>
            <div className="row-3">
              <label>Root cause
                <input value={resolution.rootCause} onChange={(e) => setResolution((prev) => ({ ...prev, rootCause: e.target.value }))} />
              </label>
              <label>Action taken
                <input value={resolution.actionTaken} onChange={(e) => setResolution((prev) => ({ ...prev, actionTaken: e.target.value }))} />
              </label>
            </div>
          </div>
        )}

        {steps.includes('VERIFIED') && (
          <label>Verification note
            <input value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Confirmed fixed with the reporter" />
          </label>
        )}

        {(steps.length > 0 || canWork) && !isClosed(incident.status) && (
          <label>Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note recorded on the timeline" />
          </label>
        )}

        <div className="actions">
          {steps.map((step) => (
            <button
              key={step}
              className="btn small"
              type="button"
              disabled={busy || (step === 'RESOLVED' && requireResolution)}
              onClick={() => changeStatus(step)}
            >
              {STATUS_LABEL[step]}
            </button>
          ))}
        </div>

        {/* ---------------------------------------------------------- notes */}
        <h3>Investigation notes</h3>
        {(incident.investigation?.notes || []).length === 0 ? (
          <p className="muted">No notes recorded yet.</p>
        ) : (
          <ol className="audit">
            {incident.investigation.notes.map((entry) => (
              <li key={entry._id || entry.createdAt}>
                <time>{formatWhen(entry.createdAt)}</time>
                <div>{entry.body}</div>
              </li>
            ))}
          </ol>
        )}
        <div className="row-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an update…" />
          <button
            className="btn ghost small"
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => run(
              async () => {
                await API.post(`/incidents/${incident._id}/notes`, { body: note.trim() });
                setNote('');
              },
              'Note added'
            )}
          >
            Add note
          </button>
        </div>

        {/* ------------------------------------------------------- feedback */}
        {role === 'employee' && owns && CLOSED_STATUSES.includes(incident.status) && (
          <div className="stack">
            <label>Feedback ({feedback.rating}/5)
              <input
                type="range"
                min="1"
                max="5"
                value={feedback.rating}
                onChange={(e) => setFeedback((prev) => ({ ...prev, rating: Number(e.target.value) }))}
              />
            </label>
            <label>Comment
              <textarea value={feedback.comment} onChange={(e) => setFeedback((prev) => ({ ...prev, comment: e.target.value }))} placeholder="Did this fix the problem?" />
            </label>
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => run(
                () => API.post(`/incidents/${incident._id}/feedback`, feedback),
                'Thank you for your feedback'
              )}
            >
              Submit feedback
            </button>
          </div>
        )}

        {/* ---------------------------------------------------- audit trail */}
        <h3>Audit trail</h3>
        {audit.length === 0 ? <p className="muted">No history yet.</p> : (
          <ol className="audit">
            {audit.map((entry) => (
              <li key={entry._id}>
                <time>{formatWhen(entry.createdAt)}</time>
                <div>
                  <b>{entry.actorName}</b> · {entry.action}
                  {entry.previousState && entry.newState && entry.previousState !== entry.newState
                    ? ` · ${entry.previousState} → ${entry.newState}`
                    : ''}
                </div>
                <div className="muted">{entry.description}</div>
              </li>
            ))}
          </ol>
        )}
      </article>
    </div>
  );
}
