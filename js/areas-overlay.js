// js/areas-overlay.js
const { ipcRenderer } = require('electron');

const overlay = document.getElementById('overlay');
const toolbar = document.getElementById('toolbar');
const drawBox = document.getElementById('drawBox');
const sizeLabel = document.getElementById('sizeLabel');
const saveBtn = document.getElementById('saveBtn');
const closeBtn = document.getElementById('closeBtn');

let bounds = { x: 0, y: 0, width: 0, height: 0 };
let areas = [];        // x, y — абсолютные экранные координаты
let counter = 0;
let selectedId = null;
let mode = null;       // 'draw' | 'move' | 'resize'
let st = null;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const local = (e) => ({ x: e.screenX - bounds.x, y: e.screenY - bounds.y });

ipcRenderer.invoke('get-display-bounds').then(b => {
  bounds = b;
  return ipcRenderer.invoke('load-areas');
}).then(list => {
  areas = Array.isArray(list) ? list : [];
  counter = areas.reduce((m, a) => Math.max(m, a.id || 0), 0);
  renderAll();
});

// Приём синхронизации с других мониторов
ipcRenderer.on('areas-sync', (e, list) => {
  areas = Array.isArray(list) ? list : [];
  counter = areas.reduce((m, a) => Math.max(m, a.id || 0), counter);
  renderAll();
});

function broadcast() {
  ipcRenderer.send('areas-sync', areas);
}

// ===== РЕНДЕР =====
function renderAll() {
  document.querySelectorAll('.area-box').forEach(el => el.remove());
  areas.forEach(a => {
    const box = document.createElement('div');
    box.className = 'area-box' + (a.id === selectedId ? ' selected' : '');
    box.dataset.id = a.id;
    box.style.left = (a.x - bounds.x) + 'px';
    box.style.top = (a.y - bounds.y) + 'px';
    box.style.width = a.w + 'px';
    box.style.height = a.h + 'px';
    box.innerHTML = `<div class="area-title">${a.name}</div><div class="area-resize"></div>`;
    overlay.appendChild(box);
  });
}

function updateBox(a) {
  const box = document.querySelector(`.area-box[data-id="${a.id}"]`);
  if (!box) return;
  box.style.left = (a.x - bounds.x) + 'px';
  box.style.top = (a.y - bounds.y) + 'px';
  box.style.width = a.w + 'px';
  box.style.height = a.h + 'px';
}

// ===== МЫШЬ =====
overlay.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = local(e);

  const resizeHandle = e.target.closest('.area-resize');
  if (resizeHandle) {
    const id = +resizeHandle.parentElement.dataset.id;
    const a = areas.find(x => x.id === id);
    selectedId = id; mode = 'resize';
    st = { id, sx: p.x, sy: p.y, w: a.w, h: a.h };
    renderAll();
    return;
  }

  const box = e.target.closest('.area-box');
  if (box) {
    const id = +box.dataset.id;
    const a = areas.find(x => x.id === id);
    selectedId = id; mode = 'move';
    st = { id, sx: p.x, sy: p.y, x: a.x, y: a.y };   // x, y — абсолютные
    renderAll();
    return;
  }

  // Пустое место — рисование новой области
  selectedId = null;
  renderAll();
  mode = 'draw';
  st = { sx: p.x, sy: p.y };
  drawBox.style.display = 'block';
  sizeLabel.style.display = 'block';
});

document.addEventListener('mousemove', (e) => {
  if (!mode || !st) return;
  const p = local(e);
  const dx = p.x - st.sx;
  const dy = p.y - st.sy;

  if (mode === 'draw') {
    const x = Math.min(st.sx, p.x), y = Math.min(st.sy, p.y);
    const w = Math.abs(dx), h = Math.abs(dy);
    drawBox.style.left = x + 'px';
    drawBox.style.top = y + 'px';
    drawBox.style.width = w + 'px';
    drawBox.style.height = h + 'px';
    sizeLabel.style.left = (x + w + 8) + 'px';
    sizeLabel.style.top = (y + h + 8) + 'px';
    sizeLabel.textContent = `${w} × ${h}`;
  } else if (mode === 'move') {
    const a = areas.find(x => x.id === st.id);
    // БЕЗ повторного прибавления bounds: st.x уже абсолютная
    a.x = clamp(st.x + dx, bounds.x, bounds.x + bounds.width - a.w);
    a.y = clamp(st.y + dy, bounds.y, bounds.y + bounds.height - a.h);
    updateBox(a);
  } else if (mode === 'resize') {
    const a = areas.find(x => x.id === st.id);
    a.w = clamp(st.w + dx, 20, bounds.x + bounds.width - a.x);
    a.h = clamp(st.h + dy, 10, bounds.y + bounds.height - a.y);
    updateBox(a);
  }
});

document.addEventListener('mouseup', (e) => {
  if (!mode || !st) return;

  if (mode === 'draw') {
    const p = local(e);
    const x = Math.min(st.sx, p.x), y = Math.min(st.sy, p.y);
    const w = Math.abs(p.x - st.sx), h = Math.abs(p.y - st.sy);
    drawBox.style.display = 'none';
    sizeLabel.style.display = 'none';
    if (w >= 10 && h >= 10) {
      counter += 1;
      const area = { id: counter, name: `Область ${counter}`, x: bounds.x + x, y: bounds.y + y, w, h };
      areas.push(area);
      selectedId = area.id;
      renderAll();
      broadcast();
    }
  } else {
    broadcast(); // перемещение/ресайз завершилось — синхронизируем
  }

  mode = null;
  st = null;
});

// ===== ПЕРЕИМЕНОВАНИЕ ПРАВОЙ КНОПКОЙ МЫШИ =====
overlay.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const box = e.target.closest('.area-box');
  if (!box) return;
  const a = areas.find(x => x.id === +box.dataset.id);
  if (!a) return;
  const name = prompt('Название области:', a.name);
  if (name !== null && name.trim()) {
    a.name = name.trim();
    renderAll();
    broadcast();
  }
});

// ===== КЛАВИШИ =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ipcRenderer.send('close-areas-overlay');
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
    areas = areas.filter(a => a.id !== selectedId);
    selectedId = null;
    renderAll();
    broadcast();
  }
});

// ===== ПАНЕЛЬ =====
toolbar.addEventListener('mousedown', (e) => e.stopPropagation());

saveBtn.addEventListener('click', () => {
  ipcRenderer.invoke('save-areas', areas).then(res => {
    if (res && res.ok) {
      saveBtn.textContent = 'Сохранено ✓';
      setTimeout(() => { saveBtn.textContent = 'Сохранить'; }, 1500);
    } else {
      alert('Ошибка сохранения: ' + (res && res.error ? res.error : 'неизвестна'));
    }
  });
});

closeBtn.addEventListener('click', () => ipcRenderer.send('close-areas-overlay'));