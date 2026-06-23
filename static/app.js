const App = {
  state: {
    activeTab: 'overview',
    workspace: null,
    workspaces: [],
    peers: [],
    sessions: [],
  },

  async init() {
    this.bindNav();
    this.bindEventDelegation();
    this.bindWorkspaceSelect();
    await this.checkHealth();
    await this.loadWorkspaces();
    await this.loadPeersAndSessions();
    this.renderTab('overview');
  },

  bindNav() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
      const activate = () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        el.classList.add('active');
        this.state.activeTab = el.dataset.tab;
        this.renderTab(el.dataset.tab);
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  },

  bindEventDelegation() {
    document.getElementById('main-content').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'toggle-card') PeersTab.toggleCard(id);
      else if (action === 'toggle-messages') SessionsTab.toggleMessages(id);
      else if (action === 'toggle-summary') SessionsTab.toggleSummary(id);
      else if (action === 'search-conclusions') ConclusionsTab.search();
      else if (action === 'load-messages') MessagesTab.load();
      else if (action === 'send-chat') ChatTab.send();
    });

    document.getElementById('modal-root').addEventListener('click', (e) => {
      const overlay = e.target.closest('.modal-overlay');
      if (e.target === overlay) Modal.close();
    });
  },

  bindWorkspaceSelect() {
    const select = document.getElementById('workspace-select');
    select.addEventListener('change', async () => {
      const wsId = select.value;
      this.state.workspace = this.state.workspaces.find(w => w.id === wsId) || null;
      if (this.state.workspace) {
        localStorage.setItem('honcho_workspace', wsId);
        await this.loadPeersAndSessions();
        this.renderTab(this.state.activeTab);
      }
    });

    document.querySelector('[data-action="create-workspace"]').addEventListener('click', () => {
      const label = document.createElement('label');
      label.textContent = 'Workspace ID';
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'modal-input';
      input.className = 'input mt-2';
      input.placeholder = 'e.g. my-workspace';
      Modal.show('Create Workspace', [label, input], async () => {
        const id = document.getElementById('modal-input').value.trim();
        if (!id) return;
        await App.api('workspaces/create', { body: { id } });
        Modal.close();
        await App.loadWorkspaces();
        App.renderWorkspaceSelect();
        App.renderTab(App.state.activeTab);
      });
    });
  },

  async checkHealth() {
    const dot = document.getElementById('health-dot');
    const text = document.getElementById('health-text');
    try {
      const r = await fetch('/api/health');
      const d = await r.json();
      if (d.status === 'ok') {
        dot.className = 'health-dot ok';
        text.textContent = 'Connected';
      } else throw new Error();
    } catch {
      dot.className = 'health-dot err';
      text.textContent = 'Unreachable';
    }
  },

  async loadWorkspaces() {
    try {
      const r = await fetch('/api/workspaces/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!r.ok) {
        let msg = `API error: ${r.status}`;
        try { const e = await r.json(); msg = e.detail || e.error || msg; } catch {}
        throw new Error(msg);
      }
      const d = await r.json();
      this.state.workspaces = d.items || [];
      const savedWs = localStorage.getItem('honcho_workspace');
      if (savedWs && this.state.workspaces.find(w => w.id === savedWs)) {
        this.state.workspace = this.state.workspaces.find(w => w.id === savedWs);
      } else if (this.state.workspaces.length > 0) {
        this.state.workspace = this.state.workspaces[0];
      }
    } catch { this.state.workspaces = []; }
    this.renderWorkspaceSelect();
  },

  renderWorkspaceSelect() {
    const select = document.getElementById('workspace-select');
    const wsId = this.state.workspace?.id || '';
    select.innerHTML = this.state.workspaces.length === 0
      ? '<option value="">No workspaces</option>'
      : this.state.workspaces.map(w => `<option value="${this.escapeHtml(w.id)}" ${w.id === wsId ? 'selected' : ''}>${this.escapeHtml(w.id)}</option>`).join('');
  },

  async loadPeersAndSessions() {
    const ws = this.state.workspace;
    if (!ws) return;
    try {
      const [peers, sessions] = await Promise.all([
        this.api(`workspaces/${ws.id}/peers/list`, { body: {} }),
        this.api(`workspaces/${ws.id}/sessions/list`, { body: {} }),
      ]);
      this.state.peers = peers.items || [];
      this.state.sessions = sessions.items || [];
    } catch {
      this.state.peers = [];
      this.state.sessions = [];
    }
  },

  renderTab(tab) {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    switch (tab) {
      case 'overview': OverviewTab.render(main); break;
      case 'peers': PeersTab.render(main); break;
      case 'sessions': SessionsTab.render(main); break;
      case 'chat': ChatTab.render(main); break;
      case 'conclusions': ConclusionsTab.render(main); break;
      case 'messages': MessagesTab.render(main); break;
      case 'settings': SettingsTab.render(main); break;
    }
  },

  async api(path, opts = {}) {
    const method = opts.method || 'POST';
    const fetchOpts = { method, headers: { 'Content-Type': 'application/json' } };
    if (opts.body !== undefined && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(`/api/${path}`, fetchOpts);
    if (!r.ok) {
      let msg = `API error: ${r.status}`;
      try { const e = await r.json(); msg = e.detail || e.error || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  },

  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

/* ─── Modal ─── */
const Modal = {
  show(title, bodyParts, onConfirm, { confirmText = 'Confirm', confirmClass = 'btn btn-primary' } = {}) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'modal-title');

    const modal = document.createElement('div');
    modal.className = 'modal';

    const h3 = document.createElement('h3');
    h3.id = 'modal-title';
    h3.textContent = title;
    modal.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof bodyParts === 'string') {
      const p = document.createElement('p');
      p.textContent = bodyParts;
      body.appendChild(p);
    } else {
      bodyParts.forEach(node => body.appendChild(node));
    }
    modal.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => Modal.close());
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = confirmClass;
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener('click', () => onConfirm());
    actions.appendChild(confirmBtn);

    modal.appendChild(actions);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    const input = root.querySelector('#modal-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onConfirm();
      });
    }
  },

  confirm(title, bodyParts, onConfirm) {
    this.show(title, bodyParts, onConfirm, { confirmText: 'Delete', confirmClass: 'btn btn-danger' });
  },

  close() {
    document.getElementById('modal-root').innerHTML = '';
  }
};

/* ─── Overview Tab ─── */
const OverviewTab = {
  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Overview</h2>
        <p>Workspace summary and health status</p>
      </div>
      <div class="loading-overlay"><div class="spinner"></div> Loading...</div>
    `;

    const ws = App.state.workspace;
    if (!ws) {
      el.innerHTML = `
        <div class="tab-header"><h2>Overview</h2><p>Workspace summary and health status</p></div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <h3>No workspaces found</h3>
          <p>Make sure your Honcho server is running at localhost:8000</p>
        </div>`;
      return;
    }

    let peerCount = 0, sessionCount = 0, conclusionCount = 0;
    try {
      const [peersData, sessionsData] = await Promise.all([
        App.api(`workspaces/${ws.id}/peers/list`, { body: {} }),
        App.api(`workspaces/${ws.id}/sessions/list`, { body: {} }),
      ]);
      peerCount = (peersData.items || []).length;
      sessionCount = (sessionsData.items || []).length;
      const conclusions = await App.api(`workspaces/${ws.id}/conclusions/list`, { body: {} });
      conclusionCount = conclusions.total || 0;
    } catch {}

    el.innerHTML = `
      <div class="tab-header">
        <h2>Overview</h2>
        <p>Workspace summary and health status</p>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Workspace</div>
          <div class="stat-value" style="font-size:16px">${App.escapeHtml(ws.id)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Peers</div>
          <div class="stat-value">${peerCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions</div>
          <div class="stat-value">${sessionCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Conclusions</div>
          <div class="stat-value">${conclusionCount}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">All Workspaces</div>
            <div class="card-subtitle">${App.state.workspaces.length} total</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Created</th><th></th></tr></thead>
            <tbody>
              ${App.state.workspaces.map(w => `
                <tr>
                  <td><code>${App.escapeHtml(w.id)}</code></td>
                  <td class="mono">${App.formatDate(w.created_at)}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-action="delete-workspace" data-id="${App.escapeAttr(w.id)}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-action="delete-workspace"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wsId = btn.dataset.id;
        Modal.confirm('Delete Workspace', `Delete workspace "${wsId}"? This action cannot be undone.`, async () => {
          try {
            await App.api(`workspaces/${wsId}`, { method: 'DELETE' });
            Modal.close();
            await App.loadWorkspaces();
            App.renderTab(App.state.activeTab);
          } catch (e) {
            Modal.close();
            alert(`Delete failed: ${e.message}`);
          }
        });
      });
    });
  }
};

/* ─── Peers Tab ─── */
const PeersTab = {
  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Peers</h2>
        <p>All participants in this workspace</p>
      </div>
      <div class="loading-overlay"><div class="spinner"></div> Loading...</div>
    `;

    const ws = App.state.workspace;
    if (!ws) { el.innerHTML = '<div class="empty-state"><h3>No workspace selected</h3></div>'; return; }

    try {
      const data = await App.api(`workspaces/${ws.id}/peers/list`, { body: {} });
      App.state.peers = data.items || [];
    } catch { App.state.peers = []; }

    if (App.state.peers.length === 0) {
      el.innerHTML = `
        <div class="tab-header">
          <h2>Peers</h2>
          <p>No peers yet</p>
        </div>
        <button class="btn btn-primary mb-3" id="create-peer-btn">+ New Peer</button>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <h3>No peers yet</h3>
          <p>Peers represent participants (humans or AI) in your workspace</p>
        </div>`;
      document.getElementById('create-peer-btn').addEventListener('click', () => this.createPeer());
      return;
    }

    el.innerHTML = `
      <div class="tab-header">
        <div class="flex items-center justify-between">
          <div>
            <h2>Peers</h2>
            <p>${App.state.peers.length} participant${App.state.peers.length !== 1 ? 's' : ''}</p>
          </div>
          <button class="btn btn-primary" id="create-peer-btn">+ New Peer</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Peer ID</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${App.state.peers.map(p => `
              <tr class="clickable" data-peer="${App.escapeAttr(p.id)}">
                <td><code>${App.escapeHtml(p.id)}</code></td>
                <td class="mono">${App.formatDate(p.created_at)}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-action="toggle-card" data-id="${App.escapeAttr(p.id)}">Card</button>
                </td>
              </tr>
              <tr class="hidden" id="peer-expand-${App.escapeHtml(p.id)}">
                <td colspan="3">
                  <div class="expand-content">
                    <div class="flex gap-4">
                      <div style="flex:1">
                        <div class="text-xs font-medium text-muted mb-2">Representation</div>
                        <div class="representation-box" id="peer-repr-${App.escapeHtml(p.id)}">
                          <div class="loading-overlay"><div class="spinner"></div></div>
                        </div>
                      </div>
                      <div style="flex:1">
                        <div class="text-xs font-medium text-muted mb-2">Peer Card</div>
                        <div id="peer-card-${App.escapeHtml(p.id)}">
                          <div class="loading-overlay"><div class="spinner"></div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('create-peer-btn').addEventListener('click', () => this.createPeer());
  },

  createPeer() {
    Modal.show('Create Peer', (() => {
      const label = document.createElement('label');
      label.textContent = 'Peer ID';
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'modal-input';
      input.className = 'input mt-2';
      input.placeholder = 'e.g. alice';
      return [label, input];
    })(), async () => {
      const id = document.getElementById('modal-input').value.trim();
      if (!id) return;
      const ws = App.state.workspace;
      await App.api(`workspaces/${ws.id}/peers/create`, { body: { id } });
      Modal.close();
      await App.loadPeersAndSessions();
      App.renderTab(App.state.activeTab);
    });
  },

  async toggleCard(peerId) {
    const expandRow = document.getElementById(`peer-expand-${peerId}`);
    if (!expandRow) return;

    if (!expandRow.classList.contains('hidden')) {
      expandRow.classList.add('hidden');
      return;
    }

    expandRow.classList.remove('hidden');

    const ws = App.state.workspace;
    const reprBox = document.getElementById(`peer-repr-${peerId}`);
    const cardBox = document.getElementById(`peer-card-${peerId}`);

    try {
      const [repr, card] = await Promise.all([
        App.api(`workspaces/${ws.id}/peers/${peerId}/representation`, { body: {} }),
        App.api(`workspaces/${ws.id}/peers/${peerId}/card`, { method: 'GET' }),
      ]);

      reprBox.textContent = repr.representation || 'No representation yet';

      if (card.peer_card && card.peer_card.length > 0) {
        cardBox.innerHTML = `<div class="peer-card-list">${card.peer_card.map(c =>
          `<div class="peer-card-item">${App.escapeHtml(c)}</div>`
        ).join('')}</div>`;
      } else {
        cardBox.innerHTML = '<div class="text-sm text-muted">No card yet</div>';
      }
    } catch {
      reprBox.textContent = 'Failed to load';
      cardBox.innerHTML = '<div class="text-sm text-muted">Failed to load</div>';
    }
  }
};

/* ─── Sessions Tab ─── */
const SessionsTab = {
  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Sessions</h2>
        <p>All conversation sessions</p>
      </div>
      <div class="loading-overlay"><div class="spinner"></div> Loading...</div>
    `;

    const ws = App.state.workspace;
    if (!ws) { el.innerHTML = '<div class="empty-state"><h3>No workspace selected</h3></div>'; return; }

    try {
      const data = await App.api(`workspaces/${ws.id}/sessions/list`, { body: {} });
      App.state.sessions = data.items || [];
    } catch { App.state.sessions = []; }

    if (App.state.sessions.length === 0) {
      el.innerHTML = `
        <div class="tab-header">
          <h2>Sessions</h2>
          <p>No sessions yet</p>
        </div>
        <button class="btn btn-primary mb-3" id="create-session-btn">+ New Session</button>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <h3>No sessions yet</h3>
          <p>Sessions are created when conversations begin between peers</p>
        </div>`;
      document.getElementById('create-session-btn').addEventListener('click', () => this.createSession());
      return;
    }

    el.innerHTML = `
      <div class="tab-header">
        <div class="flex items-center justify-between">
          <div>
            <h2>Sessions</h2>
            <p>${App.state.sessions.length} session${App.state.sessions.length !== 1 ? 's' : ''}</p>
          </div>
          <button class="btn btn-primary" id="create-session-btn">+ New Session</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Session ID</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${App.state.sessions.map(s => `
              <tr class="clickable" data-session="${App.escapeAttr(s.id)}">
                <td><code>${App.escapeHtml(s.id)}</code></td>
                <td><span class="badge ${s.is_active ? 'badge-green' : 'badge-accent'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="mono">${App.formatDate(s.created_at)}</td>
                <td class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" data-action="toggle-messages" data-id="${App.escapeAttr(s.id)}">Messages</button>
                  <button class="btn btn-ghost btn-sm" data-action="delete-session" data-id="${App.escapeAttr(s.id)}" style="color:var(--destructive)">Delete</button>
                </td>
              </tr>
              <tr class="hidden" id="session-expand-${App.escapeHtml(s.id)}">
                <td colspan="4">
                  <div class="expand-content">
                    <div class="flex items-center justify-between mb-3">
                      <div class="text-xs font-medium text-muted">Messages</div>
                      <div class="flex gap-2">
                        <button class="btn btn-ghost btn-sm" data-action="toggle-summary" data-id="${App.escapeAttr(s.id)}">Summary</button>
                      </div>
                    </div>
                    <div id="session-messages-${App.escapeHtml(s.id)}">
                      <div class="loading-overlay"><div class="spinner"></div></div>
                    </div>
                    <div id="session-summary-${App.escapeHtml(s.id)}" class="hidden mt-3"></div>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('create-session-btn').addEventListener('click', () => this.createSession());

    el.querySelectorAll('[data-action="delete-session"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.id;
        Modal.confirm('Delete Session', `Delete session "${sessionId}"? This action cannot be undone.`, async () => {
          try {
            await App.api(`workspaces/${ws.id}/sessions/${sessionId}`, { method: 'DELETE' });
            Modal.close();
            await App.loadPeersAndSessions();
            App.renderTab(App.state.activeTab);
          } catch (e) {
            Modal.close();
            alert(`Delete failed: ${e.message}`);
          }
        });
      });
    });
  },

  createSession() {
    Modal.show('Create Session', (() => {
      const label = document.createElement('label');
      label.textContent = 'Session ID';
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'modal-input';
      input.className = 'input mt-2';
      input.placeholder = 'e.g. chat-001';
      return [label, input];
    })(), async () => {
      const id = document.getElementById('modal-input').value.trim();
      if (!id) return;
      const ws = App.state.workspace;
      await App.api(`workspaces/${ws.id}/sessions/create`, { body: { id } });
      Modal.close();
      await App.loadPeersAndSessions();
      App.renderTab(App.state.activeTab);
    });
  },

  async toggleMessages(sessionId) {
    const expandRow = document.getElementById(`session-expand-${sessionId}`);
    if (!expandRow) return;

    if (!expandRow.classList.contains('hidden')) {
      expandRow.classList.add('hidden');
      return;
    }

    expandRow.classList.remove('hidden');
    const msgBox = document.getElementById(`session-messages-${sessionId}`);
    const ws = App.state.workspace;

    try {
      const data = await App.api(`workspaces/${ws.id}/sessions/${sessionId}/messages/list`, { body: {} });
      const messages = data.items || [];

      if (messages.length === 0) {
        msgBox.innerHTML = '<div class="text-sm text-muted">No messages in this session</div>';
        return;
      }

      msgBox.innerHTML = `
        <div class="table-wrap" style="max-height:300px;overflow-y:auto">
          <table>
            <thead><tr><th>Peer</th><th>Content</th><th>Tokens</th><th>Time</th></tr></thead>
            <tbody>
              ${messages.map(m => `
                <tr>
                  <td><code>${App.escapeHtml(m.peer_id)}</code></td>
                  <td class="truncate" title="${App.escapeHtml(m.content)}">${App.escapeHtml(m.content.substring(0, 120))}${m.content.length > 120 ? '...' : ''}</td>
                  <td class="mono">${m.token_count || '—'}</td>
                  <td class="mono">${App.formatDateTime(m.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {
      msgBox.innerHTML = '<div class="text-sm text-muted">Failed to load messages</div>';
    }
  },

  async toggleSummary(sessionId) {
    const summaryBox = document.getElementById(`session-summary-${sessionId}`);
    if (!summaryBox) return;

    if (!summaryBox.classList.contains('hidden')) {
      summaryBox.classList.add('hidden');
      return;
    }

    summaryBox.classList.remove('hidden');
    const ws = App.state.workspace;

    try {
      const data = await App.api(`workspaces/${ws.id}/sessions/${sessionId}/summaries`, { method: 'GET' });
      const parts = [];
      if (data.short_summary) {
        parts.push(`<div class="mb-2"><div class="text-xs font-medium text-muted mb-1">Short Summary</div><div class="representation-box">${App.escapeHtml(data.short_summary.content)}</div></div>`);
      }
      if (data.long_summary) {
        parts.push(`<div><div class="text-xs font-medium text-muted mb-1">Long Summary</div><div class="representation-box">${App.escapeHtml(data.long_summary.content)}</div></div>`);
      }
      summaryBox.innerHTML = parts.length > 0 ? parts.join('') : '<div class="text-sm text-muted">No summaries available</div>';
    } catch {
      summaryBox.innerHTML = '<div class="text-sm text-muted">Failed to load summaries</div>';
    }
  }
};

/* ─── Chat Tab ─── */
const ChatTab = {
  streaming: false,

  render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Chat</h2>
        <p>Dialectic query against a peer's representation</p>
      </div>
      <div class="chat-container">
        <div class="chat-controls">
          <select class="input" id="chat-peer" aria-label="Select peer">
            <option value="">Select peer...</option>
            ${App.state.peers.map(p => `<option value="${App.escapeHtml(p.id)}">${App.escapeHtml(p.id)}</option>`).join('')}
          </select>
          <select class="input" id="chat-session" aria-label="Select session">
            <option value="">All sessions (optional)</option>
            ${App.state.sessions.map(s => `<option value="${App.escapeHtml(s.id)}">${App.escapeHtml(s.id)}</option>`).join('')}
          </select>
          <select class="input" id="chat-reasoning" style="max-width:150px" aria-label="Reasoning level">
            <option value="low">Reasoning: Low</option>
            <option value="minimal">Minimal</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Max</option>
          </select>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="empty-state" style="padding:32px 0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>
            <h3>Ask a question</h3>
            <p>Select a peer and type a question about them</p>
          </div>
        </div>
        <div class="chat-input-bar">
          <input type="text" class="input" id="chat-input" placeholder="What do you want to know?" disabled aria-label="Chat message">
          <button class="btn btn-primary" id="chat-send" data-action="send-chat" disabled>Send</button>
        </div>
      </div>
    `;

    const peerSelect = document.getElementById('chat-peer');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    peerSelect.addEventListener('change', () => {
      const enabled = peerSelect.value !== '';
      input.disabled = !enabled;
      sendBtn.disabled = !enabled;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !sendBtn.disabled) {
        e.preventDefault();
        this.send();
      }
    });
  },

  async send() {
    if (this.streaming) return;

    const peerId = document.getElementById('chat-peer').value;
    const sessionId = document.getElementById('chat-session').value || null;
    const reasoning = document.getElementById('chat-reasoning').value;
    const input = document.getElementById('chat-input');
    const query = input.value.trim();
    if (!query || !peerId) return;

    input.value = '';
    this.addMessage('user', query);
    this.streaming = true;
    document.getElementById('chat-send').disabled = true;

    const msgEl = this.addMessage('assistant', '');
    const ws = App.state.workspace;

    try {
      const body = { query, stream: true, reasoning_level: reasoning };
      if (sessionId) body.session_id = sessionId;

      const response = await fetch(`/api/workspaces/${ws.id}/peers/${peerId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let lastScroll = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const chunk = parsed.delta?.content || parsed.content || '';
              if (chunk) {
                content += chunk;
                msgEl.textContent = content;
                const now = Date.now();
                if (now - lastScroll > 100) {
                  msgEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  lastScroll = now;
                }
              }
            } catch {
              content += data;
              msgEl.textContent = content;
            }
          } else if (line.trim() && !line.startsWith(':')) {
            content += line;
            msgEl.textContent = content;
          }
        }
      }

      if (!content) msgEl.textContent = '(No response)';
    } catch (e) {
      msgEl.textContent = `Error: ${e.message}`;
    }

    this.streaming = false;
    document.getElementById('chat-send').disabled = false;
  },

  addMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.textContent = content;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }
};

/* ─── Conclusions Tab ─── */
const ConclusionsTab = {
  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Conclusions</h2>
        <p>Reasoning and memories extracted by Honcho</p>
      </div>
      <div class="search-bar">
        <select class="input" id="conclusion-peer" style="max-width:250px" aria-label="Select peer">
          <option value="">Select peer...</option>
          ${App.state.peers.map(p => `<option value="${App.escapeHtml(p.id)}">${App.escapeHtml(p.id)}</option>`).join('')}
        </select>
        <input type="text" class="input" id="conclusion-search" placeholder="Semantic search..." disabled aria-label="Search conclusions">
        <button class="btn btn-primary" id="conclusion-search-btn" data-action="search-conclusions" disabled>Search</button>
      </div>
      <div id="conclusion-results">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          <h3>Select a peer</h3>
          <p>Choose a peer to view their conclusions, or use semantic search</p>
        </div>
      </div>
    `;

    const peerSelect = document.getElementById('conclusion-peer');
    const searchInput = document.getElementById('conclusion-search');
    const searchBtn = document.getElementById('conclusion-search-btn');

    peerSelect.addEventListener('change', () => {
      const enabled = peerSelect.value !== '';
      searchInput.disabled = !enabled;
      searchBtn.disabled = !enabled;
      if (enabled) this.loadConclusions(peerSelect.value);
    });
  },

  async loadConclusions(peerId) {
    const ws = App.state.workspace;
    const results = document.getElementById('conclusion-results');
    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';

    try {
      const data = await App.api(`workspaces/${ws.id}/conclusions/list`, {
        body: { filters: { observer_id: peerId } }
      });
      this.renderResults(results, data.items || []);
    } catch {
      results.innerHTML = '<div class="text-sm text-muted">Failed to load conclusions</div>';
    }
  },

  async search() {
    const peerId = document.getElementById('conclusion-peer').value;
    const query = document.getElementById('conclusion-search').value.trim();
    if (!query || !peerId) return;

    const ws = App.state.workspace;
    const results = document.getElementById('conclusion-results');
    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Searching...</div>';

    try {
      const items = await App.api(`workspaces/${ws.id}/conclusions/query`, {
        body: { query, top_k: 20, filters: { observer_id: peerId } }
      });
      this.renderResults(results, Array.isArray(items) ? items : []);
    } catch {
      results.innerHTML = '<div class="text-sm text-muted">Search failed</div>';
    }
  },

  renderResults(container, items) {
    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No conclusions found</h3>
          <p>Honcho hasn't drawn any conclusions about this peer yet</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="text-sm text-muted mb-3">${items.length} conclusion${items.length !== 1 ? 's' : ''}</div>
      <div class="flex flex-col gap-2">
        ${items.map(c => {
          const type = this.guessType(c.content);
          return `
            <div class="card">
              <div class="card-header">
                <div class="flex items-center gap-2">
                  <span class="conclusion-type ${type}">
                    <span class="dot"></span>
                    ${type}
                  </span>
                  <span class="text-xs text-muted">${App.formatDate(c.created_at)}</span>
                </div>
              </div>
              <div style="font-size:12px;line-height:1.6;color:var(--text)">${App.escapeHtml(c.content)}</div>
              <div class="mt-2 flex gap-2">
                <span class="text-xs text-muted">Observer: <code>${App.escapeHtml(c.observer_id)}</code></span>
                <span class="text-xs text-muted">Observed: <code>${App.escapeHtml(c.observed_id)}</code></span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  guessType(content) {
    const lower = (content || '').toLowerCase();
    if (lower.startsWith('always ') || lower.startsWith('never ') || lower.includes('prefers ')) return 'explicit';
    if (lower.includes('therefore') || lower.includes('because') || lower.includes('likely ') || lower.includes('must ')) return 'deductive';
    return 'inductive';
  }
};

/* ─── Messages Tab ─── */
const MessagesTab = {
  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Messages</h2>
        <p>Browse messages across sessions</p>
      </div>
      <div class="search-bar">
        <select class="input" id="msg-session" style="max-width:300px" aria-label="Select session">
          <option value="">All sessions</option>
          ${App.state.sessions.map(s => `<option value="${App.escapeHtml(s.id)}">${App.escapeHtml(s.id)}</option>`).join('')}
        </select>
        <select class="input" id="msg-peer" style="max-width:200px" aria-label="Filter by peer">
          <option value="">All peers</option>
          ${App.state.peers.map(p => `<option value="${App.escapeHtml(p.id)}">${App.escapeHtml(p.id)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" data-action="load-messages">Load</button>
      </div>
      <div id="msg-results">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/></svg>
          <h3>Select a session</h3>
          <p>Choose a session to browse its messages</p>
        </div>
      </div>
    `;
  },

  async load() {
    const sessionId = document.getElementById('msg-session').value;
    const peerFilter = document.getElementById('msg-peer').value;
    const results = document.getElementById('msg-results');

    if (!sessionId) {
      results.innerHTML = '<div class="text-sm text-muted">Please select a session</div>';
      return;
    }

    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
    const ws = App.state.workspace;

    try {
      const filters = {};
      if (peerFilter) filters.peer_id = peerFilter;

      const data = await App.api(`workspaces/${ws.id}/sessions/${sessionId}/messages/list`, {
        body: { filters },
      });

      const messages = data.items || [];

      if (messages.length === 0) {
        results.innerHTML = '<div class="text-sm text-muted">No messages found</div>';
        return;
      }

      results.innerHTML = `
        <div class="text-sm text-muted mb-3">${messages.length} message${messages.length !== 1 ? 's' : ''}</div>
        <div class="table-wrap" style="max-height:calc(100vh - 280px);overflow-y:auto">
          <table>
            <thead><tr><th>Peer</th><th>Content</th><th>Tokens</th><th>Time</th></tr></thead>
            <tbody>
              ${messages.map(m => `
                <tr>
                  <td><code>${App.escapeHtml(m.peer_id)}</code></td>
                  <td class="truncate" title="${App.escapeHtml(m.content)}">${App.escapeHtml(m.content.substring(0, 150))}${m.content.length > 150 ? '...' : ''}</td>
                  <td class="mono">${m.token_count || '—'}</td>
                  <td class="mono">${App.formatDateTime(m.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {
      results.innerHTML = '<div class="text-sm text-muted">Failed to load messages</div>';
    }
  }
};

/* ─── Settings Tab ─── */
const SettingsTab = {
  dirty: {},
  original: {},

  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Settings</h2>
        <p>Configure Honcho server models and providers</p>
      </div>
      <div class="loading-overlay"><div class="spinner"></div> Loading settings...</div>
    `;

    try {
      const res = await fetch('/api/settings/read');
      if (!res.ok) {
        const err = await res.json();
        if (err.detail === 'env_file_not_found') {
          el.innerHTML = `
            <div class="tab-header"><h2>Settings</h2><p>Configure Honcho server models and providers</p></div>
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
              <h3>Configuration file not found</h3>
              <p>Set HONCHO_ENV_PATH to point to your .env file</p>
            </div>`;
          return;
        }
        throw new Error('Failed to load settings');
      }
      const data = await res.json();
      this.original = this.flattenSections(data.sections);
      this.dirty = {};
      this.renderSections(el, data.sections);
    } catch (e) {
      el.innerHTML = `
        <div class="tab-header"><h2>Settings</h2><p>Configure Honcho server models and providers</p></div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <h3>Failed to load settings</h3>
          <p>${App.escapeHtml(e.message)}</p>
        </div>`;
    }
  },

  flattenSections(sections) {
    const flat = {};
    for (const [key, val] of Object.entries(sections)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        if ('MODEL_CONFIG__MODEL' in val || Object.keys(val).some(k => k.startsWith('LLM_'))) {
          Object.assign(flat, val);
        } else {
          for (const [subKey, subVal] of Object.entries(val)) {
            if (typeof subVal === 'object' && subVal !== null) {
              Object.assign(flat, subVal);
            } else {
              flat[`${key}.${subKey}`] = subVal;
            }
          }
        }
      }
    }
    return flat;
  },

  renderSections(el, sections) {
    const sectionDefs = [
      { key: 'llm', title: 'LLM Provider', icon: '🔑', expanded: true },
      { key: 'embeddings', title: 'Embeddings', icon: '📐', expanded: true },
      { key: 'deriver', title: 'Deriver (Background Worker)', icon: '⚙️', expanded: false },
      { key: 'dialectic', title: 'Dialectic Levels', icon: '💬', expanded: false },
      { key: 'summary', title: 'Summary', icon: '📝', expanded: false },
      { key: 'dream', title: 'Dream', icon: '💤', expanded: false },
      { key: 'advanced', title: 'Advanced (Read-only)', icon: '🔧', expanded: false },
    ];

    let html = '<div class="flex flex-col gap-2">';

    for (const def of sectionDefs) {
      const sectionData = sections[def.key];
      const dirtyKeys = this.getSectionDirtyKeys(def.key, sectionData);
      const dirtyDot = dirtyKeys.length > 0 ? '<span class="settings-dirty-dot"></span>' : '';

      html += `
        <div class="accordion ${def.expanded ? 'open' : ''}" data-section="${def.key}">
          <div class="accordion-header" data-action="toggle-accordion">
            <div class="flex items-center gap-2">
              <span>${def.title}</span>
              ${dirtyDot}
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </div>
          <div class="accordion-body">
            <div class="accordion-content">
              ${this.renderSectionFields(def.key, sectionData)}
            </div>
          </div>
        </div>
      `;
    }

    html += `
      <div class="settings-sticky-bar">
        <button class="btn btn-ghost" data-action="settings-backup">Create Backup</button>
        <button class="btn btn-ghost" data-action="settings-restore">Restore Backup</button>
        <button class="btn btn-primary" data-action="settings-save">Save Changes</button>
        <button class="btn btn-primary" data-action="settings-apply" style="background:var(--green);color:var(--surface)">Apply & Restart</button>
      </div>
    </div>`;

    el.innerHTML = html;
    this.bindEvents(el);
    this.updateDirtyIndicators(el);
  },

  getSectionDirtyKeys(sectionKey, sectionData) {
    if (!sectionData) return [];
    if (typeof sectionData === 'object' && !Array.isArray(sectionData)) {
      const keys = [];
      for (const [k, v] of Object.entries(sectionData)) {
        if (typeof v === 'object' && v !== null) {
          for (const [subK, subV] of Object.entries(v)) {
            if (this.dirty[subK] !== undefined && this.dirty[subK] !== subV) {
              keys.push(subK);
            }
          }
        } else {
          if (this.dirty[k] !== undefined && this.dirty[k] !== v) {
            keys.push(k);
          }
        }
      }
      return keys;
    }
    return [];
  },

  renderSectionFields(sectionKey, data) {
    if (!data) return '';

    if (sectionKey === 'dialectic') {
      const levels = ['minimal', 'low', 'medium', 'high', 'max'];
      let html = '';
      for (const level of levels) {
        const levelData = data[level];
        if (!levelData) continue;
        html += `
          <div class="mb-3">
            <div class="text-xs font-medium text-muted mb-2" style="text-transform:uppercase;letter-spacing:0.05em">${level}</div>
            <div class="flex flex-col gap-2">
              ${Object.entries(levelData).map(([key, val]) => this.renderField(key, val)).join('')}
            </div>
          </div>
        `;
      }
      return html;
    }

    if (sectionKey === 'dream') {
      let html = '';
      const groups = [
        { title: 'Deduction', prefix: 'DREAM_DEDUCTION' },
        { title: 'Induction', prefix: 'DREAM_INDUCTION' },
      ];
      for (const group of groups) {
        const groupData = {};
        for (const [k, v] of Object.entries(data)) {
          if (k.includes(group.prefix)) groupData[k] = v;
        }
        html += `
          <div class="mb-3">
            <div class="text-xs font-medium text-muted mb-2" style="text-transform:uppercase;letter-spacing:0.05em">${group.title}</div>
            <div class="flex flex-col gap-2">
              ${Object.entries(groupData).map(([key, val]) => this.renderField(key, val)).join('')}
            </div>
          </div>
        `;
      }
      return html;
    }

    if (typeof data === 'object' && !Array.isArray(data)) {
      return `<div class="flex flex-col gap-2">${Object.entries(data).map(([key, val]) => this.renderField(key, val)).join('')}</div>`;
    }

    return '';
  },

  renderField(key, value) {
    const isApiKey = key.includes('API_KEY');
    const isUrl = key.includes('BASE_URL') || key.includes('CACHE_URL') || key.includes('DB_CONNECTION');
    const isNumber = key.includes('DIMENSIONS');
    const isReadonly = key.includes('DB_CONNECTION') || key.includes('CACHE_') || key.includes('VECTOR_STORE') || key === 'LOG_LEVEL' || key === 'AUTH_USE_AUTH';
    const displayValue = this.dirty[key] !== undefined ? this.dirty[key] : value;

    const label = key.split('__').pop().replace(/_/g, ' ');
    const friendlyKey = key.split('__').slice(-2).join(' > ');

    if (isApiKey) {
      return `
        <div class="settings-field">
          <label>${App.escapeHtml(label)}</label>
          <div class="settings-masked">
            <input type="password" class="input" data-key="${App.escapeAttr(key)}" value="${App.escapeAttr(displayValue)}" ${isReadonly ? 'readonly' : ''}>
            <button class="settings-mask-toggle" data-action="toggle-mask" data-key="${App.escapeAttr(key)}">show</button>
          </div>
        </div>
      `;
    }

    if (isNumber) {
      return `
        <div class="settings-field">
          <label>${App.escapeHtml(label)}</label>
          <input type="number" class="input" data-key="${App.escapeAttr(key)}" value="${App.escapeAttr(displayValue)}" ${isReadonly ? 'readonly' : ''}>
        </div>
      `;
    }

    if (isUrl || key.includes('MODEL') || key.includes('TRANSPORT')) {
      return `
        <div class="settings-field">
          <label>${App.escapeHtml(label)}</label>
          <input type="text" class="input" data-key="${App.escapeAttr(key)}" value="${App.escapeAttr(displayValue)}" ${isReadonly ? 'readonly' : ''} placeholder="${App.escapeAttr(key)}">
        </div>
      `;
    }

    return `
      <div class="settings-field">
        <label>${App.escapeHtml(label)}</label>
        <input type="text" class="input" data-key="${App.escapeAttr(key)}" value="${App.escapeAttr(displayValue)}" ${isReadonly ? 'readonly' : ''}>
      </div>
    `;
  },

  bindEvents(el) {
    el.querySelectorAll('[data-action="toggle-accordion"]').forEach(header => {
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      const accordion = header.closest('.accordion');
      header.setAttribute('aria-expanded', accordion.classList.contains('open') ? 'true' : 'false');
      header.addEventListener('click', () => {
        accordion.classList.toggle('open');
        header.setAttribute('aria-expanded', accordion.classList.contains('open') ? 'true' : 'false');
      });
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          accordion.classList.toggle('open');
          header.setAttribute('aria-expanded', accordion.classList.contains('open') ? 'true' : 'false');
        }
      });
    });

    el.querySelectorAll('[data-action="toggle-mask"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = el.querySelector(`input[data-key="${btn.dataset.key}"]`);
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'hide';
        } else {
          input.type = 'password';
          btn.textContent = 'show';
        }
      });
    });

    el.querySelectorAll('input[data-key]').forEach(input => {
      input.addEventListener('input', () => {
        this.dirty[input.dataset.key] = input.value;
        this.updateDirtyIndicators(el);
      });
    });

    el.querySelector('[data-action="settings-save"]')?.addEventListener('click', () => this.save(el));
    el.querySelector('[data-action="settings-apply"]')?.addEventListener('click', () => this.applyAndRestart(el));
    el.querySelector('[data-action="settings-backup"]')?.addEventListener('click', () => this.backup(el));
    el.querySelector('[data-action="settings-restore"]')?.addEventListener('click', () => this.restore(el));
  },

  updateDirtyIndicators(el) {
    const dirtyCount = Object.keys(this.dirty).length;
    const saveBtn = el.querySelector('[data-action="settings-save"]');
    const applyBtn = el.querySelector('[data-action="settings-apply"]');
    if (saveBtn) saveBtn.disabled = dirtyCount === 0;
    if (applyBtn) applyBtn.disabled = dirtyCount === 0;
  },

  async save(el) {
    const saveBtn = el.querySelector('[data-action="settings-save"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const res = await fetch('/api/settings/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: this.dirty }),
      });
      if (!res.ok) throw new Error('Save failed');
      this.original = { ...this.original, ...this.dirty };
      this.dirty = {};
      this.updateDirtyIndicators(el);
      saveBtn.textContent = 'Saved';
      setTimeout(() => { saveBtn.textContent = 'Save Changes'; }, 2000);
    } catch (e) {
      saveBtn.textContent = 'Failed';
      setTimeout(() => { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }, 2000);
    }
  },

  async applyAndRestart(el) {
    const applyBtn = el.querySelector('[data-action="settings-apply"]');
    applyBtn.disabled = true;
    applyBtn.textContent = 'Saving...';

    try {
      const writeRes = await fetch('/api/settings/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: this.dirty }),
      });
      if (!writeRes.ok) throw new Error('Write failed');

      applyBtn.textContent = 'Restarting...';
      const restartRes = await fetch('/api/settings/restart', { method: 'POST' });
      if (!restartRes.ok) throw new Error('Restart failed');

      this.original = { ...this.original, ...this.dirty };
      this.dirty = {};
      this.updateDirtyIndicators(el);

      applyBtn.textContent = 'Waiting for Honcho...';
      await this.waitForHealth();

      applyBtn.textContent = 'Done';
      setTimeout(() => { applyBtn.textContent = 'Apply & Restart'; applyBtn.disabled = false; }, 2000);
    } catch (e) {
      applyBtn.textContent = 'Failed';
      setTimeout(() => { applyBtn.textContent = 'Apply & Restart'; applyBtn.disabled = false; }, 2000);
    }
  },

  async waitForHealth() {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (data.status === 'ok') return true;
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  },

  async backup(el) {
    try {
      const res = await fetch('/api/settings/backup', { method: 'POST' });
      if (!res.ok) throw new Error('Backup failed');
      const btn = el.querySelector('[data-action="settings-backup"]');
      btn.textContent = 'Backed up';
      setTimeout(() => { btn.textContent = 'Create Backup'; }, 2000);
    } catch (e) {
      alert(`Backup failed: ${e.message}`);
    }
  },

  async restore(el) {
    Modal.confirm('Restore Backup', 'Restore the previous .env configuration and restart containers?', async () => {
      try {
        await fetch('/api/settings/restore', { method: 'POST' });
        Modal.close();
        await fetch('/api/settings/restart', { method: 'POST' });
        setTimeout(() => this.render(el), 3000);
      } catch {
        Modal.close();
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
