// ═══════════════════════════════════════════════════════════════════
//  BossBot · X — Dashboard App
// ═══════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;

// ─── Auth State ──────────────────────────────────────────────────────────────
let authToken = sessionStorage.getItem('bbx_token') || null;
let authRole  = sessionStorage.getItem('bbx_role')  || null;

function apiHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` };
}

// ─── Dashboard State ─────────────────────────────────────────────────────────
let allPredictions = [];
let currentFilter  = 'all';
let currentWorld   = 'Quelibra';

// ─── Multi-city boss list (kept in sync with server) ─────────────────────────
const MULTI_CITY_KEYS = new Set([
    "rotworm queen", "the voice of ruin", "flamecaller zazrak", "tyrn",
    "dreadmaw", "white pale", "hirintror", "battlemaster zunzu",
    "fleabringer", "albino dragon"
]);

function getBaseName(bossName) {
    return bossName.replace(/\s*\(.*?\)\s*/g, '').trim();
}

function isMultiCity(bossName) {
    return MULTI_CITY_KEYS.has(getBaseName(bossName).toLowerCase());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDateBR(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatSpawnRange(minDays, maxDays) {
    if (!minDays && !maxDays) return 'Indefinida';
    if (minDays === maxDays) return `A cada ${minDays} dia${minDays !== 1 ? 's' : ''}`;
    return `${minDays} a ${maxDays} dias`;
}

// ═══ AUTH ════════════════════════════════════════════════════════════════════

async function initAuth() {
    if (!authToken) { showLoginScreen(); return; }
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { headers: apiHeaders() });
        if (!res.ok) { clearAuth(); showLoginScreen(); return; }
        const data = await res.json();
        authRole = data.role;
        sessionStorage.setItem('bbx_role', authRole);
        showDashboard();
    } catch { clearAuth(); showLoginScreen(); }
}

function showLoginScreen() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('mainDashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'block';
    if (authRole === 'admin') {
        document.getElementById('adminBtn').style.display = 'flex';
    }
    loadPredictions();
}

function clearAuth() {
    authToken = null; authRole = null;
    sessionStorage.removeItem('bbx_token');
    sessionStorage.removeItem('bbx_role');
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Erro ao fazer login.'; return; }
        authToken = data.token;
        authRole  = data.role;
        sessionStorage.setItem('bbx_token', authToken);
        sessionStorage.setItem('bbx_role', authRole);
        showDashboard();
    } catch { errEl.textContent = 'Erro de conexão com o servidor.'; }
    finally { btn.disabled = false; btn.textContent = 'Entrar'; }
}

async function handleLogout() {
    try { await fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: apiHeaders() }); } catch {}
    clearAuth();
    allPredictions = [];
    document.getElementById('adminBtn').style.display = 'none';
    showLoginScreen();
}

// ═══ BOSS GROUPING ═══════════════════════════════════════════════════════════

function groupPredictions(predictions) {
    const groups  = new Map(); // baseName -> [cityData...]
    const ordered = [];       // preserves sort order

    for (const p of predictions) {
        const base = getBaseName(p.name);
        if (isMultiCity(p.name)) {
            if (!groups.has(base)) {
                groups.set(base, []);
                ordered.push({ type: 'group', baseName: base });
            }
            groups.get(base).push(p);
        } else {
            ordered.push({ type: 'single', data: p });
        }
    }

    // Build final list with merged group data
    return ordered.map(entry => {
        if (entry.type === 'single') return entry;
        const cities = groups.get(entry.baseName) || [];
        if (cities.length === 1) {
            return { type: 'single', data: cities[0] };
        }
        const bestChance = Math.max(...cities.map(c =>
            Math.max(c.chance_percent, c.tibiadata_chance_percent ?? 0)
        ));
        const bestCity = cities.find(c =>
            Math.max(c.chance_percent, c.tibiadata_chance_percent ?? 0) === bestChance
        );
        return {
            type: 'group',
            baseName: entry.baseName,
            cities,
            chance_percent: bestChance,
            tibiadata_chance_percent: null,
            status: bestCity?.status || 'Aguardando',
            kills_yesterday: cities.reduce((s, c) => s + (c.kills_yesterday || 0), 0),
            // representative data for display
            hp: cities[0]?.hp,
            immunities: cities[0]?.immunities,
            min_days: cities[0]?.min_days,
            max_days: cities[0]?.max_days,
        };
    });
}

// ═══ DATA LOADING ════════════════════════════════════════════════════════════

async function loadPredictions() {
    const grid = document.getElementById('bossGrid');
    const worldNameEl = document.getElementById('worldName');
    grid.innerHTML = `<div class="loader-wrapper"><div class="spinner"></div><p class="loader-text">Consultando arquivos do banco de dados...</p></div>`;

    try {
        const cfgRes = await fetch(`${API_BASE}/api/config`);
        if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            currentWorld = cfg.defaultWorld || currentWorld;
        }

        const response = await fetch(`${API_BASE}/api/bosses/${encodeURIComponent(currentWorld)}`, {
            headers: apiHeaders()
        });
        if (response.status === 401) { clearAuth(); showLoginScreen(); return; }
        if (!response.ok) throw new Error('Falha na resposta do servidor.');

        const data = await response.json();
        allPredictions = data.bosses || [];
        worldNameEl.innerText = data.world || currentWorld;
        renderGrid();
    } catch (err) {
        console.error(err);
        grid.innerHTML = `<div class="loader-wrapper"><p class="loader-text" style="color:var(--color-hot)">Erro ao carregar dados. Verifique a conexão com o servidor.</p></div>`;
    }
}

// ═══ CATEGORY HELPERS ════════════════════════════════════════════════════════

function getGroupCategory(p) {
    if (!p.total_kills && p.type !== 'group') return 'none';
    if (p.chance_percent >= 90) return 'hot';
    if (p.chance_percent >= 50) return 'high';
    return 'wait';
}

function getTibiaCategory(p) {
    if (p.tibiadata_chance_percent === null || p.tibiadata_chance_percent === undefined) return null;
    if (p.tibiadata_chance_percent >= 90) return 'hot';
    if (p.tibiadata_chance_percent >= 50) return 'high';
    return 'wait';
}

function getCategory(p) {
    const g = getGroupCategory(p);
    const t = getTibiaCategory(p);
    if (!t) return g;
    const order = ['none', 'wait', 'high', 'hot'];
    return order.indexOf(g) >= order.indexOf(t) ? g : t;
}

// ═══ RENDER GRID ════════════════════════════════════════════════════════════

function renderGrid() {
    const grid = document.getElementById('bossGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();
    let filtered = allPredictions;

    if (currentFilter === 'hot')    filtered = allPredictions.filter(p => p.chance_percent >= 90 || p.tibiadata_chance_percent >= 90);
    else if (currentFilter === 'high')   filtered = allPredictions.filter(p =>
        (p.chance_percent >= 50 && p.chance_percent < 90) ||
        (p.tibiadata_chance_percent != null && p.tibiadata_chance_percent >= 50 && p.tibiadata_chance_percent < 90)
    );
    else if (currentFilter === 'recent') filtered = allPredictions.filter(p => p.kills_yesterday > 0);

    if (searchQuery) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery));
    }

    const grouped = groupPredictions(filtered);

    if (grouped.length === 0) {
        grid.innerHTML = `<div class="loader-wrapper"><p class="loader-text">Nenhum boss encontrado com os critérios atuais.</p></div>`;
        return;
    }

    grouped.forEach(entry => {
        if (entry.type === 'single') {
            renderSingleCard(grid, entry.data);
        } else {
            renderGroupCard(grid, entry);
        }
    });
}

function renderSingleCard(grid, p) {
    const cat = getCategory(p);
    const groupCat = getGroupCategory(p);
    const tibiaCat = getTibiaCategory(p);
    const sameChance = tibiaCat !== null && p.chance_percent === p.tibiadata_chance_percent;

    let predRows = '';
    if (sameChance || tibiaCat === null) {
        const label = tibiaCat !== null ? '👥📡' : '👥';
        predRows = `<div class="pred-row">${label} <span class="chance-value color-${groupCat}">${p.chance_percent}%</span></div>`;
    } else {
        predRows = `
            <div class="pred-row">👥 <span class="chance-value color-${groupCat}">${p.chance_percent}%</span></div>
            <div class="pred-row">📡 <span class="chance-value color-${tibiaCat}">${p.tibiadata_chance_percent}%</span></div>`;
    }

    const adminActions = authRole === 'admin' ? `
        <div class="card-admin-actions" onclick="event.stopPropagation()">
            <button class="btn-card-edit" style="width:auto; padding:0 8px; font-weight:700;" onclick='openEditModal(${JSON.stringify(p).replace(/'/g, "&apos;")})' title="Editar Boss">⚙️ Editar</button>
        </div>` : '';

    const col = document.createElement('div');
    col.className = 'boss-card-col';
    col.innerHTML = `
        <div class="boss-card category-${cat}" onclick='openModal(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
            ${adminActions}
            <div class="img-container">
                <img src="/assets/bosses/${encodeURIComponent(getBaseName(p.name))}.webp"
                     onerror="this.onerror=null;this.src='/assets/bosses/${encodeURIComponent(getBaseName(p.name))}.gif'"
                     class="boss-sprite" alt="${p.name}">
            </div>
            <h3 class="boss-name" title="${p.name}">${p.name}</h3>
            ${predRows}
            <div class="p-bar-track">
                <div class="p-bar-fill" style="width:${Math.max(p.chance_percent, p.tibiadata_chance_percent ?? 0)}%"></div>
            </div>
            <div class="tags-row">
                ${p.kills_yesterday > 0 ? `<span class="tag-badge badge-danger">${p.kills_yesterday} Kill${p.kills_yesterday !== 1 ? 's' : ''}</span>` : ''}
                <span class="tag-badge">${p.status}</span>
            </div>
        </div>`;
    grid.appendChild(col);
}

function renderGroupCard(grid, entry) {
    const cat = entry.chance_percent >= 90 ? 'hot' : entry.chance_percent >= 50 ? 'high' : 'wait';
    const col = document.createElement('div');
    col.className = 'boss-card-col';
    const baseName = entry.baseName;

    // City chips for card preview
    const cityChips = entry.cities.map(c => {
        const city = c.name.match(/\((.+?)\)/)?.[1] || '';
        const cc = c.chance_percent >= 90 ? 'hot' : c.chance_percent >= 50 ? 'high' : 'wait';
        return `<span class="city-chip color-${cc}">${city} ${c.chance_percent}%</span>`;
    }).join('');

    const adminActions = authRole === 'admin' ? `
        <div class="card-admin-actions" onclick="event.stopPropagation()">
            <button class="btn-card-edit" style="width:auto; padding:0 8px; font-weight:700;" onclick="openEditModal({name: '${baseName}'})" title="Editar Grupo">⚙️ Editar</button>
        </div>` : '';

    col.innerHTML = `
        <div class="boss-card category-${cat} boss-card-group" onclick='openGroupModal(${JSON.stringify(entry).replace(/'/g, "&apos;")})'>
            ${adminActions}
            <div class="img-container">
                <img src="/assets/bosses/${encodeURIComponent(baseName)}.webp"
                     onerror="this.onerror=null;this.src='/assets/bosses/${encodeURIComponent(baseName)}.gif'"
                     class="boss-sprite" alt="${baseName}">
            </div>
            <h3 class="boss-name" title="${baseName}">${baseName}</h3>
            <div class="pred-row">👥 <span class="chance-value color-${cat}">${entry.chance_percent}%</span> <span class="city-count">·${entry.cities.length} locais</span></div>
            <div class="p-bar-track">
                <div class="p-bar-fill" style="width:${entry.chance_percent}%"></div>
            </div>
            <div class="city-chips-row">${cityChips}</div>
            <div class="tags-row">
                ${entry.kills_yesterday > 0 ? `<span class="tag-badge badge-danger">${entry.kills_yesterday} Kill${entry.kills_yesterday !== 1 ? 's' : ''}</span>` : ''}
                <span class="tag-badge">${entry.status}</span>
            </div>
        </div>`;
    grid.appendChild(col);
}

// ═══ SEARCH & FILTER ════════════════════════════════════════════════════════

document.getElementById('searchInput').addEventListener('keyup', renderGrid);

document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        renderGrid();
    });
});

// ═══ SYNC ════════════════════════════════════════════════════════════════════

async function forceSync() {
    const btn = document.getElementById('syncBtn');
    const icon = btn.querySelector('.sync-icon');
    const label = document.getElementById('syncLabel');
    btn.disabled = true;
    icon.classList.add('rotating');
    label.innerText = 'Sincronizando...';
    try {
        await fetch(`${API_BASE}/api/fetch/${encodeURIComponent(currentWorld)}`, { method: 'POST', headers: apiHeaders() });
        await new Promise(r => setTimeout(r, 2000));
        await loadPredictions();
    } catch (err) { console.error(err); }
    finally {
        btn.disabled = false;
        icon.classList.remove('rotating');
        label.innerText = 'Sincronizar';
    }
}

// ═══ MODAL — SINGLE BOSS ════════════════════════════════════════════════════

function populateModal(p) {
    const cat = getCategory(p);
    const groupCat = getGroupCategory(p);
    const cleanImgName = getBaseName(p.name);

    document.getElementById('modalImg').src = `/assets/bosses/${encodeURIComponent(cleanImgName)}.webp`;
    document.getElementById('modalImg').onerror = function() {
        this.onerror = null;
        this.src = `/assets/bosses/${encodeURIComponent(cleanImgName)}.gif`;
    };
    document.getElementById('modalName').innerText = p.name;

    const statusTag = document.getElementById('modalStatusTag');
    statusTag.innerText = p.status;
    statusTag.className = `status-badge status-${cat}`;

    document.getElementById('modalChanceVal').innerText = `${p.chance_percent}%`;
    document.getElementById('modalChanceVal').className = `metric-value color-${groupCat}`;

    // Dual prediction block
    const predBlock = document.getElementById('modalPredBlock');
    const tibiaCatModal = getTibiaCategory(p);
    const sameChance = tibiaCatModal !== null && p.chance_percent === p.tibiadata_chance_percent;
    if (sameChance) {
        predBlock.innerHTML = `
            <div class="dual-pred-row unified">
                <span class="pred-source">👥📡 Grupo &amp; TibiaData</span>
                <span class="pred-pct color-${groupCat}">${p.chance_percent}%</span>
                <span class="pred-status">${p.status}</span>
            </div>`;
    } else {
        let html = `
            <div class="dual-pred-row">
                <span class="pred-source">👥 Grupo</span>
                <span class="pred-pct color-${groupCat}">${p.chance_percent}%</span>
                <span class="pred-status">${p.status}</span>
            </div>`;
        if (tibiaCatModal !== null) {
            html += `
            <div class="dual-pred-row tibia">
                <span class="pred-source">📡 TibiaData</span>
                <span class="pred-pct color-${tibiaCatModal}">${p.tibiadata_chance_percent}%</span>
                <span class="pred-status">${p.tibiadata_status}</span>
            </div>`;
            if (p.tibiadata_min_date && p.tibiadata_max_date) {
                html += `<div class="dual-pred-window">📅 Janela TibiaData: ${formatDateBR(p.tibiadata_min_date)} – ${formatDateBR(p.tibiadata_max_date)}</div>`;
            }
        }
        predBlock.innerHTML = html;
    }

    // Last kill
    if (p.last_seen) {
        let s = formatDateBR(p.last_seen);
        if (p.seen_at_full) s += ` às ${p.seen_at_full.split(' ')[1]}`;
        document.getElementById('modalLastKillVal').innerText = s;
    } else {
        document.getElementById('modalLastKillVal').innerText = '—';
    }

    document.getElementById('modalDaysSinceVal').innerText = p.days_since !== null ? `${p.days_since}d` : '—';
    document.getElementById('modalTotalKillsVal').innerText = p.total_kills || 0;

    // Attributes
    document.getElementById('modalHPVal').innerText = p.hp || '?';
    const activeImm = (p.immunities || []).filter(i => i !== 'Paralisia' && i !== 'Invisibilidade');
    document.getElementById('modalImmunitiesVal').innerText = activeImm.length > 0 ? activeImm.join(', ') : 'Nenhuma';

    // Spawn range
    document.getElementById('modalFreqVal').innerText = formatSpawnRange(p.min_days, p.max_days);
    if (p.max_days) {
        const daysLeft = p.max_days - (p.days_since || 0);
        if (daysLeft > 0)      document.getElementById('modalWindowVal').innerText = `Daqui ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`;
        else if (daysLeft === 0) document.getElementById('modalWindowVal').innerText = 'Hoje!';
        else                   document.getElementById('modalWindowVal').innerText = `Atrasado há ${Math.abs(daysLeft)}d`;
    } else {
        document.getElementById('modalWindowVal').innerText = 'Necessita de avistamento';
    }

    // Map
    const mapSection = document.getElementById('modalMapSection');
    const mapIframe = document.getElementById('modalMapIframe');
    if (p.map_link) {
        mapIframe.src = p.map_link;
        mapSection.style.display = 'block';
    } else {
        mapIframe.src = '';
        mapSection.style.display = 'none';
    }

    render7DayHistory(p);
}

async function openModal(p) {
    const overlay = document.getElementById('bossModalOverlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Hide city tabs for single boss
    document.getElementById('modalCityTabs').style.display = 'none';

    populateModal(p);

    // Full history
    const historyList = document.getElementById('fullHistoryList');
    historyList.innerHTML = '<span class="loader-text">Carregando histórico...</span>';
    try {
        const hRes = await fetch(`${API_BASE}/api/history/${encodeURIComponent(currentWorld)}/${encodeURIComponent(p.name)}`, { headers: apiHeaders() });
        if (hRes.ok) { const hData = await hRes.json(); renderFullHistoryList(hData.kills || []); }
        else historyList.innerHTML = '<span class="loader-text">Erro ao buscar histórico.</span>';
    } catch { historyList.innerHTML = '<span class="loader-text">Erro de conexão.</span>'; }
}

// ═══ MODAL — GROUP BOSS (multi-local) ═══════════════════════════════════════

async function openGroupModal(entry) {
    const overlay = document.getElementById('bossModalOverlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Build city tabs
    const tabsEl = document.getElementById('modalCityTabs');
    tabsEl.style.display = 'flex';
    tabsEl.innerHTML = entry.cities.map((c, i) => {
        const city = c.name.match(/\((.+?)\)/)?.[1] || c.name;
        const cc = c.chance_percent >= 90 ? 'hot' : c.chance_percent >= 50 ? 'high' : 'wait';
        return `<button class="city-tab ${i === 0 ? 'active' : ''} tab-color-${cc}"
            onclick="switchCityTab(${i}, this, event)">${city}</button>`;
    }).join('');

    // Load first city
    await loadCityTab(entry, 0);
}

async function switchCityTab(cityIndex, btn, e) {
    e.stopPropagation();
    document.querySelectorAll('#modalCityTabs .city-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Get entry from current render state — re-read from DOM data attr
    const entry = JSON.parse(btn.closest('#modalCityTabs').dataset.entry);
    await loadCityTab(entry, cityIndex);
}

async function loadCityTab(entry, cityIndex) {
    // Store entry in DOM for switchCityTab
    document.getElementById('modalCityTabs').dataset.entry = JSON.stringify(entry);

    const p = entry.cities[cityIndex];
    populateModal(p);

    const historyList = document.getElementById('fullHistoryList');
    historyList.innerHTML = '<span class="loader-text">Carregando histórico...</span>';
    try {
        const hRes = await fetch(`${API_BASE}/api/history/${encodeURIComponent(currentWorld)}/${encodeURIComponent(p.name)}`, { headers: apiHeaders() });
        if (hRes.ok) { const hData = await hRes.json(); renderFullHistoryList(hData.kills || []); }
        else historyList.innerHTML = '<span class="loader-text">Erro ao buscar histórico.</span>';
    } catch { historyList.innerHTML = '<span class="loader-text">Erro de conexão.</span>'; }
}

function closeModal() {
    document.getElementById('bossModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('modalMapIframe').src = '';
}

// ═══ 7-DAY HISTORY ══════════════════════════════════════════════════════════

function render7DayHistory(p) {
    const grid = document.getElementById('history7dGrid');
    grid.innerHTML = '';
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const label = i === 0 ? 'Hoje' : i === 1 ? 'Ontem' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }).replace('.', '');
        const killed = p.kills_yesterday > 0 && i === 1;
        const cell = document.createElement('div');
        cell.className = `history-day-cell${killed ? ' killed' : ''}`;
        cell.innerHTML = `
            <span class="history-day-label">${label}</span>
            <span class="history-day-icon">
                ${killed ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19v-2a4 4 0 0 1 8 0v2M12 11h.01M9 11h.01M15 11h.01M8 15h8"></path><rect x="2" y="2" width="20" height="8" rx="2"></rect></svg>`
                : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle></svg>`}
            </span>
            <span class="history-day-count">${killed ? `${p.kills_yesterday}x` : '—'}</span>`;
        grid.appendChild(cell);
    }
}

// ═══ FULL HISTORY ════════════════════════════════════════════════════════════

function renderFullHistoryList(kills) {
    const list = document.getElementById('fullHistoryList');
    if (!kills || kills.length === 0) {
        list.innerHTML = '<span class="loader-text" style="opacity:0.5">Nenhuma morte registrada.</span>';
        return;
    }
    const sorted = [...kills].sort((a, b) => b.created_at.localeCompare(a.created_at));
    list.innerHTML = sorted.map(k => {
        const formattedDate = formatDateBR(k.kill_date);
        const timePart = k.created_at.split(' ')[1]?.substring(0, 5) || '';
        const displayDateTime = timePart ? `${formattedDate} ${timePart}` : formattedDate;
        
        let adminActions = '';
        if (authRole === 'admin') {
            const btnStyle = "background:transparent; border:none; cursor:pointer; font-size:16px; margin-left:8px;";
            adminActions = `
            <div style="display:flex; align-items:center;">
                <button style="${btnStyle}" onclick='openEditHistoryModal(${JSON.stringify(k).replace(/'/g, "&apos;")})' title="Editar Registro">✏️</button>
                <button style="${btnStyle}" onclick='deleteHistoryRecord(${k.id})' title="Excluir Registro">🗑️</button>
            </div>`;
        }

        return `
            <div class="history-list-item">
                <div class="history-item-left">
                    <span class="history-item-date">${displayDateTime}</span>
                    <span class="history-item-reporter">Confirmado por: ${k.confirmed_by}</span>
                </div>
                <div class="history-item-right" style="display:flex; align-items:center; gap:10px;" title="${k.extra_text || ''}">
                    <span>${k.extra_text || 'Sem detalhes.'}</span>
                    ${adminActions}
                </div>
            </div>`;
    }).join('');
}

let currentEditingHistoryId = null;

async function openEditHistoryModal(k) {
    currentEditingHistoryId = k.id;
    
    // Set date input
    const [datePart, timePart] = k.raw_created_at.split(' ');
    const utcDate = new Date(datePart + 'T' + timePart + 'Z');
    
    // Format to YYYY-MM-DDThh:mm
    const tzOffset = utcDate.getTimezoneOffset() * 60000;
    const localDate = new Date(utcDate.getTime() - tzOffset);
    const localISO = localDate.toISOString().slice(0, 16);
    
    document.getElementById('editHistoryDate').value = localISO;

    const citySection = document.getElementById('editHistoryCitySection');
    const citySelect = document.getElementById('editHistoryCity');
    citySelect.innerHTML = '';
    
    try {
        const res = await fetch(`${API_BASE}/api/boss-cities/${encodeURIComponent(k.boss_name)}`, { headers: apiHeaders() });
        const data = await res.json();
        
        if (data.cities && data.cities.length > 0) {
            citySection.style.display = 'block';
            let currentCity = '';
            const match = k.boss_name.match(/^(.+?)\s*\((.+?)\)$/);
            if (match) currentCity = match[2];
            
            data.cities.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                if (c === currentCity) opt.selected = true;
                citySelect.appendChild(opt);
            });
        } else {
            citySection.style.display = 'none';
        }
    } catch {
        citySection.style.display = 'none';
    }

    document.getElementById('editHistoryModalOverlay').classList.add('active');
}

function closeEditHistoryModal() {
    currentEditingHistoryId = null;
    document.getElementById('editHistoryModalOverlay').classList.remove('active');
}

async function saveHistoryRecord() {
    if (!currentEditingHistoryId) return;
    const datetime = document.getElementById('editHistoryDate').value;
    const citySection = document.getElementById('editHistoryCitySection');
    const city = citySection.style.display === 'block' ? document.getElementById('editHistoryCity').value : null;

    if (!datetime) {
        alert('Data/Hora inválida.');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/admin/edit-record/${currentEditingHistoryId}`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ datetime, city })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ ${data.message}`);
            closeEditHistoryModal();
            loadPredictions();
            closeModal();
        } else {
            alert(`❌ ${data.error}`);
        }
    } catch (err) {
        alert('Erro de conexão');
    }
}

async function deleteHistoryRecord(id) {
    if (!confirm('Tem certeza que deseja excluir permanentemente este registro de histórico? Isso recalculará as previsões.')) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/delete-record/${id}`, {
            method: 'DELETE',
            headers: apiHeaders()
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ ${data.message}`);
            loadPredictions();
            closeModal();
        } else {
            alert(`❌ ${data.error}`);
        }
    } catch (err) {
        alert('Erro de conexão');
    }
}

// ═══ ADMIN ACTIONS (INLINE) ═════════════════════════════════════════════════

async function promptAddBoss() {
    const name = prompt('Nome do novo boss a ser adicionado:');
    if (!name || !name.trim()) return;
    const res = await fetch(`${API_BASE}/api/admin/add-boss`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ name: name.trim() })
    });
    const data = await res.json();
    if (res.ok) { alert(`✅ "${name.trim()}" adicionado!`); loadPredictions(); }
    else { alert(`❌ ${data.error}`); }
}

// ═══ EDIT MODAL ═════════════════════════════════════════════════════════════

let currentEditingBoss = null;

function openEditModal(p) {
    currentEditingBoss = p.name;
    const baseName = getBaseName(p.name);
    document.getElementById('editModalName').innerText = p.name;
    const img = document.getElementById('editModalImg');
    img.src = `/assets/bosses/${encodeURIComponent(baseName)}.webp`;
    img.onerror = function() {
        this.onerror = null;
        this.src = `/assets/bosses/${encodeURIComponent(baseName)}.gif`;
    };
    
    document.getElementById('editNameInput').value = p.name;
    document.getElementById('editImgFileLabel').innerText = 'Selecionar e Enviar...';
    
    // Set default datetime to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('editManualDate').value = now.toISOString().slice(0, 16);
    
    const citySection = document.getElementById('editManualCitySection');
    const citySelect = document.getElementById('editManualCity');
    citySelect.innerHTML = '';
    
    fetch(`${API_BASE}/api/boss-cities/${encodeURIComponent(p.name)}`, { headers: apiHeaders() })
        .then(res => res.json())
        .then(data => {
            if (data.cities && data.cities.length > 0) {
                citySection.style.display = 'block';
                data.cities.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    citySelect.appendChild(opt);
                });
            } else {
                citySection.style.display = 'none';
            }
        })
        .catch(() => { citySection.style.display = 'none'; });
    
    document.getElementById('editModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeEditModal() {
    document.getElementById('editModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    currentEditingBoss = null;
}

async function saveEditName() {
    if (!currentEditingBoss) return;
    const oldName = currentEditingBoss;
    const newName = document.getElementById('editNameInput').value.trim();
    if (!newName || newName === oldName) return;
    
    if (!confirm(`Renomear "${oldName}" para "${newName}"? Esta ação migra todos os dados do banco.`)) return;
    const res = await fetch(`${API_BASE}/api/admin/rename-boss`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ oldName, newName })
    });
    const data = await res.json();
    if (res.ok) { 
        alert(`✅ ${data.message}`); 
        currentEditingBoss = newName;
        document.getElementById('editModalName').innerText = newName;
        loadPredictions(); 
    }
    else { alert(`❌ ${data.error}`); }
}

async function previewAndSaveEditImage(e) {
    if (!currentEditingBoss) return;
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('editImgFileLabel').innerText = 'Enviando...';
    
    const ext = file.name.split('.').pop();
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const imageData = ev.target.result;
        const res = await fetch(`${API_BASE}/api/admin/upload-image`, {
            method: 'POST', headers: apiHeaders(),
            body: JSON.stringify({ bossName: getBaseName(currentEditingBoss), imageData, extension: ext })
        });
        const data = await res.json();
        if (res.ok) { 
            alert(`✅ Imagem atualizada com sucesso!`);
            document.getElementById('editImgFileLabel').innerText = 'Selecionar e Enviar...';
            // Force refresh image cache
            document.getElementById('editModalImg').src = `${imageData}`;
            loadPredictions(); 
        }
        else { 
            alert(`❌ ${data.error}`);
            document.getElementById('editImgFileLabel').innerText = 'Erro ao enviar. Tente novamente.';
        }
    };
    reader.readAsDataURL(file);
}

async function saveManualRecord() {
    if (!currentEditingBoss) return;
    const datetime = document.getElementById('editManualDate').value;
    const type = document.getElementById('editManualType').value;
    
    if (!datetime) {
        alert('Selecione a data e hora do registro.');
        return;
    }
    
    let targetBoss = currentEditingBoss;
    const citySection = document.getElementById('editManualCitySection');
    if (citySection.style.display === 'block') {
        const city = document.getElementById('editManualCity').value;
        if (city) {
            targetBoss = `${currentEditingBoss} (${city})`;
        }
    }
    
    const res = await fetch(`${API_BASE}/api/admin/manual-record`, {
        method: 'POST', headers: apiHeaders(),
        body: JSON.stringify({ bossName: targetBoss, type, datetime, world: currentWorld })
    });
    const data = await res.json();
    if (res.ok) { 
        alert(data.message); 
        loadPredictions(); 
    }
    else { alert(`❌ ${data.error}`); }
}



// ═══ CALENDAR MODAL ═════════════════════════════════════════════════════════

let fullHistoryDataCache = []; // Caches the latest full history loaded

// Monkey patch renderFullHistoryList to cache the data
const originalRenderFullHistoryList = renderFullHistoryList;
renderFullHistoryList = function(kills) {
    fullHistoryDataCache = kills || [];
    originalRenderFullHistoryList(kills);
}

function openCalendarModal() {
    const container = document.getElementById('calendarContainer');
    container.innerHTML = '';
    
    if (fullHistoryDataCache.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); text-align:center;">Nenhum histórico disponível para exibir no calendário.</p>';
        document.getElementById('calendarModalOverlay').classList.add('active');
        return;
    }
    
    // Group kills by year and month
    const grouped = {};
    for (const k of fullHistoryDataCache) {
        // kill_date is YYYY-MM-DD
        const parts = k.kill_date.split('-');
        if (parts.length !== 3) continue;
        const year = parts[0];
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const isFlop = k.extra_text && k.extra_text.toLowerCase().includes('flop');
        
        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = {};
        
        // We can have multiple records in a day, store array
        if (!grouped[year][month][day]) grouped[year][month][day] = [];
        grouped[year][month][day].push({ ...k, isFlop });
    }
    
    const years = Object.keys(grouped).sort((a, b) => b - a); // Descending years
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    
    let html = '';
    
    for (const year of years) {
        html += `<div class="calendar-year-block"><h3>${year}</h3><div class="calendar-months-grid">`;
        
        const months = Object.keys(grouped[year]).map(m => parseInt(m, 10)).sort((a, b) => a - b);
        
        for (const month of months) {
            html += `<div class="calendar-month-card">
                        <div class="calendar-month-title">${monthNames[month-1]}</div>
                        <div class="calendar-days-grid">
                            ${renderCalendarDays(year, month, grouped[year][month])}
                        </div>
                     </div>`;
        }
        
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
    document.getElementById('calendarModalOverlay').classList.add('active');
}

function renderCalendarDays(year, month, daysData) {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(year, month, 0).getDate();
    
    let html = '';
    
    // Empty days before the 1st
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="calendar-day calendar-day-empty"></div>`;
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        if (daysData[day]) {
            // Find if there is a kill or a flop (prioritize kill visually)
            const hasKill = daysData[day].some(d => !d.isFlop);
            const hasFlop = daysData[day].some(d => d.isFlop);
            
            let cls = '';
            if (hasKill) cls = 'kill';
            else if (hasFlop) cls = 'flop';
            
            const titles = daysData[day].map(d => `${d.created_at} - ${d.isFlop ? 'Flop' : 'Kill'} (${d.confirmed_by})`).join('&#10;');
            
            html += `<div class="calendar-day ${cls}" title="${titles}">${day}</div>`;
        } else {
            html += `<div class="calendar-day">${day}</div>`;
        }
    }
    
    return html;
}

function closeCalendarModal() {
    document.getElementById('calendarModalOverlay').classList.remove('active');
}

// ═══ INIT ════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', initAuth);
setInterval(() => { if (authToken) loadPredictions(); }, 2 * 60 * 1000);
