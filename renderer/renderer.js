const state = { groups: [], bookmarks: [], activeGroupId: null, search: '' };
let dragSrcId = null; // ID перетаскиваемого элемента для Drag & Drop
let linkCheckInProgress = false; // НОВОЕ: Флаг для отслеживания проверки ссылок

// =============================================================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================================================
(async function init(){
  const all = await window.linkdock.getAll();
  state.groups = all.groups;
  state.bookmarks = all.bookmarks;
  
  if (!state.groups.find(g => g.id === 'default')) {
      state.groups.unshift({ id: 'default', name: 'Общее', order: -1 });
  }
  state.activeGroupId = state.groups[0]?.id || null;

  const theme = await window.linkdock.getTheme();
  applyTheme(theme);

  bindUI();
  renderGroups();
  renderList();

  bindElectronEvents();
  
  // Запускаем фоновую проверку ссылок
  startBrokenLinkCheck(); 
})();

// =============================================================================
// ГЛОБАЛЬНЫЕ СОБЫТИЯ
// =============================================================================
function bindElectronEvents() {
  window.linkdock.on('ui:focusSearch', ()=> document.getElementById('search').focus());
  window.linkdock.on('ui:importJSON', ()=> doImport('json'));
  window.linkdock.on('ui:export', async ()=> { 
    const res = await window.linkdock.exportData();
    if(res.ok) showNotification(`Экспорт сохранен в ${res.path}`, 'success');
  });
  window.linkdock.on('ui:theme', (t)=> applyTheme(t));
  window.linkdock.on('ui:updateReady', ()=> {
    const yes = confirm('Доступно обновление LinkDock. Перезапустить сейчас для установки?');
    if (yes) location.reload();
  });
  
  // НОВОЕ: Обработчики для проверки ссылок
  window.linkdock.on('links:startCheck', startBrokenLinkCheck);
  window.linkdock.on('links:checkProgress', (progress) => {
    const { processed, total, status, currentBookmarkId, currentStatus } = progress;
    
    if (status === 'started') {
        linkCheckInProgress = true;
        showNotification(`Началась проверка ${total} ссылок...`, 'info', 0);
    } else if (status === 'inProgress') {
        const progressText = `Проверка ссылок: ${processed} из ${total}...`;
        showNotification(progressText, 'info', 0);
        
        // Обновляем статус иконки в реальном времени
        const itemElement = document.querySelector(`li[data-id="${currentBookmarkId}"] .link-status-icon`);
        if (itemElement) {
          updateStatusIcon(itemElement, currentStatus);
        }
    } else if (status === 'completed') {
        showNotification('Проверка ссылок завершена!', 'success');
        linkCheckInProgress = false;
        renderList(); // Перерисовываем список для отображения всех новых статусов
    }
  });
}

// =============================================================================
// ОСНОВНЫЕ ФУНКЦИИ UI
// =============================================================================
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
}

function bindUI(){
  document.getElementById('addBtn').addEventListener('click', onAdd);
  document.getElementById('addGroupBtn').addEventListener('click', onAddGroup);
  
  const addInputs = ['title', 'url', 'tags'];
  addInputs.forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onAdd();
    });
  });

  document.getElementById('btnTheme').addEventListener('click', async ()=>{
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    applyTheme(next);
    await window.linkdock.setTheme(next);
  });
  
  document.getElementById('search').addEventListener('input', (e)=>{ state.search = e.target.value.trim().toLowerCase(); renderList(); });
  
  document.getElementById('impChrome').addEventListener('click', ()=> doImport('chrome'));
  document.getElementById('impEdge').addEventListener('click', ()=> doImport('edge'));
  document.getElementById('impFirefox').addEventListener('click', ()=> doImport('firefox'));
  document.getElementById('impJSON').addEventListener('click', ()=> doImport('json'));

  document.getElementById('btnExport').addEventListener('click', async () => {
    const res = await window.linkdock.exportData();
    if (res.ok) showNotification(`Экспорт успешно сохранен`, 'success');
    else if(res.error !== 'Отменено') showNotification(res.error, 'error');
  });

  document.getElementById('moveCancelBtn').addEventListener('click', closeMoveModal);
  document.getElementById('moveConfirmBtn').addEventListener('click', handleMoveBookmark);
  document.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMoveModal();
  });
}

// =============================================================================
// УТИЛИТЫ
// =============================================================================
function uid(prefix){ return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function norm(str){ return (str||'').trim(); }
function alphaSort(a,b){
  const at = (a.title||'').toLowerCase();
  const bt = (b.title||'').toLowerCase();
  if (at < bt) return -1; if (at > bt) return 1; return 0;
}
function getFaviconUrl(bookmarkUrl) {
  if (!bookmarkUrl) return '';
  try {
    const url = new URL(bookmarkUrl);
    return `https://www.google.com/s2/favicons?sz=32&domain_url=${url.origin}`;
  } catch (e) { return ''; }
}
async function persist(){
  await window.linkdock.save('groups', state.groups);
  await window.linkdock.save('bookmarks', state.bookmarks);
}
let notificationTimeout;
function showNotification(message, type = 'info', duration = 3000) {
  const container = document.getElementById('notifications');
  const existingToast = container.querySelector('.toast');
  if(existingToast) existingToast.remove(); // Удаляем старое уведомление

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  clearTimeout(notificationTimeout);

  if (duration > 0) {
    notificationTimeout = setTimeout(() => { toast.remove(); }, duration);
  }
}

// =============================================================================
// УПРАВЛЕНИЕ ДАННЫМИ
// =============================================================================
async function onAdd(){
  const t = norm(document.getElementById('title').value);
  const u = norm(document.getElementById('url').value);
  const tagStr = norm(document.getElementById('tags').value);
  if (!u) return;

  const existingBookmark = state.bookmarks.find(b => b.url === u);

  if (existingBookmark) {
    showNotification(`Закладка обновлена`, 'info');
    existingBookmark.title = t || u;
  } else {
    const tags = tagStr ? tagStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const bm = { 
      id: uid('b'), 
      title: t || u, 
      url: u, 
      groupId: state.activeGroupId, 
      tags, 
      pinned: false,
      faviconUrl: getFaviconUrl(u),
      notes: '',
      lastCheckStatus: 'unchecked',
      lastCheckDate: null
    };
    state.bookmarks.push(bm);
  }

  await persist();
  document.getElementById('title').value = '';
  document.getElementById('url').value = '';
  document.getElementById('tags').value = '';
  renderList();
}

async function onAddGroup(){
  const name = norm(document.getElementById('newGroupName').value);
  if (!name) return;
  const g = { id: uid('g'), name, order: state.groups.length };
  state.groups.push(g);
  state.activeGroupId = g.id;
  document.getElementById('newGroupName').value = '';
  await persist();
  renderGroups();
  renderList();
}

function filtered(){
  const byGroup = state.bookmarks.filter(b => b.groupId === state.activeGroupId);
  const sorted = byGroup.sort((a,b)=> (b.pinned - a.pinned) || alphaSort(a,b));
  if (!state.search) return sorted;
  return sorted.filter(b =>
    (b.title||'').toLowerCase().includes(state.search) ||
    (b.url||'').toLowerCase().includes(state.search) ||
    (b.tags||[]).some(t=> t.toLowerCase().includes(state.search)) ||
    (b.notes||'').toLowerCase().includes(state.search)
  );
}

// =============================================================================
// РЕНДЕРИНГ СПИСКОВ
// =============================================================================
function renderGroups(){
  const ul = document.getElementById('groupList');
  ul.innerHTML = '';
  state.groups.sort((a,b)=> a.order - b.order).forEach(g => {
    const li = document.createElement('li');
    const groupNameSpan = document.createElement('span');
    groupNameSpan.textContent = g.name;
    li.appendChild(groupNameSpan);
    li.className = (g.id === state.activeGroupId) ? 'active' : '';

    if (g.id !== 'default') {
      const deleteBtn = document.createElement('span');
      deleteBtn.textContent = '×';
      deleteBtn.className = 'delete-group-btn';
      deleteBtn.title = 'Удалить группу';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteGroup(g.id, g.name);
      });
      li.appendChild(deleteBtn);
    }

    li.draggable = true;
    li.addEventListener('dragstart', ()=> { li.classList.add('dragging'); dragSrcId = g.id; });
    li.addEventListener('dragend', ()=> { li.classList.remove('dragging'); dragSrcId = null; persist(); });
    li.addEventListener('dragover', (e)=> { e.preventDefault(); li.classList.add('dragover'); });
    li.addEventListener('dragleave', ()=> li.classList.remove('dragover'));
    li.addEventListener('drop', ()=> {
      li.classList.remove('dragover');
      if (!dragSrcId || dragSrcId === g.id) return;
      const src = state.groups.find(x=>x.id===dragSrcId);
      const dst = g; const srcOrder = src.order; src.order = dst.order; dst.order = srcOrder;
      renderGroups(); renderList();
    });

    li.addEventListener('click', ()=> { state.activeGroupId = g.id; renderGroups(); renderList(); });
    ul.appendChild(li);
  });
}

function renderList(){
  const list = filtered();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  const tpl = document.getElementById('tplItem');
  let shouldPersist = false; 

  list.forEach(b => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = b.id;
    if (b.pinned) li.classList.add('pinned');

    const favicon = li.querySelector('.favicon');
    if (!b.faviconUrl) { b.faviconUrl = getFaviconUrl(b.url); shouldPersist = true; }
    favicon.src = b.faviconUrl;
    favicon.onerror = () => { favicon.style.opacity = '0.5'; }; 
    
    li.querySelector('.title').textContent = b.title;
    li.querySelector('.url').textContent = b.url;

    const statusIcon = li.querySelector('.link-status-icon');
    updateStatusIcon(statusIcon, b.lastCheckStatus);
    
    const notesDisplay = li.querySelector('.notes-display');
    if (b.notes) { 
      notesDisplay.textContent = b.notes;
      notesDisplay.style.display = 'block';
    } else { 
      notesDisplay.style.display = 'none'; 
    }

    const taglist = li.querySelector('.taglist');
    taglist.innerHTML = '';
    (b.tags||[]).forEach(t => {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag';
      tagEl.textContent = `#${t}`;
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('search').value = t;
        state.search = t.toLowerCase();
        renderList();
      });
      taglist.appendChild(tagEl);
    });

    li.querySelector('.edit-title').value = b.title;
    li.querySelector('.edit-url').value = b.url;
    li.querySelector('.edit-tags').value = (b.tags||[]).join(', ');
    li.querySelector('.edit-notes').value = b.notes || '';

    li.querySelector('.pin').addEventListener('click', async () => { b.pinned = !b.pinned; await persist(); renderList(); });
    li.querySelector('.open').addEventListener('click', () => window.linkdock.openExternalLink(b.url));
    li.querySelector('.del').addEventListener('click', async () => {
      if (confirm(`Вы уверены, что хотите удалить закладку "${b.title}"?`)) {
        state.bookmarks = state.bookmarks.filter(x => x.id !== b.id); 
        await persist(); 
        renderList();
      }
    });
    
    li.querySelector('.edit').addEventListener('click', () => li.classList.add('editing'));
    li.querySelector('.cancel').addEventListener('click', () => li.classList.remove('editing'));
    li.querySelector('.save').addEventListener('click', async () => {
      b.title = li.querySelector('.edit-title').value;
      b.url = li.querySelector('.edit-url').value;
      b.faviconUrl = getFaviconUrl(b.url);
      const newTags = li.querySelector('.edit-tags').value;
      b.tags = newTags ? newTags.split(',').map(s => s.trim()).filter(Boolean) : [];
      b.notes = li.querySelector('.edit-notes').value.trim();
      b.lastCheckStatus = 'unchecked';
      b.lastCheckDate = null;
      await persist();
      renderList(); 
    });

    li.querySelector('.move').addEventListener('click', () => openMoveModal(b.id));

    li.addEventListener('dragstart', ()=> { li.classList.add('dragging'); dragSrcId = b.id; });
    li.addEventListener('dragend', async ()=> { li.classList.remove('dragging'); dragSrcId = null; await persist(); });
    li.addEventListener('dragover', (e)=> e.preventDefault());
    li.addEventListener('drop', ()=> reorderBookmark(b.id));

    ul.appendChild(li);
  });

  if (shouldPersist) persist();
}

// =============================================================================
// ЛОГИКА КОНКРЕТНЫХ ДЕЙСТВИЙ
// =============================================================================
async function startBrokenLinkCheck() {
    if (linkCheckInProgress) return;
    await window.linkdock.checkAllLinks();
}

function updateStatusIcon(iconElement, status) {
  if (!iconElement) return;
  iconElement.className = `link-status-icon status-${status || 'unchecked'}`;
  switch (status) {
    case 'ok': iconElement.title = 'Ссылка работает'; break;
    case 'broken': iconElement.title = 'Ссылка не работает или недоступна'; break;
    case 'timeout': iconElement.title = 'Таймаут при проверке ссылки'; break;
    case 'error': iconElement.title = 'Ошибка при проверке ссылки'; break;
    case 'unchecked': iconElement.title = 'Ссылка не проверялась'; break;
    case 'unknown': iconElement.title = 'Неизвестный статус ссылки'; break;
    default: iconElement.title = 'Неизвестный статус'; break;
  }
}

async function handleDeleteGroup(groupId, groupName) {
  const response = await window.linkdock.showDeleteGroupDialog(groupName);
  
  if (response === 0) return;

  if (response === 1) { // Переместить
    const defaultGroup = state.groups.find(g => g.id === 'default');
    if (!defaultGroup) { showNotification('Группа "Общее" не найдена!', 'error'); return; }
    state.bookmarks.forEach(b => {
      if (b.groupId === groupId) b.groupId = 'default';
    });
  }
  
  if (response === 2) { // Удалить всё
    state.bookmarks = state.bookmarks.filter(b => b.groupId !== groupId);
  }

  state.groups = state.groups.filter(g => g.id !== groupId);
  if (state.activeGroupId === groupId) state.activeGroupId = 'default';

  await persist();
  renderGroups();
  renderList();
  showNotification(`Группа "${groupName}" удалена`, 'success');
}

let bookmarkToMoveId = null;

function openMoveModal(bookmarkId) { /*...*/ }
function closeMoveModal() { /*...*/ }
async function handleMoveBookmark() { /*...*/ }
function reorderBookmark(dstId){ /*...*/ }

// =============================================================================
// ИМПОРТ
// =============================================================================
async function doImport(kind){
  const res = await window.linkdock.importBookmarks(kind);
  if (!res?.ok) { 
    if (res.error !== 'Отменено') showNotification(res?.error || 'Ошибка импорта', 'error');
    return;
  }
  if (res.added > 0) showNotification(`Импортировано ${res.added} закладок`, 'success');
  if (res.imported > 0) showNotification(`Импортировано ${res.imported} закладок`, 'success');
  const all = await window.linkdock.getAll();
  state.groups = all.groups; state.bookmarks = all.bookmarks;
  
  if (!state.groups.find(g => g.id === 'default')) {
      state.groups.unshift({ id: 'default', name: 'Общее', order: -1 });
  }

  if (!state.activeGroupId && state.groups[0]) state.activeGroupId = state.g[0].id;
  renderGroups(); 
  renderList();
  startBrokenLinkCheck(); // Запускаем проверку после импорта
}
