// =========================================================
// ECEVault — Frontend App
// All file operations go to the Node.js server via fetch()
// =========================================================

const YEARS = [{
        id: 'y2',
        label: 'Second Year',
        semesters: [
            { id: 'sem3', label: 'Semester 3' },
            { id: 'sem4', label: 'Semester 4' },
        ]
    },
    {
        id: 'y3',
        label: 'Third Year',
        semesters: [
            { id: 'sem5', label: 'Semester 5' },
            { id: 'sem6', label: 'Semester 6' },
        ]
    },
    {
        id: 'y4',
        label: 'Fourth Year',
        semesters: [
            { id: 'sem7', label: 'Semester 7' },
            { id: 'sem8', label: 'Semester 8' },
        ]
    },
];

const CATEGORIES = [
    { id: 'Assignment', icon: '📝', label: 'Assignments' },
    { id: 'Manual', icon: '📗', label: 'Manuals' },
    { id: 'Self Learning', icon: '🧠', label: 'Self Learning' },
    { id: 'Question Paper', icon: '📄', label: 'Question Papers' },
    { id: 'Question Bank', icon: '🗂️', label: 'Question Bank' },
    { id: 'Project', icon: '🚀', label: 'Projects' },
    { id: 'Other', icon: '📦', label: 'Other' },
];

// ── app state (loaded from server) ────────────────────
let isAdmin = false;

let state = {
    subjects: {}, // { semId: string[] }
    files: [], // file metadata array
    activeYear: YEARS[0].id,
    activeSem: {},
    activeSubject: {},
};

// ── SERVER API CALLS ───────────────────────────────────

async function apiGet(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
    return r.json();
}

async function apiPost(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${url} → ${r.status}`);
    return r.json();
}

async function apiDelete(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${url} → ${r.status}`);
    return r.json();
}

/** Upload a single File object to the server */
async function apiUploadFile(file, semId, subject, category, desc) {
    const buf = await file.arrayBuffer();
    const r = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-Subject': encodeURIComponent(subject),
            'X-SemId': semId,
            'X-Category': encodeURIComponent(category),
            'X-Desc': encodeURIComponent(desc),
            'X-Mime': file.type || 'application/octet-stream',
            'X-Size': String(file.size),
        },
        body: buf,
    });
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
    return r.json();
}

/** Load all data (subjects + file metadata) from server */
async function loadFromServer() {
    const data = await apiGet('/api/data');
    state.subjects = data.subjects || {};
    state.files = data.files || [];
}

// ── THEME ──────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ecevault_theme', theme);
    const btn = document.getElementById('themeToggle');
    if (theme === 'dark') { btn.textContent = '🌙';
        btn.title = 'Switch to Light Mode'; } else { btn.textContent = '☀️';
        btn.title = 'Switch to Dark Mode'; }
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ── SECURE SERVER-SIDE ADMIN AUTH ──────────────────────

async function submitPassword() {
    const input = document.getElementById('pwInput');
    const error = document.getElementById('pwError');
    const wrapper = document.getElementById('pwInputWrapper');
    const password = input.value;

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const result = await response.json();

        if (!response.ok) {
            error.classList.add('show');
            wrapper.classList.add('pw-shake');

            setTimeout(() => {
                wrapper.classList.remove('pw-shake');
            }, 450);

            input.focus();
            input.select();
            return;
        }

        isAdmin = true;
        document.body.classList.add('admin-mode');

        closeModal('pwModal');
        input.value = '';
        error.classList.remove('show');

        toast('Welcome back, Admin! 👋', 'success');
        renderApp();

    } catch (e) {
        toast('Unable to contact the server. Please try again.', 'error');
        console.error('Admin login failed:', e);
    }
}

async function logoutAdmin() {
    try {
        const response = await fetch('/api/admin/logout', {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(`Logout failed: ${response.status}`);
        }

        isAdmin = false;
        document.body.classList.remove('admin-mode');

        toast('Logged out of admin mode.', 'info');
        renderApp();

    } catch (e) {
        toast('Logout failed. Please try again.', 'error');
        console.error('Admin logout failed:', e);
    }
}

function togglePwVisibility() {
    const input = document.getElementById('pwInput');
    const button = document.getElementById('pwToggle');

    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🙈';
    } else {
        input.type = 'password';
        button.textContent = '👁';
    }
}

// ── HELPERS ────────────────────────────────────────────
const getSubjects = semId => state.subjects[semId] || [];
const getFiles = (semId, s) => state.files.filter(f => f.semId === semId && f.subject === s);
const getFilesInSem = semId => state.files.filter(f => f.semId === semId);

function formatSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getFileEmoji(str) {
    if (!str) return '📄';
    const t = str.toLowerCase();
    if (t.includes('pdf')) return '📕';
    if (t.includes('word') || t.includes('.doc')) return '📘';
    if (t.includes('excel') || t.includes('.xls') || t.includes('csv')) return '📗';
    if (t.includes('ppt')) return '📙';
    if (t.match(/image|png|jpe?g|gif|svg|webp/)) return '🖼️';
    if (t.match(/zip|rar|7z/)) return '🗜️';
    if (t.includes('txt')) return '📃';
    if (t.match(/video|mp4|mkv|avi/)) return '🎬';
    if (t.match(/audio|mp3|wav/)) return '🎵';
    return '📄';
}

function getCatClass(cat) {
    const m = {
        'Assignment': 'assignment',
        'Manual': 'manual',
        'Self Learning': 'selflearning',
        'Question Paper': 'questionpaper',
        'Question Bank': 'questionbank',
        'Project': 'project',
        'Other': 'other'
    };
    return m[cat] || 'other';
}

// ── TOAST ──────────────────────────────────────────────
function toast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
    c.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => { t.classList.remove('show');
        setTimeout(() => t.remove(), 400); }, 3500);
}

// ── CONFIRM ────────────────────────────────────────────
function confirmDialog(title, msg) {
    return new Promise(resolve => {
        const overlay = document.getElementById('confirmOverlay');
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent = msg;
        overlay.classList.add('open');
        const yes = document.getElementById('confirmYes');
        const no = document.getElementById('confirmNo');
        const cleanup = val => {
            overlay.classList.remove('open');
            yes.removeEventListener('click', onYes);
            no.removeEventListener('click', onNo);
            resolve(val);
        };
        const onYes = () => cleanup(true);
        const onNo = () => cleanup(false);
        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
    });
}

// ── RENDER ────────────────────────────────────────────
function renderApp() { renderYearTabs(); }

function renderYearTabs() {
    const nav = document.getElementById('yearTabsNav');
    const panels = document.getElementById('yearPanels');
    nav.innerHTML = panels.innerHTML = '';

    YEARS.forEach(year => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${year.id === state.activeYear ? 'active' : ''}`;
        btn.textContent = year.label;
        btn.id = `yearbtn-${year.id}`;
        btn.onclick = () => { state.activeYear = year.id;
            renderYearTabs(); };
        nav.appendChild(btn);

        const panel = document.createElement('div');
        panel.className = `year-panel ${year.id === state.activeYear ? 'active' : ''}`;
        panel.id = `yearpanel-${year.id}`;
        panel.innerHTML = renderSemesterTabs(year);
        panels.appendChild(panel);
    });
}

function renderSemesterTabs(year) {
    if (!state.activeSem[year.id]) state.activeSem[year.id] = year.semesters[0].id;
    const active = state.activeSem[year.id];
    let html = `<div class="semester-tabs-wrapper"><div class="sem-tabs-nav">`;
    year.semesters.forEach(sem => {
                const cnt = getFilesInSem(sem.id).length;
                html += `<button class="sem-tab-btn ${sem.id===active?'active':''}"
      onclick="switchSem('${year.id}','${sem.id}')" id="sembtn-${sem.id}">
      ${sem.label}${cnt>0?` <span style="font-size:.7rem;color:var(--accent-primary);margin-left:4px;">${cnt}</span>`:''}
    </button>`;
  });
  html += `</div></div>`;
  year.semesters.forEach(sem => {
    html += `<div class="sem-panel ${sem.id===active?'active':''}" id="sempanel-${sem.id}">
      ${renderSubjectArea(sem.id)}
    </div>`;
  });
  return html;
}

function switchSem(yearId, semId) {
  state.activeSem[yearId] = semId;
  const year  = YEARS.find(y => y.id === yearId);
  const panel = document.getElementById(`yearpanel-${yearId}`);
  if (panel) panel.innerHTML = renderSemesterTabs(year);
}

function renderSubjectArea(semId) {
  const subjects = getSubjects(semId);
  if (!state.activeSubject[semId] && subjects[0]) state.activeSubject[semId] = subjects[0];
  const active = state.activeSubject[semId] || null;

  let html = `<div class="subject-area" id="subjectarea-${semId}">
    <div class="subject-tabs-header" id="subjtabs-${semId}">`;

  subjects.forEach(subj => {
    const cnt = getFiles(semId, subj).length;
    html += `<div class="subject-tab-wrapper">
      <button class="subject-tab-btn ${subj===active?'active':''}"
        onclick="switchSubject('${semId}','${escAttr(subj)}')"
        id="subjtab-${semId}-${escId(subj)}">
        <span>${escHtml(subj)}</span>
        <span class="file-count">${cnt}</span>
      </button>
      <button class="subject-delete-btn" title="Delete subject"
        onclick="deleteSubject('${semId}','${escAttr(subj)}')">✕</button>
    </div>`;
  });

  html += `<button class="add-subject-btn" onclick="openAddSubjectModal('${semId}')">
    <span>＋</span> Add Subject
  </button></div>`;

  if (subjects.length === 0) {
    html += `<div class="no-subject-state">
      <div class="icon">📚</div>
      <h3>No subjects yet</h3>
      <p>${isAdmin ? 'Click "Add Subject" above to get started.' : 'No subjects have been added yet.'}</p>
    </div>`;
  } else {
    subjects.forEach(subj => {
      html += `<div class="subject-panel ${subj===active?'active':''}"
        id="subjpanel-${semId}-${escId(subj)}">
        ${renderSubjectPanel(semId, subj)}
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

function renderSubjectPanel(semId, subject) {
  const files = getFiles(semId, subject);
  return `
    <div class="sem-stats">
      <div class="stat-chip">📁 <strong>${files.length}</strong> file${files.length!==1?'s':''}</div>
      <div class="stat-chip">📚 <strong>${escHtml(subject)}</strong></div>
    </div>
    <div class="search-wrapper">
      <span class="search-icon">🔍</span>
      <input type="text" class="search-input"
        placeholder="Search files in ${escHtml(subject)}..."
        oninput="searchFiles(this,'${semId}','${escAttr(subject)}')" />
    </div>
    <div id="filecontent-${semId}-${escId(subject)}">
      ${renderCategoryBlocks(semId, subject, files)}
    </div>`;
}

function renderCategoryBlocks(semId, subject, files, q='') {
  let html = '';
  CATEGORIES.forEach(cat => {
    let catFiles = files.filter(f => f.category === cat.id);
    if (q) catFiles = catFiles.filter(f =>
      f.name.toLowerCase().includes(q.toLowerCase()) ||
      (f.desc||'').toLowerCase().includes(q.toLowerCase())
    );
    const cc        = getCatClass(cat.id);
    const collapsed = catFiles.length === 0 ? 'collapsed' : '';
    html += `<div class="category-section cat-${cc} ${collapsed}">
      <div class="category-header" onclick="toggleCategory(this.parentElement)">
        <div class="category-title">
          <div class="category-icon">${cat.icon}</div>${cat.label}
        </div>
        <div class="category-meta">
          <span class="cat-count">${catFiles.length} file${catFiles.length!==1?'s':''}</span>
          <span class="cat-toggle">▼</span>
        </div>
      </div>
      <div class="category-body">`;
    if (catFiles.length === 0) {
      html += `<div class="empty-state">
        <div class="empty-icon">${cat.icon}</div>
        <h4>No ${cat.label} yet</h4>
        <p>${isAdmin?'Upload files using the ＋ button.':'Nothing uploaded here yet.'}</p>
      </div>`;
    } else {
      html += `<div class="files-grid">`;
      catFiles.forEach(f => { html += renderFileCard(f, semId, subject); });
      html += `</div>`;
    }
    html += `</div></div>`;
  });
  return html;
}

function renderFileCard(f, semId, subject) {
  const cc    = getCatClass(f.category);
  const emoji = getFileEmoji(f.mimeType || f.name);
  return `<div class="file-card" id="filecard-${f.id}">
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="file-icon-wrapper">${emoji}</div>
      <div class="file-info">
        <div class="file-name" title="${escAttr(f.name)}">${escHtml(f.name)}</div>
        <div class="file-meta">
          <span class="type-badge badge-${cc}">${escHtml(f.category)}</span>
          ${f.size?`<span class="file-size-badge">${formatSize(f.size)}</span>`:''}
        </div>
      </div>
    </div>
    ${f.desc?`<div style="font-size:.78rem;color:var(--text-muted);line-height:1.5;">${escHtml(f.desc)}</div>`:''}
    <div style="font-size:.72rem;color:var(--text-muted);">📅 ${formatDate(f.date)}</div>
    <div class="file-actions">
      <button class="btn-download" onclick="downloadFile('${f.id}','${escAttr(f.name)}')">
        ⬇ Download
      </button>
      <button class="btn-admin-action delete" title="Delete"
        onclick="deleteFile('${f.id}','${semId}','${escAttr(subject)}')">🗑</button>
    </div>
  </div>`;
}

function toggleCategory(section) { section.classList.toggle('collapsed'); }

// ── NAVIGATION ────────────────────────────────────────
function switchSubject(semId, subject) {
  state.activeSubject[semId] = subject;
  const wrapper = document.getElementById(`subjectarea-${semId}`);
  if (!wrapper) return;
  wrapper.querySelectorAll('.subject-tab-btn').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById(`subjtab-${semId}-${escId(subject)}`);
  if (tab) tab.classList.add('active');
  wrapper.querySelectorAll('.subject-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`subjpanel-${semId}-${escId(subject)}`);
  if (panel) panel.classList.add('active');
}

// ── SEARCH ────────────────────────────────────────────
function searchFiles(input, semId, subject) {
  const q    = input.value.trim();
  const cont = document.getElementById(`filecontent-${semId}-${escId(subject)}`);
  if (cont) cont.innerHTML = renderCategoryBlocks(semId, subject, getFiles(semId, subject), q);
}

// ── ADD SUBJECT ───────────────────────────────────────
let currentAddSubjectSemId = null;

function openAddSubjectModal(semId) {
  currentAddSubjectSemId = semId;
  document.getElementById('addSubjectInput').value = '';
  openModal('addSubjectModal');
}

async function submitAddSubject() {
  const name  = document.getElementById('addSubjectInput').value.trim();
  if (!name)  { toast('Please enter a subject name', 'error'); return; }
  const semId = currentAddSubjectSemId;

  if ((state.subjects[semId]||[]).includes(name)) { toast('Subject already exists', 'error'); return; }

  try {
    await apiPost('/api/subject', { semId, name });
    if (!state.subjects[semId]) state.subjects[semId] = [];
    state.subjects[semId].push(name);
    state.activeSubject[semId] = name;
    closeModal('addSubjectModal');
    toast(`Subject "${name}" added!`);
    refreshSemArea(semId);
  } catch(e) {
    toast('Failed to add subject: ' + e.message, 'error');
  }
}

async function deleteSubject(semId, subject) {
  const ok = await confirmDialog('Delete Subject', `Delete "${subject}"? All files inside will be permanently deleted from the server.`);
  if (!ok) return;
  try {
    await apiDelete(`/api/subject/${semId}/${encodeURIComponent(subject)}`);
    state.files        = state.files.filter(f => !(f.semId===semId && f.subject===subject));
    state.subjects[semId] = (state.subjects[semId]||[]).filter(s => s!==subject);
    if (state.activeSubject[semId]===subject)
      state.activeSubject[semId] = state.subjects[semId][0] || null;
    toast(`Subject "${subject}" deleted.`, 'info');
    refreshSemArea(semId);
  } catch(e) {
    toast('Failed to delete subject: ' + e.message, 'error');
  }
}

// ── UPLOAD ────────────────────────────────────────────
let currentUploadSemId = null;
let selectedFiles      = [];

function openUploadModal() {
  const year = YEARS.find(y => y.id === state.activeYear);
  if (!year) return;
  currentUploadSemId = state.activeSem[year.id] || year.semesters[0].id;
  const subjects = getSubjects(currentUploadSemId);
  if (!subjects.length) { toast('Add at least one subject first!', 'warning'); return; }

  const sel = document.getElementById('uploadSubjectSelect');
  sel.innerHTML = subjects.map(s => `<option value="${escAttr(s)}">${escHtml(s)}</option>`).join('');
  if (state.activeSubject[currentUploadSemId]) sel.value = state.activeSubject[currentUploadSemId];

  selectedFiles = [];
  document.getElementById('uploadDesc').value             = '';
  document.getElementById('uploadCategorySelect').value   = 'Assignment';
  document.getElementById('uploadProgress').classList.remove('active');
  renderSelectedFiles();
  openModal('uploadModal');
}

function handleFilesDrop(input) {
  selectedFiles.push(...Array.from(input.files));
  renderSelectedFiles();
  input.value = '';
}
function renderSelectedFiles() {
  const c = document.getElementById('selectedFilesList');
  if (!selectedFiles.length) { c.innerHTML = ''; return; }
  c.innerHTML = selectedFiles.map((f,i) => `
    <div class="selected-file-item">
      <span>${getFileEmoji(f.type || f.name)}</span>
      <span class="sf-name">${escHtml(f.name)}</span>
      <span style="color:var(--text-muted);font-size:.7rem;">${formatSize(f.size)}</span>
      <button onclick="removeSelectedFile(${i})"
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.8rem;padding:0;">✕</button>
    </div>`).join('');
}
function removeSelectedFile(idx) { selectedFiles.splice(idx,1); renderSelectedFiles(); }

async function submitUpload() {
  if (!selectedFiles.length) { toast('Please select at least one file','error'); return; }

  const subject  = document.getElementById('uploadSubjectSelect').value;
  const category = document.getElementById('uploadCategorySelect').value;
  const desc     = document.getElementById('uploadDesc').value.trim();
  const semId    = currentUploadSemId;
  const btn      = document.getElementById('uploadSubmitBtn');
  const progress = document.getElementById('uploadProgress');
  const bar      = document.getElementById('uploadProgressBar');
  const pText    = document.getElementById('uploadProgressText');

  btn.disabled   = true;
  btn.innerHTML  = `<span class="loading-spinner"></span> Uploading...`;
  progress.classList.add('active');

  let uploaded = 0;
  for (let i=0; i<selectedFiles.length; i++) {
    const file = selectedFiles[i];
    bar.style.width   = Math.round(((i+.5)/selectedFiles.length)*100) + '%';
    pText.textContent = `Uploading ${i+1} of ${selectedFiles.length}: ${file.name}`;
    try {
      const result = await apiUploadFile(file, semId, subject, category, desc);
      // Add to local state so UI updates immediately
      state.files.push({
        id      : result.id,
        name    : file.name,
        semId, subject, category,
        size    : file.size,
        mimeType: file.type,
        date    : new Date().toISOString(),
        desc,
      });
      uploaded++;
    } catch(e) {
      toast(`Failed to upload "${file.name}": ${e.message}`, 'error');
    }
  }

  bar.style.width   = '100%';
  pText.textContent = `${uploaded} of ${selectedFiles.length} uploaded!`;

  setTimeout(() => {
    closeModal('uploadModal');
    if (uploaded > 0) toast(`${uploaded} file(s) saved permanently to server! 🎉`);
    btn.disabled  = false;
    btn.innerHTML = '⬆ Upload Files';
    state.activeSubject[semId] = subject;
    refreshSemArea(semId);
  }, 600);
}

// ── DELETE FILE ───────────────────────────────────────
async function deleteFile(fileId, semId, subject) {
  const ok = await confirmDialog('Delete File', 'Permanently delete this file from the server? Cannot be undone.');
  if (!ok) return;
  try {
    await apiDelete(`/api/file/${fileId}`);
    state.files = state.files.filter(f => f.id !== fileId);
    toast('File deleted from server.', 'info');
    refreshSemArea(semId);
  } catch(e) {
    toast('Failed to delete: ' + e.message, 'error');
  }
}

// ── DOWNLOAD FILE ─────────────────────────────────────
function downloadFile(fileId, fileName) {
  // Direct link to server — browser handles the download natively
  const a = document.createElement('a');
  a.href     = `/api/download/${fileId}`;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 500);
  toast(`Downloading "${fileName}"...`, 'info');
}

// ── REFRESH ───────────────────────────────────────────
function refreshSemArea(semId) {
  const panel = document.getElementById(`sempanel-${semId}`);
  if (panel) panel.innerHTML = renderSubjectArea(semId);
  const year = YEARS.find(y => y.semesters.some(s => s.id===semId));
  if (year) {
    const yp = document.getElementById(`yearpanel-${year.id}`);
    if (yp) yp.innerHTML = renderSemesterTabs(year);
  }
}

// ── MODALS ────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open');    }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay'))
    e.target.classList.remove('open');
});

// ── XSS HELPERS ───────────────────────────────────────
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str||''));
  return d.innerHTML;
}
function escAttr(str) { return (str||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function escId(str)   { return (str||'').replace(/[^a-zA-Z0-9]/g,'_'); }

// ── DRAG & DROP ───────────────────────────────────────
function initDropzone() {
  const zone = document.getElementById('fileDropzone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    selectedFiles.push(...Array.from(e.dataTransfer.files));
    renderSelectedFiles();
  });
}

// ── KEYBOARD ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key==='Escape')
    document.querySelectorAll('.modal-overlay.open,.confirm-overlay.open')
            .forEach(el => el.classList.remove('open'));
});

// ── INIT ─────────────────────────────────────────────
async function init() {
  // Apply saved theme
  const savedTheme = localStorage.getItem('ecevault_theme') || 'dark';
  applyTheme(savedTheme);

  // Show loading state
  document.getElementById('yearPanels').innerHTML =
    `<div style="text-align:center;padding:4rem;color:var(--text-muted);">
       <div class="loading-spinner" style="width:32px;height:32px;margin:0 auto 1rem;border-width:3px;"></div>
       <p>Loading resources...</p>
     </div>`;

  try {
    await loadFromServer();
  } catch(e) {
    console.error('Failed to load data:', e);
    document.getElementById('yearPanels').innerHTML =
      `<div style="text-align:center;padding:4rem;color:#ef4444;">
         <div style="font-size:2rem;margin-bottom:.5rem;">⚠️</div>
         <p>Could not connect to server. Make sure <strong>node server.js</strong> is running.</p>
       </div>`;
    return;
  }

// Restore admin session from the server
try {
  const session = await apiGet('/api/admin/session');

  isAdmin = session.authenticated === true;

  if (isAdmin) {
    document.body.classList.add('admin-mode');
  } else {
    document.body.classList.remove('admin-mode');
  }
} catch (e) {
  console.error('Could not verify admin session:', e);
  isAdmin = false;
  document.body.classList.remove('admin-mode');
}
  renderApp();
  initDropzone();
}

window.addEventListener('DOMContentLoaded', init);