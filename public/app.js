const API_BASE = window.location.origin;

let allPredictions = [];
let currentFilter = 'all';
let currentWorld = 'Quelibra';

// Format dynamic ISO Date to Brazilian format (DD/MM/AAAA)
function formatDateBR(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

async function loadPredictions() {
    const grid = document.getElementById('bossGrid');
    const worldNameEl = document.getElementById('worldName');

    try {
        // Fetch current target world
        const cfgRes = await fetch(`${API_BASE}/api/config`);
        if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            currentWorld = cfg.defaultWorld || currentWorld;
        }

        const response = await fetch(`${API_BASE}/api/bosses/${encodeURIComponent(currentWorld)}`);
        if (!response.ok) throw new Error('Falha na resposta do servidor.');

        const data = await response.json();
        allPredictions = data.bosses || [];
        worldNameEl.innerText = data.world || currentWorld;

        renderGrid();
    } catch (err) {
        console.error(err);
        grid.innerHTML = `<div class="loader-wrapper"><p class="loader-text" style="color: var(--color-hot)">Erro ao carregar dados do oráculo. Certifique-se de que o servidor está rodando.</p></div>`;
    }
}

function getGroupCategory(p) {
    if (!p.total_kills || p.last_seen === null) return 'none';
    if (p.chance_percent >= 90) return 'hot';
    if (p.chance_percent >= 50) return 'high';
    return 'wait';
}

function getTibiaCategory(p) {
    if (p.tibiadata_chance_percent === null) return null;
    if (p.tibiadata_chance_percent >= 90) return 'hot';
    if (p.tibiadata_chance_percent >= 50) return 'high';
    return 'wait';
}

// Primary category: best of group and tibia (for card color)
function getCategory(p) {
    const g = getGroupCategory(p);
    const t = getTibiaCategory(p);
    if (!t) return g;
    const order = ['none', 'wait', 'high', 'hot'];
    return order.indexOf(g) >= order.indexOf(t) ? g : t;
}

function renderGrid() {
    const grid = document.getElementById('bossGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();

    let filtered = allPredictions;

    // Apply Tab Filter — each filter checks BOTH group and TibiaData predictions independently
    if (currentFilter === 'hot') {
        filtered = allPredictions.filter(p => p.chance_percent >= 90 || p.tibiadata_chance_percent >= 90);
    } else if (currentFilter === 'high') {
        filtered = allPredictions.filter(p =>
            (p.chance_percent >= 50 && p.chance_percent < 90) ||
            (p.tibiadata_chance_percent !== null && p.tibiadata_chance_percent >= 50 && p.tibiadata_chance_percent < 90)
        );
    } else if (currentFilter === 'recent') {
        filtered = allPredictions.filter(p => p.kills_yesterday > 0);
    }

    // Apply Search Query Filter
    if (searchQuery) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery));
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="loader-wrapper"><p class="loader-text">Nenhum boss encontrado com os critérios de filtro atuais.</p></div>`;
        return;
    }

    filtered.forEach(p => {
        const cat = getCategory(p);
        const groupCat = getGroupCategory(p);
        const tibiaCat = getTibiaCategory(p);

        // Build dual prediction rows for the card
        const sameChance = tibiaCat !== null && p.chance_percent === p.tibiadata_chance_percent;
        let predRows = '';
        if (sameChance || tibiaCat === null) {
            // Single unified row
            const label = tibiaCat !== null ? '👥📡' : '👥';
            predRows = `<div class="pred-row">${label} <span class="chance-value color-${groupCat}">${p.chance_percent}%</span></div>`;
        } else {
            predRows = `
                <div class="pred-row">👥 <span class="chance-value color-${groupCat}">${p.chance_percent}%</span></div>
                <div class="pred-row">📡 <span class="chance-value color-${tibiaCat}">${p.tibiadata_chance_percent}%</span></div>
            `;
        }

        const col = document.createElement('div');
        col.className = 'boss-card-col';
        col.innerHTML = `
            <div class="boss-card category-${cat}" onclick='openModal(${JSON.stringify(p).replace(/'/g, "&apos;")})'>
                <div class="img-container">
                    <img src="/assets/bosses/${encodeURIComponent(p.name.replace(/\s*\(.*?\)\s*/g, ''))}.webp" 
                         onerror="this.onerror=null; this.src='/assets/bosses/${encodeURIComponent(p.name.replace(/\s*\(.*?\)\s*/g, ''))}.gif'"
                         class="boss-sprite" alt="${p.name}">
                </div>
                <h3 class="boss-name" title="${p.name}">${p.name}</h3>
                ${predRows}
                <div class="p-bar-track">
                    <div class="p-bar-fill" style="width: ${Math.max(p.chance_percent, p.tibiadata_chance_percent ?? 0)}%"></div>
                </div>
                <div class="tags-row">
                    ${p.kills_yesterday > 0 ? `<span class="tag-badge badge-danger">${p.kills_yesterday} Kill${p.kills_yesterday !== 1 ? 's' : ''}</span>` : ''}
                    <span class="tag-badge">${p.status}</span>
                </div>
            </div>
        `;
        grid.appendChild(col);
    });
}

// Search filter binding
document.getElementById('searchInput').addEventListener('keyup', renderGrid);

// Tabs filter binding
document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        renderGrid();
    });
});

async function forceSync() {
    const btn = document.getElementById('syncBtn');
    const icon = btn.querySelector('.sync-icon');
    const label = document.getElementById('syncLabel');

    btn.disabled = true;
    icon.classList.add('rotating');
    label.innerText = 'Sincronizando...';

    try {
        await fetch(`${API_BASE}/api/fetch/${encodeURIComponent(currentWorld)}`, { method: 'POST' });
        // Let it complete sync, then reload
        await new Promise(resolve => setTimeout(resolve, 2000));
        await loadPredictions();
    } catch (err) {
        console.error(err);
    } finally {
        btn.disabled = false;
        icon.classList.remove('rotating');
        label.innerText = 'Sincronizar';
    }
}

// Modal handling
async function openModal(p) {
    const overlay = document.getElementById('bossModalOverlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    const cat = getCategory(p);
    const groupCat = getGroupCategory(p);
    const cleanImgName = p.name.replace(/\s*\(.*?\)\s*/g, '');

    document.getElementById('modalImg').src = `/assets/bosses/${encodeURIComponent(cleanImgName)}.webp`;
    document.getElementById('modalImg').onerror = function() {
        this.onerror = null;
        this.src = `/assets/bosses/${encodeURIComponent(cleanImgName)}.gif`;
    };

    document.getElementById('modalName').innerText = p.name;
    
    const statusTag = document.getElementById('modalStatusTag');
    statusTag.innerText = p.status;
    statusTag.className = `status-badge status-${cat}`;

    // Metrics
    document.getElementById('modalChanceVal').innerText = `${p.chance_percent}%`;
    document.getElementById('modalChanceVal').className = `metric-value color-${groupCat}`;

    // Dual prediction block
    const predBlock = document.getElementById('modalPredBlock');
    if (predBlock) {
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
                    html += `
                <div class="dual-pred-window">
                    📅 Janela TibiaData: ${formatDateBR(p.tibiadata_min_date)} – ${formatDateBR(p.tibiadata_max_date)}
                </div>`;
                }
            }
            predBlock.innerHTML = html;
        }
    }

    if (p.last_seen) {
        let lastSeenStr = formatDateBR(p.last_seen);
        if (p.seen_at_full) {
            const timePart = p.seen_at_full.split(' ')[1];
            lastSeenStr += ` às ${timePart}`;
        }
        document.getElementById('modalLastKillVal').innerText = lastSeenStr;
    } else {
        document.getElementById('modalLastKillVal').innerText = '—';
    }

    document.getElementById('modalDaysSinceVal').innerText = p.days_since !== null ? `${p.days_since}d` : '—';
    document.getElementById('modalTotalKillsVal').innerText = p.total_kills || 0;

    // Attributes
    document.getElementById('modalHPVal').innerText = p.hp || '?';
    
    // Filter conditions immunities like Paralyze, Invisible
    const activeImmunities = (p.immunities || []).filter(imm => imm !== 'Paralisia' && imm !== 'Invisibilidade');
    document.getElementById('modalImmunitiesVal').innerText = activeImmunities.length > 0 ? activeImmunities.join(', ') : 'Nenhuma';

    // Freq & Spawn window
    if (p.expected_days) {
        document.getElementById('modalFreqVal').innerText = `${p.expected_days} dias`;
        const daysLeft = p.expected_days - (p.days_since || 0);
        if (daysLeft > 0) {
            document.getElementById('modalWindowVal').innerText = `Daqui ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`;
        } else if (daysLeft === 0) {
            document.getElementById('modalWindowVal').innerText = 'Hoje!';
        } else {
            document.getElementById('modalWindowVal').innerText = `Atrasado há ${Math.abs(daysLeft)}d`;
        }
    } else {
        document.getElementById('modalFreqVal').innerText = 'Indefinida';
        document.getElementById('modalWindowVal').innerText = 'Necessita de avistamento';
    }

    // Embed Map
    const mapSection = document.getElementById('modalMapSection');
    const mapIframe = document.getElementById('modalMapIframe');
    if (p.map_link) {
        mapIframe.src = p.map_link;
        mapSection.style.display = 'block';
    } else {
        mapIframe.src = '';
        mapSection.style.display = 'none';
    }

    // Render 7-day checks history
    render7DayHistory(p);

    // Fetch and render full history
    const historyList = document.getElementById('fullHistoryList');
    historyList.innerHTML = '<span class="loader-text">Carregando histórico...</span>';
    
    try {
        const hRes = await fetch(`${API_BASE}/api/history/${encodeURIComponent(currentWorld)}/${encodeURIComponent(p.name)}`);
        if (hRes.ok) {
            const hData = await hRes.json();
            renderFullHistoryList(hData.kills || []);
        } else {
            historyList.innerHTML = '<span class="loader-text">Erro ao buscar histórico.</span>';
        }
    } catch (err) {
        console.error(err);
        historyList.innerHTML = '<span class="loader-text">Erro de conexão ao buscar histórico.</span>';
    }
}

function closeModal() {
    const overlay = document.getElementById('bossModalOverlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

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
                ${killed ? `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 19v-2a4 4 0 0 1 8 0v2M12 11h.01M9 11h.01M15 11h.01M8 15h8"></path>
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                </svg>` : `
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                </svg>`}
            </span>
            <span class="history-day-count">${killed ? `${p.kills_yesterday}x` : '—'}</span>
        `;
        grid.appendChild(cell);
    }
}

function renderFullHistoryList(kills) {
    const list = document.getElementById('fullHistoryList');
    if (!kills || kills.length === 0) {
        list.innerHTML = '<span class="loader-text" style="opacity: 0.5;">Nenhuma morte registrada.</span>';
        return;
    }

    // Sort showing newest first
    const sorted = [...kills].sort((a, b) => b.created_at.localeCompare(a.created_at));

    list.innerHTML = sorted.map(k => {
        const formattedDate = formatDateBR(k.kill_date);
        const timePart = k.created_at.split(' ')[1] ? k.created_at.split(' ')[1].substring(0, 5) : '';
        const displayDateTime = timePart ? `${formattedDate} ${timePart}` : formattedDate;
        
        return `
            <div class="history-list-item">
                <div class="history-item-left">
                    <span class="history-item-date">${displayDateTime}</span>
                    <span class="history-item-reporter">Confirmado por: ${k.confirmed_by}</span>
                </div>
                <div class="history-item-right" title="${k.extra_text || ''}">
                    ${k.extra_text || 'Sem detalhes.'}
                </div>
            </div>
        `;
    }).join('');
}

// Start loading statistics
document.addEventListener('DOMContentLoaded', loadPredictions);
// Reload predictions periodically every 2 minutes
setInterval(loadPredictions, 2 * 60 * 1000);
