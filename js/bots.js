// js/bots.js
const { ipcRenderer } = require('electron');

function initBots() {
  document.getElementById('editAreasBtn')?.addEventListener('click', () => {
    ipcRenderer.send('open-areas-overlay');
  });

  const startBtn = document.getElementById('testBotStart');
  const statusEl = document.getElementById('testBotStatus');

  startBtn?.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.6';
    statusEl.textContent = 'Запуск...';
    statusEl.className = 'bot-status active';

    const res = await ipcRenderer.invoke('start-test-bot');
    if (!res.ok) {
      statusEl.textContent = 'Ошибка';
      statusEl.className = 'bot-status inactive';
      alert(res.error);
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
    }
  });

  ipcRenderer.on('test-bot-status', (e, s) => {
    if (!statusEl || !startBtn) return;
    statusEl.textContent = s.text;
    statusEl.className = 'bot-status ' + (s.running ? 'active' : 'inactive');
    if (!s.running) {
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
    }
  });
}

module.exports = { initBots };