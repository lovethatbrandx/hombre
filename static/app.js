const App = {
  state: {
    activeTab: 'overview',
    workspace: null,
    workspaces: [],
    peers: [],
    sessions: [],
    user: null,
    supabaseConfigured: false,
  },

  async init() {
    this.bindNav();
    this.bindEventDelegation();
    this.bindWorkspaceSelect();
    await this.checkSupabaseAuth();
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
      else if (action === 'load-more-conclusions') ConclusionsTab.loadMore();
      else if (action === 'load-more-messages') MessagesTab.loadMore();
      else if (action === 'delete-conclusion') ConclusionsTab.deleteItem(id, btn);
      else if (action === 'delete-message') MessagesTab.deleteItem(id, btn);
      else if (action === 'delete-peer') PeersTab.deletePeer(id, btn);
      else if (action === 'compare-peers') PeersTab.openCompare();
    });

    document.getElementById('modal-root').addEventListener('click', (e) => {
      const overlay = e.target.closest('.modal-overlay');
      if (e.target === overlay) Modal.close();
    });

    document.querySelector('.sidebar-footer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'show-login') App.showLogin();
      else if (action === 'logout') App.logout();
    });
  },

  bindWorkspaceSelect() {
    const select = document.getElementById('workspace-select');
    select.addEventListener('change', async () => {
      const wsId = select.value;
      this.state.workspace = this.state.workspaces.find(w => w.id === wsId) || null;
      if (this.state.workspace) {
        localStorage.setItem('hombre_workspace', wsId);
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

  async checkSupabaseAuth() {
    try {
      const r = await fetch('/api/auth/status');
      const d = await r.json();
      this.state.supabaseConfigured = d.configured || false;
      this.state.user = d.user || null;
    } catch {
      this.state.supabaseConfigured = false;
      this.state.user = null;
    }
    this.updateAuthUI();
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
      const savedWs = localStorage.getItem('hombre_workspace');
      if (savedWs && this.state.workspaces.find(w => w.id === savedWs)) {
        this.state.workspace = this.state.workspaces.find(w => w.id === savedWs);
      } else if (this.state.workspaces.length > 0) {
        this.state.workspace = this.state.workspaces[0];
      }
    } catch (err) {
      if (this.isRateLimited(err)) {
        this.toast('Rate limited — try again in a moment', 'warning');
      } else {
        this.state.workspaces = [];
      }
    }
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
    } catch (err) {
      if (this.isRateLimited(err)) {
        this.toast('Rate limited — try again in a moment', 'warning');
      } else {
        this.state.peers = [];
        this.state.sessions = [];
      }
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
    const token = localStorage.getItem('hombre_auth_token');
    if (token) {
      fetchOpts.headers['Authorization'] = `Bearer ${token}`;
    }
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

  /* ─── Auth Methods ─── */
  showLogin() {
    if (!this.state.supabaseConfigured) {
      this.toast('Supabase auth is not configured', 'warning');
      return;
    }

    const emailLabel = document.createElement('label');
    emailLabel.textContent = 'Email';
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'modal-email';
    emailInput.className = 'input mt-2';
    emailInput.placeholder = 'you@example.com';

    const passLabel = document.createElement('label');
    passLabel.className = 'mt-3';
    passLabel.textContent = 'Password';
    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.id = 'modal-password';
    passInput.className = 'input mt-2';
    passInput.placeholder = 'Your password';

    const divider = document.createElement('div');
    divider.className = 'mt-3 mb-2';
    divider.style.cssText = 'display:flex;align-items:center;gap:8px;color:var(--text-dim);font-size:11px';
    divider.innerHTML = '<span style="flex:1;border-top:1px solid var(--border)"></span><span>or</span><span style="flex:1;border-top:1px solid var(--border)"></span>';

    const magicBtn = document.createElement('button');
    magicBtn.className = 'btn btn-ghost w-full mt-2';
    magicBtn.textContent = 'Send Magic Link';
    magicBtn.addEventListener('click', () => this.sendMagicLink());

    Modal.show('Sign In', [emailLabel, emailInput, passLabel, passInput, divider, magicBtn], () => this.loginWithEmail());
  },

  async loginWithEmail() {
    const email = document.getElementById('modal-email')?.value.trim();
    const password = document.getElementById('modal-password')?.value;
    if (!email || !password) {
      this.toast('Email and password are required', 'warning');
      return;
    }

    try {
      const data = await this.api('auth/login', { body: { email, password } });
      if (data.token) {
        localStorage.setItem('hombre_auth_token', data.token);
      }
      this.state.user = data.user || { email };
      this.updateAuthUI();
      Modal.close();
      this.toast('Signed in successfully', 'success');
    } catch (e) {
      this.toast(`Login failed: ${e.message}`, 'error');
    }
  },

  async sendMagicLink() {
    const email = document.getElementById('modal-email')?.value.trim();
    if (!email) {
      this.toast('Enter your email first', 'warning');
      return;
    }

    try {
      await this.api('auth/magic-link', { body: { email } });
      this.toast('Magic link sent! Check your inbox.', 'success');
    } catch (e) {
      this.toast(`Failed to send magic link: ${e.message}`, 'error');
    }
  },

  async logout() {
    try {
      await this.api('auth/logout', { body: {} });
    } catch {}
    localStorage.removeItem('hombre_auth_token');
    this.state.user = null;
    this.updateAuthUI();
    this.toast('Signed out', 'info');
  },

  updateAuthUI() {
    const container = document.getElementById('auth-section');
    if (!container) return;

    if (!this.state.supabaseConfigured) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    if (this.state.user) {
      const email = this.state.user.email || 'user';
      const initials = email.charAt(0).toUpperCase();
      container.innerHTML = `
        <div class="auth-user">
          <div class="auth-avatar">${this.escapeHtml(initials)}</div>
          <span class="auth-name">${this.escapeHtml(email)}</span>
        </div>
        <button class="btn btn-ghost btn-sm w-full" data-action="logout">Sign Out</button>
      `;
    } else {
      container.innerHTML = `
        <button class="btn btn-ghost btn-sm w-full" data-action="show-login">Sign In</button>
      `;
    }
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
  },

  /* ─── Error Helpers ─── */
  isRateLimited(err) {
    return err && err.message && err.message.includes('API error: 429');
  },

  /* ─── Toast Notifications ─── */
  toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  },

  /* ─── Soft Delete ─── */
  async softDelete(type, id) {
    const ws = this.state.workspace;
    if (!ws) return;
    try {
      await this.api('soft-delete', { body: { type, id, workspace_id: ws.id } });
      this.toast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted`, 'success');
      return true;
    } catch (e) {
      this.toast(`Delete failed: ${e.message}`, 'error');
      return false;
    }
  },


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
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try { await onConfirm(); } finally { confirmBtn.disabled = false; }
    });
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

/* ─── Export/Import Helpers ─── */
const ExportImport = {
  async exportWorkspace(wsId) {
    const btn = document.getElementById('export-workspace-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Exporting...';
    }

    try {
      const response = await fetch(`/api/export/workspace/${encodeURIComponent(wsId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        let msg = `Export failed: ${response.status}`;
        try { const e = await response.json(); msg = e.detail || msg; } catch {}
        throw new Error(msg);
      }

      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hombre-export-${wsId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      if (btn) {
        btn.textContent = 'Exported!';
        setTimeout(() => { btn.textContent = 'Export Workspace'; btn.disabled = false; }, 2000);
      }
    } catch (e) {
      if (btn) {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Export Workspace'; btn.disabled = false; }, 2000);
      }
      alert(`Export failed: ${e.message}`);
    }
  },

  async importWorkspace(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/export/import/workspace', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let msg = `Import preview failed: ${response.status}`;
        try { const e = await response.json(); msg = e.detail || msg; } catch {}
        throw new Error(msg);
      }

      return await response.json();
    } catch (e) {
      alert(`Import preview failed: ${e.message}`);
      return null;
    }
  },

  async confirmImport(workspaceId, data, strategy, idMapping) {
    try {
      const response = await fetch('/api/export/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          data: data,
          conflict_strategy: strategy,
          id_mapping: idMapping || {},
        }),
      });

      if (!response.ok) {
        let msg = `Import failed: ${response.status}`;
        try { const e = await response.json(); msg = e.detail || msg; } catch {}
        throw new Error(msg);
      }

      return await response.json();
    } catch (e) {
      alert(`Import failed: ${e.message}`);
      return null;
    }
  },

  showImportPreview(preview) {
    const conflictItems = [];
    if (preview.conflicts.peer_conflicts.length > 0) {
      conflictItems.push(`<div class="mb-2"><strong>Peer conflicts:</strong> ${preview.conflicts.peer_conflicts.map(id => `<code>${App.escapeHtml(id)}</code>`).join(', ')}</div>`);
    }
    if (preview.conflicts.session_conflicts.length > 0) {
      conflictItems.push(`<div class="mb-2"><strong>Session conflicts:</strong> ${preview.conflicts.session_conflicts.map(id => `<code>${App.escapeHtml(id)}</code>`).join(', ')}</div>`);
    }
    if (preview.conflicts.workspace_exists) {
      conflictItems.push(`<div class="mb-2"><strong>Note:</strong> Target workspace <code>${App.escapeHtml(preview.source_workspace)}</code> already exists</div>`);
    }

    const bodyParts = [];
    const summary = document.createElement('div');
    summary.innerHTML = `
      <div class="mb-3">
        <div class="text-sm text-muted mb-2">Export from <code>${App.escapeHtml(preview.source_workspace)}</code> (${App.formatDate(preview.export_date)})</div>
        <div class="flex gap-4">
          <div><strong>${preview.summary.peers}</strong> peers</div>
          <div><strong>${preview.summary.sessions}</strong> sessions</div>
          <div><strong>${preview.summary.conclusions}</strong> conclusions</div>
          <div><strong>${preview.summary.message_sessions}</strong> message sessions</div>
        </div>
      </div>
    `;
    bodyParts.push(summary);

    if (preview.conflicts.has_conflicts) {
      const conflicts = document.createElement('div');
      conflicts.className = 'mb-3';
      conflicts.innerHTML = `
        <div class="text-sm font-medium mb-2" style="color:var(--amber)">Conflicts Detected</div>
        ${conflictItems.join('')}
        <div class="text-xs text-muted mt-2">Choose a conflict resolution strategy below.</div>
      `;
      bodyParts.push(conflicts);
    } else {
      const noConflicts = document.createElement('div');
      noConflicts.className = 'mb-3';
      noConflicts.innerHTML = '<div class="text-sm" style="color:var(--green)">No conflicts detected. Ready to import.</div>';
      bodyParts.push(noConflicts);
    }

    // Strategy selector
    const strategyDiv = document.createElement('div');
    strategyDiv.innerHTML = `
      <label class="text-xs font-medium text-muted mb-1">Conflict Resolution</label>
      <select class="input mt-1" id="import-strategy">
        <option value="skip">Skip conflicting resources</option>
        <option value="rename">Rename with -imported suffix</option>
        <option value="rename">Rename (add -merged suffix)</option>
      </select>
    `;
    bodyParts.push(strategyDiv);

    Modal.show('Import Preview', bodyParts, async () => {
      const strategy = document.getElementById('import-strategy').value;
      Modal.close();

      // Show progress
      const progressDiv = document.createElement('div');
      progressDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Importing...</div>';
      document.getElementById('modal-root').appendChild(progressDiv);

      const result = await ExportImport.confirmImport(preview.source_workspace, preview.data, strategy);
      progressDiv.remove();

      if (result) {
        const notesHtml = result.notes.length > 0
          ? `<div class="mt-3"><div class="text-xs text-muted mb-1">Notes</div>${result.notes.map(n => `<div class="text-xs mb-1">- ${App.escapeHtml(n)}</div>`).join('')}</div>`
          : '';

        const resultParts = [];
        const resultDiv = document.createElement('div');
        resultDiv.innerHTML = `
          <div class="mb-2">
            <strong>${result.imported.peers_created.length}</strong> peers created,
            <strong>${result.imported.peers_skipped.length}</strong> skipped
          </div>
          <div class="mb-2">
            <strong>${result.imported.sessions_created.length}</strong> sessions created,
            <strong>${result.imported.sessions_skipped.length}</strong> skipped
          </div>
          ${result.imported.errors.length > 0 ? `<div class="mb-2" style="color:var(--destructive)">${result.imported.errors.length} errors</div>` : ''}
          ${notesHtml}
        `;
        resultParts.push(resultDiv);

        Modal.show('Import Complete', resultParts, () => {
          Modal.close();
          App.loadWorkspaces().then(() => App.renderTab(App.state.activeTab));
        }, { confirmText: 'Done' });
      }
    }, { confirmText: 'Import', confirmClass: 'btn btn-primary' });
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
            <div class="card-title">Export / Import</div>
            <div class="card-subtitle">Backup and restore workspace data</div>
          </div>
        </div>
        <div class="flex gap-2 p-3">
          <button class="btn btn-primary" id="export-workspace-btn">Export Workspace</button>
          <button class="btn btn-ghost" id="import-workspace-btn">Import Workspace</button>
          <input type="file" id="import-file-input" accept=".json" style="display:none">
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
            App.state.workspaces = App.state.workspaces.filter(w => w.id !== wsId);
            if (App.state.workspace?.id === wsId) {
              App.state.workspace = App.state.workspaces[0] || null;
            }
            App.renderWorkspaceSelect();
            App.renderTab(App.state.activeTab);
          } catch (e) {
            Modal.close();
            alert(`Delete failed: ${e.message}`);
          }
        });
      });
    });

    // Export/Import handlers
    const exportBtn = document.getElementById('export-workspace-btn');
    const importBtn = document.getElementById('import-workspace-btn');
    const fileInput = document.getElementById('import-file-input');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => ExportImport.exportWorkspace(ws.id));
    }

    if (importBtn) {
      importBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileInput.value = '';

        const preview = await ExportImport.importWorkspace(file);
        if (preview) {
          ExportImport.showImportPreview(preview);
        }
      });
    }
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

    const compareBtnHtml = App.state.peers.length >= 2
      ? `<button class="btn btn-ghost" data-action="compare-peers">Compare</button>`
      : '';

    el.innerHTML = `
      <div class="tab-header">
        <div class="flex items-center justify-between">
          <div>
            <h2>Peers</h2>
            <p>${App.state.peers.length} participant${App.state.peers.length !== 1 ? 's' : ''}</p>
          </div>
          <div class="flex gap-2">
            ${compareBtnHtml}
            <button class="btn btn-primary" id="create-peer-btn">+ New Peer</button>
          </div>
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
                <td class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" data-action="toggle-card" data-id="${App.escapeAttr(p.id)}">Card</button>
                  <button class="btn-delete-inline" data-action="delete-peer" data-id="${App.escapeAttr(p.id)}" title="Delete peer">&times;</button>
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

  async deletePeer(id, btnEl) {
    const ws = App.state.workspace;
    Modal.confirm('Delete Peer', `Delete peer "${id}"? This will be removed locally (Honcho does not support native peer deletion).`, async () => {
      const ok = await App.softDelete('peer', id);
      if (ok) {
        Modal.close();
        // Gray out or hide the peer
        const row = document.querySelector(`tr[data-peer="${id}"]`);
        const expandRow = document.getElementById(`peer-expand-${id}`);
        if (row) {
          row.classList.add('peer-soft-deleted');
          row.classList.remove('clickable');
        }
        if (expandRow) expandRow.classList.add('hidden');
        // Remove from peers list so it won't show on re-render
        App.state.peers = App.state.peers.filter(p => p.id !== id);
      }
    });
  },

  openCompare() {
    const peers = App.state.peers;
    if (peers.length < 2) {
      App.toast('Need at least 2 peers to compare', 'warning');
      return;
    }

    const select1 = document.createElement('select');
    select1.className = 'input';
    select1.id = 'compare-peer-1';
    select1.innerHTML = `<option value="">Select peer...</option>${peers.map(p => `<option value="${App.escapeHtml(p.id)}">${App.escapeHtml(p.id)}</option>`).join('')}`;

    const select2 = document.createElement('select');
    select2.className = 'input';
    select2.id = 'compare-peer-2';
    select2.innerHTML = `<option value="">Select peer...</option>${peers.map(p => `<option value="${App.escapeHtml(p.id)}">${App.escapeHtml(p.id)}</option>`).join('')}`;

    const selectContainer = document.createElement('div');
    selectContainer.className = 'comparison-selects';
    selectContainer.appendChild(select1);
    selectContainer.appendChild(select2);

    const pane1 = document.createElement('div');
    pane1.className = 'comparison-pane';
    pane1.id = 'compare-pane-1';
    pane1.innerHTML = '<div class="text-sm text-muted">Select a peer above</div>';

    const pane2 = document.createElement('div');
    pane2.className = 'comparison-pane';
    pane2.id = 'compare-pane-2';
    pane2.innerHTML = '<div class="text-sm text-muted">Select a peer above</div>';

    const grid = document.createElement('div');
    grid.className = 'comparison-container';
    grid.appendChild(pane1);
    grid.appendChild(pane2);

    const container = document.createElement('div');
    container.appendChild(selectContainer);
    container.appendChild(grid);

    Modal.show('Compare Peers', container, () => { Modal.close(); });

    // Bind change events after modal is shown
    const loadPeer = async (peerId, paneId) => {
      const pane = document.getElementById(paneId);
      if (!peerId || !pane) {
        if (pane) pane.innerHTML = '<div class="text-sm text-muted">Select a peer above</div>';
        return;
      }
      const ws = App.state.workspace;
      pane.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

      try {
        const [repr, card] = await Promise.all([
          App.api(`workspaces/${ws.id}/peers/${peerId}/representation`, { body: {} }),
          App.api(`workspaces/${ws.id}/peers/${peerId}/card`, { method: 'GET' }),
        ]);

        let html = `<div class="comparison-pane-header">${App.escapeHtml(peerId)}</div>`;
        html += `<div class="text-xs font-medium text-muted">Representation</div>`;
        html += `<div class="representation-box">${App.escapeHtml(repr.representation || 'No representation yet')}</div>`;
        html += `<div class="text-xs font-medium text-muted mt-2">Card</div>`;
        if (card.peer_card && card.peer_card.length > 0) {
          html += `<div class="peer-card-list">${card.peer_card.map(c => `<div class="peer-card-item">${App.escapeHtml(c)}</div>`).join('')}</div>`;
        } else {
          html += '<div class="text-sm text-muted">No card yet</div>';
        }
        pane.innerHTML = html;
      } catch {
        pane.innerHTML = '<div class="text-sm text-muted">Failed to load peer data</div>';
      }
    };

    select1.addEventListener('change', () => loadPeer(select1.value, 'compare-pane-1'));
    select2.addEventListener('change', () => loadPeer(select2.value, 'compare-pane-2'));
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
            App.state.sessions = App.state.sessions.filter(s => s.id !== sessionId);
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

    // Show typing indicator
    const typingEl = this.addMessage('assistant', '');
    typingEl.classList.add('typing');
    typingEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

    const ws = App.state.workspace;
    let gotFirstChunk = false;

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
                // Remove typing indicator on first chunk
                if (!gotFirstChunk) {
                  typingEl.classList.remove('typing');
                  typingEl.innerHTML = '';
                  gotFirstChunk = true;
                }
                content += chunk;
                typingEl.textContent = content;
                const now = Date.now();
                if (now - lastScroll > 100) {
                  typingEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  lastScroll = now;
                }
              }
            } catch {
              // Remove typing indicator on first chunk
              if (!gotFirstChunk) {
                typingEl.classList.remove('typing');
                typingEl.innerHTML = '';
                gotFirstChunk = true;
              }
              content += data;
              typingEl.textContent = content;
            }
          } else if (line.trim() && !line.startsWith(':')) {
            // Remove typing indicator on first chunk
            if (!gotFirstChunk) {
              typingEl.classList.remove('typing');
              typingEl.innerHTML = '';
              gotFirstChunk = true;
            }
            content += line;
            typingEl.textContent = content;
          }
        }
      }

      if (!content) typingEl.textContent = '(No response)';
    } catch (e) {
      typingEl.classList.remove('typing');
      typingEl.textContent = `Error: ${e.message}`;
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
  state: {
    items: [],
    offset: 0,
    limit: 20,
    allLoaded: false,
    currentPeerId: null,
  },

  resetState() {
    this.state.items = [];
    this.state.offset = 0;
    this.state.allLoaded = false;
    this.state.currentPeerId = null;
  },

  async render(el) {
    this.resetState();
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
      if (enabled) {
        this.resetState();
        this.state.currentPeerId = peerSelect.value;
        this.loadConclusions(peerSelect.value);
      }
    });
  },

  async loadConclusions(peerId) {
    const ws = App.state.workspace;
    const results = document.getElementById('conclusion-results');
    if (!results) return;

    results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';

    try {
      const data = await App.api(`workspaces/${ws.id}/conclusions/list`, {
        body: {
          filters: { observer_id: peerId },
          limit: this.state.limit,
          offset: this.state.offset,
        }
      });
      const newItems = data.items || [];
      this.state.items = this.state.offset === 0 ? newItems : [...this.state.items, ...newItems];
      this.state.allLoaded = newItems.length < this.state.limit;
      this.renderResults(results, this.state.items);
    } catch {
      results.innerHTML = '<div class="text-sm text-muted">Failed to load conclusions</div>';
    }
  },

  async loadMore() {
    this.state.offset = this.state.items.length;
    await this.loadConclusions(this.state.currentPeerId);
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
        body: { query, top_k: 20, filters: { observer: peerId, observed: peerId } }
      });
      const resultItems = Array.isArray(items) ? items : [];
      this.state.items = resultItems;
      this.state.allLoaded = true;
      this.state.offset = 0;
      this.renderResults(results, resultItems);
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

    const loadMoreHtml = this.state.allLoaded ? '' : `
      <div class="load-more-wrap">
        <button class="btn-load-more" data-action="load-more-conclusions">Load More</button>
      </div>
    `;

    container.innerHTML = `
      <div class="text-sm text-muted mb-3">${items.length} conclusion${items.length !== 1 ? 's' : ''}</div>
      <div class="flex flex-col gap-2" id="conclusion-list">
        ${items.map((c, idx) => {
          const type = this.guessType(c.content);
          const cid = c.id || `c-${idx}`;
          return `
            <div class="card" data-conclusion-id="${App.escapeAttr(cid)}">
              <div class="card-header">
                <div class="flex items-center gap-2">
                  <span class="conclusion-type ${type}">
                    <span class="dot"></span>
                    ${type}
                  </span>
                  <span class="text-xs text-muted">${App.formatDate(c.created_at)}</span>
                </div>
                <button class="btn-delete-inline" data-action="delete-conclusion" data-id="${App.escapeAttr(cid)}" title="Delete conclusion">&times;</button>
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
      ${loadMoreHtml}
    `;
  },

  async deleteItem(id, btnEl) {
    const card = btnEl.closest('.card');
    if (!card) return;
    const ws = App.state.workspace;

    Modal.confirm('Delete Conclusion', `Delete this conclusion? ${ws ? `This will attempt to remove it from Honcho via ${ws.id}.` : ''}`, async () => {
      let ok = false;
      try {
        // Try real deletion via Honcho API first
        await App.api(`workspaces/${ws.id}/conclusions/${id}`, { method: 'DELETE' });
        ok = true;
        App.toast('Conclusion deleted', 'success');
      } catch {
        // Honcho may not support conclusion deletion — fall back to soft-delete
        ok = await App.softDelete('conclusion', id);
      }
      if (ok) {
        Modal.close();
        card.style.transition = 'opacity 0.2s ease';
        card.style.opacity = '0';
        setTimeout(() => {
          card.remove();
          this.state.items = this.state.items.filter((c, i) => (c.id || `c-${i}`) !== id);
          const list = document.getElementById('conclusion-list');
          if (list && list.children.length === 0) {
            const results = document.getElementById('conclusion-results');
            results.innerHTML = `
              <div class="empty-state">
                <h3>No conclusions found</h3>
                <p>Honcho hasn't drawn any conclusions about this peer yet</p>
              </div>`;
          }
        }, 200);
      }
    });
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
  state: {
    items: [],
    offset: 0,
    limit: 20,
    allLoaded: false,
    currentSessionId: null,
    currentPeerFilter: null,
  },

  resetState() {
    this.state.items = [];
    this.state.offset = 0;
    this.state.allLoaded = false;
    this.state.currentSessionId = null;
    this.state.currentPeerFilter = null;
  },

  async render(el) {
    this.resetState();
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

    // Reset state when loading fresh
    this.state.items = [];
    this.state.offset = 0;
    this.state.allLoaded = false;
    this.state.currentSessionId = sessionId;
    this.state.currentPeerFilter = peerFilter;

    await this.fetchMessages();
  },

  async fetchMessages() {
    const results = document.getElementById('msg-results');
    if (!results) return;

    const ws = App.state.workspace;
    const { currentSessionId, currentPeerFilter, offset, limit } = this.state;

    if (this.state.offset === 0) {
      results.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading...</div>';
    }

    try {
      const filters = {};
      if (currentPeerFilter) filters.peer_id = currentPeerFilter;

      const data = await App.api(`workspaces/${ws.id}/sessions/${currentSessionId}/messages/list`, {
        body: { filters, limit, offset },
      });

      const newMessages = data.items || [];
      this.state.items = offset === 0 ? newMessages : [...this.state.items, ...newMessages];
      this.state.allLoaded = newMessages.length < limit;
      this.renderMessages(results, this.state.items);
    } catch {
      results.innerHTML = '<div class="text-sm text-muted">Failed to load messages</div>';
    }
  },

  async loadMore() {
    this.state.offset = this.state.items.length;
    await this.fetchMessages();
  },

  renderMessages(container, messages) {
    if (messages.length === 0) {
      container.innerHTML = '<div class="text-sm text-muted">No messages found</div>';
      return;
    }

    const loadMoreHtml = this.state.allLoaded ? '' : `
      <div class="load-more-wrap">
        <button class="btn-load-more" data-action="load-more-messages">Load More</button>
      </div>
    `;

    container.innerHTML = `
      <div class="text-sm text-muted mb-3">${messages.length} message${messages.length !== 1 ? 's' : ''}</div>
      <div class="table-wrap" style="max-height:calc(100vh - 280px);overflow-y:auto">
        <table>
          <thead><tr><th>Peer</th><th>Content</th><th>Tokens</th><th>Time</th><th></th></tr></thead>
          <tbody>
            ${messages.map((m, idx) => {
              const mid = m.id || `m-${idx}`;
              return `
                <tr data-message-id="${App.escapeAttr(mid)}">
                  <td><code>${App.escapeHtml(m.peer_id)}</code></td>
                  <td class="truncate" title="${App.escapeHtml(m.content)}">${App.escapeHtml(m.content.substring(0, 150))}${m.content.length > 150 ? '...' : ''}</td>
                  <td class="mono">${m.token_count || '—'}</td>
                  <td class="mono">${App.formatDateTime(m.created_at)}</td>
                  <td>
                    <button class="btn-delete-inline" data-action="delete-message" data-id="${App.escapeAttr(mid)}" title="Delete message">&times;</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${loadMoreHtml}
    `;
  },

  async deleteItem(id, btnEl) {
    const row = btnEl.closest('tr');
    if (!row) return;
    const ws = App.state.workspace;

    Modal.confirm('Delete Message', `Delete this message? This will be removed locally.`, async () => {
      // Honcho does not natively support message deletion — use soft-delete
      const ok = await App.softDelete('message', id);
      if (ok) {
        Modal.close();
        row.style.transition = 'opacity 0.2s ease';
        row.style.opacity = '0';
        setTimeout(() => {
          row.remove();
          this.state.items = this.state.items.filter((m, i) => (m.id || `m-${i}`) !== id);
          const tbody = document.querySelector('#msg-results tbody');
          if (tbody && tbody.children.length === 0) {
            const results = document.getElementById('msg-results');
            results.innerHTML = '<div class="text-sm text-muted">No messages found</div>';
          }
        }, 200);
      }
    });
  }
};

/* ─── Settings Tab ─── */
const SettingsTab = {
  dirty: {},
  original: {},
  users: [],
  usersDirty: false,
  mergeState: {
    sourceWorkspace: '',
    targetWorkspace: '',
    conflictStrategy: 'rename',
    previewResult: null,
    canExecute: false,
  },

  async render(el) {
    el.innerHTML = `
      <div class="tab-header">
        <h2>Settings</h2>
        <p>Configure dashboard access and Honcho server models</p>
      </div>
      <div class="loading-overlay"><div class="spinner"></div> Loading settings...</div>
    `;

    // Load users and settings in parallel
    const [settingsResult, usersResult] = await Promise.allSettled([
      fetch('/api/settings/read'),
      fetch('/api/settings/users'),
    ]);

    // Handle settings load
    if (settingsResult.status === 'rejected' || !settingsResult.value.ok) {
      let msg = 'Failed to load settings';
      try {
        const err = settingsResult.value ? await settingsResult.value.json() : {};
        if (err.detail === 'env_file_not_found') msg = 'env_file_not_found';
      } catch {}
      if (msg === 'env_file_not_found') {
        el.innerHTML = `
          <div class="tab-header"><h2>Settings</h2><p>Configure dashboard access and Honcho server models</p></div>
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
            <h3>Configuration file not found</h3>
            <p>Set HONCHO_ENV_PATH to point to your .env file</p>
          </div>`;
        return;
      }
      el.innerHTML = `
        <div class="tab-header"><h2>Settings</h2><p>Configure dashboard access and Honcho server models</p></div>
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <h3>Failed to load settings</h3>
          <p>${App.escapeHtml(msg)}</p>
        </div>`;
      return;
    }

    // Parse users
    this.users = [];
    this.usersDirty = false;
    if (usersResult.status === 'fulfilled' && usersResult.value.ok) {
      try {
        const uData = await usersResult.value.json();
        this.users = (uData.users || []).map(u => ({
          username: u.username || '',
          role: u.role || 'viewer',
          password: '',
          _existing: true,
          _deleted: false,
        }));
      } catch {}
    }

    try {
      const data = await settingsResult.value.json();
      this.original = this.flattenSections(data.sections);
      this.dirty = {};
      this.renderSections(el, data.sections);
    } catch (e) {
      el.innerHTML = `
        <div class="tab-header"><h2>Settings</h2><p>Configure dashboard access and Honcho server models</p></div>
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

    // Dashboard Credentials section (at the very top)
    html += this.renderCredentialsSection();

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

    // Workspace Merge section (between advanced and sticky bar)
    html += this.renderMergeSection();

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

  renderCredentialsSection() {
    const visibleUsers = this.users.filter(u => !u._deleted);
    const rows = visibleUsers.map((u, idx) => {
      const isNew = !u._existing;
      const displayName = isNew ? '' : App.escapeHtml(u.username);
      const pwPlaceholder = isNew ? '' : '••••';
      return `
        <div class="credentials-row" data-credential-idx="${idx}">
          <input type="text" class="input" placeholder="username" value="${displayName}" data-cred-field="username" ${u._existing ? 'readonly' : ''}>
          <select class="input" data-cred-field="role">
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
            <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          </select>
          <input type="password" class="input" placeholder="${pwPlaceholder}" value="" data-cred-field="password">
          <button class="btn-delete-inline" data-action="credential-delete" data-credential-idx="${idx}" title="Remove user">&times;</button>
        </div>
      `;
    }).join('');

    const noUsers = visibleUsers.length === 0
      ? '<div class="text-sm text-muted" style="padding:8px 0">No users configured. Add a user to enable dashboard access.</div>'
      : '';

    return `
      <div class="accordion open" data-section="credentials">
        <div class="accordion-header" data-action="toggle-accordion">
          <div class="flex items-center gap-2">
            <span>🔐 Dashboard Access</span>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="accordion-body">
          <div class="accordion-content">
            <div class="credentials-list" id="credentials-list">
              ${rows}
            </div>
            ${noUsers}
            <div class="flex gap-2 mt-3">
              <button class="btn btn-ghost" data-action="credential-add">+ Add User</button>
              <button class="btn btn-primary" data-action="credential-save">Save Credentials</button>
            </div>
          </div>
        </div>
      </div>
    `;
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

  addUser() {
    // Before adding, save any current form state
    this.collectUsersFromDOM();
    this.users.push({ username: '', role: 'viewer', password: '', _existing: false, _deleted: false });
    this.renderCredentialList();
  },

  deleteUser(idx) {
    this.collectUsersFromDOM();
    const visibleUsers = this.users.filter(u => !u._deleted);
    const target = visibleUsers[idx];
    if (target) {
      if (target._existing) {
        target._deleted = true;
      } else {
        // Remove brand-new users entirely
        const realIdx = this.users.indexOf(target);
        this.users.splice(realIdx, 1);
      }
    }
    this.renderCredentialList();
  },

  collectUsersFromDOM() {
    const visibleUsers = this.users.filter(u => !u._deleted);
    const rows = document.querySelectorAll('.credentials-row');
    rows.forEach((row, idx) => {
      const u = visibleUsers[idx];
      if (!u) return;
      const usernameInput = row.querySelector('[data-cred-field="username"]');
      const roleSelect = row.querySelector('[data-cred-field="role"]');
      const passwordInput = row.querySelector('[data-cred-field="password"]');
      if (usernameInput) u.username = usernameInput.value.trim();
      if (roleSelect) u.role = roleSelect.value;
      if (passwordInput && passwordInput.value) u.password = passwordInput.value;
    });
  },

  renderCredentialList() {
    const container = document.getElementById('credentials-list');
    if (!container) return;
    const visibleUsers = this.users.filter(u => !u._deleted);
    if (visibleUsers.length === 0) {
      container.innerHTML = '';
      // Also re-render to show the "no users" message
      const section = container.closest('[data-section="credentials"]');
      if (section) {
        const content = section.querySelector('.accordion-content');
        if (content) {
          // Replace just the list and no-users msg
          const existingMsg = content.querySelector('.text-sm.text-muted');
          if (existingMsg) existingMsg.remove();
          const msg = document.createElement('div');
          msg.className = 'text-sm text-muted';
          msg.style.cssText = 'padding:8px 0';
          msg.textContent = 'No users configured. Add a user to enable dashboard access.';
          content.insertBefore(msg, content.querySelector('.flex.gap-2.mt-3'));
        }
      }
      return;
    }
    container.innerHTML = visibleUsers.map((u, idx) => {
      const isNew = !u._existing;
      const displayName = isNew ? '' : App.escapeHtml(u.username);
      const pwPlaceholder = isNew ? '' : '••••';
      return `
        <div class="credentials-row" data-credential-idx="${idx}">
          <input type="text" class="input" placeholder="username" value="${displayName}" data-cred-field="username" ${u._existing ? 'readonly' : ''}>
          <select class="input" data-cred-field="role">
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
            <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          </select>
          <input type="password" class="input" placeholder="${pwPlaceholder}" value="" data-cred-field="password">
          <button class="btn-delete-inline" data-action="credential-delete" data-credential-idx="${idx}" title="Remove user">&times;</button>
        </div>
      `;
    }).join('');
    // Remove "no users" message if present
    const section = container.closest('[data-section="credentials"]');
    if (section) {
      const noMsg = section.querySelector('.accordion-content > .text-sm.text-muted');
      if (noMsg) noMsg.remove();
    }
    // Re-bind delete buttons
    container.querySelectorAll('[data-action="credential-delete"]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteUser(parseInt(btn.dataset.credentialIdx)));
    });
  },

  async saveUsers() {
    this.collectUsersFromDOM();
    // Filter out users with no username (empty new rows)
    const payload = this.users
      .filter(u => !u._deleted && u.username)
      .map(u => {
        const entry = { username: u.username, role: u.role };
        // Only send password if it was changed (not the placeholder)
        if (u.password && u.password !== '••••') {
          entry.password = u.password;
        }
        return entry;
      });

    try {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: payload }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);

      // Refresh users from server
      const freshRes = await fetch('/api/settings/users');
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        this.users = (freshData.users || []).map(u => ({
          username: u.username || '',
          role: u.role || 'viewer',
          password: '',
          _existing: true,
          _deleted: false,
        }));
      }
      this.usersDirty = false;
      App.toast('Credentials saved', 'success');
      this.renderCredentialList();
    } catch (e) {
      App.toast(`Failed to save credentials: ${e.message}`, 'error');
    }
  },

  renderMergeSection() {
    const workspaces = App.state.workspaces;
    const ms = this.mergeState;

    const wsOptions = workspaces.map(w =>
      `<option value="${App.escapeAttr(w.id)}">${App.escapeHtml(w.id)}</option>`
    ).join('');

    const strategyOptions = [
      { value: 'skip', label: 'Skip (don\'t merge conflicting items)' },
      { value: 'rename', label: 'Rename (add -merged suffix)' },
    ];

    const strategyRadios = strategyOptions.map(opt => `
      <label class="merge-strategy-option">
        <input type="radio" name="merge-strategy" value="${opt.value}" ${ms.conflictStrategy === opt.value ? 'checked' : ''}>
        <span>${opt.label}</span>
      </label>
    `).join('');

    const previewHtml = ms.previewResult ? this.renderMergePreview(ms.previewResult) : '';

    return `
      <div class="accordion" data-section="merge">
        <div class="accordion-header" data-action="toggle-accordion">
          <div class="flex items-center gap-2">
            <span>🔀 Workspace Merge</span>
          </div>
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="accordion-body">
          <div class="accordion-content">
            <div class="merge-warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Merging workspaces is a destructive operation. Preview before executing.</span>
            </div>

            <div class="merge-fields">
              <div class="settings-field">
                <label>Source Workspace</label>
                <select class="input" id="merge-source-ws" aria-label="Source workspace">
                  <option value="">Select source...</option>
                  ${wsOptions}
                </select>
              </div>

              <div class="settings-field">
                <label>Target Workspace</label>
                <select class="input" id="merge-target-ws" aria-label="Target workspace">
                  <option value="">Select target...</option>
                  ${wsOptions}
                </select>
              </div>
            </div>

            <div class="settings-field">
              <label>Conflict Strategy</label>
              <div class="merge-strategy-list">
                ${strategyRadios}
              </div>
            </div>

            <div class="merge-actions">
              <button class="btn btn-ghost" data-action="merge-preview" id="merge-preview-btn">Preview Merge</button>
              <button class="btn btn-primary" data-action="merge-execute" id="merge-execute-btn" disabled style="background:var(--destructive);color:#fff">Execute Merge</button>
            </div>

            <div id="merge-preview-results">
              ${previewHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderMergePreview(result) {
    if (!result) return '';

    const strategy = this.mergeState.conflictStrategy;
    const strategyLabel = strategy === 'skip' ? 'skipped' : 'renamed with -merged suffix';
    const strategyAction = strategy === 'skip' ? 'will be skipped (not copied)' : 'will be renamed (id-merged)';
    const strategyActionSessions = strategy === 'skip' ? 'will be skipped (not copied)' : 'will be renamed (id-merged)';

    const nonConflicting = result.non_conflicting || [];
    const conflicts = result.conflicts || [];
    const conflictDetails = result.conflict_details || [];
    const sessionConflicts = result.session_conflicts || [];
    const sessionsNonConflicting = result.sessions_non_conflicting || 0;
    const sessionsConflicting = result.sessions_conflicting || 0;

    // Build conflict detail map for peer creation dates
    const detailMap = {};
    for (const d of conflictDetails) {
      detailMap[d.id] = d;
    }

    // Peer sections
    let peerCopyHtml = '';
    if (nonConflicting.length > 0) {
      const names = nonConflicting.map(id => `<code>${App.escapeHtml(id)}</code>`).join(', ');
      peerCopyHtml = `
        <div class="merge-preview-section">
          <div class="merge-preview-section-title" style="color:var(--green)">
            Would be copied (${nonConflicting.length})
          </div>
          <div class="merge-preview-id-list">${names}</div>
        </div>
      `;
    } else {
      peerCopyHtml = `
        <div class="merge-preview-section">
          <div class="merge-preview-section-title" style="color:var(--text-dim)">
            Would be copied (0)
          </div>
          <div class="text-xs text-muted">All source peers already exist in the target workspace</div>
        </div>
      `;
    }

    let peerConflictHtml = '';
    if (conflicts.length > 0) {
      const conflictEntries = conflicts.map(id => {
        const detail = detailMap[id];
        let meta = '';
        if (detail) {
          const srcDate = detail.source_created && detail.source_created !== 'unknown'
            ? `source created ${App.formatDate(detail.source_created)}` : '';
          const tgtDate = detail.target_created && detail.target_created !== 'unknown'
            ? `target created ${App.formatDate(detail.target_created)}` : '';
          const parts = [srcDate, tgtDate].filter(Boolean);
          if (parts.length > 0) meta = ` <span class="text-muted">(${parts.join(' / ')})</span>`;
        }
        return `<code>${App.escapeHtml(id)}</code>${meta}`;
      }).join('');

      peerConflictHtml = `
        <div class="merge-preview-section">
          <div class="merge-preview-section-title" style="color:var(--amber)">
            Conflicts (${conflicts.length})
          </div>
          <div class="merge-preview-id-list">${conflictEntries}</div>
          <div class="text-xs text-muted mt-1">
            These exist in both workspaces and ${strategyAction}.
          </div>
        </div>
      `;
    }

    // Session sections
    let sessionCopyHtml = `
      <div class="merge-preview-section">
        <div class="merge-preview-section-title" style="color:var(--green)">
          Would be copied (${sessionsNonConflicting})
        </div>
        ${sessionsNonConflicting === 0
          ? '<div class="text-xs text-muted">All source sessions already exist in the target workspace</div>'
          : `<div class="text-xs text-muted">${sessionsNonConflicting} session${sessionsNonConflicting !== 1 ? 's' : ''} unique to the source will be created in the target</div>`
        }
      </div>
    `;

    let sessionConflictHtml = '';
    if (sessionConflicts.length > 0) {
      const sessionNames = sessionConflicts.map(id => `<code>${App.escapeHtml(id)}</code>`).join(', ');
      sessionConflictHtml = `
        <div class="merge-preview-section">
          <div class="merge-preview-section-title" style="color:var(--amber)">
            Conflicts (${sessionConflicts.length})
          </div>
          <div class="merge-preview-id-list">${sessionNames}</div>
          <div class="text-xs text-muted mt-1">
            These exist in both workspaces and ${strategyActionSessions}.
          </div>
        </div>
      `;
    }

    // Summary stats line
    const totalWillCopy = nonConflicting.length + sessionsNonConflicting;
    const totalConflicts = conflicts.length + sessionConflicts;
    const totalWillSkipOrRename = totalConflicts;

    return `
      <div class="merge-preview-box">
        <div class="merge-preview-header">Preview Results</div>

        <div class="merge-preview-stats">
          <div class="merge-stat">
            <span class="merge-stat-label">Source:</span>
            <span>${result.source_peers || 0} peers, ${result.source_sessions || 0} sessions</span>
          </div>
          <div class="merge-stat">
            <span class="merge-stat-label">Target:</span>
            <span>${result.target_peers || 0} peers, ${result.target_sessions || 0} sessions</span>
          </div>
          <div class="merge-stat">
            <span class="merge-stat-label">Action:</span>
            <span>${totalWillCopy} item${totalWillCopy !== 1 ? 's' : ''} will be copied, ${totalWillSkipOrRename} conflict${totalWillSkipOrRename !== 1 ? 's' : ''} ${strategyLabel}</span>
          </div>
        </div>

        <div class="merge-preview-section-group">
          <div class="merge-preview-group-header">Peers</div>
          ${peerCopyHtml}
          ${peerConflictHtml}
        </div>

        <div class="merge-preview-section-group">
          <div class="merge-preview-group-header">Sessions</div>
          ${sessionCopyHtml}
          ${sessionConflictHtml}
        </div>

        <div class="merge-preview-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Merge only copies peers and session structure. <strong>Messages, conclusions, and peer memory are NOT transferred.</strong></span>
        </div>
      </div>
    `;
  },

  async previewMerge() {
    const sourceId = document.getElementById('merge-source-ws')?.value;
    const targetId = document.getElementById('merge-target-ws')?.value;
    const strategy = document.querySelector('input[name="merge-strategy"]:checked')?.value || 'rename';

    if (!sourceId || !targetId) {
      App.toast('Select both source and target workspaces', 'warning');
      return;
    }
    if (sourceId === targetId) {
      App.toast('Source and target must be different', 'warning');
      return;
    }

    const previewBtn = document.getElementById('merge-preview-btn');
    const executeBtn = document.getElementById('merge-execute-btn');
    const resultsDiv = document.getElementById('merge-preview-results');

    previewBtn.disabled = true;
    previewBtn.textContent = 'Previewing...';
    resultsDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading preview...</div>';

    try {
      const result = await App.api('workspaces/merge/preview', {
        body: {
          source_workspace_id: sourceId,
          target_workspace_id: targetId,
          conflict_strategy: strategy,
        }
      });

      this.mergeState.previewResult = result;
      this.mergeState.canExecute = true;
      this.mergeState.sourceWorkspace = sourceId;
      this.mergeState.targetWorkspace = targetId;
      this.mergeState.conflictStrategy = strategy;

      resultsDiv.innerHTML = this.renderMergePreview(result);
      executeBtn.disabled = false;

      previewBtn.textContent = 'Preview Merge';
      previewBtn.disabled = false;
    } catch (e) {
      resultsDiv.innerHTML = `<div class="text-sm" style="color:var(--destructive)">Preview failed: ${App.escapeHtml(e.message)}</div>`;
      previewBtn.textContent = 'Preview Merge';
      previewBtn.disabled = false;
      executeBtn.disabled = true;
    }
  },

  async executeMerge() {
    const ms = this.mergeState;
    if (!ms.canExecute || !ms.sourceWorkspace || !ms.targetWorkspace) {
      App.toast('Run a preview first', 'warning');
      return;
    }

    const executeBtn = document.getElementById('merge-execute-btn');
    const resultsDiv = document.getElementById('merge-preview-results');

    Modal.confirm(
      'Execute Workspace Merge',
      `Merge "${ms.sourceWorkspace}" into "${ms.targetWorkspace}" using "${ms.conflictStrategy}" strategy? This cannot be undone.`,
      async () => {
        executeBtn.disabled = true;
        executeBtn.textContent = 'Merging...';
        resultsDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Merging workspaces...</div>';

        try {
          const result = await App.api('workspaces/merge', {
            body: {
              source_workspace_id: ms.sourceWorkspace,
              target_workspace_id: ms.targetWorkspace,
              conflict_strategy: ms.conflictStrategy,
            }
          });

          // Reset merge state
          ms.previewResult = null;
          ms.canExecute = false;

          resultsDiv.innerHTML = '';
          executeBtn.textContent = 'Execute Merge';
          executeBtn.disabled = true;

          App.toast('Merge completed successfully', 'success');

          // Refresh workspace data
          await App.loadWorkspaces();
          App.renderTab(App.state.activeTab);
        } catch (e) {
          resultsDiv.innerHTML = `<div class="text-sm" style="color:var(--destructive)">Merge failed: ${App.escapeHtml(e.message)}</div>`;
          executeBtn.textContent = 'Execute Merge';
          executeBtn.disabled = false;
        }
      }
    );
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

    // Merge event handlers
    el.querySelector('[data-action="merge-preview"]')?.addEventListener('click', () => this.previewMerge());
    el.querySelector('[data-action="merge-execute"]')?.addEventListener('click', () => this.executeMerge());

    // Credentials event handlers
    el.querySelector('[data-action="credential-add"]')?.addEventListener('click', () => this.addUser());
    el.querySelector('[data-action="credential-save"]')?.addEventListener('click', () => this.saveUsers());

    el.querySelectorAll('[data-action="credential-delete"]').forEach(btn => {
      btn.addEventListener('click', () => this.deleteUser(parseInt(btn.dataset.credentialIdx)));
    });
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

      applyBtn.textContent = 'Waiting for server...';
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
    try {
      const res = await fetch('/api/settings/backups');
      if (!res.ok) throw new Error('Failed to list backups');
      const data = await res.json();
      const backups = data.backups || [];

      if (backups.length === 0) {
        App.toast('No backups found', 'warning');
        return;
      }

      // Build backup list for modal
      const listDiv = document.createElement('div');
      listDiv.className = 'backup-list';
      backups.forEach((b, idx) => {
        const item = document.createElement('label');
        item.className = 'backup-item';
        item.innerHTML = `
          <input type="radio" name="backup-pick" value="${App.escapeAttr(b.filename)}" ${idx === 0 ? 'checked' : ''}>
          <div class="backup-info">
            <div class="backup-name">${App.escapeHtml(b.filename)}</div>
            <div class="backup-meta">${App.formatDateTime(b.modified)} &middot; ${(b.size / 1024).toFixed(1)} KB</div>
          </div>
        `;
        listDiv.appendChild(item);
      });

      Modal.show('Restore Backup', [
        listDiv,
        (() => {
          const note = document.createElement('div');
          note.className = 'text-xs text-muted mt-2';
          note.textContent = 'Select a backup and confirm. The server will restart after restoring.';
          return note;
        })(),
      ], async () => {
        const selected = document.querySelector('input[name="backup-pick"]:checked');
        if (!selected) return;
        const filename = selected.value;

        Modal.close();

        // Show progress
        const progressDiv = document.createElement('div');
        progressDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Restoring...</div>';
        document.getElementById('modal-root').appendChild(progressDiv);

        try {
          await fetch('/api/settings/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename }),
          });
          progressDiv.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Restarting...</div>';
          await fetch('/api/settings/restart', { method: 'POST' });
          setTimeout(() => this.render(el), 3000);
        } catch {
          progressDiv.remove();
          App.toast('Restore failed', 'error');
        }
      }, { confirmText: 'Restore' });
    } catch (e) {
      App.toast(`Failed to load backups: ${e.message}`, 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
