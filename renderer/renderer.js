const state = { groups: [], bookmarks: [], activeGroupId: null, search: '' };
let dragSrcId = null; // DnD

(async function init(){
  const all = await window.linkdock.getAll();
  state.groups = all.groups;
  state.bookmarks = all.bookmarks;
  state.activeGroupId = state.groups[0]?.id || null;
  bindUI();
  renderGroups();
  renderList();

  window.linkdock.on('ui:focusSearch', ()=> document.getElementById('search').focus());
  window.linkdock.on('ui:importJSON', ()=> doImport('json'));
  window.linkdock.on('ui:export', async ()=> { await window.linkdock.exportData(); });
  window.linkdock.on('ui:updateReady', ()=> {
    const yes = confirm('Доступно обновление LinkDock. Перезапустить сейчас для установки?');
    if (yes) require('electron').ipcRenderer.invoke('app:quitAndInstall');
  });
})();

function bindUI(){
  document.getElementById('addBtn').addEventListener('click', onAdd);
  document.getElementById('addGroupBtn').addEventListener('click', onAddGroup);
  document.getElementById('search').addEventListener('input', (e)=>{ state.search = e.target.value.trim().toLowerCase(); renderList(); });
  document.getElementById('impChrome').addEventListener('click', ()=> doImport('chrome'));
  document.getElementById('impEdge').addEventListener('click', ()=> doImport('edge'));
  document.getElementById('impFirefox').addEventListener('click', ()=> doImport('firefox'));
  document.getElementById('impJSON').addEventListener('click', ()=> doImport('json'));
  document.getElementById('btnExport').addEventListener('click', async ()=> { await window.linkdock.exportData(); });
}

function uid(prefix){ return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

async function persist(){
  await window.linkdock.save('groups', state.groups);
  await window.linkdock.save('bookmarks', state.bookmarks);
}

function renderGroups(){
  const ul = document.getElementById('groupList');
  ul.innerHTML = '';
  state.groups.sort((a,b)=> a.order - b.order).forEach(g => {
    const li = document.createElement('li');
    li.textContent = g.name;
    li.className = (g.id === state.activeGroupId) ? 'active' : '';

    // Drag&Drop групп
    li.draggable = true;
    li.addEventListener('dragstart', ()=> { li.classList.add('dragging'); dragSrcId = g.id; });
    li.addEventListener('dragend', ()=> { li.classList.remove('dragging'); dragSrcId = null; persist(); });
    li.addEventListener('dragover', (e)=> { e.preventDefault(); li.classList.add('dragover'); });
    li.addEventListener('dragleave', ()=> li.classList.remove('dragover'));
    li.addEventListener('drop', ()=> {
      li.classList.remove('dragover');
      if (!dragSrcId || dragSrcId === g.id) return;
      const src = state.groups.find(x=>x.id===dragSrcId);
      const dst = g;
      const srcOrder = src.order; src.order = dst.order; dst.order = srcOrder;
      renderGroups(); renderList();
    });

    li.addEventListener('click', ()=> { state.activeGroupId = g.id; renderGroups(); renderList(); });
    ul.appendChild(li);
  });
}

function norm(str){ return (str||'').trim(); }

async function onAdd(){
  const t = norm(document.getElementById('title').value);
  const u = norm(document.getElementById('url').value);
  const tagStr = norm(document.getElementById('tags').value);
  if (!u) return;
  const tags = tagStr ? tagStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const bm = { id: uid('b'), title: t || u, url: u, groupId: state.activeGroupId, tags, pinned: false };
  state.bookmarks.push(bm);
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
    (b.tags||[]).some(t=> t.toLowerCase().includes(state.search))
  );
}

function alphaSort(a,b){
  const at = (a.title||'').toLowerCase();
  const bt = (b.title||'').toLowerCase();
  if (at < bt) return -1; if (at > bt) return 1; return 0;
}

function renderList(){
  const list = filtered();
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  const tpl = document.getElementById('tplItem');
  list.forEach(b => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = b.id;
    if (b.pinned) li.classList.add('pinned');

    li.querySelector('.pin').addEventListener('click', async () => {
      b.pinned = !b.pinned; await persist(); renderList();
    });
    li.querySelector('.title').textContent = b.title;
    li.querySelector('.url').textContent = b.url;
    li.querySelector('.taglist').textContent = (b.tags||[]).map(t=>`#${t}`).join(', ');
    li.querySelector('.open').addEventListener('click', () => window.linkdock.openLink(b.url));
    li.querySelector('.del').addEventListener('click', async () => {
      state.bookmarks = state.bookmarks.filter(x => x.id !== b.id);
      await persist();
      renderList();
    });
    li.querySelector('.edit').addEventListener('click', async () => {
      const title = prompt('Название', b.title);
      const url = prompt('URL', b.url);
      const tags = prompt('Теги через запятую', (b.tags||[]).join(','));
      if (title) b.title = title;
      if (url) b.url = url;
      b.tags = tags ? tags.split(',').map(s=>s.trim()).filter(Boolean) : [];
      await persist(); renderList();
    });
    li.querySelector('.move').addEventListener('click', async () => {
      const name = prompt('Переместить в группу (новая/существующая):', 'Общее');
      if (!name) return;
      let g = state.groups.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!g){ g = { id: uid('g'), name, order: state.groups.length }; state.groups.push(g); }
      b.groupId = g.id;
      await persist();
      renderGroups();
      renderList();
    });

    // Drag&Drop закладок (внутри группы)
    li.addEventListener('dragstart', ()=> { li.classList.add('dragging'); dragSrcId = b.id; });
    li.addEventListener('dragend', async ()=> { li.classList.remove('dragging'); dragSrcId = null; await persist(); });
    li.addEventListener('dragover', (e)=> e.preventDefault());
    li.addEventListener('drop', ()=> reorderBookmark(b.id));

    ul.appendChild(li);
  });
}

function reorderBookmark(dstId){
  if (!dragSrcId || dragSrcId === dstId) return;
  const inGroup = state.bookmarks.filter(x => x.groupId === state.activeGroupId);
  const order = inGroup.map(x=>x.id);
  const from = order.indexOf(dragSrcId);
  const to = order.indexOf(dstId);
  if (from === -1 || to === -1) return;
  order.splice(to, 0, order.splice(from,1)[0]);
  // apply new order: rebuild group items + others
  const others = state.bookmarks.filter(x => x.groupId !== state.activeGroupId);
  const reordered = order.map(id => inGroup.find(x=>x.id===id));
  state.bookmarks = others.concat(reordered);
  renderList();
}

async function doImport(kind){
  const res = await window.linkdock.importBookmarks(kind);
  if (!res?.ok) { alert(res?.error || 'Ошибка импорта'); return; }
  const all = await window.linkdock.getAll();
  state.groups = all.groups; state.bookmarks = all.bookmarks;
  if (!state.activeGroupId && state.groups[0]) state.activeGroupId = state.groups[0].id;
  renderGroups(); renderList();
}
