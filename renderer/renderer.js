const state = { groups: [], bookmarks: [], activeGroupId: null, search: '' };
let dragSrcId = null; // ID перетаскиваемого элемента для Drag & Drop
let linkCheckInProgress = false; // НОВОЕ: Флаг для отслеживания проверки ссылок
let notificationTimeout; // Для управления уведомлениями

// =============================================================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================================================
(async function init(){
  const all = await window.linkdock.getAll();
  state.groups = all.groups;
  state.bookmarks = all.bookmarks;
  
  // Убедимся, что группа "Общее" всегда существует
  if (!state.groups.find(g => g.id === 'default')) {
      state.groups.unshift({ id: 'default', name: 'Общее', order: -1 });
      await persist(); // Сохраняем, если добавили
  }
  state.activeGroupId = state.groups[0]?.id || 'default'; // Если групп нет, устанавливаем 'default'

  const theme = await window.linkdock.getTheme();
  applyTheme(theme);

  bindUI();
  renderGroups();
  renderList();

  bindElectronEvents();
  
  // Запускаем фоновую проверку ссылок через короткое время после загрузки, чтобы не блокировать UI
  setTimeout(startBrokenLinkCheck, 1000); 
})();

// =============================================================================
// ГЛОБАЛЬНЫЕ СОБЫТИЯ ELECTRON
// =============================================================================
function bindElectronEvents() {
  window.linkdock.on('ui:focusSearch', ()=> document.getElementById('search').focus());
  // Обработчики импорта/экспорта теперь будут вызываться из preload.js, который вызывает main.js
  window.linkdock.on('ui:importJSON', ()=> doImport('json')); 
  window.linkdock.on('ui:export', async ()=> { 
    const res = await window.linkdock.exportData();
    if(res.ok) showNotification(`Экспорт сохранен в ${res.path}`, 'success');
    else if (res.error !== 'Отменено') showNotification(res.error, 'error');
  });
  window.linkdock.on('ui:theme', (t)=> applyTheme(t));
  window.linkdock.on('ui:updateReady', ()=> {
    const yes = confirm('Доступно обновление LinkDock. Перезапустить сейчас для установки?');
    if (yes) location.reload();
  });
  
  // НОВОЕ: Обработчики для проверки ссылок
  window.linkdock.onStartLinkCheck(startBrokenLinkCheck); // Для запуска из меню main-процесса
  window.linkdock.onLinkCheckProgress((progress) => {
    const { processed, total, status, currentBookmarkId, currentStatus } = progress;
    
    if (status === 'started') {
        linkCheckInProgress = true;
        showNotification(`Началась проверка ${total} ссылок...`, 'info', 0); // 0 = без автозакрытия
    } else if (status === 'inProgress') {
        const progressText = `Проверка ссылок: ${processed} из ${total}...`;
        showNotification(progressText, 'info', 0);
        
        // Обновляем статус иконки в реальном времени, если закладка видна
        if (currentBookmarkId) {
          const itemElement = document.querySelector(`li[data-id="${currentBookmarkId}"]`);
          if (itemElement) {
            const statusIcon = itemElement.querySelector('.link-status-icon');
            if (statusIcon) {
              updateStatusIcon(statusIcon, currentStatus);
              // Обновляем состояние в state.bookmarks
              const bookmark = state.bookmarks.find(b => b.id === currentBookmarkId);
              if (bookmark) {
                bookmark.lastCheckStatus = currentStatus;
                // Дату проверки будем обновлять только после полной проверки и сохранения store
              }
            }
          }
        }
    } else if (status === 'completed') {
        showNotification('Проверка ссылок завершена!', 'success');
        linkCheckInProgress = false;
        renderList(); // Перерисовываем список для отображения всех новых статусов
        // Важно: Persist происходит в main.js, здесь не нужно
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

  // Модальное окно перемещения
  document.getElementById('moveCancelBtn').addEventListener('click', closeMoveModal);
  document.getElementById('moveConfirmBtn').addEventListener('click', handleMoveBookmark);
  document.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMoveModal();
  });
}

// =============================================================================
// УТИЛИТЫ И ХЕЛПЕРЫ
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

function showNotification(message, type = 'info', duration = 3000) {
  const container = document.getElementById('notifications');
  // Если duration = 0, значит, это уведомление о прогрессе, его не удаляем, а обновляем
  if (duration === 0) {
    let progressToast = container.querySelector('.toast.progress-notification');
    if (!progressToast) {
      progressToast = document.createElement('div');
      progressToast.className = `toast progress-notification ${type}`;
      container.prepend(progressToast); // Добавляем сверху
    }
    progressToast.textContent = message;
    clearTimeout(notificationTimeout); // Очищаем таймер, чтобы уведомление не закрылось
    return;
  }

  // Для обычных уведомлений
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => { toast.remove(); }, duration);
}


// =============================================================================
// УПРАВЛЕНИЕ ДАННЫМИ (Bookmarks & Groups)
// =============================================================================
async function onAdd(){
  const t = norm(document.getElementById('title').value);
  const u = norm(document.getElementById('url').value);
  const tagStr = norm(document.getElementById('tags').value);
  if (!u) {
    showNotification('URL не может быть пустым', 'error');
    return;
  }

  const existingBookmark = state.bookmarks.find(b => b.url === u);

  if (existingBookmark) {
    showNotification(`Закладка "${existingBookmark.title}" обновлена`, 'info');
    existingBookmark.title = t || u;
    existingBookmark.tags = tagStr ? tagStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
    existingBookmark.faviconUrl = getFaviconUrl(u); // Обновить фавикон на всякий случай
    existingBookmark.lastCheckStatus = 'unchecked'; // Сбросить статус для перепроверки
    existingBookmark.lastCheckDate = null;
  } else {
    const tags = tagStr ? tagStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    const bm = { 
      id: uid('b'), 
      title: t || u, 
      url: u, 
      groupId: state.activeGroupId, 
      tags, 
      pinned: false,
      faviconUrl: getFaviconUrl(u),
      notes: '',
      lastCheckStatus: 'unchecked', // НОВОЕ: Начальный статус
      lastCheckDate: null            // НОВОЕ: Дата последней проверки
    };
    state.bookmarks.push(bm);
    showNotification(`Закладка "${bm.title}" добавлена`, 'success');
  }

  await persist();
  document.getElementById('title').value = '';
  document.getElementById('url').value = '';
  document.getElementById('tags').value = '';
  renderList();
}

async function onAddGroup(){
  const name = norm(document.getElementById('newGroupName').value);
  if (!name) {
    showNotification('Название группы не может быть пустым', 'error');
    return;
  }
  if (state.groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
    showNotification('Группа с таким названием уже существует', 'error');
    return;
  }
  const g = { id: uid('g'), name, order: state.groups.length };
  state.groups.push(g);
  state.activeGroupId = g.id;
  document.getElementById('newGroupName').value = '';
  await persist();
  renderGroups();
  renderList();
  showNotification(`Группа "${name}" добавлена`, 'success');
}

function filtered(){
  const byGroup = state.bookmarks.filter(b => b.groupId === state.activeGroupId);
  const sorted = byGroup.sort((a,b)=> (b.pinned ? -1 : a.pinned ? 1 : 0) || alphaSort(a,b)); // Сначала закрепленные
  if (!state.search) return sorted;
  const s = state.search;
  return sorted.filter(b =>
    (b.title||'').toLowerCase().includes(s) ||
    (b.url||'').toLowerCase().includes(s) ||
    (b.tags||[]).some(t=> t.toLowerCase().includes(s)) ||
    (b.notes||'').toLowerCase().includes(s)
  );
}

// =============================================================================
// РЕНДЕРИНГ ЭЛЕМЕНТОВ UI
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

    if (g.id !== 'default') { // Нельзя удалить группу "Общее"
      const deleteBtn = document.createElement('span');
      deleteBtn.textContent = '×';
      deleteBtn.className = 'delete-group-btn';
      deleteBtn.title = 'Удалить группу';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Предотвращаем срабатывание клика по группе
        handleDeleteGroup(g.id, g.name);
      });
      li.appendChild(deleteBtn);
    }

    // Drag & Drop для групп
    li.draggable = true;
    li.addEventListener('dragstart', (e)=> { 
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', g.id); // Передаем ID группы
      li.classList.add('dragging'); 
      dragSrcId = g.id; 
    });
    li.addEventListener('dragend', ()=> { 
      li.classList.remove('dragging'); 
      dragSrcId = null; 
      persist(); // Сохраняем порядок после перетаскивания
    });
    li.addEventListener('dragover', (e)=> { e.preventDefault(); li.classList.add('dragover'); });
    li.addEventListener('dragleave', ()=> li.classList.remove('dragover'));
    li.addEventListener('drop', (e)=> {
      e.preventDefault();
      li.classList.remove('dragover');
      const draggedGroupId = e.dataTransfer.getData('text/plain');
      if (!draggedGroupId || draggedGroupId === g.id) return;
      
      const srcGroup = state.groups.find(x => x.id === draggedGroupId);
      const dstGroup = g; 
      
      if (srcGroup && dstGroup) {
        // Меняем местами порядковые номера
        const srcOrder = srcGroup.order;
        srcGroup.order = dstGroup.order;
        dstGroup.order = srcOrder;
        
        renderGroups(); // Перерисовываем, чтобы обновить порядок
      }
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
  let shouldPersistFavicons = false; // Флаг для сохранения фавиконов

  list.forEach(b => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = b.id;
    if (b.pinned) li.classList.add('pinned');

    // Фавикон
    const favicon = li.querySelector('.favicon');
    if (!b.faviconUrl || b.faviconUrl === '') { // Если фавикона нет или он пустой, генерируем
      b.faviconUrl = getFaviconUrl(b.url); 
      shouldPersistFavicons = true; // Нужна запись в store
    }
    favicon.src = b.faviconUrl;
    favicon.onerror = () => { favicon.style.opacity = '0.5'; }; // Если фавикон не загрузился

    li.querySelector('.title').textContent = b.title;
    li.querySelector('.url').textContent = b.url;

    // НОВОЕ: Иконка статуса ссылки
    const statusIcon = li.querySelector('.link-status-icon');
    updateStatusIcon(statusIcon, b.lastCheckStatus);
    
    // Заметки
    const notesDisplay = li.querySelector('.notes-display');
    if (b.notes) { 
      notesDisplay.textContent = b.notes;
      notesDisplay.style.display = 'block';
    } else { 
      notesDisplay.style.display = 'none'; 
    }

    // Теги
    const taglist = li.querySelector('.taglist');
    taglist.innerHTML = '';
    (b.tags||[]).forEach(t => {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag';
      tagEl.textContent = `#${t}`;
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Предотвращаем клик по закладке
        document.getElementById('search').value = t;
        state.search = t.toLowerCase();
        renderList();
      });
      taglist.appendChild(tagEl);
    });

    // Режим редактирования
    li.querySelector('.edit-title').value = b.title;
    li.querySelector('.edit-url').value = b.url;
    li.querySelector('.edit-tags').value = (b.tags||[]).join(', ');
    li.querySelector('.edit-notes').value = b.notes || '';

    // Кнопки действий
    li.querySelector('.pin').addEventListener('click', async () => { 
      b.pinned = !b.pinned; 
      await persist(); 
      renderList(); 
      showNotification(b.pinned ? 'Закладка закреплена' : 'Закладка откреплена', 'info');
    });
    li.querySelector('.open').addEventListener('click', () => {
      // ИСПРАВЛЕНО: Вызываем openExternalLink
      window.linkdock.openExternalLink(b.url);
      showNotification(`Открываю "${b.title}"`, 'info');
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (confirm(`Вы уверены, что хотите удалить закладку "${b.title}"?`)) {
        state.bookmarks = state.bookmarks.filter(x => x.id !== b.id); 
        await persist(); 
        renderList();
        showNotification(`Закладка "${b.title}" удалена`, 'success');
      }
    });
    
    // Кнопки редактирования (появление/сохранение/отмена)
    li.querySelector('.edit').addEventListener('click', () => li.classList.add('editing'));
    li.querySelector('.cancel').addEventListener('click', () => { 
      li.classList.remove('editing'); 
      renderList(); // Перерисовать, чтобы вернуть оригинальные значения
    });
    li.querySelector('.save').addEventListener('click', async () => {
      b.title = li.querySelector('.edit-title').value;
      b.url = li.querySelector('.edit-url').value;
      b.faviconUrl = getFaviconUrl(b.url); // Обновить фавикон, если URL изменился
      const newTags = li.querySelector('.edit-tags').value;
      b.tags = newTags ? newTags.split(',').map(s => s.trim()).filter(Boolean) : [];
      b.notes = li.querySelector('.edit-notes').value.trim();
      
      // НОВОЕ: Сбросить статус проверки, если URL изменился
      if (li.querySelector('.edit-url').value !== b.url) {
        b.lastCheckStatus = 'unchecked';
        b.lastCheckDate = null;
      }

      await persist();
      renderList(); 
      li.classList.remove('editing');
      showNotification(`Закладка "${b.title}" сохранена`, 'success');
    });

    li.querySelector('.move').addEventListener('click', () => openMoveModal(b.id));

    // Drag & Drop для закладок
    li.draggable = true;
    li.addEventListener('dragstart', (e)=> { 
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', b.id);
      li.classList.add('dragging'); 
      dragSrcId = b.id; 
    });
    li.addEventListener('dragend', async ()=> { 
      li.classList.remove('dragging'); 
      dragSrcId = null; 
      await persist(); 
    });
    li.addEventListener('dragover', (e)=> { e.preventDefault(); }); // Важно для drop
    li.addEventListener('drop', (e)=> {
      e.preventDefault();
      const draggedBookmarkId = e.dataTransfer.getData('text/plain');
      if (draggedBookmarkId === b.id) return;
      reorderBookmark(b.id); // Переупорядочить относительно текущей закладки
    });

    ul.appendChild(li);
  });

  if (shouldPersistFavicons) {
    persist(); // Сохраняем, если были сгенерированы новые фавиконы
  }
}

// =============================================================================
// ЛОГИКА КОНКРЕТНЫХ ДЕЙСТВИЙ (Check Links, Delete Group, Move Bookmark)
// =============================================================================

// НОВОЕ: Запуск проверки битых ссылок
async function startBrokenLinkCheck() {
    if (linkCheckInProgress) {
        showNotification('Проверка ссылок уже запущена.', 'info');
        return;
    }
    showNotification('Запускаю проверку всех ссылок...', 'info');
    linkCheckInProgress = true;
    await window.linkdock.checkAllLinks();
    // Дальнейший прогресс и завершение обрабатываются в onLinkCheckProgress
}

// НОВОЕ: Обновление иконки статуса
function updateStatusIcon(iconElement, status) {
  if (!iconElement) return;
  iconElement.className = `link-status-icon status-${status || 'unchecked'}`; // Дефолтный статус
  switch (status) {
    case 'ok': iconElement.title = 'Ссылка работает'; break;
    case 'broken': iconElement.title = 'Ссылка не работает или недоступна (4xx, 5xx, DNS, отказ)'; break;
    case 'timeout': iconElement.title = 'Таймаут при проверке ссылки'; break;
    case 'error': iconElement.title = 'Общая ошибка сети при проверке'; break;
    case 'unchecked': iconElement.title = 'Ссылка не проверялась'; break;
    case 'unknown': iconElement.title = 'Неизвестный статус или тип ссылки'; break; // Например, не http/https
    default: iconElement.title = 'Неизвестный статус'; break;
  }
}

async function handleDeleteGroup(groupId, groupName) {
  const response = await window.linkdock.showDeleteGroupDialog(groupName);
  
  if (response === 0) return; // Отмена

  if (response === 1) { // Переместить закладки в "Общее"
    const defaultGroup = state.groups.find(g => g.id === 'default');
    if (!defaultGroup) { 
      showNotification('Группа "Общее" не найдена! Не могу переместить закладки.', 'error'); 
      return; 
    }
    state.bookmarks.forEach(b => {
      if (b.groupId === groupId) b.groupId = 'default';
    });
    showNotification(`Закладки из "${groupName}" перемещены в "Общее"`, 'success');
  }
  
  if (response === 2) { // Удалить группу и все закладки
    state.bookmarks = state.bookmarks.filter(b => b.groupId !== groupId);
    showNotification(`Группа "${groupName}" и все ее закладки удалены`, 'success');
  }

  state.groups = state.groups.filter(g => g.id !== groupId);
  if (state.activeGroupId === groupId) state.activeGroupId = 'default'; // Если удалили активную, переходим в "Общее"

  await persist();
  renderGroups();
  renderList();
}

let bookmarkToMoveId = null;

function openMoveModal(bookmarkId) {
  bookmarkToMoveId = bookmarkId;
  const modal = document.getElementById('moveModal');
  const select = document.getElementById('moveToGroupSelect');
  select.innerHTML = ''; // Очищаем старые опции

  state.groups.sort((a,b)=>a.order - b.order).forEach(g => {
    const option = document.createElement('option');
    option.value = g.id;
    option.textContent = g.name;
    select.appendChild(option);
  });

  const currentBookmark = state.bookmarks.find(b => b.id === bookmarkId);
  if (currentBookmark) {
    select.value = currentBookmark.groupId; // Выбираем текущую группу
  }
  modal.style.display = 'flex'; // Показываем модальное окно
}

function closeMoveModal() {
  document.getElementById('moveModal').style.display = 'none';
  bookmarkToMoveId = null;
}

async function handleMoveBookmark() {
  if (!bookmarkToMoveId) return;

  const targetGroupId = document.getElementById('moveToGroupSelect').value;
  const targetGroupName = document.getElementById('moveToGroupSelect').options[document.getElementById('moveToGroupSelect').selectedIndex].text;
  
  const bookmark = state.bookmarks.find(b => b.id === bookmarkToMoveId);
  if (bookmark) {
    const oldGroupName = state.groups.find(g => g.id === bookmark.groupId)?.name || 'Неизвестная группа';
    bookmark.groupId = targetGroupId;
    await persist();
    renderList(); // Перерисовываем список, чтобы закладка исчезла из текущей группы
    closeMoveModal();
    showNotification(`Закладка "${bookmark.title}" перемещена из "${oldGroupName}" в "${targetGroupName}"`, 'success');
  }
}

// НОВОЕ: Переупорядочивание закладок
function reorderBookmark(dstId){
  if (!dragSrcId || dragSrcId === dstId) return;
  const srcIndex = state.bookmarks.findIndex(b => b.id === dragSrcId);
  const dstIndex = state.bookmarks.findIndex(b => b.id === dstId);

  if (srcIndex === -1 || dstIndex === -1) return;

  const [removed] = state.bookmarks.splice(srcIndex, 1);
  state.bookmarks.splice(dstIndex, 0, removed);
  
  // renderList() будет вызван в dragend, persist() тоже там
}

// =============================================================================
// ИМПОРТ ЗАКЛАДОК (Chrome, Edge, Firefox, JSON)
// =============================================================================
async function doImport(kind){
  const res = await window.linkdock.importBookmarks(kind);
  if (!res?.ok) { 
    if (res.error !== 'Отменено') showNotification(res?.error || 'Ошибка импорта', 'error');
    return;
  }
  if (res.added > 0) showNotification(`Импортировано ${res.added} закладок`, 'success');
  if (res.imported > 0) showNotification(`Импортировано ${res.imported} закладок`, 'success');
  
  // После импорта нужно обновить состояние в renderer
  const all = await window.linkdock.getAll();
  state.groups = all.groups; 
  state.bookmarks = all.bookmarks;
  
  // Убедимся, что группа "Общее" всегда существует
  if (!state.groups.find(g => g.id === 'default')) {
      state.groups.unshift({ id: 'default', name: 'Общее', order: -1 });
      await persist(); 
  }

  // Если активная группа была удалена/изменена, устанавливаем 'default'
  if (!state.activeGroupId || !state.groups.find(g => g.id === state.activeGroupId)) {
    state.activeGroupId = 'default';
  }

  renderGroups(); 
  renderList();
  
  // Запускаем проверку ссылок после импорта
  startBrokenLinkCheck(); 
}
