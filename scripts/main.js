import { splitIntoChunks } from './utils/chunk.js';
import { cleanLyrics, cleanPunctuation } from './utils/text.js';
import { bindLegacyInlineHandlers } from './features/navigation.js';
import { createAudioApi } from './features/audio.js';
import { toggleDyslexicMode as toggleDyslexicModeImpl } from './features/accessibility.js';
import { THEMES } from './config/themes.js';
import { presets } from './config/presets.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config/supabase.js';

window.incrementPracticeCounter = window.incrementPracticeCounter || (() => {});
window.toggleSavedWord = window.toggleSavedWord || (() => {});
window.isWordSaved = window.isWordSaved || (() => false);
window.saveGameResult = undefined;

const KNOWN_YOUTUBE_VIDEO_IDS = {
    'neck deep|kali ma': ['aYpDYuoEA4U', 'uKw7oEvzL_Y']
};

function normalizeSongKey(artist, title) {
    const clean = (v) => (v || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `${clean(artist)}|${clean(title)}`;
}

bindLegacyInlineHandlers();

        // --- SOUND MANAGER ---
        const { playSound, toggleSound } = createAudioApi();
        window.toggleSound = toggleSound;

        // --- THEME LOGIC ---
        function loadTheme() {
            const savedTheme = localStorage.getItem('icarus_theme') || 'icarus';
            setTheme(savedTheme);
            renderThemeSelector();
        }

        function setTheme(themeName) {
            const theme = THEMES[themeName];
            if (!theme) return;
            
            const root = document.documentElement;
            for (const [key, value] of Object.entries(theme)) {
                root.style.setProperty(key, value);
            }
            
            localStorage.setItem('icarus_theme', themeName);
            renderThemeSelector(); 
        }

        function renderThemeSelector() {
            const container = document.getElementById('theme-selector');
            if (!container) return;
            container.innerHTML = '';
            
            const currentTheme = localStorage.getItem('icarus_theme') || 'icarus';
            
            for (const [key, val] of Object.entries(THEMES)) {
                const btn = document.createElement('div');
                btn.className = `theme-btn ${key === currentTheme ? 'active' : ''}`;
                btn.onclick = () => setTheme(key);
                
                const previewColor = val['--main-color'];
                const previewBg = val['--bg-color'];
                
                btn.innerHTML = `
                    <div class="theme-preview" style="background:${previewColor}; border: 2px solid ${previewBg};"></div>
                    <span class="capitalize text-sub">${key}</span>
                `;
                container.appendChild(btn);
            }
        }

        loadTheme();

        // --- VIRTUAL KEYBOARD ---
        const KEYS = [
            'q w e r t y u i o p',
            'a s d f g h j k l',
            'z x c v b n m'
        ];

        function initVirtualKeyboard() {
            const container = document.getElementById('virtual-keyboard');
            container.innerHTML = '';
            
            KEYS.forEach(rowStr => {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'kb-row';
                rowStr.split(' ').forEach(key => {
                    const btn = document.createElement('div');
                    btn.className = 'kb-key';
                    btn.setAttribute('data-key', key);
                    btn.textContent = key;
                    // No onclick, visual only
                    rowDiv.appendChild(btn);
                });
                container.appendChild(rowDiv);
            });
            
            const bottomRow = document.createElement('div');
            bottomRow.className = 'kb-row';
            
            const space = document.createElement('div');
            space.className = 'kb-key kb-space';
            space.setAttribute('data-key', ' ');
            space.textContent = ''; 
            // No onclick
            
            const back = document.createElement('div');
            back.className = 'kb-key kb-backspace';
            back.setAttribute('data-key', 'Backspace');
            back.innerHTML = '⌫';
            // No onclick
            
            bottomRow.appendChild(space);
            bottomRow.appendChild(back);
            container.appendChild(bottomRow);
        }

        // Removed handleVirtualKey as it's visual only
        
        function toggleDyslexicMode() { return toggleDyslexicModeImpl(); }
        window.toggleDyslexicMode = toggleDyslexicMode;
        
        initVirtualKeyboard();

        const wordTranslationCache = new Map();
        let popoverWord = null;

        function closeWordPopover() {
            document.getElementById('word-popover').style.display = 'none';
            document.getElementById('popover-overlay').style.display = 'none';
            document.getElementById('popover-content').innerHTML = '<span class="text-sub text-xs italic">Loading...</span>';
            focusTypingInput();
        }

        function handleWordClick(e, word) {
            state.isPlaying = false;
            clearInterval(state.timerInterval);
            
            popoverWord = word.replace(/[.,!?;:"()]/g, ''); 
            const popover = document.getElementById('word-popover');
            const overlay = document.getElementById('popover-overlay');
            const titleEl = document.getElementById('popover-word-title');
            const speakBtn = document.getElementById('popover-speak-btn');
            const btnTrans = document.getElementById('btn-trans');
            const saveBtn = document.getElementById('popover-save-btn');
            
            if (window.isWordSaved && window.isWordSaved(popoverWord)) {
                 saveBtn.classList.add('text-main');
            } else {
                 saveBtn.classList.remove('text-main');
            }
            
            const wordEl = e.target.closest('.word');
            let isLocked = false;
            if (state.isClozeMode && wordEl && wordEl.classList.contains('cloze-target')) {
                 if (!wordEl.classList.contains('revealed')) {
                     isLocked = true;
                 }
            }

            if (isLocked) {
                 titleEl.textContent = "???";
                 titleEl.classList.add('italic', 'opacity-50');
                 speakBtn.style.display = 'none'; 
                 btnTrans.style.pointerEvents = 'none';
                 btnTrans.style.opacity = '0.5';
                 btnTrans.textContent = "Locked";
                 showDefinition();
            } else {
                 titleEl.textContent = popoverWord;
                 titleEl.classList.remove('italic', 'opacity-50');
                 speakBtn.style.display = 'block';
                 btnTrans.style.pointerEvents = 'auto';
                 btnTrans.style.opacity = '1';
                 btnTrans.textContent = "Translation";
                 showDefinition();
            }
            
            const rect = wordEl ? wordEl.getBoundingClientRect() : e.target.getBoundingClientRect();
            let top = rect.top - 10 - popover.offsetHeight; 
            popover.style.display = 'flex';
            popover.style.opacity = '0';
            
            const popHeight = popover.offsetHeight || 150;
            const popWidth = popover.offsetWidth || 220;
            
            top = rect.top - popHeight - 10;
            let left = rect.left + (rect.width / 2) - (popWidth / 2);
            
            if (top < 10) top = rect.bottom + 10; 
            if (left < 10) left = 10;
            if (left + popWidth > window.innerWidth - 10) left = window.innerWidth - popWidth - 10;
            
            popover.style.top = `${top + window.scrollY}px`;
            popover.style.left = `${left + window.scrollX}px`;
            popover.style.opacity = '1';
            
            overlay.style.display = 'block';
        }
        
        window.handleWordClick = handleWordClick;
        window.closeWordPopover = closeWordPopover;

        async function showDefinition() {
            if(!popoverWord) return;
            document.getElementById('btn-def').classList.add('active');
            document.getElementById('btn-trans').classList.remove('active');

            const content = document.getElementById('popover-content');
            content.innerHTML = '<div class="loader mx-auto"></div>';
            
            try {
                const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${popoverWord}`);
                const data = await res.json();
                
                if (Array.isArray(data)) {
                    const meanings = data[0].meanings.slice(0, 2); 
                    let html = '';
                    meanings.forEach(m => {
                        html += `<div class="mb-2"><span class="def-part-speech">${m.partOfSpeech}</span> ${m.definitions[0].definition}</div>`;
                    });
                    content.innerHTML = html;
                } else {
                    content.innerHTML = '<div class="text-center text-error">Definition not found.</div>';
                }
            } catch (e) {
                content.innerHTML = '<div class="text-center text-error">Error fetching definition.</div>';
            }
        }
        window.showDefinition = showDefinition;

        async function showTranslation() {
            if(!popoverWord) return;
            document.getElementById('btn-trans').classList.add('active');
            document.getElementById('btn-def').classList.remove('active');

            const content = document.getElementById('popover-content');
            content.innerHTML = '<div class="loader mx-auto"></div>';
            
            let cached = wordTranslationCache.get(popoverWord.toLowerCase());
            if (cached) {
                content.innerHTML = `<div class="text-center text-lg font-bold text-main">${cached}</div>`;
                return;
            }

            try {
                const trans = await fetchTranslation(popoverWord);
                wordTranslationCache.set(popoverWord.toLowerCase(), trans);
                content.innerHTML = `<div class="text-center text-lg font-bold text-main">${trans}</div>`;
            } catch (e) {
                content.innerHTML = '<div class="text-center text-error">Translation error.</div>';
            }
        }
        window.showTranslation = showTranslation;

        const state = {
            lines: [],
            transLines: [],
            words: [],
            wordElements: [],
            currentWordIndex: 0,
            startTime: null,
            endTime: null,
            correctChars: 0,
            incorrectChars: 0,
            extraChars: 0,
            timerInterval: null,
            isPlaying: false,
            isPreviewMode: false,
            songTitle: '',
            artist: '',
            history: [],
            missedWords: new Set(),
            searchCache: new Map(),
            isFetching: false,
            pendingNav: null,
            abortController: null,
            wordsCorrect: 0,
            wordsWrong: 0,
            currentCombo: 0,
            isEasyMode: false,
            isAutoSpeak: false,
            isClozeMode: false,
            isRhythmMode: false,
            clozeIndices: new Set(),
            lineWordRanges: [],
            wordToLineMap: [],
            syncedLyricsRaw: '',
            syncedTimeline: [],
            rhythmTimeoutId: null,
            rhythmAnchorMs: 0,
            rhythmStarted: false,
            musicWordIndex: 0,
            cpuFinishedAt: null,
            cpuExpectedFinishAt: null,
            youtubeEmbedUrl: '',
            youtubeSearchUrl: '',
            youtubeEmbedCandidates: [],
            youtubeCandidateIndex: 0,
            wpmHistory: [],
            previousRun: null,
            practiceQueue: [],
            currentPracticeIndex: 0,
            isCustomGame: false,
            tooltipTimeout: null,
            isSoundEnabled: false 
        };

        const elements = {
            setupArea: document.getElementById('setup-area'),
            gameArea: document.getElementById('game-area'),
            resultsArea: document.getElementById('results-area'),
            wordsContainer: document.getElementById('words'),
            wordsWrapper: document.getElementById('words-wrapper'),
            input: document.getElementById('typing-input'),
            caret: document.getElementById('caret'),
            musicCaret: document.getElementById('music-caret'),
            liveWpm: document.getElementById('live-wpm'),
            liveWpmDiff: document.getElementById('live-wpm-diff'),
            liveCombo: document.getElementById('live-combo'),
            liveCorrect: document.getElementById('live-correct'),
            liveWrong: document.getElementById('live-wrong'),
            statsWordCount: document.getElementById('stats-word-count'),
            statsTotalWords: document.getElementById('stats-total-words'),
            navSearch: document.getElementById('nav-search'),
            navPresets: document.getElementById('nav-presets'),
            navCustom: document.getElementById('nav-custom'),
            btnToggleEasy: document.getElementById('btn-toggle-easy'),
            btnToggleSpeak: document.getElementById('btn-toggle-speak'),
            btnToggleVideo: document.getElementById('btn-toggle-video'),
            viewSearch: document.getElementById('view-search'),
            viewPresets: document.getElementById('view-presets'),
            viewCustom: document.getElementById('view-custom'),
            artistInput: document.getElementById('input-artist'),
            titleInput: document.getElementById('input-title'),
            customText: document.getElementById('custom-text-area'),
            customTrans: document.getElementById('custom-translation-area'),
            customTransContainer: document.getElementById('custom-translation-container'),
            missedWordsContainer: document.getElementById('missed-words-container'),
            missedWordsList: document.getElementById('missed-words-list'),
            resWpmBig: document.getElementById('res-wpm-big'),
            resAccBig: document.getElementById('res-acc-big'),
            resRaw: document.getElementById('res-raw'),
            resCharTotal: document.getElementById('res-char-total'),
            resCharErr: document.getElementById('res-char-err'),
            resConsistency: document.getElementById('res-consistency'),
            resTimeVal: document.getElementById('res-time-val'),
            resCpuFinish: document.getElementById('res-cpu-finish'),
            resUserFinish: document.getElementById('res-user-finish'),
            resRaceDiff: document.getElementById('res-race-diff'),
            chartCanvas: document.getElementById('wpm-chart'),
            modal: document.getElementById('modal-overlay'),
            restartModal: document.getElementById('restart-modal-overlay'),
            practiceModal: document.getElementById('practice-modal-overlay'),
            practiceContainer: document.getElementById('practice-container'),
            practiceProgress: document.getElementById('practice-progress'),
            searchStatus: document.getElementById('search-status-text'),
            searchBar: document.getElementById('search-progress-bar'),
            searchStatusContainer: document.getElementById('search-status-container'),
            searchErrorContainer: document.getElementById('search-error-container'),
            searchError: document.getElementById('search-error'),
            googleFallbackLink: document.getElementById('google-fallback-link'),
            toastContainer: document.getElementById('toast-container'),
            videoPanel: document.getElementById('video-pip-panel'),
            videoFrame: document.getElementById('video-pip-frame'),
            videoSearchLink: document.getElementById('video-search-link'),
            authGuestView: document.getElementById('auth-guest-view'),
            authUserView: document.getElementById('auth-user-view'),
            authTabLogin: document.getElementById('auth-tab-login'),
            authTabRegister: document.getElementById('auth-tab-register'),
            authLoginForm: document.getElementById('auth-login-form'),
            authRegisterForm: document.getElementById('auth-register-form'),
            authLoginEmail: document.getElementById('auth-login-email'),
            authLoginPassword: document.getElementById('auth-login-password'),
            authRememberMe: document.getElementById('auth-remember-me'),
            authRegisterUsername: document.getElementById('auth-register-username'),
            authRegisterEmail: document.getElementById('auth-register-email'),
            authRegisterEmailVerify: document.getElementById('auth-register-email-verify'),
            authRegisterPassword: document.getElementById('auth-register-password'),
            authRegisterPasswordVerify: document.getElementById('auth-register-password-verify'),
            authUserName: document.getElementById('auth-user-name'),
            authUserEmail: document.getElementById('auth-user-email'),
            authDeletePassword: document.getElementById('auth-delete-password'),
            authStatGames: document.getElementById('auth-stat-games'),
            authStatBestWpm: document.getElementById('auth-stat-best-wpm'),
            authStatAvgWpm: document.getElementById('auth-stat-avg-wpm'),
            authStatAvgAcc: document.getElementById('auth-stat-avg-acc'),
            authRecentResults: document.getElementById('auth-recent-results')
        };

        function initSpeech() { window.speechSynthesis.getVoices(); }
        initSpeech();
        if (speechSynthesis.onvoiceschanged !== undefined) { speechSynthesis.onvoiceschanged = initSpeech; }

        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `<span class="toast-icon"></span><span>${message}</span>`;
            elements.toastContainer.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        const AUTH_SESSION_KEY = 'icarus_supabase_session_v1';
        const AUTH_PERSIST_MODE_KEY = 'icarus_supabase_persist_v1';
        const AUTH_MAX_ATTEMPTS = 8;
        const AUTH_WINDOW_MS = 10 * 60 * 1000;
        const AUTH_LOCK_MS = 60 * 1000;
        const AUTH_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
        let authTab = 'login';
        const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
        const supabase = hasSupabaseConfig
            ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: false,
                    autoRefreshToken: true,
                    detectSessionInUrl: false
                }
            })
            : null;
        let authCurrentUser = null;
        let authIdleTimer = null;
        const authAttempts = { login: [], register: [] };

        function normalizeEmail(email) {
            return (email || '').trim().toLowerCase();
        }

        function validatePasswordStrength(password) {
            const rules = [
                { ok: password.length >= 10, msg: 'Password must have at least 10 characters.' },
                { ok: /[a-z]/.test(password), msg: 'Password needs a lowercase letter.' },
                { ok: /[A-Z]/.test(password), msg: 'Password needs an uppercase letter.' },
                { ok: /\d/.test(password), msg: 'Password needs a number.' },
                { ok: /[^A-Za-z0-9]/.test(password), msg: 'Password needs a special character.' }
            ];
            const failed = rules.find((r) => !r.ok);
            return failed ? failed.msg : '';
        }

        function pruneAuthAttempts(type) {
            const now = Date.now();
            authAttempts[type] = authAttempts[type].filter((ts) => now - ts <= AUTH_WINDOW_MS);
        }

        function isAuthLocked(type) {
            pruneAuthAttempts(type);
            const attempts = authAttempts[type];
            if (attempts.length < AUTH_MAX_ATTEMPTS) return false;
            const lockFrom = attempts[attempts.length - AUTH_MAX_ATTEMPTS];
            return (Date.now() - lockFrom) < AUTH_LOCK_MS;
        }

        function recordAuthAttempt(type, success) {
            if (success) {
                authAttempts[type] = [];
                return;
            }
            authAttempts[type].push(Date.now());
            pruneAuthAttempts(type);
        }

        function resetAuthIdleTimer() {
            if (authIdleTimer) {
                clearTimeout(authIdleTimer);
                authIdleTimer = null;
            }
            if (!authCurrentUser) return;
            authIdleTimer = setTimeout(async () => {
                await logoutAccount(false);
                showToast('Session ended due to inactivity.', 'info');
            }, AUTH_IDLE_TIMEOUT_MS);
        }

        function bindAuthActivityWatchers() {
            const bump = () => resetAuthIdleTimer();
            ['click', 'keydown', 'touchstart', 'mousemove'].forEach((evt) => {
                document.addEventListener(evt, bump, { passive: true });
            });
        }

        function readStoredSession() {
            try {
                const raw = localStorage.getItem(AUTH_SESSION_KEY) || sessionStorage.getItem(AUTH_SESSION_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        }

        function writeStoredSession(session, remember) {
            if (!session) return;
            const safeSession = {
                access_token: session.access_token,
                refresh_token: session.refresh_token
            };
            if (remember) {
                localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(safeSession));
                sessionStorage.removeItem(AUTH_SESSION_KEY);
                return;
            }
            sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(safeSession));
            localStorage.removeItem(AUTH_SESSION_KEY);
        }

        function setPersistMode(remember) {
            localStorage.setItem(AUTH_PERSIST_MODE_KEY, remember ? '1' : '0');
        }

        function shouldPersistSession() {
            return localStorage.getItem(AUTH_PERSIST_MODE_KEY) === '1';
        }

        function clearAuthSession() {
            localStorage.removeItem(AUTH_SESSION_KEY);
            sessionStorage.removeItem(AUTH_SESSION_KEY);
        }

        async function bootstrapAuthSession() {
            if (!supabase) return;
            const stored = readStoredSession();
            if (!stored?.access_token || !stored?.refresh_token) return;
            await supabase.auth.setSession(stored);
        }

        async function syncCurrentUser() {
            if (!supabase) {
                authCurrentUser = null;
                return null;
            }
            const { data } = await supabase.auth.getUser();
            authCurrentUser = data?.user || null;
            resetAuthIdleTimer();
            return authCurrentUser;
        }

        async function getCurrentProfile(userId) {
            if (!supabase || !userId) return null;
            const { data } = await supabase
                .from('profiles')
                .select('username,email')
                .eq('id', userId)
                .maybeSingle();
            return data || null;
        }

        async function ensureProfileForUser(user, usernameOverride) {
            if (!supabase || !user) return;
            const usernameFallback = (user.user_metadata?.username || user.email?.split('@')[0] || 'user').trim();
            const username = (usernameOverride || usernameFallback).trim();
            await supabase.from('profiles').upsert({
                id: user.id,
                email: user.email,
                username
            });
        }

        function resetAuthDashboardUI() {
            if (elements.authStatGames) elements.authStatGames.textContent = '0';
            if (elements.authStatBestWpm) elements.authStatBestWpm.textContent = '0';
            if (elements.authStatAvgWpm) elements.authStatAvgWpm.textContent = '0';
            if (elements.authStatAvgAcc) elements.authStatAvgAcc.textContent = '0%';
            if (elements.authRecentResults) {
                elements.authRecentResults.innerHTML = '<div class="auth-recent-empty">No saved games yet.</div>';
            }
        }

        function renderRecentResults(rows) {
            if (!elements.authRecentResults) return;
            if (!rows || rows.length === 0) {
                elements.authRecentResults.innerHTML = '<div class="auth-recent-empty">No saved games yet.</div>';
                return;
            }
            const escapeHtml = (text) => String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const html = rows.slice(0, 8).map((row) => {
                const title = (row.song_title && row.artist)
                    ? `${row.artist} - ${row.song_title}`
                    : (row.song_title || row.artist || 'Custom lyrics');
                const mode = (row.mode || 'normal').toUpperCase();
                const when = row.created_at ? new Date(row.created_at).toLocaleDateString() : '';
                return `
                    <div class="auth-recent-item">
                        <div>
                            <div class="auth-recent-title">${escapeHtml(title)}</div>
                            <div class="auth-recent-meta">${escapeHtml(mode)}${when ? ` - ${escapeHtml(when)}` : ''}</div>
                        </div>
                        <div class="auth-recent-score">${row.wpm || 0} WPM - ${row.accuracy || 0}%</div>
                    </div>
                `;
            }).join('');
            elements.authRecentResults.innerHTML = html;
        }

        async function loadUserGameStats(userId) {
            if (!supabase || !userId) return;
            const { data, error } = await supabase
                .from('game_results')
                .select('wpm,accuracy,mode,created_at,song_title,artist')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(200);

            if (error || !data) {
                resetAuthDashboardUI();
                return;
            }

            const games = data.length;
            const bestWpm = games > 0 ? Math.max(...data.map((r) => Number(r.wpm) || 0)) : 0;
            const avgWpm = games > 0 ? Math.round(data.reduce((sum, r) => sum + (Number(r.wpm) || 0), 0) / games) : 0;
            const avgAcc = games > 0 ? Math.round(data.reduce((sum, r) => sum + (Number(r.accuracy) || 0), 0) / games) : 0;

            if (elements.authStatGames) elements.authStatGames.textContent = String(games);
            if (elements.authStatBestWpm) elements.authStatBestWpm.textContent = String(bestWpm);
            if (elements.authStatAvgWpm) elements.authStatAvgWpm.textContent = String(avgWpm);
            if (elements.authStatAvgAcc) elements.authStatAvgAcc.textContent = `${avgAcc}%`;
            renderRecentResults(data);
        }

        async function saveGameResultToCloud(result) {
            if (!supabase) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) return;
            const payload = {
                user_id: user.id,
                song_title: result.songTitle || null,
                artist: result.artist || null,
                mode: result.mode || 'normal',
                wpm: result.wpm || 0,
                accuracy: result.accuracy || 0,
                words_correct: result.wordsCorrect || 0,
                words_wrong: result.wordsWrong || 0,
                total_chars: result.totalChars || 0,
                incorrect_chars: result.incorrectChars || 0,
                extra_chars: result.extraChars || 0,
                duration_seconds: result.durationSeconds || 0
            };
            const { error } = await supabase.from('game_results').insert(payload);
            if (error) {
                console.error('Could not save result', error);
                return;
            }
            await loadUserGameStats(user.id);
        }

        function ensureSupabaseReady() {
            if (supabase) return true;
            showToast('Configure Supabase URL and anon key in scripts/config/supabase.js first.', 'error');
            return false;
        }

        function clearAuthFormInputs() {
            if (elements.authLoginEmail) elements.authLoginEmail.value = '';
            if (elements.authLoginPassword) elements.authLoginPassword.value = '';
            if (elements.authRememberMe) elements.authRememberMe.checked = false;
            if (elements.authRegisterUsername) elements.authRegisterUsername.value = '';
            if (elements.authRegisterEmail) elements.authRegisterEmail.value = '';
            if (elements.authRegisterEmailVerify) elements.authRegisterEmailVerify.value = '';
            if (elements.authRegisterPassword) elements.authRegisterPassword.value = '';
            if (elements.authRegisterPasswordVerify) elements.authRegisterPasswordVerify.value = '';
            if (elements.authDeletePassword) elements.authDeletePassword.value = '';
        }

        function switchAuthTab(tab) {
            authTab = tab === 'register' ? 'register' : 'login';
            if (!elements.authLoginForm || !elements.authRegisterForm) return;
            elements.authTabLogin?.classList.toggle('active', authTab === 'login');
            elements.authTabRegister?.classList.toggle('active', authTab === 'register');
            elements.authLoginForm.classList.toggle('hidden', authTab !== 'login');
            elements.authRegisterForm.classList.toggle('hidden', authTab !== 'register');
        }

        async function refreshAuthUI() {
            const user = await syncCurrentUser();
            const isLoggedIn = !!user;
            elements.authGuestView?.classList.toggle('hidden', isLoggedIn);
            elements.authUserView?.classList.toggle('hidden', !isLoggedIn);

            if (isLoggedIn) {
                const profile = await getCurrentProfile(user.id);
                const username = profile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'user';
                const email = profile?.email || user.email || '';
                if (elements.authUserName) elements.authUserName.textContent = username;
                if (elements.authUserEmail) elements.authUserEmail.textContent = email;
                if (elements.authDeletePassword) elements.authDeletePassword.value = '';
                await loadUserGameStats(user.id);
            } else {
                resetAuthDashboardUI();
                if (elements.authRememberMe) elements.authRememberMe.checked = shouldPersistSession();
                switchAuthTab(authTab);
            }
        }

        async function registerAccount() {
            if (!ensureSupabaseReady()) return;
            if (isAuthLocked('register')) {
                showToast('Too many signup attempts. Try again in a minute.', 'error');
                return;
            }
            const username = (elements.authRegisterUsername?.value || '').trim();
            const email = normalizeEmail(elements.authRegisterEmail?.value || '');
            const verifyEmail = normalizeEmail(elements.authRegisterEmailVerify?.value || '');
            const password = elements.authRegisterPassword?.value || '';
            const verifyPassword = elements.authRegisterPasswordVerify?.value || '';

            if (!username || !email || !verifyEmail || !password || !verifyPassword) {
                showToast('Please fill all register fields.', 'error');
                return;
            }
            if (email !== verifyEmail) {
                showToast('Email confirmation does not match.', 'error');
                return;
            }
            if (password !== verifyPassword) {
                showToast('Password confirmation does not match.', 'error');
                return;
            }
            const passwordError = validatePasswordStrength(password);
            if (passwordError) {
                showToast(passwordError, 'error');
                return;
            }

            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { username }
                }
            });
            if (error) {
                recordAuthAttempt('register', false);
                showToast('Could not create account. Check fields and try again.', 'error');
                return;
            }
            recordAuthAttempt('register', true);
            if (data?.session) {
                setPersistMode(true);
                writeStoredSession(data.session, true);
                await ensureProfileForUser(data.user, username);
                await refreshAuthUI();
                showToast('Account created and logged in.', 'info');
            } else {
                showToast('Account created. Check your email to confirm.', 'info');
            }
            clearAuthFormInputs();
        }

        async function loginAccount() {
            if (!ensureSupabaseReady()) return;
            if (isAuthLocked('login')) {
                showToast('Too many login attempts. Try again in a minute.', 'error');
                return;
            }
            const email = normalizeEmail(elements.authLoginEmail?.value || '');
            const password = elements.authLoginPassword?.value || '';
            const remember = !!elements.authRememberMe?.checked;

            if (!email || !password) {
                showToast('Enter email and password.', 'error');
                return;
            }

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error || !data?.session) {
                recordAuthAttempt('login', false);
                showToast('Login failed. Check your credentials.', 'error');
                return;
            }
            recordAuthAttempt('login', true);
            setPersistMode(remember);
            writeStoredSession(data.session, remember);
            clearAuthFormInputs();
            await ensureProfileForUser(data.user);
            await refreshAuthUI();
            showToast('Login successful.', 'info');
        }

        async function logoutAccount(showToastMessage = true) {
            if (!supabase) {
                clearAuthSession();
                await refreshAuthUI();
                switchAuthTab('login');
                return;
            }
            await supabase.auth.signOut();
            clearAuthSession();
            localStorage.removeItem(AUTH_PERSIST_MODE_KEY);
            await refreshAuthUI();
            switchAuthTab('login');
            if (showToastMessage) showToast('Logged out.', 'info');
        }

        async function deleteAccount() {
            if (!ensureSupabaseReady()) return;
            const user = await syncCurrentUser();
            if (!user) {
                showToast('You need to be logged in.', 'error');
                return;
            }
            const confirmed = window.confirm('Delete this account permanently from this device?');
            if (!confirmed) return;
            const password = elements.authDeletePassword?.value || '';
            if (!password) {
                showToast('Enter your password in the field above to delete the account.', 'error');
                return;
            }
            const reauth = await supabase.auth.signInWithPassword({
                email: user.email,
                password
            });
            if (reauth.error || !reauth.data?.session) {
                if (elements.authDeletePassword) elements.authDeletePassword.value = '';
                showToast('Reauthentication failed. Account was not deleted.', 'error');
                return;
            }
            writeStoredSession(reauth.data.session, shouldPersistSession());

            const { error } = await supabase.rpc('delete_my_account');
            if (error) {
                showToast(error.message || 'Could not delete account.', 'error');
                return;
            }
            await supabase.auth.signOut();
            clearAuthSession();
            localStorage.removeItem(AUTH_PERSIST_MODE_KEY);
            clearAuthFormInputs();
            switchAuthTab('register');
            await refreshAuthUI();
            showToast('Account deleted.', 'info');
        }

        function focusTypingInput() {
            if (!elements.input) return;
            if (document.activeElement === elements.input) return;
            const prevScrollX = window.scrollX;
            const prevScrollY = window.scrollY;
            try {
                elements.input.focus({ preventScroll: true });
            } catch (e) {
                elements.input.focus();
            }
            if (window.scrollX !== prevScrollX || window.scrollY !== prevScrollY) {
                window.scrollTo(prevScrollX, prevScrollY);
            }
            requestAnimationFrame(() => {
                if (window.scrollX !== prevScrollX || window.scrollY !== prevScrollY) {
                    window.scrollTo(prevScrollX, prevScrollY);
                }
            });
        }

        function closeOnboarding() {
            const onboarding = document.getElementById('onboarding-overlay');
            if (onboarding) onboarding.classList.add('hidden');
            localStorage.setItem('icarus_onboarding_seen', '1');
        }

        function parseSyncedLyrics(raw) {
            if (!raw) return [];
            const lines = raw.split('\n');
            const parsed = [];
            lines.forEach((line) => {
                const m = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
                if (!m) return;
                const mm = parseInt(m[1], 10);
                const ss = parseInt(m[2], 10);
                const frac = (m[3] || '0').padEnd(3, '0');
                const text = (m[4] || '').trim();
                if (!text) return;
                parsed.push({
                    timeMs: (mm * 60 * 1000) + (ss * 1000) + parseInt(frac, 10),
                    text
                });
            });
            return parsed.sort((a, b) => a.timeMs - b.timeMs);
        }

        function syncedToPlainLyrics(raw) {
            return parseSyncedLyrics(raw).map((p) => p.text).join('\n').trim();
        }

        function getLineIndexByWord(idx) {
            for (let i = 0; i < state.lineWordRanges.length; i++) {
                const range = state.lineWordRanges[i];
                if (idx >= range.start && idx <= range.end) return i;
            }
            return -1;
        }

        function getCurrentLineIndexByWord() {
            return getLineIndexByWord(state.currentWordIndex);
        }

        function updateMusicCursorVisual() {
            state.wordElements.forEach((el) => el.classList.remove('music-active'));
            if (!state.isRhythmMode) {
                if (elements.musicCaret) elements.musicCaret.style.display = 'none';
                return;
            }
            const musicEl = state.wordElements[state.musicWordIndex];
            if (musicEl) musicEl.classList.add('music-active');
            updateMusicCaretPosition();
        }

        function clearRhythmTimer() {
            if (state.rhythmTimeoutId) {
                clearTimeout(state.rhythmTimeoutId);
                state.rhythmTimeoutId = null;
            }
        }

        function getLineDurationMs(lineIndex) {
            const timeline = state.syncedTimeline;
            if (!timeline || timeline.length === 0) return 4500;
            const curr = timeline[lineIndex];
            const next = timeline[lineIndex + 1];
            if (!curr || !next) return 4500;
            const diff = next.timeMs - curr.timeMs;
            return Math.max(1800, Math.min(diff, 8000));
        }

        function scheduleRhythmDeadline() {
            clearRhythmTimer();
            if (!state.isRhythmMode || elements.gameArea.classList.contains('hidden')) return;
            if (!state.rhythmStarted) return;
            if (state.musicWordIndex >= state.words.length) return;
            const lineIndex = getLineIndexByWord(state.musicWordIndex);
            if (lineIndex < 0) return;
            const range = state.lineWordRanges[lineIndex];
            if (!range) return;
            const wordsInLine = Math.max(1, (range.end - range.start + 1));
            const wordOffset = Math.max(0, state.musicWordIndex - range.start);

            let delayMs = getLineDurationMs(lineIndex) / wordsInLine;
            if (state.syncedTimeline && state.syncedTimeline.length > 1) {
                const firstTs = state.syncedTimeline[0].timeMs;
                const lineStartTs = state.syncedTimeline[lineIndex]?.timeMs;
                const nextTs = state.syncedTimeline[lineIndex + 1]?.timeMs;
                if (lineStartTs != null && nextTs != null) {
                    const lineStartElapsed = Math.max(0, lineStartTs - firstTs);
                    const lineEndElapsed = Math.max(lineStartElapsed + 100, nextTs - firstTs);
                    const step = (lineEndElapsed - lineStartElapsed) / wordsInLine;
                    const targetElapsed = lineStartElapsed + (step * (wordOffset + 1));
                    const elapsed = Math.max(0, Date.now() - state.rhythmAnchorMs);
                    delayMs = Math.max(100, targetElapsed - elapsed);
                }
            }
            state.rhythmTimeoutId = setTimeout(() => forceAdvanceRhythmWord(lineIndex), delayMs);
        }

        function forceAdvanceRhythmWord(lineIndex) {
            if (!state.isRhythmMode || elements.gameArea.classList.contains('hidden')) return;
            if (!state.rhythmStarted) return;
            const range = state.lineWordRanges[lineIndex];
            if (!range) return;
            if (state.musicWordIndex > range.end) {
                scheduleRhythmDeadline();
                return;
            }

            const missed = state.words[state.musicWordIndex];
            if (missed) {
                // Rhythm cursor is visual-only; no auto-penalty here.
            }
            state.musicWordIndex += 1;
            updateMusicCursorVisual();

            if (state.musicWordIndex >= state.words.length) {
                state.cpuFinishedAt = new Date();
                clearRhythmTimer();
                return;
            }
            scheduleRhythmDeadline();
        }

        function buildYouTubeEmbedFromQuery(query) {
            const encoded = encodeURIComponent(query);
            return `https://www.youtube.com/embed/videoseries?listType=search&list=${encoded}&autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1`;
        }

        function buildYouTubeEmbedFromVideoId(videoId) {
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1`;
        }
        function buildNoCookieEmbedFromVideoId(videoId) {
            return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1`;
        }
        function buildPipedEmbedFromVideoId(videoId) {
            return `https://piped.video/embed/${videoId}?autoplay=1`;
        }

        async function fetchJsonWithTimeout(url, timeoutMs = 6000) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, { signal: controller.signal });
                if (!res.ok) return null;
                return await res.json();
            } catch (e) {
                return null;
            } finally {
                clearTimeout(timer);
            }
        }

        function extractYouTubeVideoId(raw) {
            if (!raw) return null;
            const input = String(raw).trim();
            const plainId = input.match(/^[a-zA-Z0-9_-]{11}$/);
            if (plainId) return plainId[0];
            const watchId = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
            if (watchId) return watchId[1];
            const shortId = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
            if (shortId) return shortId[1];
            const embedId = input.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
            if (embedId) return embedId[1];
            const shortsId = input.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (shortsId) return shortsId[1];
            return null;
        }

        function extractVideoIdFromPipedUrl(url) {
            return extractYouTubeVideoId(url);
        }

        async function resolveYouTubeVideoIds(query) {
            const encoded = encodeURIComponent(query);
            const collected = [];
            const addId = (id) => {
                if (!id || collected.includes(id)) return;
                collected.push(id);
            };

            const lemnosData = await fetchJsonWithTimeout(
                `https://yt.lemnoslife.com/noKey/search?part=id&type=video&maxResults=8&q=${encoded}`,
                6500
            );
            if (Array.isArray(lemnosData?.items)) {
                lemnosData.items.forEach((item) => addId(item?.id?.videoId));
            }

            const pipedData = await fetchJsonWithTimeout(
                `https://piped.video/api/v1/search?q=${encoded}&filter=videos`,
                6500
            );
            if (Array.isArray(pipedData) && pipedData.length > 0) {
                pipedData.slice(0, 8).forEach((item) => {
                    addId(item?.id || null);
                    addId(extractVideoIdFromPipedUrl(item?.url));
                });
            }

            return collected;
        }

        function loadYouTubeCandidate(index) {
            if (!elements.videoFrame) return;
            const candidate = state.youtubeEmbedCandidates[index];
            if (!candidate) return;
            state.youtubeCandidateIndex = index;
            state.youtubeEmbedUrl = candidate;
            if (!elements.videoPanel.classList.contains('hidden')) {
                elements.videoFrame.src = candidate;
            }
        }

        function tryNextYouTubeCandidate() {
            const nextIndex = state.youtubeCandidateIndex + 1;
            if (nextIndex >= state.youtubeEmbedCandidates.length) return;
            loadYouTubeCandidate(nextIndex);
            return true;
        }
        function currentYouTubeAttemptLabel() {
            const total = state.youtubeEmbedCandidates.length || 1;
            const current = Math.min(total, (state.youtubeCandidateIndex || 0) + 1);
            return `${current}/${total}`;
        }

        async function updateYouTubeSource(artist, title) {
            const rawQuery = `${artist} ${title}`.trim().replace(/\s+/g, ' ');
            const knownKey = normalizeSongKey(artist, title);
            const knownIds = KNOWN_YOUTUBE_VIDEO_IDS[knownKey] || [];
            const queries = [
                `${rawQuery} official audio`,
                `${rawQuery} lyrics`,
                rawQuery
            ].filter(Boolean);

            const resolvedVideoIds = [];
            knownIds.forEach((id) => {
                if (!resolvedVideoIds.includes(id)) resolvedVideoIds.push(id);
            });
            for (const q of queries) {
                const ids = await resolveYouTubeVideoIds(q);
                ids.forEach((id) => {
                    if (!resolvedVideoIds.includes(id)) resolvedVideoIds.push(id);
                });
                if (resolvedVideoIds.length >= 8) break;
            }
            if (resolvedVideoIds.length === 0) {
                showToast("Couldn't resolve direct YouTube IDs. Using search fallback.", "info");
            }

            state.youtubeEmbedCandidates = [];
            resolvedVideoIds.forEach((id) => {
                state.youtubeEmbedCandidates.push(buildYouTubeEmbedFromVideoId(id));
                state.youtubeEmbedCandidates.push(buildNoCookieEmbedFromVideoId(id));
                state.youtubeEmbedCandidates.push(buildPipedEmbedFromVideoId(id));
            });
            queries.forEach((q) => {
                state.youtubeEmbedCandidates.push(buildYouTubeEmbedFromQuery(q));
            });
            if (state.youtubeEmbedCandidates.length === 0) {
                state.youtubeEmbedCandidates = [buildYouTubeEmbedFromQuery(rawQuery)];
            }
            state.youtubeCandidateIndex = 0;
            state.youtubeEmbedUrl = state.youtubeEmbedCandidates[0] || '';
            state.youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(rawQuery)}`;
            if (elements.videoSearchLink) {
                elements.videoSearchLink.href = state.youtubeSearchUrl;
            }
            if (!elements.videoFrame) return;
            loadYouTubeCandidate(0);
        }

        function nextYouTubeResult() {
            if (!state.youtubeEmbedCandidates || state.youtubeEmbedCandidates.length === 0) {
                showToast("No video candidates available for this song.", "error");
                return;
            }
            const moved = tryNextYouTubeCandidate();
            if (moved) {
                showToast(`Trying another YouTube result (${currentYouTubeAttemptLabel()})...`, "info");
                return;
            }
            showToast("No more candidates. Use 'search' to open YouTube results.", "info");
        }

        function setYouTubeVideoManually() {
            const raw = prompt("Paste a YouTube URL or 11-char video ID:");
            if (!raw) return;
            const videoId = extractYouTubeVideoId(raw);
            if (!videoId) {
                showToast("Invalid YouTube URL/ID.", "error");
                return;
            }
            const embed = buildYouTubeEmbedFromVideoId(videoId);
            state.youtubeEmbedCandidates = [
                embed,
                buildNoCookieEmbedFromVideoId(videoId),
                buildPipedEmbedFromVideoId(videoId)
            ];
            state.youtubeCandidateIndex = 0;
            state.youtubeEmbedUrl = embed;
            if (elements.videoSearchLink) {
                elements.videoSearchLink.href = `https://www.youtube.com/watch?v=${videoId}`;
            }
            toggleVideoPanel(true);
            loadYouTubeCandidate(0);
            showToast("Manual YouTube video loaded.", "info");
        }

        function estimateCpuDurationMs() {
            if (!state.isRhythmMode) return 0;
            if (state.syncedTimeline && state.syncedTimeline.length > 1) {
                const first = state.syncedTimeline[0].timeMs;
                const lastLineIndex = Math.max(0, state.syncedTimeline.length - 1);
                const lastStart = state.syncedTimeline[lastLineIndex].timeMs;
                const lastDuration = getLineDurationMs(lastLineIndex);
                return Math.max(1000, (lastStart - first) + lastDuration);
            }
            return Math.max(1500, state.words.length * 650);
        }

        function toggleVideoPanel(forceState) {
            if (!elements.videoPanel || !elements.videoFrame) return;
            const shouldOpen = forceState !== undefined
                ? forceState
                : elements.videoPanel.classList.contains('hidden');
            if (!shouldOpen) {
                elements.videoPanel.classList.add('hidden');
                elements.btnToggleVideo?.classList.remove('active');
                return;
            }
            if (!state.youtubeEmbedUrl) {
                showToast("Load a song first to open video.", "info");
                return;
            }
            elements.videoPanel.classList.remove('hidden');
            elements.btnToggleVideo?.classList.add('active');
            if (elements.videoFrame.src !== state.youtubeEmbedUrl) {
                loadYouTubeCandidate(state.youtubeCandidateIndex || 0);
            }
        }

        function openModal(id) {
            document.getElementById(id + '-modal-overlay').classList.remove('hidden');
            if (id === 'profile') refreshAuthUI();
        }
        function closeModal(id) { document.getElementById(id + '-modal-overlay').classList.add('hidden'); }

        function trySwitchTab(tabName) {
            if (state.isFetching) {
                state.pendingNav = tabName;
                elements.modal.classList.remove('hidden');
            } else {
                switchTab(tabName);
            }
        }

        function switchTab(tabName) {
            ['search', 'presets', 'custom'].forEach(t => {
                const el = document.getElementById(`nav-${t}`);
                const view = document.getElementById(`view-${t}`);
                if (t === tabName) {
                    el.classList.add('active');
                    view.classList.remove('hidden');
                } else {
                    el.classList.remove('active');
                    view.classList.add('hidden');
                }
            });
            if(tabName === 'custom' && state.isEasyMode) {
                elements.customTransContainer.classList.remove('hidden');
            } else {
                elements.customTransContainer.classList.add('hidden');
            }
        }

        function setGameMode(mode) {
             state.isClozeMode = (mode === 'cloze');
             state.isRhythmMode = (mode === 'rhythm');
             document.getElementById('mode-normal').classList.toggle('active', mode === 'normal');
             document.getElementById('mode-cloze').classList.toggle('active', state.isClozeMode);
             document.getElementById('mode-rhythm').classList.toggle('active', state.isRhythmMode);
             if ((state.isClozeMode || state.isRhythmMode) && state.isEasyMode) {
                state.isEasyMode = false;
                document.body.classList.remove('easy-mode');
                elements.btnToggleEasy.classList.remove('active');
             }
             if (!elements.gameArea.classList.contains('hidden')) { resetGame(); }
        }

        async function toggleEasyMode() {
            if (
                (state.isClozeMode || state.isRhythmMode) &&
                elements.resultsArea.classList.contains('hidden')
            ) {
                showToast("Translation is disabled during cloze/rhythm mode.", "info");
                return;
            }
            state.isEasyMode = !state.isEasyMode;
            elements.btnToggleEasy.classList.toggle('active', state.isEasyMode);
            document.body.classList.toggle('easy-mode', state.isEasyMode);

            if (state.isEasyMode && !state.transLines.some(l => l && l.length > 0)) {
                const fullText = state.lines.map(l => l ? l.join(' ') : '').join('\n');
                if (fullText.trim().length > 0) {
                    showToast("Translating...", "info");
                    try {
                         const translatedText = await fetchTranslation(fullText);
                         updateTranslations(translatedText);
                         renderWords(); 
                         if(state.wordElements[state.currentWordIndex]) {
                             state.wordElements[state.currentWordIndex].classList.add('active');
                             handleScroll(state.wordElements[state.currentWordIndex]);
                             updateCaretPosition();
                         }
                         showToast("Translation enabled", "info");
                    } catch (e) {
                         showToast("Translation failed", "error");
                         state.isEasyMode = false;
                         elements.btnToggleEasy.classList.remove('active');
                         document.body.classList.remove('easy-mode');
                    }
                }
            }
            if(state.isPlaying || !elements.gameArea.classList.contains('hidden')) {
                focusTypingInput();
                if(state.wordElements[state.currentWordIndex]) {
                     handleScroll(state.wordElements[state.currentWordIndex]);
                }
            }
        }

        function updateTranslations(text) {
             const transLinesRaw = text ? text.split('\n') : [];
             state.transLines = [];
             let tIndex = 0;
             state.lines.forEach((line) => {
                 if (line === null) {
                     state.transLines.push(null);
                 } else {
                     while(tIndex < transLinesRaw.length && transLinesRaw[tIndex].trim() === '') tIndex++;
                     if(tIndex < transLinesRaw.length) {
                         state.transLines.push(transLinesRaw[tIndex]);
                         tIndex++;
                     } else {
                         state.transLines.push("");
                     }
                 }
             });
        }
        
        async function fetchTranslation(text) {
             if (!text.includes('\n') && text.length < 100) {
                 const encodedText = encodeURIComponent(text);
                 const pair = "en|pt";
                 try {
                    const transRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${pair}`);
                    const transData = await transRes.json();
                    if (transData?.responseData?.translatedText) return transData.responseData.translatedText;
                 } catch (e) { console.warn(e); }
                 return "Translation unavailable";
             }
             const chunks = splitIntoChunks(text, 450);
             const translatedChunks = [];
             for (let i = 0; i < chunks.length; i++) {
                 const textChunk = chunks[i];
                 const encodedText = encodeURIComponent(textChunk);
                 const pair = "en|pt";
                 await new Promise(r => setTimeout(r, 200));
                 const transRes = await fetch(`https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${pair}`);
                 const transData = await transRes.json();
                 if (transData?.responseData?.translatedText) {
                     const resText = transData.responseData.translatedText;
                     if (!resText.includes("QUERY LENGTH") && !resText.includes("MYMEMORY")) {
                         translatedChunks.push(resText);
                         continue;
                     }
                 } 
                 translatedChunks.push(""); 
             }
            return translatedChunks.join('\n\n');
        }

        async function startPracticeErrors() {
             elements.practiceContainer.innerHTML = '<div class="text-center text-sub text-sm">Preparing words...</div>';
             elements.practiceModal.classList.remove('hidden');
             const rawErrors = Array.from(state.missedWords);
             const cleanedErrors = [...new Set(rawErrors.map(w => cleanPunctuation(w)).filter(w => w.length > 0))];
             state.practiceQueue = cleanedErrors;
             state.currentPracticeIndex = 0;
             if(state.practiceQueue.length === 0) {
                 elements.practiceContainer.innerHTML = '<div class="text-center text-sub">No valid words to practice!</div>';
                 return;
             }
             renderPracticeWord();
        }
        
        async function renderPracticeWord() {
            if(state.currentPracticeIndex >= state.practiceQueue.length) {
                elements.practiceContainer.innerHTML = `<div class="text-center text-main text-2xl font-bold mb-2">All Done!</div><div class="text-center text-sub">Great job practicing your tricky words.</div>`;
                elements.practiceProgress.textContent = "";
                return;
            }
            const word = state.practiceQueue[state.currentPracticeIndex];
            elements.practiceProgress.textContent = `${state.currentPracticeIndex + 1} / ${state.practiceQueue.length}`;
            elements.practiceContainer.innerHTML = '<div class="loader"></div>';
            let translation = "...";
            try { translation = await fetchTranslation(word); } catch(e) { translation = "???"; }
            elements.practiceContainer.innerHTML = `
                <div class="practice-card w-full">
                    <div class="flex flex-col items-center mb-6 w-full">
                        <div class="flex items-center gap-4">
                            <span class="practice-word-display">${word}</span>
                            <button data-onclick="speakWord('${word}')" class="text-main hover:text-base p-2 rounded-full hover:bg-surface transition">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                            </button>
                        </div>
                        <span class="practice-translation">(${translation})</span>
                    </div>
                    <input type="text" id="practice-input-field" class="practice-input" placeholder="Type word here..." autocomplete="off">
                </div>
            `;
            const inputEl = document.getElementById('practice-input-field');
            inputEl.focus();
            inputEl.addEventListener('input', (e) => checkPracticeInput(e.target, word));
        }
        
        function checkPracticeInput(input, target) {
            if (input.value.trim().toLowerCase() === target.toLowerCase()) {
                input.disabled = true;
                input.style.borderColor = 'var(--success-color)';
                input.style.color = 'var(--success-color)';
                const card = input.closest('.practice-card');
                card.classList.add('success');
                playSound('click'); // Reward sound
                
                if(window.incrementPracticeCounter) window.incrementPracticeCounter();

                setTimeout(() => { state.currentPracticeIndex++; renderPracticeWord(); }, 800);
            } else {
                // Play error sound for incorrect input if sound enabled
                if(input.value.length > 0 && !target.toLowerCase().startsWith(input.value.trim().toLowerCase())) {
                    // Simple logic to detect obvious mistake
                     // playSound('error'); 
                     // Avoiding spam, only play if enabled in settings
                }
            }
        }

        function toggleAutoSpeak() {
            state.isAutoSpeak = !state.isAutoSpeak;
            elements.btnToggleSpeak.classList.toggle('active', state.isAutoSpeak);
            focusTypingInput();
        }

        function cancelNavigation() { state.pendingNav = null; elements.modal.classList.add('hidden'); }
        function confirmNavigation() {
            if (state.abortController) { state.abortController.abort(); state.abortController = null; }
            state.isFetching = false;
            updateFetchUI(false);
            elements.modal.classList.add('hidden');
            if (state.pendingNav) { switchTab(state.pendingNav); state.pendingNav = null; }
        }

        function stopGame() {
            state.isPlaying = false;
            clearInterval(state.timerInterval);
            clearRhythmTimer();
            if(elements.caret) elements.caret.style.display = 'none';
        }

        function goHome() {
            stopGame();
            if(state.isEasyMode) {
                 state.isEasyMode = false;
                 document.body.classList.remove('easy-mode');
                 elements.btnToggleEasy.classList.remove('active');
            }
            state.isClozeMode = false;
            state.isRhythmMode = false;
            document.getElementById('mode-cloze').classList.remove('active');
            document.getElementById('mode-rhythm').classList.remove('active');
            document.getElementById('mode-normal').classList.add('active');
            state.previousRun = null; 
            elements.gameArea.classList.add('hidden');
            elements.resultsArea.classList.add('hidden');
            elements.setupArea.classList.remove('hidden');
            elements.input.blur();
            toggleVideoPanel(false);
        }

        function updateFetchUI(isFetching, progress = 0, message = "") {
            const btnText = document.getElementById('search-btn-text');
            const loader = document.getElementById('search-loader');
            const fetchBtn = document.getElementById('btn-fetch-action');
            if (isFetching) {
                btnText.classList.add('hidden');
                loader.classList.remove('hidden');
                fetchBtn.classList.add('opacity-70', 'cursor-not-allowed');
                elements.searchStatus.classList.remove('hidden');
                elements.searchStatusContainer.classList.remove('hidden');
                elements.searchStatus.textContent = message || "Searching...";
                elements.searchBar.style.width = `${progress}%`;
                elements.searchErrorContainer.classList.add('hidden'); 
            } else {
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
                fetchBtn.classList.remove('opacity-70', 'cursor-not-allowed');
                elements.searchStatus.classList.add('hidden');
                elements.searchStatusContainer.classList.add('hidden');
                elements.searchBar.style.width = `0%`;
            }
        }

        async function fetchLyrics() {
            if (state.isFetching) return;
            const artist = elements.artistInput.value.trim();
            const title = elements.titleInput.value.trim();
            if (!artist || !title) { showToast("Enter both artist and title", "error"); return; }
            elements.searchErrorContainer.classList.add('hidden');
            state.isFetching = true;
            updateFetchUI(true, 5, "Connecting to database...");
            state.abortController = new AbortController();
            const signal = state.abortController.signal;
            const cacheKey = `${artist}-${title}`.toLowerCase();
            if(state.searchCache.has(cacheKey)) {
                const data = state.searchCache.get(cacheKey);
                setTimeout(() => { handleLyricsSuccess(data.lyrics, title, artist, signal, data.syncedLyrics || ''); }, 300);
                return;
            }
            try {
                updateFetchUI(true, 30, "Searching LrcLib...");
                const lrclibData = await fetchFromLrcLib(artist, title, signal);
                if (lrclibData && lrclibData.lyrics) {
                    state.searchCache.set(cacheKey, { lyrics: lrclibData.lyrics, syncedLyrics: lrclibData.syncedLyrics || '' });
                    await handleLyricsSuccess(lrclibData.lyrics, title, artist, signal, lrclibData.syncedLyrics || '');
                    return;
                }
            } catch(e) { console.warn("LrcLib failed", e); }
            if(signal.aborted) return;
            try {
                updateFetchUI(true, 60, "Trying backup source...");
                const lyrics2 = await fetchFromLyricsOvh(artist, title, signal);
                if (lyrics2) {
                    state.searchCache.set(cacheKey, { lyrics: lyrics2, syncedLyrics: '' });
                    await handleLyricsSuccess(lyrics2, title, artist, signal, '');
                    return;
                }
            } catch(e) { console.warn("OVH failed", e); }
            if(signal.aborted) return;
            state.isFetching = false;
            updateFetchUI(false);
            const query = encodeURIComponent(`${artist} ${title} lyrics`);
            elements.googleFallbackLink.href = `https://www.google.com/search?q=${query}`;
            elements.searchError.textContent = "Could not find lyrics automatically.";
            elements.searchErrorContainer.classList.remove('hidden');
        }

        async function fetchFromLrcLib(artist, title, signal) {
            const artistClean = artist.replace(/\s+(ft|feat)\.?\s+.*$/i, '').trim();
            const titleClean = title.replace(/\s*[\(\[]?\s*(ft|feat)\.?.*?[\)\]]?\s*$/i, '').trim();
            const queries = [...new Set([
                `${artist} ${title}`.trim(),
                `${artistClean} ${titleClean}`.trim()
            ])];

            let allResults = [];
            for (const q of queries) {
                const params = new URLSearchParams({ q });
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000));
                const res = await Promise.race([ fetch(`https://lrclib.net/api/search?${params}`, { signal }), timeout ]);
                if (!res.ok) continue;
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    allResults = allResults.concat(data);
                }
            }

            if (allResults.length === 0) throw new Error("No results");

            const targetArtist = artistClean.toLowerCase();
            const targetTitle = titleClean.toLowerCase();
            const hasLyrics = (item) => Boolean(item?.plainLyrics || item?.syncedLyrics);
            let bestMatch = allResults.find(item =>
                hasLyrics(item) &&
                item.artistName?.toLowerCase().includes(targetArtist) &&
                item.trackName?.toLowerCase().includes(targetTitle)
            );
            if (!bestMatch) bestMatch = allResults.find(item => hasLyrics(item) && item.artistName?.toLowerCase() === targetArtist);
            if (!bestMatch) bestMatch = allResults.find(item => hasLyrics(item));
            if (!bestMatch) throw new Error("No lyrics");

            const synced = bestMatch.syncedLyrics || '';
            const plain = (bestMatch.plainLyrics || '').trim();
            const lyrics = plain || syncedToPlainLyrics(synced);
            if (!lyrics) throw new Error("No lyrics");

            return { lyrics, syncedLyrics: synced };
        }

        async function fetchFromLyricsOvh(artist, title, signal) {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000));
            const res = await Promise.race([ fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`, { signal }), timeout ]);
            if(!res.ok) throw new Error("Status " + res.status);
            const data = await res.json();
            if(!data.lyrics) throw new Error("No lyrics");
            return data.lyrics;
        }

        async function handleLyricsSuccess(lyricsRaw, title, artist, signal, syncedLyricsRaw = '') {
            updateFetchUI(true, 80, "Processing text...");
            const cleanedLyrics = cleanLyrics(lyricsRaw);
            state.isFetching = false;
            updateFetchUI(false);
            await updateYouTubeSource(artist, title);
            if (state.isRhythmMode) toggleVideoPanel(true);
            startGame(cleanedLyrics, title, artist, "", syncedLyricsRaw);
        }

        function loadPreset(key) {
            const song = presets[key];
            state.isCustomGame = false;
            updateYouTubeSource(song.artist, song.title).catch(() => {});
            startGame(song.lyrics, song.title, song.artist, "");
        }

        function startCustomGame() {
            const text = elements.customText.value.trim();
            const trans = elements.customTrans.value.trim();
            if (!text) return;
            state.isCustomGame = true;
            startGame(text, "Custom Text", "You", trans);
        }

        function startGame(text, title, artist, translationText = '', syncedLyricsRaw = '') {
            state.syncedLyricsRaw = syncedLyricsRaw || '';
            state.syncedTimeline = parseSyncedLyrics(state.syncedLyricsRaw);
            let effectiveText = text;
            if (state.isRhythmMode && state.syncedTimeline.length > 1) {
                effectiveText = state.syncedTimeline.map(item => item.text).join('\n');
            } else if (state.isRhythmMode) {
                showToast("No synced timestamps found. Falling back to normal timing.", "info");
            }

            const rawLines = effectiveText.split('\n');
            const transLinesRaw = translationText ? translationText.split('\n') : [];
            state.lines = [];
            state.transLines = [];
            state.lineWordRanges = [];
            state.wordToLineMap = [];
            let tIndex = 0;
            rawLines.forEach((line) => {
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                    state.lines.push(null);
                    state.transLines.push(null);
                } else {
                    state.lines.push(trimmed.split(/\s+/).filter(w => w.length > 0));
                    while(tIndex < transLinesRaw.length && transLinesRaw[tIndex].trim() === '') tIndex++;
                    if(tIndex < transLinesRaw.length) { state.transLines.push(transLinesRaw[tIndex]); tIndex++; } 
                    else { state.transLines.push(""); }
                }
            });
            state.words = state.lines.flat().filter(w => w !== null); 
            
            state.clozeIndices.clear();
            if (state.isClozeMode) {
                state.words.forEach((word, index) => {
                    if (word.length <= 3) return;
                    if (Math.random() < 0.25) { state.clozeIndices.add(index); }
                });
                if (state.clozeIndices.size === 0 && state.words.length > 5) { state.clozeIndices.add(5); }
            }

            state.currentWordIndex = 0;
            if (state.isClozeMode && state.clozeIndices.size > 0) {
                let firstCloze = -1;
                for(let i=0; i<state.words.length; i++) { if(state.clozeIndices.has(i)) { firstCloze = i; break; } }
                if (firstCloze !== -1) state.currentWordIndex = firstCloze;
            }

            state.startTime = null;
            state.endTime = null;
            state.correctChars = 0;
            state.incorrectChars = 0;
            state.extraChars = 0;
            state.isPlaying = false;
            state.songTitle = title;
            state.artist = artist;
            state.history = [];
            state.wordElements = [];
            state.missedWords.clear();
            state.wordsCorrect = 0;
            state.wordsWrong = 0;
            state.currentCombo = 0;
            state.wpmHistory = [];
            state.rhythmAnchorMs = 0;
            state.rhythmStarted = false;
            state.musicWordIndex = 0;
            state.cpuFinishedAt = null;
            state.cpuExpectedFinishAt = null;

            document.getElementById('current-song-title').textContent = title;
            document.getElementById('current-song-artist').textContent = artist;
            elements.liveWpm.textContent = '0';
            elements.liveWpmDiff.textContent = '';
            elements.liveCombo.textContent = '0';
            elements.liveCorrect.textContent = '0';
            elements.liveWrong.textContent = '0';
            elements.caret.style.display = 'block';
            if (elements.musicCaret) elements.musicCaret.style.display = 'none';
            elements.statsWordCount.textContent = '0';
            elements.statsTotalWords.textContent = '/' + state.words.length;
            
            elements.btnToggleEasy.classList.toggle('active', state.isEasyMode);
            document.body.classList.toggle('easy-mode', state.isEasyMode);

            elements.setupArea.classList.add('hidden');
            elements.resultsArea.classList.add('hidden');
            elements.gameArea.classList.remove('hidden');
            renderWords();
            elements.input.value = '';
            focusTypingInput();
            requestAnimationFrame(updateCaretPosition);
            
            if(state.isClozeMode && state.wordElements[state.currentWordIndex]) {
                 handleScroll(state.wordElements[state.currentWordIndex]);
            }
        }

        function renderWords() {
            elements.wordsContainer.innerHTML = '<div id="music-caret"></div><div id="caret"></div>';
            elements.wordsContainer.style.transform = `translateY(0px)`;
            elements.caret = document.getElementById('caret');
            elements.musicCaret = document.getElementById('music-caret');
            state.wordElements = []; 
            state.lineWordRanges = [];
            state.wordToLineMap = [];
            let wordIdx = 0;
            let logicalLineIndex = 0;
            state.lines.forEach((lineData, lineIndex) => {
                if (lineData === null) {
                    const breakEl = document.createElement('div');
                    breakEl.className = 'stanza-break';
                    elements.wordsContainer.appendChild(breakEl);
                } else {
                    const lineStartWord = wordIdx;
                    const lineEl = document.createElement('div');
                    lineEl.className = 'lyrics-line';
                    lineData.forEach(word => {
                        const wordSpan = document.createElement('div');
                        wordSpan.className = 'word';
                        if (state.isRhythmMode) wordSpan.classList.add('rhythm-word');
                        const isCloze = state.isClozeMode && state.clozeIndices.has(wordIdx);
                        const isSkipped = state.isClozeMode && !state.clozeIndices.has(wordIdx);
                        if (isSkipped) { wordSpan.classList.add('cloze-context'); } else if (isCloze) { wordSpan.classList.add('cloze-target'); }

                        // Add click listener for popover via delegated safe handler
                        wordSpan.setAttribute('data-onclick', `handleWordClick(event, "${word.replace(/"/g, '\\"')}")`);

                        word.split('').forEach(char => {
                            const charSpan = document.createElement('span');
                            charSpan.className = 'letter';
                            if (isCloze) { charSpan.textContent = '\u00A0'; } else { charSpan.textContent = char; }
                            charSpan.dataset.char = char; 
                            wordSpan.appendChild(charSpan);
                        });
                        lineEl.appendChild(wordSpan);
                        state.wordElements.push(wordSpan); 
                        state.wordToLineMap[wordIdx] = logicalLineIndex;
                        wordIdx++;
                    });
                    if (wordIdx > lineStartWord) {
                        state.lineWordRanges.push({ start: lineStartWord, end: wordIdx - 1 });
                        logicalLineIndex++;
                    }
                    elements.wordsContainer.appendChild(lineEl);
                    const transText = state.transLines[lineIndex];
                    if(transText) {
                        const transEl = document.createElement('div');
                        transEl.className = 'translation-line';
                        transEl.textContent = transText;
                        elements.wordsContainer.appendChild(transEl);
                    }
                }
            });
            if(state.wordElements.length > 0 && state.currentWordIndex < state.wordElements.length) {
                state.wordElements[state.currentWordIndex].classList.add('active');
            }
            updateMusicCursorVisual();
        }

        function handleInput(currentVal) {
            // Check popover state
            const popover = document.getElementById('word-popover');
            if (popover && popover.style.display !== 'none' && popover.style.display !== '') {
                return;
            }

            // SAFETY: Do not process if game is hidden (finished)
            if (elements.gameArea.classList.contains('hidden')) return;

            if (state.currentWordIndex >= state.words.length) return;
            if (!state.isPlaying && currentVal.length > 0) {
                state.isPlaying = true;
                state.startTime = new Date();
                startTimer();
                if (state.isRhythmMode && !state.rhythmStarted) {
                    state.rhythmStarted = true;
                    state.rhythmAnchorMs = Date.now();
                    state.cpuExpectedFinishAt = new Date(state.rhythmAnchorMs + estimateCpuDurationMs());
                    if (state.syncedTimeline.length > 1) {
                        scheduleRhythmDeadline();
                    }
                    updateMusicCursorVisual();
                }
            }
            const currentWordVal = state.words[state.currentWordIndex];
            const wordEl = state.wordElements[state.currentWordIndex];
            const letterEls = wordEl.querySelectorAll('.letter');

            // --- AUTO-FINISH: Detecta se completou a última palavra ---
            if (state.currentWordIndex === state.words.length - 1) {
                if (currentVal === currentWordVal) {
                    // Marca como correto visualmente
                    const originalChars = currentWordVal.split('');
                    originalChars.forEach((char, index) => {
                         if(letterEls[index]) {
                             letterEls[index].className = 'letter correct';
                             letterEls[index].textContent = char;
                         }
                    });
                    
                    state.wordsCorrect++;
                    state.currentCombo++;
                    playSound('click');
                    if (state.isAutoSpeak) speakWord(currentWordVal);
                    
                    if (state.isClozeMode && state.clozeIndices.has(state.currentWordIndex)) {
                        wordEl.classList.add('revealed');
                    }
                    
                    finishGame();
                    return;
                }
            }

            if (currentVal.endsWith(' ')) {
                if (currentVal.trim() === '') { elements.input.value = ''; return; }
                state.history.push(currentVal.trim());
                const trimmedTyped = currentVal.trim();
                wordEl.classList.remove('active');
                
                if (trimmedTyped === currentWordVal) {
                    state.wordsCorrect++;
                    state.currentCombo++;
                    playSound('click'); 
                    if (state.isAutoSpeak) speakWord(currentWordVal);
                    if (state.isClozeMode && state.clozeIndices.has(state.currentWordIndex)) {
                        wordEl.classList.add('revealed');
                    }
                } else {
                    state.wordsWrong++;
                    state.currentCombo = 0; 
                    state.missedWords.add(currentWordVal);
                    playSound('error'); 
                }
                
                if (trimmedTyped.length < currentWordVal.length) {
                    for (let i = trimmedTyped.length; i < currentWordVal.length; i++) {
                        if (!(state.isClozeMode && state.clozeIndices.has(state.currentWordIndex))) {
                            letterEls[i].classList.add('incorrect');
                        }
                        state.incorrectChars++;
                    }
                }
                state.currentWordIndex++;
                
                // Skip words in Cloze mode
                if (state.isClozeMode) {
                    while (state.currentWordIndex < state.words.length && !state.clozeIndices.has(state.currentWordIndex)) {
                        state.currentWordIndex++;
                    }
                }
                
                elements.input.value = '';
                updateStats();
                
                // Check finish again in case skipping context words reached the end
                if (state.currentWordIndex >= state.words.length) { 
                    finishGame(); 
                    return; 
                }
                
                const nextWordEl = state.wordElements[state.currentWordIndex];
                if (nextWordEl) {
                    nextWordEl.classList.add('active');
                    handleScroll(nextWordEl);
                    updateCaretPosition();
                }
                return;
            }

            const currentArray = currentVal.split('');
            const typedArray = currentVal.split('');
            const originalChars = currentWordVal.split('');

            originalChars.forEach((char, index) => {
                const charEl = letterEls[index];
                const typedChar = typedArray[index];
                if (typedChar == null) { 
                    charEl.className = 'letter'; 
                    if (state.isClozeMode && state.clozeIndices.has(state.currentWordIndex)) { 
                        charEl.textContent = '\u00A0'; 
                    } else { 
                        charEl.textContent = charEl.dataset.char; 
                    }
                } else if (typedChar === char) { 
                    charEl.className = 'letter correct'; 
                    charEl.textContent = char;
                } else { 
                    charEl.className = 'letter incorrect'; 
                    if (state.isClozeMode && state.clozeIndices.has(state.currentWordIndex)) {
                        charEl.textContent = typedChar;
                    } else {
                        charEl.textContent = char;
                    }
                }
            });
            
            const existingExtras = wordEl.querySelectorAll('.letter.extra');
            existingExtras.forEach(el => el.remove());
            if (typedArray.length > originalChars.length) {
                for (let i = originalChars.length; i < typedArray.length; i++) {
                    const extraSpan = document.createElement('span');
                    extraSpan.className = 'letter extra';
                    extraSpan.textContent = typedArray[i];
                    wordEl.appendChild(extraSpan);
                }
            }
            
            // KEYBOARD ERROR FEEDBACK LOGIC
            const lastTypedChar = currentArray[currentArray.length - 1];
            if (lastTypedChar) {
                 const expectedChar = originalChars[currentArray.length - 1];
                 const isCorrect = lastTypedChar === expectedChar;
                 const keySelector = lastTypedChar === ' ' ? ' ' : lastTypedChar.toLowerCase();
                 // Use querySelector to find key by data-key attribute. Need to handle special characters carefully if needed.
                 // Assuming simple letters for now based on context.
                 let keyEl = null;
                 try {
                     // Try finding the key. Escape double quotes if present.
                     const safeKey = keySelector.replace(/"/g, '\\"');
                     keyEl = document.querySelector(`.kb-key[data-key="${safeKey}"]`);
                 } catch (e) { console.error(e); }
                 
                 if (keyEl) {
                     // Remove previous error state to reset animation if needed
                     keyEl.classList.remove('error');
                     
                     if (!isCorrect) {
                         // Force reflow to restart animation if desired, or just add class
                         void keyEl.offsetWidth; 
                         keyEl.classList.add('error');
                         
                         // Remove error class after a short delay
                         setTimeout(() => {
                             keyEl.classList.remove('error');
                         }, 200);
                     } else {
                         // If correct, maybe flash active color briefly? 
                         // Already handled by keydown/keyup events for physical keyboard.
                         // But for virtual clarity, we can flash active too.
                         keyEl.classList.add('active');
                         setTimeout(() => {
                             keyEl.classList.remove('active');
                         }, 100);
                     }
                 }
            }

            updateCaretPosition();
        }

        document.addEventListener('keydown', (e) => {
            const popover = document.getElementById('word-popover');
            const target = e.target;
            const isEditableTarget =
                target &&
                (target.tagName === 'INPUT' ||
                 target.tagName === 'TEXTAREA' ||
                 target.isContentEditable);
            if (isEditableTarget && target !== elements.input) return;

            if (e.key === 'Escape') {
                if (popover && popover.style.display !== 'none' && popover.style.display !== '') {
                    closeWordPopover();
                    return;
                }
                closeModal('about'); closeModal('settings'); closeModal('practice'); closeModal('profile'); cancelRestart(); cancelNavigation(); 
            }
            
            if (popover && popover.style.display !== 'none' && popover.style.display !== '') return;

            // Add keydown visual feedback for virtual keyboard
            if (e.key) {
                const safeKey = e.key.replace(/"/g, '\\"');
                // Case insensitive check for letters
                const lowerKey = e.key.toLowerCase();
                const vKey = document.querySelector(`.kb-key[data-key="${safeKey}"]`) || 
                             document.querySelector(`.kb-key[data-key="${lowerKey}"]`);
                if (vKey) vKey.classList.add('active');
            }

            if (e.key === 'Alt') { if (e.repeat) return; e.preventDefault(); togglePreviewMode(true); }
            if (e.key === 'Tab' && !elements.gameArea.classList.contains('hidden')) { e.preventDefault(); requestRestart(); }
            if (e.key === 'Control' && !e.repeat) {
                const currentWordEl = state.wordElements[state.currentWordIndex];
                const isLockedClozeWord =
                    state.isClozeMode &&
                    currentWordEl &&
                    currentWordEl.classList.contains('cloze-target') &&
                    !currentWordEl.classList.contains('revealed');
                if (isLockedClozeWord) {
                    showToast("Audio unlocks after the word is typed correctly.", "info");
                } else {
                    speakWord(state.words[state.currentWordIndex]);
                }
            }
            if (e.key === 'Backspace' && !elements.gameArea.classList.contains('hidden') && !state.isPreviewMode) {
                // Previne o backspace de navegar para a página anterior se o input estiver vazio
                if (elements.input.value.length === 0 && state.currentWordIndex > 0) { 
                    e.preventDefault(); 
                    goBackToPreviousWord(); 
                }
            }
            
            if (!elements.gameArea.classList.contains('hidden') && !state.isPreviewMode && document.activeElement !== elements.input) { focusTypingInput(); }
        });
        document.addEventListener('keyup', (e) => { 
            // Add keyup visual feedback for virtual keyboard
            if (e.key) { // Safety check
                 const safeKey = e.key.replace(/"/g, '\\"');
                 const lowerKey = e.key.toLowerCase();
                 const vKey = document.querySelector(`.kb-key[data-key="${safeKey}"]`) || 
                              document.querySelector(`.kb-key[data-key="${lowerKey}"]`);
                 if (vKey) vKey.classList.remove('active');
            }
            
            if (e.key === 'Alt') { togglePreviewMode(false); } 
        });

        function requestRestart() { if (state.isPlaying) { clearInterval(state.timerInterval); state.isPlaying = false; } elements.restartModal.classList.remove('hidden'); }
        function cancelRestart() { elements.restartModal.classList.add('hidden'); focusTypingInput(); }
        function confirmRestart() { elements.restartModal.classList.add('hidden'); resetGame(); }
        
        function resetGame(saveHistory = false) {
            if (saveHistory && state.wpmHistory.length > 0) { state.previousRun = { wpmHistory: [...state.wpmHistory] }; } 
            else if (!saveHistory && state.wpmHistory.length > 0 && elements.resultsArea.classList.contains('hidden') === false) { state.previousRun = { wpmHistory: [...state.wpmHistory] }; }
            const text = state.lines.map(l => l ? l.join(' ') : '').join('\n');
            const trans = state.transLines.map(l => l || '').join('\n');
            startGame(text, state.songTitle, state.artist, trans, state.syncedLyricsRaw);
        }

        function formatRaceTime(ms) {
            if (ms == null || Number.isNaN(ms)) return '--';
            const total = Math.max(0, Math.round(ms));
            const m = Math.floor(total / 60000);
            const s = Math.floor((total % 60000) / 1000);
            const ds = Math.floor((total % 1000) / 100);
            return `${m}:${String(s).padStart(2, '0')}.${ds}`;
        }

        function formatRaceDiff(ms) {
            if (ms == null || Number.isNaN(ms)) return '--';
            const sign = ms > 0 ? '+' : '';
            return `${sign}${formatRaceTime(ms)}`;
        }
        
        function finishGame() { 
            state.endTime = new Date();
            stopGame(); 
            
            // CLEAR INPUT AND BLUR
            elements.input.value = '';
            elements.input.blur();

            // Toggle screens
            elements.gameArea.classList.add('hidden');
            elements.resultsArea.classList.remove('hidden');

            // Calculate final WPM and Acc for saving
            const timeSeconds = Math.max(1, (state.endTime - state.startTime) / 1000);
            const minutes = timeSeconds / 60;
            
            // CORREÇÃO: Calcular total de chars baseado no modo
            let totalCharsTyped = 0;
            state.words.forEach((word, index) => {
                // Se for Normal, conta tudo. Se for Cloze, conta só se for índice de lacuna.
                if (!state.isClozeMode || state.clozeIndices.has(index)) {
                    totalCharsTyped += word.length + 1; // +1 espaço
                }
            });
            if (totalCharsTyped > 0) totalCharsTyped--; // Remove último espaço

            const netWpm = Math.round(((totalCharsTyped / 5) / minutes));
            const totalKeypresses = totalCharsTyped + state.incorrectChars + state.extraChars;
            const accuracy = totalKeypresses > 0 ? Math.round((totalCharsTyped / totalKeypresses) * 100) : 0;

            const currentMode = state.isRhythmMode ? 'rhythm' : (state.isClozeMode ? 'cloze' : 'normal');
            saveGameResultToCloud({
                songTitle: state.songTitle,
                artist: state.artist,
                mode: currentMode,
                wpm: netWpm,
                accuracy,
                wordsCorrect: state.wordsCorrect,
                wordsWrong: state.wordsWrong,
                totalChars: totalCharsTyped,
                incorrectChars: state.incorrectChars,
                extraChars: state.extraChars,
                durationSeconds: Math.round(timeSeconds)
            });
            
            // Update Results UI
            elements.resWpmBig.textContent = netWpm;
            elements.resAccBig.textContent = `${accuracy}%`;
            elements.resRaw.textContent = Math.round(netWpm * (accuracy/100)) || 0; 
            elements.resCharTotal.textContent = totalCharsTyped;
            elements.resCharErr.textContent = state.incorrectChars + state.extraChars;
            elements.resTimeVal.textContent = `${Math.round(timeSeconds)}s`;

            if (state.isRhythmMode) {
                const cpuFinishAt = state.cpuFinishedAt || state.cpuExpectedFinishAt;
                const cpuMs = cpuFinishAt ? (cpuFinishAt.getTime() - state.rhythmAnchorMs) : null;
                const userMs = state.endTime ? (state.endTime.getTime() - state.rhythmAnchorMs) : null;
                const diffMs = (cpuMs != null && userMs != null) ? (userMs - cpuMs) : null;

                if (elements.resCpuFinish) elements.resCpuFinish.textContent = formatRaceTime(cpuMs);
                if (elements.resUserFinish) elements.resUserFinish.textContent = formatRaceTime(userMs);
                if (elements.resRaceDiff) {
                    elements.resRaceDiff.textContent = formatRaceDiff(diffMs);
                    elements.resRaceDiff.classList.toggle('text-success', diffMs != null && diffMs <= 0);
                    elements.resRaceDiff.classList.toggle('text-error', diffMs != null && diffMs > 0);
                }
            } else {
                if (elements.resCpuFinish) elements.resCpuFinish.textContent = '--';
                if (elements.resUserFinish) elements.resUserFinish.textContent = '--';
                if (elements.resRaceDiff) elements.resRaceDiff.textContent = '--';
            }
            
            const wpmMean = state.wpmHistory.reduce((a, b) => a + b, 0) / state.wpmHistory.length || 0;
            const wpmVariance = state.wpmHistory.reduce((a, b) => a + Math.pow(b - wpmMean, 2), 0) / state.wpmHistory.length || 0;
            const wpmStdDev = Math.sqrt(wpmVariance);
            let consistency = 100;
            if(wpmMean > 0) { const cv = wpmStdDev / wpmMean; consistency = Math.max(0, Math.round(100 * (1 - cv))); }
            elements.resConsistency.textContent = `${consistency}%`;

            elements.missedWordsList.innerHTML = '';
            if(state.missedWords.size > 0) {
                elements.missedWordsContainer.classList.remove('hidden');
            } else {
                elements.missedWordsContainer.classList.add('hidden');
            }

            drawChart(state.wpmHistory, state.previousRun ? state.previousRun.wpmHistory : null);
        }

        function drawChart(currentData, prevData) {
            const canvas = elements.chartCanvas;
            const ctx = canvas.getContext('2d');
            const container = canvas.parentElement;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            
            if(currentData.length < 2) return;

            const padding = 20;
            const width = canvas.width - padding * 2;
            const height = canvas.height - padding * 2;
            
            let maxVal = Math.max(...currentData, 10);
            if (prevData) maxVal = Math.max(maxVal, ...prevData);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const drawLine = (data, color, dash) => {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                if(dash) ctx.setLineDash([5, 5]); else ctx.setLineDash([]);
                const stepX = width / (Math.max(data.length, currentData.length) - 1);
                data.forEach((val, i) => {
                    const x = padding + (i * stepX);
                    const y = padding + height - ((val / maxVal) * height);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.stroke();
            };

            if (prevData) {
                drawLine(prevData, '#5e8396', true);
            }
            drawLine(currentData, '#3EE39E', false);
        }

        function togglePreviewMode(forceState) {
            state.isPreviewMode = forceState !== undefined ? forceState : !state.isPreviewMode;
            elements.wordsContainer.style.transition = 'none';
            if (state.isPreviewMode) {
                document.body.classList.add('preview-mode');
                elements.input.blur();
                elements.caret.style.display = 'none';
                const currentWord = state.wordElements[state.currentWordIndex];
                if (currentWord) {
                    const currentLine = currentWord.closest('.lyrics-line');
                    const lineTop = currentLine ? currentLine.offsetTop : 0;
                    elements.wordsContainer.style.transform = 'translateY(0px)';
                    requestAnimationFrame(() => { elements.wordsWrapper.scrollTop = Math.max(0, lineTop - 50); });
                }
            } else {
                document.body.classList.remove('preview-mode');
                focusTypingInput();
                elements.caret.style.display = 'block';
                elements.wordsWrapper.scrollTop = 0; 
                if (state.wordElements[state.currentWordIndex]) { handleScroll(state.wordElements[state.currentWordIndex]); }
            }
            setTimeout(() => { elements.wordsContainer.style.transition = ''; }, 50);
        }

        function goBackToPreviousWord() {
            // Safety check for index
            if (state.currentWordIndex <= 0) return;

            if (state.isClozeMode) {
                 let prevIndex = state.currentWordIndex - 1;
                 while(prevIndex >= 0 && !state.clozeIndices.has(prevIndex)) { prevIndex--; }
                 
                 if (prevIndex < 0) return; // No previous cloze word found
                 
                 // Safely remove active class from current
                 const currentEl = state.wordElements[state.currentWordIndex];
                 if (currentEl) currentEl.classList.remove('active');
                 
                 state.currentWordIndex = prevIndex;
                 
                 // Safely add active class to new
                 const newEl = state.wordElements[state.currentWordIndex];
                 if (newEl) newEl.classList.add('active');
                 
                 const prevText = state.history.pop() || "";
                 elements.input.value = prevText;
                 handleInput(prevText);
                 
                 if (newEl) handleScroll(newEl);
                 return;
            }
            
            // Normal Mode
            const oldIndex = state.currentWordIndex;
            state.currentWordIndex--;
            
            const oldWordEl = state.wordElements[oldIndex];
            const newWordEl = state.wordElements[state.currentWordIndex];
            
            if (oldWordEl) oldWordEl.classList.remove('active');
            if (newWordEl) newWordEl.classList.add('active');
            
            const prevText = state.history.pop() || "";
            elements.input.value = prevText;
            handleInput(prevText);
            if (newWordEl) handleScroll(newWordEl);
        }
        function handleScroll(activeElement) {
            const wordsDiv = elements.wordsContainer;
            const currentLine = activeElement.closest('.lyrics-line');
            if (!currentLine) return; 
            const lineTop = currentLine.offsetTop;
            if (state.isRhythmMode) {
                wordsDiv.style.transform = `translateY(0px)`;
                elements.wordsWrapper.scrollTop = Math.max(0, lineTop - 80);
                requestAnimationFrame(updateMusicCaretPosition);
                return;
            }
            wordsDiv.style.transform = `translateY(-${lineTop}px)`;
            requestAnimationFrame(updateMusicCaretPosition);
        }
        function updateMusicCaretPosition() {
            if (!elements.musicCaret) return;
            // Keep only the low-opacity square marker (music-active) in rhythm mode.
            elements.musicCaret.style.display = 'none';
        }
        function updateCaretPosition() {
            const wordEl = state.wordElements[state.currentWordIndex];
            if (!wordEl) return;
            const typedLen = elements.input.value.length;
            const letterEls = wordEl.querySelectorAll('.letter');
            const contentRect = elements.wordsContainer.getBoundingClientRect();
            const wordRect = wordEl.getBoundingClientRect();
            const relativeWordX = wordRect.left - contentRect.left;
            const relativeWordY = wordRect.top - contentRect.top;
            const caretHeight = elements.caret.offsetHeight || Math.max(20, Math.round(wordRect.height));
            const rhythmUnderlineY = (wordRect.bottom - contentRect.top) - caretHeight + 1;
            let targetX = 0;
            let targetY = state.isRhythmMode ? rhythmUnderlineY : 0;
            if (typedLen === 0) {
                targetX = relativeWordX; 
                if (!state.isRhythmMode) targetY = relativeWordY + 5; 
            } else if (typedLen <= letterEls.length) {
                const lastChar = letterEls[typedLen - 1];
                const charRect = lastChar.getBoundingClientRect();
                targetX = charRect.right - contentRect.left;
                if (!state.isRhythmMode) targetY = charRect.top - contentRect.top;
            } else {
                const extras = wordEl.querySelectorAll('.extra');
                const lastExtra = extras[extras.length - 1];
                if (lastExtra) {
                    const extraRect = lastExtra.getBoundingClientRect();
                    targetX = extraRect.right - contentRect.left;
                    if (!state.isRhythmMode) targetY = extraRect.top - contentRect.top;
                } else {
                    targetX = relativeWordX + wordRect.width;
                }
            }
            elements.caret.style.left = (targetX - 1) + 'px'; 
            elements.caret.style.top = targetY + 'px';
            updateMusicCaretPosition();
        }
        
        function updateStats() {
            const current = state.currentWordIndex;
            elements.statsWordCount.textContent = current;
            elements.liveCorrect.textContent = state.wordsCorrect;
            elements.liveWrong.textContent = state.wordsWrong;
            elements.liveCombo.textContent = state.currentCombo;
        }
        
        function startTimer() {
            state.timerInterval = setInterval(() => {
                const now = new Date();
                const diffSeconds = (now - state.startTime) / 1000;
                let charCount = 0;
                for(let i=0; i<state.currentWordIndex; i++) {
                    charCount += state.words[i].length + 1; 
                }
                charCount += elements.input.value.length;
                const minutes = diffSeconds / 60;
                const wpm = Math.round((charCount / 5) / minutes);
                
                if (wpm > 0 && wpm < 300) {
                     elements.liveWpm.textContent = wpm;
                     state.wpmHistory.push(wpm);
                     
                     if (state.previousRun && state.previousRun.wpmHistory && state.wpmHistory.length <= state.previousRun.wpmHistory.length) {
                         const tickIndex = state.wpmHistory.length - 1;
                         const prevWpm = state.previousRun.wpmHistory[tickIndex] || 0;
                         const diff = wpm - prevWpm;
                         const diffEl = elements.liveWpmDiff;
                         diffEl.textContent = diff > 0 ? `+${diff}` : diff;
                         diffEl.className = `wpm-diff ${diff >= 0 ? 'positive' : 'negative'}`;
                     } else {
                         elements.liveWpmDiff.textContent = '';
                     }
                     
                } else if(minutes > 0) {
                    state.wpmHistory.push(0);
                }
            }, 1000);
        }
        function speakWord(wordToSpeak) {
            if (!wordToSpeak) return;
            const cleanWord = wordToSpeak.replace(/[^\w\s]|_/g, "");
            if (!cleanWord) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(cleanWord);
            utterance.lang = 'en-US';
            utterance.rate = 1.0;
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en'));
            if (preferredVoice) utterance.voice = preferredVoice;
            window.speechSynthesis.speak(utterance);
        }

        Object.assign(window, {
            focusTypingInput,
            nextYouTubeResult,
            setYouTubeVideoManually,
            closeOnboarding,
            openModal,
            closeModal,
            cancelNavigation,
            confirmNavigation,
            cancelRestart,
            confirmRestart,
            goHome,
            trySwitchTab,
            switchTab,
            setGameMode,
            fetchLyrics,
            loadPreset,
            startCustomGame,
            toggleEasyMode,
            toggleAutoSpeak,
            startPracticeErrors,
            resetGame,
            requestRestart,
            speakWord,
            toggleVideoPanel,
            switchAuthTab,
            registerAccount,
            loginAccount,
            logoutAccount,
            deleteAccount,
        });

        elements.input.addEventListener('input', (e) => handleInput(elements.input.value));
        window.addEventListener('resize', () => { if(state.isPlaying) updateCaretPosition(); });
        elements.gameArea.addEventListener('click', () => { if(!state.isPreviewMode) focusTypingInput(); });
        if (elements.videoFrame) {
            elements.videoFrame.addEventListener('error', () => {
                const prevIndex = state.youtubeCandidateIndex;
                const moved = tryNextYouTubeCandidate();
                if (moved && state.youtubeCandidateIndex !== prevIndex) {
                    showToast(`Trying another YouTube result (${currentYouTubeAttemptLabel()})...`, "info");
                } else {
                    showToast("Could not auto-load an embeddable YouTube video. Use 'search' to pick one.", "error");
                }
            });
        }
        switchAuthTab('login');
        bindAuthActivityWatchers();
        if (supabase) {
            supabase.auth.onAuthStateChange((_event, session) => {
                if (session) {
                    writeStoredSession(session, shouldPersistSession());
                } else {
                    clearAuthSession();
                    if (authIdleTimer) {
                        clearTimeout(authIdleTimer);
                        authIdleTimer = null;
                    }
                }
                refreshAuthUI();
            });
        }
        (async () => {
            await bootstrapAuthSession();
            await refreshAuthUI();
        })();
        switchTab('search'); 

