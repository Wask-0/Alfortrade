// js/bots.js
const { ipcRenderer } = require('electron');

function initBots() {
    document.getElementById('editAreasBtn')?.addEventListener('click', () => {
        ipcRenderer.send('open-areas-overlay');
    });

    const botsListContainer = document.getElementById('botsListContainer');
    if (!botsListContainer) return;

    const botsState = {};

    function updateBotUI(botId, running, paused) {
        const state = botsState[botId];
        if (!state) return;

        const startBtn = state.elements.startBtn;
        const pauseBtn = state.elements.pauseBtn;
        const stopBtn = state.elements.stopBtn;

        if (!running) {
            startBtn.disabled = false;
            startBtn.textContent = 'Запустить';
            
            pauseBtn.disabled = true;
            pauseBtn.textContent = 'Пауза (F9)';
            pauseBtn.classList.remove('active-pause');
            
            stopBtn.disabled = true;
        } else {
            startBtn.disabled = true;
            startBtn.textContent = 'Работает...';
            
            pauseBtn.disabled = false;
            pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза (F9)';
            if (paused) pauseBtn.classList.add('active-pause');
            else pauseBtn.classList.remove('active-pause');
            
            stopBtn.disabled = false;
        }
    }

    async function loadAndRenderBots() {
        const bots = await ipcRenderer.invoke('get-bots-list');
        botsListContainer.innerHTML = '';
        
        if (bots.length === 0) {
            botsListContainer.innerHTML = '<div style="color: var(--text-primary); opacity: 0.5; text-align: center; padding: 20px;">Нет доступных ботов. Проверьте bots-config.json</div>';
            return;
        }

        bots.forEach(bot => {
            botsState[bot.id] = { elements: {} };

            const row = document.createElement('div');
            row.className = 'bot-row';
            
            row.innerHTML = `
                <div class="bot-info">
                    <div class="bot-name">${bot.name}</div>
                    <div class="bot-desc">${bot.description}</div>
                </div>
                <span class="bot-status inactive" id="status-${bot.id}">Ожидание</span>
                <div class="bot-controls">
                    <button class="bot-btn start" id="start-${bot.id}">Запустить</button>
                    <button class="bot-btn pause" id="pause-${bot.id}" disabled>Пауза (F9)</button>
                    <button class="bot-btn stop" id="stop-${bot.id}" disabled>Стоп (F10)</button>
                </div>
            `;
            
            botsListContainer.appendChild(row);

            const state = botsState[bot.id];
            state.elements.startBtn = document.getElementById(`start-${bot.id}`);
            state.elements.pauseBtn = document.getElementById(`pause-${bot.id}`);
            state.elements.stopBtn = document.getElementById(`stop-${bot.id}`);
            state.elements.statusEl = document.getElementById(`status-${bot.id}`);

            state.elements.startBtn.addEventListener('click', async () => {
                state.elements.statusEl.textContent = 'Запуск...';
                state.elements.statusEl.className = 'bot-status active';
                updateBotUI(bot.id, true, false);
                
                const res = await ipcRenderer.invoke('start-test-bot', bot.id);
                if (!res.ok) {
                    state.elements.statusEl.textContent = 'Ошибка';
                    state.elements.statusEl.className = 'bot-status inactive';
                    alert(res.error);
                    updateBotUI(bot.id, false, false);
                }
            });

            state.elements.pauseBtn.addEventListener('click', () => {
                if (state.elements.pauseBtn.textContent.includes('Пауза')) {
                    ipcRenderer.send('pause-test-bot', bot.id);
                } else {
                    ipcRenderer.send('resume-test-bot', bot.id);
                }
            });

            state.elements.stopBtn.addEventListener('click', () => {
                ipcRenderer.send('stop-test-bot', bot.id);
            });
        });
    }

    loadAndRenderBots();

    ipcRenderer.on('test-bot-status', (e, s) => {
        if (!s.botId || !botsState[s.botId]) return;
        
        const state = botsState[s.botId];
        state.elements.statusEl.textContent = s.text;
        state.elements.statusEl.className = 'bot-status ' + (s.running ? 'active' : 'inactive');
        updateBotUI(s.botId, s.running, s.paused);
    });
}

module.exports = { initBots };