// js/bots.js
const { ipcRenderer } = require('electron');

function initBots() {
    document.getElementById('editAreasBtn')?.addEventListener('click', () => {
        ipcRenderer.send('open-areas-overlay');
    });

    const startBtn = document.getElementById('testBotStart');
    const pauseBtn = document.getElementById('testBotPause');
    const stopBtn = document.getElementById('testBotStop');
    const statusEl = document.getElementById('testBotStatus');

    function updateButtonsUI(running, paused) {
        if (!startBtn || !pauseBtn || !stopBtn) return;
        
        if (!running) {
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.textContent = 'Запустить бота';
            
            pauseBtn.disabled = true;
            pauseBtn.style.opacity = '0.5';
            pauseBtn.textContent = 'Пауза (F9)';
            pauseBtn.classList.remove('active-pause');
            
            stopBtn.disabled = true;
            stopBtn.style.opacity = '0.5';
        } else {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.6';
            startBtn.textContent = 'Работает...';
            
            pauseBtn.disabled = false;
            pauseBtn.style.opacity = '1';
            pauseBtn.textContent = paused ? 'Продолжить (F9)' : 'Пауза (F9)';
            if (paused) pauseBtn.classList.add('active-pause');
            else pauseBtn.classList.remove('active-pause');
            
            stopBtn.disabled = false;
            stopBtn.style.opacity = '1';
        }
    }

    startBtn?.addEventListener('click', async () => {
        statusEl.textContent = 'Запуск...';
        statusEl.className = 'bot-status active';
        updateButtonsUI(true, false);
        
        const res = await ipcRenderer.invoke('start-test-bot');
        if (!res.ok) {
            statusEl.textContent = 'Ошибка: ' + res.error;
            statusEl.className = 'bot-status inactive';
            alert(res.error);
            updateButtonsUI(false, false);
        }
    });

    pauseBtn?.addEventListener('click', () => {
        if (pauseBtn.textContent.includes('Пауза')) {
            ipcRenderer.send('pause-test-bot');
        } else {
            ipcRenderer.send('resume-test-bot');
        }
    });

    stopBtn?.addEventListener('click', () => {
        ipcRenderer.send('stop-test-bot');
    });

    ipcRenderer.on('test-bot-status', (e, s) => {
        if (!statusEl) return;
        statusEl.textContent = s.text;
        statusEl.className = 'bot-status ' + (s.running ? 'active' : 'inactive');
        updateButtonsUI(s.running, s.paused);
    });
}

module.exports = { initBots };