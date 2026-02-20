import { splitIntoChunks } from './utils/chunk.js';
import { cleanLyrics, cleanPunctuation } from './utils/text.js';
import { bindLegacyInlineHandlers } from './features/navigation.js';
import { createAudioApi } from './features/audio.js';
import { toggleDyslexicMode as toggleDyslexicModeImpl } from './features/accessibility.js';
import { THEMES } from './config/themes.js';
import { presets } from './config/presets.js';
import { PUBLIC_APP_URL } from './config/app.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config/supabase.js';

window.incrementPracticeCounter = window.incrementPracticeCounter || (() => {});
window.toggleSavedWord = window.toggleSavedWord || (() => {});
window.isWordSaved = window.isWordSaved || (() => false);
window.saveGameResult = undefined;

const CUSTOM_LYRICS_MAX_CHARS = 4000;
const CUSTOM_TRANSLATION_MAX_CHARS = 4000;
const CUSTOM_TOTAL_MAX_CHARS = 6500;
const CUSTOM_COVER_MAX_BYTES = 2 * 1024 * 1024;
const DUEL_POLL_MS = 1800;
const PLAYER_PROVIDERS = ['spotify', 'deezer', 'youtube_music'];

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
            artistSongsCache: new Map(),
            artistTermSearchCache: new Map(),
            artistCatalogSongs: [],
            artistCatalogName: '',
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
            preferredPlayer: 'spotify',
            wpmHistory: [],
            previousRun: null,
            lastResultShare: null,
            practiceQueue: [],
            currentPracticeIndex: 0,
            isCustomGame: false,
            currentLyricsRaw: '',
            currentTranslationRaw: '',
            duel: {
                roomId: '',
                status: 'idle',
                uiStep: 'entry',
                ownerId: '',
                ownerName: '',
                songTitle: '',
                artist: '',
                lyrics: '',
                songConfigured: false,
                translation: '',
                startedAtMs: 0,
                countdownSeconds: 5,
                inRoom: false,
                isOwner: false,
                opponentId: '',
                opponentName: '',
                gameLaunched: false,
                resultShown: false
            },
            tooltipTimeout: null,
            isSoundEnabled: false 
        };

        const elements = {
            setupArea: document.getElementById('setup-area'),
            gameArea: document.getElementById('game-area'),
            resultsArea: document.getElementById('results-area'),
            sharedResultArea: document.getElementById('shared-result-area'),
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
            navDuel: document.getElementById('nav-duel'),
            btnToggleEasy: document.getElementById('btn-toggle-easy'),
            btnToggleSpeak: document.getElementById('btn-toggle-speak'),
            btnToggleVideo: document.getElementById('btn-toggle-video'),
            viewSearch: document.getElementById('view-search'),
            viewPresets: document.getElementById('view-presets'),
            viewCustom: document.getElementById('view-custom'),
            viewDuel: document.getElementById('view-duel'),
            duelStepEntry: document.getElementById('duel-step-entry'),
            duelStepRoom: document.getElementById('duel-step-room'),
            duelStepSong: document.getElementById('duel-step-song'),
            favoritesTabList: document.getElementById('favorites-tab-list'),
            favoritesTabControls: document.getElementById('favorites-tab-controls'),
            favoritesTabFilter: document.getElementById('favorites-tab-filter'),
            favoritesTabSort: document.getElementById('favorites-tab-sort'),
            favoritesTabType: document.getElementById('favorites-tab-type'),
            favoritesTabArtist: document.getElementById('favorites-tab-artist'),
            artistInput: document.getElementById('input-artist'),
            titleInput: document.getElementById('input-title'),
            artistSuggestions: document.getElementById('artist-suggestions'),
            titleSuggestions: document.getElementById('title-suggestions'),
            browseArtistBtn: document.getElementById('btn-browse-artist'),
            artistCatalog: document.getElementById('artist-catalog'),
            artistCatalogName: document.getElementById('artist-catalog-name'),
            artistCatalogMeta: document.getElementById('artist-catalog-meta'),
            artistSongFilter: document.getElementById('artist-song-filter'),
            artistCatalogList: document.getElementById('artist-catalog-list'),
            customText: document.getElementById('custom-text-area'),
            customTrans: document.getElementById('custom-translation-area'),
            customTransContainer: document.getElementById('custom-translation-container'),
            customTextCounter: document.getElementById('custom-text-counter'),
            customTransCounter: document.getElementById('custom-translation-counter'),
            customSaveFavorite: document.getElementById('custom-save-favorite'),
            customCoverFile: document.getElementById('custom-cover-file'),
            customCoverFileName: document.getElementById('custom-cover-file-name'),
            customCoverPreview: document.getElementById('custom-cover-preview'),
            duelViewState: document.getElementById('duel-view-state'),
            duelViewOpponent: document.getElementById('duel-view-opponent'),
            duelSlotOwner: document.getElementById('duel-slot-owner'),
            duelSlotOpponent: document.getElementById('duel-slot-opponent'),
            duelViewInviteTarget: document.getElementById('duel-view-invite-target'),
            duelViewInviteBtn: document.getElementById('duel-view-invite-btn'),
            duelRoomCodeInputView: document.getElementById('duel-room-code-input-view'),
            duelViewFriendList: document.getElementById('duel-view-friend-list'),
            duelNextToSongBtn: document.getElementById('duel-next-to-song-btn'),
            duelSongArtist: document.getElementById('duel-song-artist'),
            duelSongTitle: document.getElementById('duel-song-title'),
            duelSongStatus: document.getElementById('duel-song-status'),
            currentSongArtist: document.getElementById('current-song-artist'),
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
            artistSongsModal: document.getElementById('artist-songs-modal-overlay'),
            artistSongsTitle: document.getElementById('artist-songs-title'),
            artistSongsStatus: document.getElementById('artist-songs-status'),
            artistSongsList: document.getElementById('artist-songs-list'),
            artistSongsCover: document.getElementById('artist-songs-cover'),
            artistSongsOpenPlayer: document.getElementById('artist-songs-open-player'),
            avatarPreviewOverlay: document.getElementById('avatar-preview-overlay'),
            avatarPreviewImage: document.getElementById('avatar-preview-image'),
            avatarPreviewName: document.getElementById('avatar-preview-name'),
            practiceContainer: document.getElementById('practice-container'),
            practiceProgress: document.getElementById('practice-progress'),
            searchStatus: document.getElementById('search-status-text'),
            searchBar: document.getElementById('search-progress-bar'),
            searchStatusContainer: document.getElementById('search-status-container'),
            searchErrorContainer: document.getElementById('search-error-container'),
            searchError: document.getElementById('search-error'),
            googleFallbackLink: document.getElementById('google-fallback-link'),
            songLaunchOverlay: document.getElementById('song-launch-overlay'),
            songLaunchTitle: document.getElementById('song-launch-title'),
            songLaunchArtist: document.getElementById('song-launch-artist'),
            songLaunchStatus: document.getElementById('song-launch-status'),
            songLaunchProgress: document.getElementById('song-launch-progress'),
            toastContainer: document.getElementById('toast-container'),
            headerAvatarButton: document.getElementById('header-avatar-button'),
            headerAvatarImage: document.getElementById('header-avatar-image'),
            videoPanel: document.getElementById('video-pip-panel'),
            videoSearchLink: document.getElementById('video-search-link'),
            videoCoverLink: document.getElementById('video-cover-link'),
            videoCoverImage: document.getElementById('video-cover-image'),
            videoCoverFallback: document.getElementById('video-cover-fallback'),
            videoTitleLink: document.getElementById('video-title-link'),
            videoSubtitle: document.getElementById('video-subtitle'),
            videoProviderLabel: document.getElementById('video-provider-label'),
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
            authUserAvatar: document.getElementById('auth-user-avatar'),
            authProfileEditPanel: document.getElementById('auth-profile-edit-panel'),
            authNonEditSections: document.getElementById('auth-nonedit-sections'),
            authAvatarFile: document.getElementById('auth-avatar-file'),
            authAvatarFileName: document.getElementById('auth-avatar-file-name'),
            authUserBio: document.getElementById('auth-user-bio'),
            authPlayerPref: document.getElementById('auth-player-pref'),
            authUserLevel: document.getElementById('auth-user-level'),
            authAchievements: document.getElementById('auth-achievements'),
            authStatsSection: document.getElementById('auth-stats-section'),
            authDeletePassword: document.getElementById('auth-delete-password'),
            authStatGames: document.getElementById('auth-stat-games'),
            authStatBestWpm: document.getElementById('auth-stat-best-wpm'),
            authStatAvgWpm: document.getElementById('auth-stat-avg-wpm'),
            authStatAvgAcc: document.getElementById('auth-stat-avg-acc'),
            authRecentResults: document.getElementById('auth-recent-results'),
            authRecentSection: document.getElementById('auth-recent-section'),
            authHistorySong: document.getElementById('auth-history-song'),
            authHistoryChart: document.getElementById('auth-history-chart'),
            authHistorySummary: document.getElementById('auth-history-summary'),
            authHistorySection: document.getElementById('auth-history-section'),
            authFriendsSection: document.getElementById('auth-friends-section'),
            authDuelSection: document.getElementById('auth-duel-section'),
            authFriendUsername: document.getElementById('auth-friend-username'),
            authFriendRequests: document.getElementById('auth-friend-requests'),
            authFriendCompare: document.getElementById('auth-friend-compare'),
            duelRoomCodeInput: document.getElementById('duel-room-code-input'),
            duelInviteTarget: document.getElementById('duel-invite-target'),
            duelRoomBox: document.getElementById('duel-room-box'),
            duelRoomMeta: document.getElementById('duel-room-meta'),
            duelRoomStatus: document.getElementById('duel-room-status'),
            duelRoomMembers: document.getElementById('duel-room-members'),
            duelFriendList: document.getElementById('duel-friend-list'),
            duelInviteList: document.getElementById('duel-invite-list'),
            authFavoritesSection: document.getElementById('auth-favorites-section'),
            authDangerSection: document.getElementById('auth-danger-section'),
            authActionsSection: document.getElementById('auth-actions-section'),
            authFavoritesList: document.getElementById('auth-favorites-list'),
            profileHubOverlay: document.getElementById('profile-hub-overlay'),
            profileHubName: document.getElementById('profile-hub-name'),
            profileHubAvatar: document.getElementById('profile-hub-avatar'),
            profileHubLevel: document.getElementById('profile-hub-level'),
            profileHubEmail: document.getElementById('profile-hub-email'),
            profileHubBio: document.getElementById('profile-hub-bio'),
            profileHubGames: document.getElementById('profile-hub-games'),
            profileHubBest: document.getElementById('profile-hub-best'),
            profileHubAvgWpm: document.getElementById('profile-hub-avgwpm'),
            profileHubAvgAcc: document.getElementById('profile-hub-avgacc'),
            profileHubChart: document.getElementById('profile-hub-chart'),
            profileHubRecent: document.getElementById('profile-hub-recent'),
            profileHubFavorites: document.getElementById('profile-hub-favorites'),
            profileHubFriends: document.getElementById('profile-hub-friends'),
            profileHubAchievements: document.getElementById('profile-hub-achievements'),
            profileHubCompareSelect: document.getElementById('profile-hub-compare-select'),
            profileHubCompareGrid: document.getElementById('profile-hub-compare-grid'),
            sharedResultUser: document.getElementById('shared-result-user'),
            sharedResultSong: document.getElementById('shared-result-song'),
            sharedResultMeta: document.getElementById('shared-result-meta'),
            sharedResultWpm: document.getElementById('shared-result-wpm'),
            headerBrand: document.getElementById('header-brand'),
            sharedResultAcc: document.getElementById('shared-result-acc'),
            sharedResultRaw: document.getElementById('shared-result-raw'),
            sharedResultConsistency: document.getElementById('shared-result-consistency'),
            duelHud: document.getElementById('duel-hud'),
            duelMeName: document.getElementById('duel-me-name'),
            duelMeProgressText: document.getElementById('duel-me-progress-text'),
            duelMeProgressBar: document.getElementById('duel-me-progress-bar'),
            duelOpponentName: document.getElementById('duel-opponent-name'),
            duelOpponentProgressText: document.getElementById('duel-opponent-progress-text'),
            duelOpponentProgressBar: document.getElementById('duel-opponent-progress-bar'),
            duelCountdownText: document.getElementById('duel-countdown-text')
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
                    detectSessionInUrl: true
                }
            })
            : null;
        let authCurrentUser = null;
        let authIdleTimer = null;
        const authAttempts = { login: [], register: [] };
        let authGameResultsCache = [];
        let authSongGroupsCache = [];
        let authStatsSummary = { games: 0, bestWpm: 0, avgWpm: 0, avgAcc: 0 };
        let authFriendsCache = [];
        let authFriendRequestsCache = [];
        let authFavoritesCache = [];
        let favoritesFilterText = '';
        let favoritesSortMode = 'recent';
        let favoritesTypeFilter = 'all';
        let favoritesArtistFilter = 'all';
        const favoriteArtworkCache = new Map();
        let favoritesSupportsCustomColumns = true;
        let authPendingAvatarFile = null;
        let authAvatarPreviewUrl = '';
        let authStoredAvatarUrl = '';
        let customPendingCoverFile = null;
        let customCoverPreviewUrl = '';
        let authAccountViewMode = 'full';
        let profileHubContext = { type: 'self', friend: null, source: 'self' };
        let profileHubCompareFriendKey = '';
        let pendingSharedResultId = '';
        let artistSuggestTimer = null;
        let titleSuggestTimer = null;
        let artistSuggestSeq = 0;
        let titleSuggestSeq = 0;
        let artistCatalogFilterTimer = null;
        let artistCatalogFilterSeq = 0;
        let artistSpotlightSongs = [];
        let isSongLaunchOverlayActive = false;
        let duelPollTimer = null;
        let duelLastProgressSentAt = 0;
        let duelRealtimeRoomChannel = null;
        let duelRealtimeRoomId = '';
        let duelRealtimeInvitesChannel = null;
        let duelRealtimeInvitesUserId = '';
        let duelSnapshotRefreshTimer = null;

        function normalizeEmail(email) {
            return (email || '').trim().toLowerCase();
        }

        function escapeHtml(text) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function sanitizeAvatarUrl(url) {
            const raw = String(url || '').trim();
            if (!raw) return '';
            try {
                const u = new URL(raw);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
                return u.toString();
            } catch (e) {
                return '';
            }
        }

        function isFavoritesColumnMissingError(error) {
            const code = String(error?.code || '');
            const message = String(error?.message || '');
            return (
                code === '42703' ||
                code === 'PGRST204' ||
                /custom_lyrics|custom_translation|custom_cover_url|source_type/i.test(message)
            );
        }

        function toggleProfileEditor(forceState) {
            if (!elements.authProfileEditPanel) return;
            const open = forceState !== undefined
                ? !!forceState
                : elements.authProfileEditPanel.classList.contains('hidden');
            elements.authProfileEditPanel.classList.toggle('hidden', !open);
            if (elements.authNonEditSections) {
                elements.authNonEditSections.classList.toggle('hidden', open);
            }
            if (!open) {
                if (authPendingAvatarFile) {
                    const fallback = sanitizeAvatarUrl(authStoredAvatarUrl || '');
                    if (elements.authUserAvatar) {
                        elements.authUserAvatar.src = fallback || 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
                    }
                }
                authPendingAvatarFile = null;
                if (elements.authAvatarFile) elements.authAvatarFile.value = '';
                if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
                if (authAvatarPreviewUrl) {
                    URL.revokeObjectURL(authAvatarPreviewUrl);
                    authAvatarPreviewUrl = '';
                }
            }
        }

        function setAccountViewMode(mode = 'full') {
            authAccountViewMode = mode === 'friends' ? 'friends' : 'full';
            const friendsMode = authAccountViewMode === 'friends';
            elements.authStatsSection?.classList.toggle('hidden', friendsMode);
            elements.authRecentSection?.classList.toggle('hidden', friendsMode);
            elements.authHistorySection?.classList.toggle('hidden', friendsMode);
            elements.authFavoritesSection?.classList.toggle('hidden', friendsMode);
            elements.authDangerSection?.classList.toggle('hidden', friendsMode);
            elements.authActionsSection?.classList.toggle('hidden', friendsMode);
            elements.authAchievements?.classList.toggle('hidden', friendsMode);
        }

        function triggerAvatarPicker() {
            elements.authAvatarFile?.click();
        }

        function triggerCustomCoverPicker() {
            elements.customCoverFile?.click();
        }

        function resetCustomCoverInput() {
            customPendingCoverFile = null;
            if (elements.customCoverFile) elements.customCoverFile.value = '';
            if (elements.customCoverFileName) elements.customCoverFileName.textContent = 'No file selected';
            if (customCoverPreviewUrl) {
                URL.revokeObjectURL(customCoverPreviewUrl);
                customCoverPreviewUrl = '';
            }
            if (elements.customCoverPreview) {
                elements.customCoverPreview.src = '';
                elements.customCoverPreview.classList.add('hidden');
            }
        }

        async function uploadAvatarFile(userId, file) {
            if (!supabase || !file || !userId) return '';
            const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
            const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'png'}`;
            const upload = await supabase.storage.from('avatars').upload(path, file, {
                cacheControl: '3600',
                upsert: false
            });
            if (upload.error) {
                throw upload.error;
            }
            const pub = supabase.storage.from('avatars').getPublicUrl(path);
            return pub?.data?.publicUrl || '';
        }

        async function uploadFavoriteCoverFile(userId, file) {
            if (!supabase || !file || !userId) return '';
            const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
            const path = `${userId}/favorites/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'png'}`;
            const upload = await supabase.storage.from('avatars').upload(path, file, {
                cacheControl: '3600',
                upsert: false
            });
            if (upload.error) {
                throw upload.error;
            }
            const pub = supabase.storage.from('avatars').getPublicUrl(path);
            return pub?.data?.publicUrl || '';
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
                .select('username,email,avatar_url,bio,preferred_player')
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
                username,
                preferred_player: 'spotify'
            });
        }

        function normalizePreferredPlayer(raw) {
            const value = String(raw || '').trim().toLowerCase();
            return PLAYER_PROVIDERS.includes(value) ? value : 'spotify';
        }

        function getPlayerLabel(provider) {
            if (provider === 'deezer') return 'Deezer';
            if (provider === 'youtube_music') return 'YouTube Music';
            return 'Spotify';
        }

        function buildProviderSearchLink(provider, query) {
            const safeQuery = encodeURIComponent(String(query || '').trim());
            const selected = normalizePreferredPlayer(provider);
            if (selected === 'deezer') return `https://www.deezer.com/search/${safeQuery}`;
            if (selected === 'youtube_music') return `https://music.youtube.com/search?q=${safeQuery}`;
            return `https://open.spotify.com/search/${safeQuery}`;
        }

        function getCandidateLinkForProvider(candidate, provider) {
            const selected = normalizePreferredPlayer(provider);
            if (selected === 'deezer') return candidate?.deezerUrl || candidate?.spotifyUrl || '#';
            if (selected === 'youtube_music') return candidate?.youtubeMusicUrl || candidate?.spotifyUrl || '#';
            return candidate?.spotifyUrl || '#';
        }

        function withAutoplayParam(url, provider) {
            try {
                const u = new URL(String(url || ''));
                if (normalizePreferredPlayer(provider) === 'youtube_music') {
                    u.searchParams.set('autoplay', '1');
                } else {
                    u.searchParams.set('autoplay', 'true');
                }
                return u.toString();
            } catch (_err) {
                return url || '#';
            }
        }

        function openCandidateInPreferredPlayer(event) {
            if (event) event.preventDefault();
            const idx = state.youtubeCandidateIndex || 0;
            const candidate = state.youtubeEmbedCandidates?.[idx];
            if (!candidate) return;
            const provider = normalizePreferredPlayer(state.preferredPlayer);
            const baseUrl = getCandidateLinkForProvider(candidate, provider);
            const webUrl = withAutoplayParam(baseUrl, provider);
            if (!webUrl || webUrl === '#') return;
            window.open(webUrl, '_blank', 'noopener,noreferrer');
        }

        function setPreferredPlayer(provider) {
            const next = normalizePreferredPlayer(provider);
            state.preferredPlayer = next;
            if (elements.authPlayerPref) {
                elements.authPlayerPref.querySelectorAll('.auth-player-btn').forEach((btn) => {
                    const isActive = btn.getAttribute('data-player') === next;
                    btn.classList.toggle('active', isActive);
                    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });
            }
            if (elements.videoProviderLabel) {
                elements.videoProviderLabel.textContent = getPlayerLabel(next);
            }
            if (state.youtubeEmbedCandidates?.length) {
                loadYouTubeCandidate(state.youtubeCandidateIndex || 0);
            }
        }

        function computeProfileLevel(summary) {
            const baseXp = (summary.games * 30) + (summary.bestWpm * 2) + summary.avgAcc;
            const level = Math.max(1, Math.floor(baseXp / 350) + 1);
            return level;
        }

        function computeAchievements(summary) {
            const out = [];
            if (summary.games >= 1) out.push('First Steps');
            if (summary.games >= 25) out.push('Dedicated');
            if (summary.bestWpm >= 60) out.push('Fast Fingers');
            if (summary.bestWpm >= 100) out.push('Speed Demon');
            if (summary.avgAcc >= 95 && summary.games >= 10) out.push('Precision');
            if (summary.games >= 50 && summary.avgWpm >= 70) out.push('Marathon Typist');
            return out;
        }

        function renderAchievements(summary) {
            if (!elements.authAchievements) return;
            const badges = computeAchievements(summary);
            if (badges.length === 0) {
                elements.authAchievements.innerHTML = '<div class="auth-recent-empty">No achievements yet.</div>';
                return;
            }
            elements.authAchievements.innerHTML = badges.map((b) => `<span class="auth-achievement">${escapeHtml(b)}</span>`).join('');
        }

        async function saveProfileDetails() {
            if (!ensureSupabaseReady()) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                showToast('You need to be logged in.', 'error');
                return;
            }
            let avatarUrl = sanitizeAvatarUrl(authStoredAvatarUrl || '');
            if (authPendingAvatarFile) {
                try {
                    avatarUrl = await uploadAvatarFile(user.id, authPendingAvatarFile);
                } catch (e) {
                    showToast('Could not upload avatar image.', 'error');
                    return;
                }
            }
            const bio = (elements.authUserBio?.value || '').trim();
            const updates = {
                id: user.id,
                email: user.email,
                username: elements.authUserName?.textContent || user.user_metadata?.username || user.email?.split('@')[0] || 'user',
                avatar_url: avatarUrl || null,
                bio: bio || null,
                preferred_player: normalizePreferredPlayer(state.preferredPlayer)
            };
            const { error } = await supabase.from('profiles').upsert(updates);
            if (error) {
                showToast('Could not save profile.', 'error');
                return;
            }
            if (elements.authUserAvatar) {
                elements.authUserAvatar.src = avatarUrl || 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
            }
            if (elements.headerAvatarImage) {
                elements.headerAvatarImage.src = avatarUrl || 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
            }
            authStoredAvatarUrl = avatarUrl || '';
            authPendingAvatarFile = null;
            if (elements.authAvatarFile) elements.authAvatarFile.value = '';
            if (authAvatarPreviewUrl) {
                URL.revokeObjectURL(authAvatarPreviewUrl);
                authAvatarPreviewUrl = '';
            }
            toggleProfileEditor(false);
            renderProfileHub();
            showToast('Profile updated.', 'info');
        }

        async function loadFavoriteSongs(userId) {
            if (!supabase || !userId || !elements.authFavoritesList) return;
            const selectColumns = favoritesSupportsCustomColumns
                ? 'id,song_title,artist,created_at,source_type,custom_lyrics,custom_translation,custom_cover_url'
                : 'id,song_title,artist,created_at';
            let { data, error } = await supabase
                .from('user_favorites')
                .select(selectColumns)
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(200);
            if (error && favoritesSupportsCustomColumns && isFavoritesColumnMissingError(error)) {
                favoritesSupportsCustomColumns = false;
                ({ data, error } = await supabase
                    .from('user_favorites')
                    .select('id,song_title,artist,created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(200));
            }
            authFavoritesCache = data || [];
            if (error) {
                showToast(`Could not load favorites (${error.message || 'unknown error'}).`, 'error');
            }
            if (error || !data || data.length === 0) {
                elements.authFavoritesList.innerHTML = '<div class="auth-recent-empty">No favorites yet.</div>';
                renderSetupFavoritesTab();
                renderProfileHub();
                return;
            }
            await enrichFavoriteArtwork(authFavoritesCache);
            elements.authFavoritesList.innerHTML = data.map((f) => {
                const title = escapeHtml(f.song_title || 'Unknown Song');
                const artist = escapeHtml(f.artist || 'Unknown Artist');
                const when = f.created_at ? new Date(f.created_at).toLocaleDateString() : '';
                const badge = f.source_type === 'custom' ? '<span class="auth-favorite-meta">custom</span>' : '';
                return `<div class="auth-favorite-item">
                          <div>
                            <div class="auth-favorite-title">${artist} - ${title}</div>
                            <div class="auth-favorite-meta">${when} ${badge}</div>
                          </div>
                          <button class="auth-friend-btn reject" data-onclick="removeFavoriteSong(${f.id})">Remove</button>
                        </div>`;
            }).join('');
            renderSetupFavoritesTab();
            renderProfileHub();
        }

        function buildFavoriteSongKey(artist, songTitle) {
            return `${normalizeLookupText(artist)}|||${normalizeLookupText(songTitle)}`;
        }

        function updateCustomInputCounters() {
            const lyricsLen = (elements.customText?.value || '').trim().length;
            const transLen = (elements.customTrans?.value || '').trim().length;
            const totalLen = lyricsLen + transLen;

            if (elements.customTextCounter) {
                elements.customTextCounter.textContent = `${lyricsLen} / ${CUSTOM_LYRICS_MAX_CHARS}`;
                elements.customTextCounter.classList.toggle('custom-counter-warn', lyricsLen > CUSTOM_LYRICS_MAX_CHARS);
            }
            if (elements.customTransCounter) {
                elements.customTransCounter.textContent = `${transLen} / ${CUSTOM_TRANSLATION_MAX_CHARS}`;
                elements.customTransCounter.classList.toggle('custom-counter-warn', transLen > CUSTOM_TRANSLATION_MAX_CHARS || totalLen > CUSTOM_TOTAL_MAX_CHARS);
            }
        }

        function validateCustomInputLimits(text, trans) {
            const lyricsLen = text.length;
            const transLen = trans.length;
            const totalLen = lyricsLen + transLen;
            if (lyricsLen > CUSTOM_LYRICS_MAX_CHARS) {
                return `Lyrics limit is ${CUSTOM_LYRICS_MAX_CHARS} characters.`;
            }
            if (transLen > CUSTOM_TRANSLATION_MAX_CHARS) {
                return `Translation limit is ${CUSTOM_TRANSLATION_MAX_CHARS} characters.`;
            }
            if (totalLen > CUSTOM_TOTAL_MAX_CHARS) {
                return `Lyrics + translation limit is ${CUSTOM_TOTAL_MAX_CHARS} characters.`;
            }
            return '';
        }

        function buildCustomSongTitle(text) {
            const firstLine = String(text || '')
                .split('\n')
                .map((line) => line.trim())
                .find((line) => line.length > 0) || 'Custom Lyrics';
            const compact = firstLine.replace(/\s+/g, ' ');
            const short = compact.length > 52 ? `${compact.slice(0, 49)}...` : compact;
            return `Custom: ${short}`;
        }

        function isSongFavorited(artist, songTitle) {
            const target = buildFavoriteSongKey(artist, songTitle);
            return (authFavoritesCache || []).some((f) => buildFavoriteSongKey(f.artist, f.song_title) === target);
        }

        async function addSongToFavorites(artist, songTitle, silent = false, options = {}) {
            if (!ensureSupabaseReady()) return false;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                if (!silent) showToast('Login to save favorites.', 'info');
                return false;
            }
            const safeArtist = String(artist || '').trim();
            const safeSong = String(songTitle || '').trim();
            const sourceType = options?.sourceType === 'custom' ? 'custom' : 'catalog';
            const customLyrics = sourceType === 'custom' ? String(options?.customLyrics || '').trim() : '';
            const customTranslation = sourceType === 'custom' ? String(options?.customTranslation || '').trim() : '';
            const customCoverFile = sourceType === 'custom' ? (options?.customCoverFile || null) : null;
            if (!safeSong || !safeArtist) {
                if (!silent) showToast('Invalid song data.', 'error');
                return false;
            }
            if (sourceType === 'custom') {
                const limitError = validateCustomInputLimits(customLyrics, customTranslation);
                if (limitError) {
                    if (!silent) showToast(limitError, 'error');
                    return false;
                }
            }
            if (isSongFavorited(safeArtist, safeSong)) {
                if (!silent) showToast('Song already in favorites.', 'info');
                return true;
            }

            const { data: existing, error: existingError } = await supabase
                .from('user_favorites')
                .select('id')
                .eq('user_id', user.id)
                .eq('song_title', safeSong)
                .eq('artist', safeArtist)
                .maybeSingle();
            if (existingError) {
                if (!silent) showToast(`Could not validate favorite (${existingError.message || 'unknown error'}).`, 'error');
                return false;
            }

            if (existing?.id) {
                if (!silent) showToast('Song already in favorites.', 'info');
                await loadFavoriteSongs(user.id);
                return true;
            }

            const payload = {
                user_id: user.id,
                song_title: safeSong,
                artist: safeArtist
            };
            if (favoritesSupportsCustomColumns) {
                let customCoverUrl = '';
                if (sourceType === 'custom' && customCoverFile) {
                    try {
                        customCoverUrl = await uploadFavoriteCoverFile(user.id, customCoverFile);
                    } catch (uploadError) {
                        if (!silent) showToast(`Could not upload custom cover (${uploadError?.message || 'unknown error'}).`, 'error');
                        return false;
                    }
                }
                payload.source_type = sourceType;
                payload.custom_lyrics = sourceType === 'custom' ? customLyrics : null;
                payload.custom_translation = sourceType === 'custom' ? customTranslation : null;
                payload.custom_cover_url = sourceType === 'custom'
                    ? (sanitizeAvatarUrl(customCoverUrl || '') || null)
                    : null;
            }
            let { error } = await supabase
                .from('user_favorites')
                .insert(payload);
            if (error && favoritesSupportsCustomColumns && isFavoritesColumnMissingError(error)) {
                favoritesSupportsCustomColumns = false;
                ({ error } = await supabase
                    .from('user_favorites')
                    .insert({
                        user_id: user.id,
                        song_title: safeSong,
                        artist: safeArtist
                    }));
            }
            if (error) {
                if (String(error.code || '') === '23505') {
                    if (!silent) showToast('Song already in favorites.', 'info');
                    await loadFavoriteSongs(user.id);
                    return true;
                }
                if (!silent) showToast(`Could not add favorite (${error.message || 'unknown error'}).`, 'error');
                return false;
            }

            await loadFavoriteSongs(user.id);
            if (!silent) showToast('Song added to favorites.', 'info');
            return true;
        }

        function buildFavoriteArtworkFallback(artist, title) {
            const a = String(artist || 'A').trim().charAt(0).toUpperCase() || 'A';
            const t = String(title || 'S').trim().charAt(0).toUpperCase() || 'S';
            return `https://placehold.co/200x200/0B2D45/3EE39E?text=${encodeURIComponent(a + t)}`;
        }

        function favoriteArtworkKey(artist, title) {
            return `${normalizeLookupText(artist)}|||${normalizeLookupText(title)}`;
        }

        async function enrichFavoriteArtwork(entries) {
            const pending = (entries || []).slice(0, 36).filter((f) => {
                const key = favoriteArtworkKey(f.artist, f.song_title);
                const customCover = sanitizeAvatarUrl(f.custom_cover_url || '');
                if (key && customCover) {
                    favoriteArtworkCache.set(key, customCover);
                    return false;
                }
                return key && !favoriteArtworkCache.has(key);
            });
            await Promise.all(pending.map(async (f) => {
                const key = favoriteArtworkKey(f.artist, f.song_title);
                const query = `${String(f.artist || '').trim()} ${String(f.song_title || '').trim()}`.trim();
                if (!key || !query) return;
                try {
                    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
                    const data = await fetchJsonWithRetry(url, {}, 2800, 0);
                    const row = Array.isArray(data?.results) ? data.results[0] : null;
                    const cover = row?.artworkUrl100 ? upscaleItunesArtwork(row.artworkUrl100) : '';
                    favoriteArtworkCache.set(key, cover || buildFavoriteArtworkFallback(f.artist, f.song_title));
                } catch (_err) {
                    favoriteArtworkCache.set(key, buildFavoriteArtworkFallback(f.artist, f.song_title));
                }
            }));
        }

        function getFilteredFavorites() {
            const q = normalizeLookupText(favoritesFilterText || '');
            let rows = (authFavoritesCache || []).filter((f) => {
                if (favoritesTypeFilter === 'custom') return f.source_type === 'custom';
                if (favoritesTypeFilter === 'catalog') return f.source_type !== 'custom';
                return true;
            }).filter((f) => {
                if (favoritesArtistFilter === 'all') return true;
                return normalizeLookupText(f.artist || '') === favoritesArtistFilter;
            }).filter((f) => {
                if (!q) return true;
                const artist = normalizeLookupText(f.artist || '');
                const song = normalizeLookupText(f.song_title || '');
                return artist.includes(q) || song.includes(q);
            });

            if (favoritesSortMode === 'artist_az') {
                rows = rows.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || '')));
            } else if (favoritesSortMode === 'song_az') {
                rows = rows.sort((a, b) => String(a.song_title || '').localeCompare(String(b.song_title || '')));
            } else {
                rows = rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
            }
            return rows;
        }

        function renderFavoritesArtistOptions() {
            if (!elements.favoritesTabArtist) return;
            const map = new Map();
            (authFavoritesCache || []).forEach((f) => {
                const raw = String(f.artist || '').trim();
                const key = normalizeLookupText(raw);
                if (!raw || !key || map.has(key)) return;
                map.set(key, raw);
            });
            const options = Array.from(map.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`);
            elements.favoritesTabArtist.innerHTML = `<option value="all">All artists</option>${options.join('')}`;
            if (favoritesArtistFilter !== 'all' && !map.has(favoritesArtistFilter)) {
                favoritesArtistFilter = 'all';
            }
            elements.favoritesTabArtist.value = favoritesArtistFilter;
        }

        function renderSetupFavoritesTab() {
            if (!elements.favoritesTabList) return;
            renderFavoritesArtistOptions();
            if (elements.favoritesTabFilter && elements.favoritesTabFilter.value !== favoritesFilterText) {
                elements.favoritesTabFilter.value = favoritesFilterText;
            }
            if (elements.favoritesTabSort && elements.favoritesTabSort.value !== favoritesSortMode) {
                elements.favoritesTabSort.value = favoritesSortMode;
            }
            if (elements.favoritesTabType && elements.favoritesTabType.value !== favoritesTypeFilter) {
                elements.favoritesTabType.value = favoritesTypeFilter;
            }
            if (elements.favoritesTabArtist && elements.favoritesTabArtist.value !== favoritesArtistFilter) {
                elements.favoritesTabArtist.value = favoritesArtistFilter;
            }
            const isLoggedIn = !!authCurrentUser;
            if (!isLoggedIn) {
                elements.favoritesTabControls?.classList.add('hidden');
                elements.favoritesTabList.innerHTML = `<div class="auth-recent-empty">Login to see your saved favorites and play them instantly.</div>`;
                return;
            }
            if (!authFavoritesCache.length) {
                elements.favoritesTabControls?.classList.add('hidden');
                elements.favoritesTabList.innerHTML = `<div class="auth-recent-empty">No favorites yet. Load a song and click "Add current song" in your account.</div>`;
                return;
            }
            elements.favoritesTabControls?.classList.remove('hidden');
            const rows = getFilteredFavorites().slice(0, 80);
            if (!rows.length) {
                elements.favoritesTabList.innerHTML = `<div class="auth-recent-empty">No favorites match this filter.</div>`;
                return;
            }
            elements.favoritesTabList.innerHTML = rows.map((f) => {
                const title = escapeHtml(f.song_title || 'Unknown Song');
                const artist = escapeHtml(f.artist || 'Unknown Artist');
                const when = f.created_at ? new Date(f.created_at).toLocaleDateString() : '';
                const encodedArtist = encodeURIComponent(f.artist || '');
                const encodedTitle = encodeURIComponent(f.song_title || '');
                const sourceTag = f.source_type === 'custom' ? 'custom' : 'catalog';
                const artKey = favoriteArtworkKey(f.artist, f.song_title);
                const customCover = sanitizeAvatarUrl(f.custom_cover_url || '');
                const cover = escapeHtml(customCover || favoriteArtworkCache.get(artKey) || buildFavoriteArtworkFallback(f.artist, f.song_title));
                return `<button class="favorite-media-card"
                                data-onclick="playFavoriteFromSetup(${f.id},'${encodedArtist}','${encodedTitle}')">
                          <img class="favorite-media-thumb" src="${cover}" alt="${artist} cover" loading="lazy">
                          <div class="favorite-media-body">
                            <div class="favorite-media-title">${title}</div>
                            <div class="favorite-media-artist">${artist}</div>
                            <div class="favorite-media-meta">${when ? `saved ${when}` : 'saved song'}</div>
                            <div class="favorite-media-tag">${sourceTag}</div>
                          </div>
                        </button>`;
            }).join('');
        }

        async function playFavoriteFromSetup(favoriteId, encodedArtist, encodedTitle) {
            const artist = decodeURIComponent(String(encodedArtist || '')).trim();
            const title = decodeURIComponent(String(encodedTitle || '')).trim();
            if (!artist || !title) {
                showToast('Invalid favorite song.', 'error');
                return;
            }
            const favorite = (authFavoritesCache || []).find((f) => Number(f.id) === Number(favoriteId));
            if (favorite?.source_type === 'custom' && favorite?.custom_lyrics) {
                state.isCustomGame = true;
                startGame(
                    String(favorite.custom_lyrics || ''),
                    favorite.song_title || 'Custom Text',
                    favorite.artist || 'Custom',
                    String(favorite.custom_translation || '')
                );
                return;
            }
            if (elements.artistInput) elements.artistInput.value = artist;
            if (elements.titleInput) elements.titleInput.value = title;
            switchTab('search');
            await fetchLyrics();
        }

        async function addCurrentSongToFavorites() {
            const songTitle = (state.songTitle || '').trim();
            const artist = (state.artist || '').trim();
            if (!songTitle || !artist) {
                showToast('Load a song first.', 'error');
                return;
            }
            if (state.isCustomGame) {
                await addSongToFavorites(artist, songTitle, false, {
                    sourceType: 'custom',
                    customLyrics: state.currentLyricsRaw || '',
                    customTranslation: state.currentTranslationRaw || ''
                });
                return;
            }
            await addSongToFavorites(artist, songTitle);
        }

        async function removeFavoriteSong(favoriteId) {
            if (!ensureSupabaseReady()) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) return;
            const { error } = await supabase
                .from('user_favorites')
                .delete()
                .eq('id', favoriteId)
                .eq('user_id', user.id);
            if (error) {
                showToast('Could not remove favorite.', 'error');
                return;
            }
            await loadFavoriteSongs(user.id);
        }

        async function addFavoriteFromCatalog(encodedArtist, encodedTitle) {
            const artist = decodeURIComponent(String(encodedArtist || '')).trim();
            const title = decodeURIComponent(String(encodedTitle || '')).trim();
            if (!artist || !title) {
                showToast('Invalid song data.', 'error');
                return;
            }
            await addSongToFavorites(artist, title);
            await renderArtistCatalogList(elements.artistSongFilter?.value || '', false);
        }

        async function loginWithProvider(provider) {
            if (!ensureSupabaseReady()) return;
            const supported = ['google', 'github'];
            if (!supported.includes(provider)) {
                showToast('Unsupported provider.', 'error');
                return;
            }
            const { error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: `${window.location.origin}${window.location.pathname}`
                }
            });
            if (error) {
                showToast('Social login could not be started.', 'error');
            }
        }

        function groupResultsBySong(rows) {
            const map = new Map();
            (rows || []).forEach((row) => {
                const artist = row.artist || 'Unknown Artist';
                const title = row.song_title || 'Custom Lyrics';
                const key = `${artist}|||${title}`;
                if (!map.has(key)) {
                    map.set(key, { key, artist, title, rows: [] });
                }
                map.get(key).rows.push(row);
            });
            return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length || a.title.localeCompare(b.title));
        }

        function populateSongHistorySelector(songGroups) {
            if (!elements.authHistorySong) return;
            const current = elements.authHistorySong.value;
            const options = ['<option value="">Select a song</option>']
                .concat(songGroups.map((g) => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.artist)} - ${escapeHtml(g.title)} (${g.rows.length})</option>`));
            elements.authHistorySong.innerHTML = options.join('');
            const keep = songGroups.some((g) => g.key === current);
            elements.authHistorySong.value = keep ? current : (songGroups[0]?.key || '');
        }

        function drawSongHistoryChart(group) {
            const canvas = elements.authHistoryChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const dpr = window.devicePixelRatio || 1;
            const cssW = Math.max(260, Math.round(canvas.clientWidth || 320));
            const cssH = Math.max(120, Math.round(canvas.clientHeight || 120));
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            ctx.clearRect(0, 0, cssW, cssH);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
            ctx.fillRect(0, 0, cssW, cssH);

            if (!group || !group.rows || group.rows.length === 0) {
                ctx.fillStyle = 'rgba(120, 140, 155, 0.9)';
                ctx.font = '12px Roboto Mono, monospace';
                ctx.fillText('No data yet', 10, 24);
                return;
            }

            const rows = [...group.rows].reverse();
            const padding = 18;
            const width = cssW - padding * 2;
            const height = cssH - padding * 2;
            const maxWpm = Math.max(10, ...rows.map((r) => Number(r.wpm) || 0));

            ctx.strokeStyle = 'rgba(125, 145, 160, 0.35)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = padding + (height * i / 4);
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(padding + width, y);
                ctx.stroke();
            }

            const n = rows.length;
            const stepX = n > 1 ? width / (n - 1) : 0;
            ctx.strokeStyle = '#3EE39E';
            ctx.lineWidth = 2;
            ctx.beginPath();
            rows.forEach((row, idx) => {
                const wpm = Number(row.wpm) || 0;
                const x = padding + (idx * stepX);
                const y = padding + height - (wpm / maxWpm) * height;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.fillStyle = '#3EE39E';
            rows.forEach((row, idx) => {
                const wpm = Number(row.wpm) || 0;
                const x = padding + (idx * stepX);
                const y = padding + height - (wpm / maxWpm) * height;
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        function renderSongHistoryDetails() {
            if (!elements.authHistorySummary) return;
            const selected = elements.authHistorySong?.value || '';
            const group = authSongGroupsCache.find((g) => g.key === selected);
            drawSongHistoryChart(group);
            if (!group || group.rows.length === 0) {
                elements.authHistorySummary.textContent = 'Finish more tests to see detailed history by song.';
                return;
            }
            const games = group.rows.length;
            const avgWpm = Math.round(group.rows.reduce((s, r) => s + (Number(r.wpm) || 0), 0) / games);
            const bestWpm = Math.max(...group.rows.map((r) => Number(r.wpm) || 0));
            const avgAcc = Math.round(group.rows.reduce((s, r) => s + (Number(r.accuracy) || 0), 0) / games);
            elements.authHistorySummary.textContent = `${group.artist} - ${group.title} | ${games} runs | avg ${avgWpm} WPM | best ${bestWpm} WPM | avg acc ${avgAcc}%`;
        }

        function buildFriendAvatarButton(username, avatarUrl) {
            const name = String(username || 'U').trim() || 'U';
            const initial = escapeHtml(name.charAt(0).toUpperCase());
            const safeUrl = sanitizeAvatarUrl(avatarUrl || '');
            const src = safeUrl || `https://placehold.co/80x80/0B2D45/3EE39E?text=${encodeURIComponent(initial)}`;
            const encodedSrc = encodeURIComponent(src);
            const encodedName = encodeURIComponent(name);
            return `<button type="button" class="auth-friend-avatar-btn" data-avatar-src="${encodedSrc}" data-avatar-name="${encodedName}" title="View avatar">
                      <img class="auth-friend-avatar-img" src="${src}" alt="${escapeHtml(name)} avatar">
                    </button>`;
        }

        function bindFriendAvatarPreview(container) {
            if (!container) return;
            container.querySelectorAll('.auth-friend-avatar-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const src = decodeURIComponent(btn.getAttribute('data-avatar-src') || '');
                    const name = decodeURIComponent(btn.getAttribute('data-avatar-name') || 'User avatar');
                    openAvatarPreview(src, name);
                });
            });
        }

        function openFriendProfileFromList(encodedUsername, source = 'friends') {
            const username = decodeURIComponent(String(encodedUsername || '')).trim();
            if (!username) return;
            const key = normalizeLookupText(username);
            const friend = authFriendsCache.find((f) => normalizeLookupText(f.username) === key);
            const req = authFriendRequestsCache.find((r) => normalizeLookupText(r.username) === key);
            const selected = friend || req;
            if (!selected) {
                showToast('Could not load this profile now.', 'error');
                return;
            }
            profileHubContext = { type: 'friend', friend: selected, source };
            profileHubCompareFriendKey = key;
            if (elements.profileHubOverlay) {
                elements.profileHubOverlay.classList.remove('hidden');
                renderProfileHub();
            }
        }

        function readFriendSummaryStats(friend) {
            const toMaybeNumber = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const n = Number(value);
                return Number.isFinite(n) ? n : null;
            };
            const stats = {
                games: toMaybeNumber(friend?.games),
                bestWpm: toMaybeNumber(friend?.best_wpm ?? friend?.bestWpm),
                avgWpm: toMaybeNumber(friend?.avg_wpm ?? friend?.avgWpm),
                avgAcc: toMaybeNumber(friend?.avg_acc ?? friend?.avgAcc)
            };
            const hasSummary = ['games', 'best_wpm', 'avg_wpm', 'avg_acc', 'bestWpm', 'avgWpm', 'avgAcc']
                .some((k) => friend && friend[k] !== undefined && friend[k] !== null);
            return { stats, hasSummary };
        }

        function getSelfSummaryStats() {
            const parseTextNumber = (value) => {
                const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
                return Number.isFinite(n) ? n : 0;
            };
            return {
                games: Number(authStatsSummary?.games) || parseTextNumber(elements.authStatGames?.textContent),
                bestWpm: Number(authStatsSummary?.bestWpm) || parseTextNumber(elements.authStatBestWpm?.textContent),
                avgWpm: Number(authStatsSummary?.avgWpm) || parseTextNumber(elements.authStatAvgWpm?.textContent),
                avgAcc: Number(authStatsSummary?.avgAcc) || parseTextNumber(elements.authStatAvgAcc?.textContent)
            };
        }

        function renderProfileHubComparison(selfStats, preferredFriend = null) {
            if (!elements.profileHubCompareSelect || !elements.profileHubCompareGrid) return;
            const friends = Array.isArray(authFriendsCache) ? authFriendsCache : [];
            const preferredKey = normalizeLookupText(preferredFriend?.username || '');
            const preferredInFriends = preferredKey
                ? friends.some((f) => normalizeLookupText(f.username) === preferredKey)
                : false;
            const isFriendContext = profileHubContext.type === 'friend' && !!preferredFriend;
            const candidates = isFriendContext
                ? [preferredFriend]
                : ((!preferredFriend || preferredInFriends) ? friends : [preferredFriend, ...friends]);

            if (!candidates.length) {
                elements.profileHubCompareSelect.innerHTML = '<option value="">No friends to compare</option>';
                elements.profileHubCompareSelect.disabled = true;
                elements.profileHubCompareGrid.innerHTML = '<div class="auth-recent-empty">Add friends to compare your profile stats here.</div>';
                return;
            }

            const targetKey = profileHubCompareFriendKey || preferredKey || normalizeLookupText(candidates[0]?.username || '');
            profileHubCompareFriendKey = targetKey;

            elements.profileHubCompareSelect.disabled = isFriendContext;
            elements.profileHubCompareSelect.innerHTML = candidates.map((friend) => {
                const key = normalizeLookupText(friend?.username || '');
                const selected = key === targetKey ? ' selected' : '';
                return `<option value="${escapeHtml(key)}"${selected}>${escapeHtml(friend?.username || 'friend')}</option>`;
            }).join('');

            const selectedFriend = candidates.find((f) => normalizeLookupText(f.username || '') === profileHubCompareFriendKey) || candidates[0];
            const selectedName = String(selectedFriend?.username || 'friend');
            const { stats: friendStats } = readFriendSummaryStats(selectedFriend);

            const self = {
                games: Number(selfStats?.games) || 0,
                bestWpm: Number(selfStats?.bestWpm) || 0,
                avgWpm: Number(selfStats?.avgWpm) || 0,
                avgAcc: Number(selfStats?.avgAcc) || 0
            };
            const selfLabel = String(elements.authUserName?.textContent || 'You').trim();
            const metrics = [
                { label: 'Games', self: self.games, friend: friendStats.games, suffix: '' },
                { label: 'Best WPM', self: self.bestWpm, friend: friendStats.bestWpm, suffix: '' },
                { label: 'Avg WPM', self: self.avgWpm, friend: friendStats.avgWpm, suffix: '' },
                { label: 'Avg Acc', self: self.avgAcc, friend: friendStats.avgAcc, suffix: '%' }
            ];

            const rows = metrics.map((metric) => {
                const hasFriendValue = metric.friend !== null && metric.friend !== undefined;
                const diff = hasFriendValue ? (metric.friend - metric.self) : null;
                const diffClass = diff === null ? 'even' : (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'even'));
                const friendText = hasFriendValue ? `${metric.friend}${metric.suffix}` : 'N/A';
                const diffText = diff === null ? 'N/A' : `${diff > 0 ? '+' : ''}${diff}${metric.suffix}`;
                return `<div class="profile-hub-compare-row">
                          <div class="profile-hub-compare-metric">${metric.label}</div>
                          <div class="profile-hub-compare-you">${metric.self}${metric.suffix}</div>
                          <div class="profile-hub-compare-friend">${friendText}</div>
                          <div class="profile-hub-compare-diff ${diffClass}">${diffText}</div>
                        </div>`;
            }).join('');

            elements.profileHubCompareGrid.innerHTML = `
                <div class="profile-hub-compare-row head">
                    <div class="profile-hub-compare-metric">Metric</div>
                    <div class="profile-hub-compare-you">${escapeHtml(selfLabel)}</div>
                    <div class="profile-hub-compare-friend">${escapeHtml(selectedName)}</div>
                    <div class="profile-hub-compare-diff">Diff</div>
                </div>
                ${rows}
            `;
        }

        async function loadFriendsPanel() {
            if (!supabase || !authCurrentUser) return;
            const [reqRes, friendsRes] = await Promise.all([
                supabase.rpc('get_my_friend_requests'),
                supabase.rpc('get_my_friends_with_stats')
            ]);

            const reqRowsAll = reqRes.data || [];
            const reqRows = reqRowsAll.filter((r) => String(r?.status || '').toLowerCase() === 'pending');
            const friendRows = friendsRes.data || [];
            authFriendRequestsCache = reqRows;
            authFriendsCache = friendRows;

            if (elements.authFriendRequests) {
                if (reqRows.length === 0) {
                    elements.authFriendRequests.innerHTML = '<div class="auth-recent-empty">No requests.</div>';
                } else {
                    elements.authFriendRequests.innerHTML = reqRows.map((r) => {
                        const username = escapeHtml(r.username);
                        const encodedUsername = encodeURIComponent(r.username || '');
                        const direction = escapeHtml(r.direction);
                        const status = escapeHtml(r.status);
                        const actions = r.direction === 'incoming' && r.status === 'pending'
                            ? `<div class="auth-friend-actions">
                                 <button class="auth-friend-btn accept" data-onclick="respondFriendRequest(${r.request_id}, true)">Accept</button>
                                 <button class="auth-friend-btn reject" data-onclick="respondFriendRequest(${r.request_id}, false)">Reject</button>
                                 <button class="auth-friend-btn" data-onclick="openFriendProfileFromList('${encodedUsername}','requests')">View profile</button>
                               </div>`
                            : `<div class="auth-friend-actions">
                                 <div class="auth-friend-meta">${direction} - ${status}</div>
                                 <button class="auth-friend-btn" data-onclick="openFriendProfileFromList('${encodedUsername}','requests')">View profile</button>
                               </div>`;
                        const avatar = buildFriendAvatarButton(r.username, r.avatar_url);
                        return `<div class="auth-friend-item">
                                  ${avatar}
                                  <div>
                                    <div class="auth-friend-name">${username}</div>
                                    <div class="auth-friend-meta">${direction} - ${status}</div>
                                  </div>
                                  ${actions}
                                </div>`;
                    }).join('');
                    bindFriendAvatarPreview(elements.authFriendRequests);
                }
            }

            if (elements.authFriendCompare) {
                if (friendRows.length === 0) {
                    elements.authFriendCompare.innerHTML = '<div class="auth-recent-empty">No friends added yet.</div>';
                } else {
                    const selfAvg = Number(elements.authStatAvgWpm?.textContent || 0);
                    elements.authFriendCompare.innerHTML = friendRows.map((f) => {
                        const diff = (Number(f.avg_wpm) || 0) - selfAvg;
                        const diffText = `${diff > 0 ? '+' : ''}${diff} vs you`;
                        const username = escapeHtml(f.username);
                        const encodedUsername = encodeURIComponent(f.username || '');
                        const avatar = buildFriendAvatarButton(f.username, f.avatar_url);
                        return `<div class="auth-friend-item">
                                  ${avatar}
                                  <div>
                                    <div class="auth-friend-name">${username}</div>
                                    <div class="auth-friend-meta">${f.games} games | avg ${f.avg_wpm} | best ${f.best_wpm} | acc ${f.avg_acc}%</div>
                                  </div>
                                  <div class="auth-friend-actions">
                                    <div class="auth-recent-score">${escapeHtml(diffText)}</div>
                                    <button class="auth-friend-btn" data-onclick="openFriendProfileFromList('${encodedUsername}','compare')">View profile</button>
                                  </div>
                                </div>`;
                    }).join('');
                    bindFriendAvatarPreview(elements.authFriendCompare);
                }
            }
            renderDuelFriendInviteList();
            renderProfileHub();
        }

        async function sendFriendRequest() {
            if (!ensureSupabaseReady()) return;
            const identifier = (elements.authFriendUsername?.value || '').trim();
            if (!identifier) {
                showToast('Enter email or username.', 'error');
                return;
            }
            const { data, error } = await supabase.rpc('create_friend_request_by_username', {
                target_username: identifier
            });
            if (error) {
                showToast('Could not send friend request.', 'error');
                return;
            }
            if (elements.authFriendUsername) elements.authFriendUsername.value = '';
            showToast(data || 'Friend request processed.', 'info');
            await loadFriendsPanel();
        }

        async function respondFriendRequest(requestId, acceptRequest) {
            if (!ensureSupabaseReady()) return;
            const { error } = await supabase.rpc('respond_friend_request', {
                req_id: requestId,
                accept_request: !!acceptRequest
            });
            if (error) {
                showToast('Could not update request.', 'error');
                return;
            }
            showToast(acceptRequest ? 'Friend request accepted.' : 'Friend request rejected.', 'info');
            await loadFriendsPanel();
        }

        function clearDuelPolling() {
            if (duelPollTimer) {
                clearInterval(duelPollTimer);
                duelPollTimer = null;
            }
        }

        function clearDuelRealtimeRoomSubscription() {
            if (duelSnapshotRefreshTimer) {
                clearTimeout(duelSnapshotRefreshTimer);
                duelSnapshotRefreshTimer = null;
            }
            if (duelRealtimeRoomChannel && supabase) {
                supabase.removeChannel(duelRealtimeRoomChannel).catch(() => {});
            }
            duelRealtimeRoomChannel = null;
            duelRealtimeRoomId = '';
        }

        function clearDuelRealtimeInvitesSubscription() {
            if (duelRealtimeInvitesChannel && supabase) {
                supabase.removeChannel(duelRealtimeInvitesChannel).catch(() => {});
            }
            duelRealtimeInvitesChannel = null;
            duelRealtimeInvitesUserId = '';
        }

        function queueDuelSnapshotRefresh(delayMs = 120) {
            if (duelSnapshotRefreshTimer || !state.duel.inRoom || !state.duel.roomId) return;
            duelSnapshotRefreshTimer = setTimeout(() => {
                duelSnapshotRefreshTimer = null;
                pollDuelRoom().catch(() => {});
            }, Math.max(0, Number(delayMs) || 0));
        }

        function ensureDuelRealtimeRoomSubscription(roomId) {
            if (!supabase || !roomId) return;
            if (duelRealtimeRoomChannel && duelRealtimeRoomId === roomId) return;
            clearDuelRealtimeRoomSubscription();
            const roomFilter = `id=eq.${roomId}`;
            const roomMemberFilter = `room_id=eq.${roomId}`;
            const channel = supabase
                .channel(`duel-room:${roomId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_rooms',
                    filter: roomFilter
                }, () => queueDuelSnapshotRefresh(0))
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_room_members',
                    filter: roomMemberFilter
                }, () => queueDuelSnapshotRefresh(0))
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_progress',
                    filter: roomMemberFilter
                }, () => queueDuelSnapshotRefresh(0))
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_room_invites',
                    filter: roomMemberFilter
                }, () => {
                    renderDuelInvites().catch(() => {});
                    queueDuelSnapshotRefresh(0);
                })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        queueDuelSnapshotRefresh(0);
                        return;
                    }
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        if (duelRealtimeRoomChannel === channel) {
                            duelRealtimeRoomChannel = null;
                            duelRealtimeRoomId = '';
                        }
                        if (state.duel.inRoom && state.duel.roomId === roomId) ensureDuelPolling();
                    }
                });
            duelRealtimeRoomChannel = channel;
            duelRealtimeRoomId = roomId;
        }

        function ensureDuelRealtimeInvitesSubscription(userId) {
            if (!supabase || !userId) return;
            if (duelRealtimeInvitesChannel && duelRealtimeInvitesUserId === userId) return;
            clearDuelRealtimeInvitesSubscription();
            const channel = supabase
                .channel(`duel-invites:${userId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_room_invites',
                    filter: `invitee_id=eq.${userId}`
                }, () => {
                    renderDuelInvites().catch(() => {});
                    queueDuelSnapshotRefresh(0);
                })
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'duel_room_invites',
                    filter: `inviter_id=eq.${userId}`
                }, () => {
                    renderDuelInvites().catch(() => {});
                    queueDuelSnapshotRefresh(0);
                })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        renderDuelInvites().catch(() => {});
                    }
                });
            duelRealtimeInvitesChannel = channel;
            duelRealtimeInvitesUserId = userId;
        }

        function clearDuelState() {
            clearDuelPolling();
            clearDuelRealtimeRoomSubscription();
            duelLastProgressSentAt = 0;
            state.duel = {
                roomId: '',
                status: 'idle',
                uiStep: 'entry',
                ownerId: '',
                ownerName: '',
                songTitle: '',
                artist: '',
                lyrics: '',
                songConfigured: false,
                translation: '',
                startedAtMs: 0,
                countdownSeconds: 5,
                inRoom: false,
                isOwner: false,
                opponentId: '',
                opponentName: '',
                gameLaunched: false,
                resultShown: false
            };
            if (elements.duelSongArtist) elements.duelSongArtist.value = '';
            if (elements.duelSongTitle) elements.duelSongTitle.value = '';
            if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Pick a song before starting.';
            if (elements.duelRoomCodeInputView) elements.duelRoomCodeInputView.value = '';
            if (elements.duelHud) elements.duelHud.classList.add('hidden');
            renderDuelPanel();
        }

        function getCurrentTypedChars() {
            let charCount = 0;
            for (let i = 0; i < state.currentWordIndex; i++) {
                charCount += (state.words[i]?.length || 0) + 1;
            }
            charCount += (elements.input?.value || '').length;
            return Math.max(0, charCount);
        }

        function setDuelHudProgress(selfPercent, opponentPercent, selfLabel, opponentLabel, centerLabel) {
            if (elements.duelMeProgressBar) elements.duelMeProgressBar.style.width = `${Math.max(0, Math.min(100, selfPercent))}%`;
            if (elements.duelOpponentProgressBar) elements.duelOpponentProgressBar.style.width = `${Math.max(0, Math.min(100, opponentPercent))}%`;
            if (elements.duelMeProgressText) elements.duelMeProgressText.textContent = selfLabel;
            if (elements.duelOpponentProgressText) elements.duelOpponentProgressText.textContent = opponentLabel;
            if (elements.duelCountdownText) elements.duelCountdownText.textContent = centerLabel;
        }

        function isDuelSongConfigured(room = state.duel) {
            const title = String(room?.songTitle || '').trim();
            const lyrics = String(room?.lyrics || '').trim();
            return !!title && !!lyrics && title !== 'Pending song' && lyrics !== 'waiting';
        }

        function renderDuelPanel() {
            const inRoom = !!state.duel.inRoom && !!state.duel.roomId;
            if (!inRoom) state.duel.uiStep = 'entry';
            if (elements.duelStepEntry) elements.duelStepEntry.classList.toggle('hidden', state.duel.uiStep !== 'entry');
            if (elements.duelStepRoom) elements.duelStepRoom.classList.toggle('hidden', state.duel.uiStep !== 'room');
            if (elements.duelStepSong) elements.duelStepSong.classList.toggle('hidden', state.duel.uiStep !== 'song');
            if (elements.duelRoomBox) elements.duelRoomBox.classList.toggle('hidden', !state.duel.inRoom);
            if (elements.duelRoomMeta) {
                elements.duelRoomMeta.textContent = state.duel.inRoom
                    ? `Room: ${state.duel.roomId}`
                    : 'Room: -';
            }
            if (elements.duelRoomStatus) {
                elements.duelRoomStatus.textContent = `Status: ${state.duel.status || 'idle'}`;
            }
            if (elements.duelViewState) {
                elements.duelViewState.textContent = state.duel.inRoom
                    ? `Room active (${state.duel.status})`
                    : 'Not in a duel room.';
            }
            if (elements.duelViewOpponent) {
                elements.duelViewOpponent.textContent = state.duel.opponentName
                    ? `Opponent: ${state.duel.opponentName}`
                    : '';
            }
            if (elements.duelSlotOwner) {
                elements.duelSlotOwner.textContent = inRoom
                    ? (state.duel.ownerName || (elements.authUserName?.textContent || 'You'))
                    : '-';
            }
            if (elements.duelSlotOpponent) {
                elements.duelSlotOpponent.textContent = inRoom
                    ? (state.duel.opponentName || 'Empty slot')
                    : 'Empty slot';
            }
            if (elements.duelViewInviteTarget) {
                elements.duelViewInviteTarget.disabled = !inRoom;
                if (!inRoom) {
                    elements.duelViewInviteTarget.value = '';
                    elements.duelViewInviteTarget.placeholder = 'Create or join a room first';
                } else {
                    elements.duelViewInviteTarget.placeholder = 'friend username/email';
                }
            }
            if (elements.duelViewInviteBtn) {
                elements.duelViewInviteBtn.disabled = !inRoom;
            }
            if (elements.duelNextToSongBtn) {
                elements.duelNextToSongBtn.classList.toggle('hidden', !state.duel.isOwner);
                elements.duelNextToSongBtn.disabled = !inRoom || !state.duel.isOwner;
            }
            if (elements.duelSongArtist) {
                if (!elements.duelSongArtist.value && state.duel.artist) elements.duelSongArtist.value = state.duel.artist;
                elements.duelSongArtist.disabled = !state.duel.isOwner || !inRoom;
            }
            if (elements.duelSongTitle) {
                if (!elements.duelSongTitle.value && state.duel.songTitle && state.duel.songTitle !== 'Pending song') elements.duelSongTitle.value = state.duel.songTitle;
                elements.duelSongTitle.disabled = !state.duel.isOwner || !inRoom;
            }
            if (elements.duelSongStatus) {
                if (!inRoom) {
                    elements.duelSongStatus.textContent = 'Join or create a room first.';
                } else if (!state.duel.isOwner) {
                    elements.duelSongStatus.textContent = isDuelSongConfigured()
                        ? `Waiting start: ${state.duel.artist || 'Unknown'} - ${state.duel.songTitle}`
                        : 'Waiting room owner to choose the song.';
                } else if (isDuelSongConfigured()) {
                    elements.duelSongStatus.textContent = `Ready: ${state.duel.artist || 'Unknown'} - ${state.duel.songTitle}`;
                } else {
                    elements.duelSongStatus.textContent = 'Pick artist and song, then start game.';
                }
            }
            if (elements.duelMeName) {
                const meName = elements.authUserName?.textContent || 'You';
                elements.duelMeName.textContent = meName;
            }
            if (elements.duelOpponentName) {
                elements.duelOpponentName.textContent = state.duel.opponentName || '-';
            }
            renderDuelFriendInviteList();
        }

        function goToDuelSongStep() {
            if (!state.duel.inRoom || !state.duel.roomId) {
                showToast('Create or join a room first.', 'error');
                return;
            }
            if (!state.duel.isOwner) {
                showToast('Only room owner can choose the song.', 'info');
                return;
            }
            state.duel.uiStep = 'song';
            renderDuelPanel();
        }

        function goToDuelRoomStep() {
            state.duel.uiStep = state.duel.inRoom ? 'room' : 'entry';
            renderDuelPanel();
        }

        async function fetchDuelLyricsBySong(artist, title) {
            const controller = new AbortController();
            const signal = controller.signal;
            try {
                const lrclibData = await fetchFromLrcLib(artist, title, signal);
                if (lrclibData && lrclibData.lyrics) {
                    return { lyrics: cleanLyrics(lrclibData.lyrics), translation: '' };
                }
            } catch (_e) {}
            const fallback = await fetchFromLyricsOvh(artist, title, signal);
            return { lyrics: cleanLyrics(fallback || ''), translation: '' };
        }

        async function prepareAndStartDuel() {
            if (!ensureSupabaseReady()) return;
            if (!state.duel.inRoom || !state.duel.roomId) {
                showToast('Create or join a room first.', 'error');
                return;
            }
            if (!state.duel.isOwner) {
                showToast('Only room owner can start.', 'error');
                return;
            }
            const artist = String(elements.duelSongArtist?.value || '').trim();
            const title = String(elements.duelSongTitle?.value || '').trim();
            if (!artist || !title) {
                showToast('Enter artist and song name.', 'error');
                return;
            }
            if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Loading lyrics...';
            let lyricsPayload = null;
            try {
                lyricsPayload = await fetchDuelLyricsBySong(artist, title);
            } catch (e) {
                if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Could not find lyrics.';
                showToast('Could not load lyrics for this song.', 'error');
                return;
            }
            const lyrics = String(lyricsPayload?.lyrics || '').trim();
            if (!lyrics) {
                if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Could not find lyrics.';
                showToast('Could not load lyrics for this song.', 'error');
                return;
            }
            const { error: updateError } = await supabase
                .from('duel_rooms')
                .update({
                    song_title: title,
                    artist,
                    lyrics,
                    translation: String(lyricsPayload?.translation || ''),
                    status: 'waiting'
                })
                .eq('id', state.duel.roomId)
                .eq('owner_id', authCurrentUser?.id || '');
            if (updateError) {
                showToast('Could not save duel song.', 'error');
                if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Could not save selected song.';
                return;
            }
            if (elements.duelSongStatus) elements.duelSongStatus.textContent = 'Song selected. Starting countdown...';
            state.duel.songTitle = title;
            state.duel.artist = artist;
            state.duel.lyrics = lyrics;
            state.duel.songConfigured = true;
            await startDuelCountdown();
            state.duel.uiStep = 'room';
            renderDuelPanel();
        }

        function renderDuelFriendInviteList() {
            if (!elements.duelFriendList && !elements.duelViewFriendList) return;
            const buildHtml = () => {
                if (!state.duel.inRoom || !state.duel.roomId) {
                    return '<div class="auth-recent-empty">Create or join a room to invite friends.</div>';
                }
                if (!authFriendsCache.length) {
                    return '<div class="auth-recent-empty">No friends added yet.</div>';
                }
                const canInvite = !!state.duel.inRoom && !!state.duel.roomId;
                return authFriendsCache.map((f) => {
                    const usernameRaw = String(f.username || '').trim();
                    const username = escapeHtml(usernameRaw || 'friend');
                    const encodedUsername = encodeURIComponent(usernameRaw);
                    const avatar = buildFriendAvatarButton(f.username, f.avatar_url);
                    const inviteBtn = canInvite
                        ? `<button class="auth-friend-btn accept" data-onclick="inviteDuelFriendByUsername('${encodedUsername}')">Invite duel</button>`
                        : `<button class="auth-friend-btn" disabled title="Create or join a duel room first">Invite duel</button>`;
                    return `<div class="auth-friend-item">
                              ${avatar}
                              <div>
                                <div class="auth-friend-name">${username}</div>
                                <div class="auth-friend-meta">${f.games} games | avg ${f.avg_wpm} | best ${f.best_wpm}</div>
                              </div>
                              <div class="auth-friend-actions">
                                ${inviteBtn}
                              </div>
                            </div>`;
                }).join('');
            };
            const html = buildHtml();
            if (elements.duelFriendList) elements.duelFriendList.innerHTML = html;
            if (elements.duelViewFriendList) elements.duelViewFriendList.innerHTML = html;
            if (elements.duelFriendList) bindFriendAvatarPreview(elements.duelFriendList);
            if (elements.duelViewFriendList) bindFriendAvatarPreview(elements.duelViewFriendList);
        }

        async function invitePlayerToDuelRoomByIdentifier(target) {
            if (!ensureSupabaseReady()) return;
            if (!state.duel.roomId) {
                showToast('Create or join a room first.', 'error');
                return;
            }
            const safeTarget = String(target || '').trim();
            if (!safeTarget) {
                showToast('Enter friend username/email.', 'error');
                return;
            }
            const { data, error } = await supabase.rpc('invite_duel_player', {
                p_room_id: state.duel.roomId,
                p_target_identifier: safeTarget
            });
            if (error) {
                showToast(error.message || 'Could not send duel invite.', 'error');
                return;
            }
            showToast(data || 'Invite sent.', 'info');
            await renderDuelInvites();
        }

        async function invitePlayerToDuelRoomFromView() {
            const target = String(elements.duelViewInviteTarget?.value || '').trim();
            await invitePlayerToDuelRoomByIdentifier(target);
            if (elements.duelViewInviteTarget) elements.duelViewInviteTarget.value = '';
        }

        async function inviteDuelFriendByUsername(encodedUsername) {
            const username = decodeURIComponent(String(encodedUsername || '')).trim();
            if (!username) {
                showToast('Invalid friend.', 'error');
                return;
            }
            if (elements.duelInviteTarget) elements.duelInviteTarget.value = username;
            if (elements.duelViewInviteTarget) elements.duelViewInviteTarget.value = username;
            await invitePlayerToDuelRoomByIdentifier(username);
        }

        async function renderDuelInvites() {
            if (!ensureSupabaseReady() || !elements.duelInviteList) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                elements.duelInviteList.innerHTML = '<div class="auth-recent-empty">Login required.</div>';
                return;
            }
            const { data, error } = await supabase
                .from('duel_room_invites')
                .select('id,room_id,status,created_at,inviter_id')
                .eq('invitee_id', user.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(20);
            if (error || !data || data.length === 0) {
                elements.duelInviteList.innerHTML = '<div class="auth-recent-empty">No duel invites.</div>';
                return;
            }
            const inviterIds = Array.from(new Set(data.map((row) => row.inviter_id).filter(Boolean)));
            let inviterMap = new Map();
            if (inviterIds.length > 0) {
                const { data: inviterProfiles } = await supabase
                    .from('profiles')
                    .select('id,username,avatar_url')
                    .in('id', inviterIds);
                inviterMap = new Map((inviterProfiles || []).map((p) => [p.id, p]));
            }
            elements.duelInviteList.innerHTML = data.map((row) => {
                const from = inviterMap.get(row.inviter_id)?.username || 'player';
                return `<div class="auth-friend-item">
                          <div>
                            <div class="auth-friend-name">${escapeHtml(from)}</div>
                            <div class="auth-friend-meta">room ${escapeHtml(String(row.room_id || ''))}</div>
                          </div>
                          <div class="auth-friend-actions">
                            <button class="auth-friend-btn accept" data-onclick="respondDuelInvite(${row.id}, true)">Accept</button>
                            <button class="auth-friend-btn reject" data-onclick="respondDuelInvite(${row.id}, false)">Reject</button>
                          </div>
                        </div>`;
            }).join('');
        }

        async function fetchDuelRoomSnapshot(roomId) {
            if (!roomId || !ensureSupabaseReady()) return null;
            const { data: room, error: roomError } = await supabase
                .from('duel_rooms')
                .select('id,owner_id,song_title,artist,lyrics,translation,status,countdown_seconds,started_at,finished_at,created_at')
                .eq('id', roomId)
                .maybeSingle();
            if (roomError || !room) return null;

            const { data: members } = await supabase
                .from('duel_room_members')
                .select('room_id,user_id,joined_at')
                .eq('room_id', roomId);
            const { data: progress } = await supabase
                .from('duel_progress')
                .select('room_id,user_id,typed_words,typed_chars,wpm,accuracy,is_finished,finished_at,updated_at')
                .eq('room_id', roomId);

            const userIds = Array.from(new Set([room.owner_id, ...(members || []).map((m) => m.user_id)].filter(Boolean)));
            let profilesMap = new Map();
            if (userIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id,username')
                    .in('id', userIds);
                profilesMap = new Map((profiles || []).map((p) => [p.id, p]));
            }
            return { room, members: members || [], progress: progress || [], profilesMap };
        }

        async function findResumableDuelRoomId() {
            if (!ensureSupabaseReady()) return '';
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) return '';
            const { data: memberships } = await supabase
                .from('duel_room_members')
                .select('room_id,joined_at')
                .eq('user_id', user.id)
                .order('joined_at', { ascending: false })
                .limit(10);
            const roomIds = (memberships || []).map((m) => m.room_id).filter(Boolean);
            if (!roomIds.length) return '';
            const { data: rooms } = await supabase
                .from('duel_rooms')
                .select('id,status,created_at')
                .in('id', roomIds);
            const resumable = (rooms || [])
                .filter((r) => ['waiting', 'countdown', 'active'].includes(String(r.status || '')))
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            if (resumable[0]?.id) return resumable[0].id;

            // Fallback: owner may still have an active room even if membership row was lost.
            const { data: ownedRooms } = await supabase
                .from('duel_rooms')
                .select('id,status,created_at')
                .eq('owner_id', user.id)
                .in('status', ['waiting', 'countdown', 'active'])
                .order('created_at', { ascending: false })
                .limit(1);
            return ownedRooms?.[0]?.id || '';
        }

        function announceDuelResultIfReady(progressRows) {
            if (!state.duel.inRoom || state.duel.resultShown) return;
            const finishedRows = (progressRows || [])
                .filter((p) => p.is_finished && p.finished_at)
                .sort((a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime());
            if (finishedRows.length < 2) return;
            const me = authCurrentUser?.id || '';
            const winner = finishedRows[0];
            const isWinner = winner.user_id === me;
            showToast(isWinner ? 'You won the duel.' : 'You lost the duel.', isWinner ? 'info' : 'error');
            state.duel.resultShown = true;
        }

        function updateDuelHud(snapshot) {
            if (!elements.duelHud) return;
            if (!state.duel.inRoom || !state.duel.gameLaunched) {
                elements.duelHud.classList.add('hidden');
                return;
            }
            elements.duelHud.classList.remove('hidden');
            const me = authCurrentUser?.id || '';
            const totalWords = Math.max(1, String(snapshot?.room?.lyrics || '').split(/\s+/).filter(Boolean).length);
            const meProgress = (snapshot?.progress || []).find((p) => p.user_id === me);
            const opProgress = state.duel.opponentId
                ? (snapshot?.progress || []).find((p) => p.user_id === state.duel.opponentId)
                : null;
            const mePct = meProgress ? Math.round((Number(meProgress.typed_words || 0) / totalWords) * 100) : Math.round((state.currentWordIndex / totalWords) * 100);
            const opPct = opProgress ? Math.round((Number(opProgress.typed_words || 0) / totalWords) * 100) : 0;
            const now = Date.now();
            let center = 'Duel running';
            if (state.duel.startedAtMs > now) {
                center = `Start in ${Math.max(0, Math.ceil((state.duel.startedAtMs - now) / 1000))}s`;
            }
            if (meProgress?.is_finished && opProgress?.is_finished) {
                center = 'Finished';
            }
            setDuelHudProgress(
                mePct,
                opPct,
                `${Math.max(0, Math.min(100, mePct))}%${meProgress?.is_finished ? ' done' : ''}`,
                `${Math.max(0, Math.min(100, opPct))}%${opProgress?.is_finished ? ' done' : ''}`,
                center
            );
        }

        async function applyDuelSnapshot(snapshot) {
            const user = authCurrentUser || await syncCurrentUser();
            if (!user || !snapshot || !snapshot.room) return;
            const room = snapshot.room;
            const members = snapshot.members || [];
            const meInRoom = members.some((m) => m.user_id === user.id) || room.owner_id === user.id;
            if (!meInRoom) {
                clearDuelState();
                return;
            }
            state.duel.roomId = room.id;
            state.duel.inRoom = true;
            state.duel.status = room.status || 'waiting';
            state.duel.ownerId = room.owner_id || '';
            state.duel.isOwner = room.owner_id === user.id;
            state.duel.songTitle = room.song_title || 'Duel song';
            state.duel.artist = room.artist || 'Duel';
            state.duel.lyrics = room.lyrics || '';
            state.duel.songConfigured = isDuelSongConfigured({
                songTitle: room.song_title || '',
                lyrics: room.lyrics || ''
            });
            state.duel.translation = room.translation || '';
            state.duel.countdownSeconds = Number(room.countdown_seconds || 5) || 5;
            state.duel.startedAtMs = room.started_at ? new Date(room.started_at).getTime() : 0;
            if (room.status === 'finished' || room.status === 'canceled') {
                showToast('Duel room closed.', 'info');
                clearDuelState();
                return;
            }
            const ownerProfile = snapshot.profilesMap.get(room.owner_id);
            state.duel.ownerName = ownerProfile?.username || 'owner';
            const opponentMember = members.find((m) => m.user_id !== user.id) || null;
            state.duel.opponentId = opponentMember?.user_id || '';
            state.duel.opponentName = opponentMember
                ? (snapshot.profilesMap.get(opponentMember.user_id)?.username || 'opponent')
                : '';
            if (state.duel.uiStep === 'entry') {
                state.duel.uiStep = 'room';
            }
            if (elements.duelSongArtist && !elements.duelSongArtist.value && state.duel.artist && state.duel.artist !== 'Unknown') {
                elements.duelSongArtist.value = state.duel.artist;
            }
            if (elements.duelSongTitle && !elements.duelSongTitle.value && state.duel.songTitle && state.duel.songTitle !== 'Pending song') {
                elements.duelSongTitle.value = state.duel.songTitle;
            }

            if (elements.duelRoomMembers) {
                if (members.length === 0) {
                    elements.duelRoomMembers.innerHTML = '<div class="auth-recent-empty">No players.</div>';
                } else {
                    elements.duelRoomMembers.innerHTML = members.map((m) => {
                        const username = snapshot.profilesMap.get(m.user_id)?.username || 'player';
                        const suffix = m.user_id === room.owner_id ? ' (owner)' : '';
                        return `<div class="auth-friend-item">
                                  <div>
                                    <div class="auth-friend-name">${escapeHtml(username)}${suffix}</div>
                                  </div>
                                </div>`;
                    }).join('');
                }
            }

            const now = Date.now();
            if (state.duel.startedAtMs > now && room.status === 'countdown') {
                setDuelHudProgress(0, 0, '0%', '0%', `Start in ${Math.ceil((state.duel.startedAtMs - now) / 1000)}s`);
            }

            if (!state.duel.gameLaunched && room.status === 'countdown' && state.duel.startedAtMs > 0 && now >= state.duel.startedAtMs) {
                state.isClozeMode = false;
                state.isRhythmMode = false;
                document.getElementById('mode-cloze')?.classList.remove('active');
                document.getElementById('mode-rhythm')?.classList.remove('active');
                document.getElementById('mode-normal')?.classList.add('active');
                state.duel.gameLaunched = true;
                state.duel.resultShown = false;
                startGame(state.duel.lyrics, state.duel.songTitle, state.duel.artist, state.duel.translation || '');
                showToast('Duel started.', 'info');
            }

            updateDuelHud(snapshot);
            announceDuelResultIfReady(snapshot.progress || []);
            renderDuelPanel();
        }

        async function pollDuelRoom() {
            if (!state.duel.roomId || !state.duel.inRoom) return;
            const snapshot = await fetchDuelRoomSnapshot(state.duel.roomId);
            if (!snapshot) return;
            await applyDuelSnapshot(snapshot);
        }

        function ensureDuelPolling() {
            if (duelRealtimeRoomChannel && duelRealtimeRoomId && duelRealtimeRoomId === state.duel.roomId) {
                return;
            }
            clearDuelPolling();
            duelPollTimer = setInterval(() => {
                pollDuelRoom().catch(() => {});
            }, DUEL_POLL_MS);
        }

        async function createDuelRoomFromCurrentSong() {
            if (!ensureSupabaseReady()) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                showToast('Login first.', 'error');
                return;
            }
            const { data, error } = await supabase.rpc('create_duel_room', {
                p_song_title: 'Pending song',
                p_artist: 'Unknown',
                p_lyrics: 'waiting',
                p_translation: ''
            });
            if (error || !data) {
                showToast(error?.message || 'Could not create duel room.', 'error');
                return;
            }
            state.duel.roomId = data;
            state.duel.inRoom = true;
            state.duel.uiStep = 'room';
            state.duel.gameLaunched = false;
            state.duel.resultShown = false;
            ensureDuelRealtimeRoomSubscription(state.duel.roomId);
            await pollDuelRoom();
            showToast('Duel room created.', 'info');
            closeModal('profile');
            switchTab('duel');
        }

        async function joinDuelRoomByCode() {
            if (!ensureSupabaseReady()) return;
            const code = String(elements.duelRoomCodeInput?.value || '').trim();
            if (!code) {
                showToast('Enter a room id.', 'error');
                return;
            }
            const { error } = await supabase.rpc('join_duel_room', { p_room_id: code });
            if (error) {
                showToast(error.message || 'Could not join room.', 'error');
                return;
            }
            state.duel.roomId = code;
            state.duel.inRoom = true;
            state.duel.uiStep = 'room';
            state.duel.gameLaunched = false;
            state.duel.resultShown = false;
            if (elements.duelRoomCodeInput) elements.duelRoomCodeInput.value = '';
            if (elements.duelRoomCodeInputView) elements.duelRoomCodeInputView.value = '';
            ensureDuelRealtimeRoomSubscription(state.duel.roomId);
            await pollDuelRoom();
            showToast('Joined duel room.', 'info');
            closeModal('profile');
            switchTab('duel');
        }

        async function joinDuelRoomByCodeFromView() {
            const code = String(elements.duelRoomCodeInputView?.value || '').trim();
            if (!code) {
                showToast('Enter a room id.', 'error');
                return;
            }
            if (elements.duelRoomCodeInput) elements.duelRoomCodeInput.value = code;
            await joinDuelRoomByCode();
        }

        async function invitePlayerToDuelRoom() {
            const target = String(elements.duelInviteTarget?.value || '').trim();
            await invitePlayerToDuelRoomByIdentifier(target);
            if (elements.duelInviteTarget) elements.duelInviteTarget.value = '';
        }

        async function respondDuelInvite(inviteId, acceptInvite) {
            if (!ensureSupabaseReady()) return;
            const { data, error } = await supabase.rpc('respond_duel_invite', {
                p_invite_id: inviteId,
                p_accept: !!acceptInvite
            });
            if (error) {
                showToast(error.message || 'Could not update duel invite.', 'error');
                return;
            }
            if (acceptInvite && data) {
                state.duel.roomId = data;
                state.duel.inRoom = true;
                state.duel.uiStep = 'room';
                state.duel.gameLaunched = false;
                state.duel.resultShown = false;
                ensureDuelRealtimeRoomSubscription(state.duel.roomId);
                await pollDuelRoom();
                closeModal('profile');
                switchTab('duel');
            }
            showToast(acceptInvite ? 'Duel invite accepted.' : 'Duel invite rejected.', 'info');
            await renderDuelInvites();
        }

        async function startDuelCountdown() {
            if (!ensureSupabaseReady()) return;
            if (!state.duel.roomId) {
                showToast('Create a room first.', 'error');
                return;
            }
            if (!isDuelSongConfigured()) {
                showToast('Choose the song first (Next).', 'error');
                return;
            }
            const { data, error } = await supabase.rpc('start_duel_room', {
                p_room_id: state.duel.roomId,
                p_countdown_seconds: 5
            });
            if (error) {
                showToast(error.message || 'Could not start duel.', 'error');
                return;
            }
            state.duel.startedAtMs = data ? new Date(data).getTime() : (Date.now() + 5000);
            state.duel.gameLaunched = false;
            state.duel.resultShown = false;
            queueDuelSnapshotRefresh(0);
            showToast('Countdown started.', 'info');
            switchTab('duel');
        }

        async function leaveCurrentDuelRoom() {
            if (!ensureSupabaseReady()) return;
            if (!state.duel.roomId) {
                clearDuelState();
                return;
            }
            await supabase.rpc('leave_duel_room', { p_room_id: state.duel.roomId });
            clearDuelState();
            await renderDuelInvites();
            showToast('Left duel room.', 'info');
        }

        async function sendDuelProgress(forceFinished = false, overrides = {}) {
            if (!ensureSupabaseReady()) return;
            if (!state.duel.inRoom || !state.duel.roomId) return;
            const now = Date.now();
            if (!forceFinished && (now - duelLastProgressSentAt) < 700) return;
            duelLastProgressSentAt = now;
            const typedWords = Number(overrides.typedWords ?? state.currentWordIndex) || 0;
            const typedChars = Number(overrides.typedChars ?? getCurrentTypedChars()) || 0;
            const liveWpm = Number(overrides.wpm ?? Number(elements.liveWpm?.textContent || 0)) || 0;
            const liveAcc = Number(overrides.accuracy ?? 0) || 0;
            await supabase.rpc('upsert_duel_progress', {
                p_room_id: state.duel.roomId,
                p_typed_words: Math.max(0, typedWords),
                p_typed_chars: Math.max(0, typedChars),
                p_wpm: Math.max(0, liveWpm),
                p_accuracy: Math.max(0, Math.min(100, liveAcc)),
                p_is_finished: !!forceFinished
            });
        }

        function resetAuthDashboardUI() {
            if (elements.authStatGames) elements.authStatGames.textContent = '0';
            if (elements.authStatBestWpm) elements.authStatBestWpm.textContent = '0';
            if (elements.authStatAvgWpm) elements.authStatAvgWpm.textContent = '0';
            if (elements.authStatAvgAcc) elements.authStatAvgAcc.textContent = '0%';
            authStatsSummary = { games: 0, bestWpm: 0, avgWpm: 0, avgAcc: 0 };
            if (elements.authRecentResults) {
                elements.authRecentResults.innerHTML = '<div class="auth-recent-empty">No saved games yet.</div>';
            }
            if (elements.authUserLevel) elements.authUserLevel.textContent = 'Level 1';
            if (elements.authAchievements) elements.authAchievements.innerHTML = '<div class="auth-recent-empty">No achievements yet.</div>';
            authGameResultsCache = [];
            authSongGroupsCache = [];
            if (elements.authHistorySong) elements.authHistorySong.innerHTML = '<option value="">Select a song</option>';
            if (elements.authHistorySummary) elements.authHistorySummary.textContent = 'Finish more tests to see detailed history by song.';
            drawSongHistoryChart(null);
            if (elements.authFriendRequests) elements.authFriendRequests.innerHTML = '<div class="auth-recent-empty">No requests.</div>';
            if (elements.authFriendCompare) elements.authFriendCompare.innerHTML = '<div class="auth-recent-empty">No friends added yet.</div>';
            if (elements.duelFriendList) elements.duelFriendList.innerHTML = '<div class="auth-recent-empty">No friends added yet.</div>';
            if (elements.duelViewFriendList) elements.duelViewFriendList.innerHTML = '<div class="auth-recent-empty">No friends added yet.</div>';
            if (elements.authFavoritesList) elements.authFavoritesList.innerHTML = '<div class="auth-recent-empty">No favorites yet.</div>';
            if (elements.duelInviteList) elements.duelInviteList.innerHTML = '<div class="auth-recent-empty">No duel invites.</div>';
            if (elements.duelRoomMembers) elements.duelRoomMembers.innerHTML = '<div class="auth-recent-empty">No players.</div>';
            authFriendsCache = [];
            authFriendRequestsCache = [];
            authFavoritesCache = [];
            setPreferredPlayer('spotify');
            renderSetupFavoritesTab();
            renderProfileHub();
        }

        function renderRecentResults(rows) {
            if (!elements.authRecentResults) return;
            if (!rows || rows.length === 0) {
                elements.authRecentResults.innerHTML = '<div class="auth-recent-empty">No saved games yet.</div>';
                return;
            }
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

        function drawProfileHubChart(rows) {
            const canvas = elements.profileHubChart;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const dataRows = (rows || []).slice(0, 20).reverse();

            const dpr = window.devicePixelRatio || 1;
            const cssW = Math.max(260, Math.round(canvas.clientWidth || 320));
            const cssH = Math.max(130, Math.round(canvas.clientHeight || 140));
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.fillRect(0, 0, cssW, cssH);

            if (dataRows.length < 2) {
                ctx.fillStyle = 'rgba(120, 140, 155, 0.9)';
                ctx.font = '12px Roboto Mono, monospace';
                ctx.fillText('Complete tests to build your curve', 10, 24);
                return;
            }

            const padding = 16;
            const width = cssW - padding * 2;
            const height = cssH - padding * 2;
            const maxVal = Math.max(10, ...dataRows.map((r) => Number(r.wpm) || 0));

            ctx.strokeStyle = 'rgba(120, 140, 155, 0.32)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = padding + (height * i / 4);
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(padding + width, y);
                ctx.stroke();
            }

            const stepX = width / (dataRows.length - 1);
            ctx.strokeStyle = '#3EE39E';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            dataRows.forEach((row, idx) => {
                const wpm = Number(row.wpm) || 0;
                const x = padding + (stepX * idx);
                const y = padding + height - ((wpm / maxVal) * height);
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        function renderProfileHub() {
            if (!elements.profileHubOverlay || elements.profileHubOverlay.classList.contains('hidden')) return;
            if (profileHubContext.type === 'friend' && profileHubContext.friend) {
                const f = profileHubContext.friend;
                const friendLookupKey = normalizeLookupText(f.username || '');
                const friendFromCompare = authFriendsCache.find((x) => normalizeLookupText(x.username || '') === friendLookupKey);
                const summarySource = friendFromCompare || f;
                const friendSummary = readFriendSummaryStats(summarySource).stats;
                const stats = {
                    games: Number(friendSummary.games ?? 0) || 0,
                    bestWpm: Number(friendSummary.bestWpm ?? 0) || 0,
                    avgWpm: Number(friendSummary.avgWpm ?? 0) || 0,
                    avgAcc: Number(friendSummary.avgAcc ?? 0) || 0
                };
                const username = String(f.username || 'friend');
                const avatar = sanitizeAvatarUrl(f.avatar_url || '') || 'https://placehold.co/96x96/0B2D45/3EE39E?text=IT';
                const level = computeProfileLevel(stats);
                const achievements = computeAchievements(stats);
                const source = profileHubContext.source === 'requests'
                    ? `${f.direction || 'request'} - ${f.status || 'pending'}`
                    : 'Friend profile';

                if (elements.profileHubName) elements.profileHubName.textContent = username;
                if (elements.profileHubAvatar) elements.profileHubAvatar.src = avatar;
                if (elements.profileHubLevel) elements.profileHubLevel.textContent = `Level ${level}`;
                if (elements.profileHubEmail) elements.profileHubEmail.textContent = source;
                if (elements.profileHubBio) elements.profileHubBio.textContent = 'Public summary from your social panel.';
                if (elements.profileHubGames) elements.profileHubGames.textContent = String(stats.games);
                if (elements.profileHubBest) elements.profileHubBest.textContent = String(stats.bestWpm);
                if (elements.profileHubAvgWpm) elements.profileHubAvgWpm.textContent = String(stats.avgWpm);
                if (elements.profileHubAvgAcc) elements.profileHubAvgAcc.textContent = `${stats.avgAcc}%`;

                if (elements.profileHubAchievements) {
                    if (achievements.length === 0) {
                        elements.profileHubAchievements.innerHTML = '<div class="auth-recent-empty">No achievements yet.</div>';
                    } else {
                        elements.profileHubAchievements.innerHTML = achievements.map((a) => `<span class="auth-achievement">${escapeHtml(a)}</span>`).join('');
                    }
                }
                if (elements.profileHubRecent) elements.profileHubRecent.innerHTML = '<div class="auth-recent-empty">Detailed run history is private.</div>';
                if (elements.profileHubFavorites) elements.profileHubFavorites.innerHTML = '<div class="auth-recent-empty">Favorites are private.</div>';
                if (elements.profileHubFriends) {
                    const encodedUsername = encodeURIComponent(username);
                    elements.profileHubFriends.innerHTML = `<div class="auth-friend-item">
                        ${buildFriendAvatarButton(username, f.avatar_url)}
                        <div>
                          <div class="auth-friend-name">${escapeHtml(username)}</div>
                          <div class="auth-friend-meta">${escapeHtml(source)}</div>
                        </div>
                        <button class="auth-friend-btn" data-onclick="openFriendProfileFromList('${encodedUsername}','compare')">Refresh</button>
                    </div>`;
                    bindFriendAvatarPreview(elements.profileHubFriends);
                }
                renderProfileHubComparison(getSelfSummaryStats(), f);
                drawProfileHubChart([]);
                return;
            }
            const username = elements.authUserName?.textContent || 'user';
            const email = elements.authUserEmail?.textContent || '';
            const avatar = elements.authUserAvatar?.src || 'https://placehold.co/96x96/0B2D45/3EE39E?text=IT';
            const bio = (elements.authUserBio?.value || '').trim() || 'No bio yet.';
            const level = computeProfileLevel(authStatsSummary);
            const achievements = computeAchievements(authStatsSummary);

            if (elements.profileHubName) elements.profileHubName.textContent = username;
            if (elements.profileHubAvatar) elements.profileHubAvatar.src = avatar;
            if (elements.profileHubLevel) elements.profileHubLevel.textContent = `Level ${level}`;
            if (elements.profileHubEmail) elements.profileHubEmail.textContent = email;
            if (elements.profileHubBio) elements.profileHubBio.textContent = bio;
            if (elements.profileHubGames) elements.profileHubGames.textContent = String(authStatsSummary.games || 0);
            if (elements.profileHubBest) elements.profileHubBest.textContent = String(authStatsSummary.bestWpm || 0);
            if (elements.profileHubAvgWpm) elements.profileHubAvgWpm.textContent = String(authStatsSummary.avgWpm || 0);
            if (elements.profileHubAvgAcc) elements.profileHubAvgAcc.textContent = `${authStatsSummary.avgAcc || 0}%`;

            if (elements.profileHubAchievements) {
                if (achievements.length === 0) {
                    elements.profileHubAchievements.innerHTML = '<div class="auth-recent-empty">No achievements yet.</div>';
                } else {
                    elements.profileHubAchievements.innerHTML = achievements.map((a) => `<span class="auth-achievement">${escapeHtml(a)}</span>`).join('');
                }
            }

            if (elements.profileHubRecent) {
                if (!authGameResultsCache.length) {
                    elements.profileHubRecent.innerHTML = '<div class="auth-recent-empty">No saved games yet.</div>';
                } else {
                    elements.profileHubRecent.innerHTML = authGameResultsCache.slice(0, 12).map((r) => {
                        const title = escapeHtml((r.artist && r.song_title) ? `${r.artist} - ${r.song_title}` : (r.song_title || r.artist || 'Custom lyrics'));
                        const mode = escapeHtml((r.mode || 'normal').toUpperCase());
                        return `<div class="auth-recent-item">
                                  <div>
                                    <div class="auth-recent-title">${title}</div>
                                    <div class="auth-recent-meta">${mode}</div>
                                  </div>
                                  <div class="auth-recent-score">${r.wpm || 0} WPM - ${r.accuracy || 0}%</div>
                                </div>`;
                    }).join('');
                }
            }

            if (elements.profileHubFavorites) {
                if (!authFavoritesCache.length) {
                    elements.profileHubFavorites.innerHTML = '<div class="auth-recent-empty">No favorites yet.</div>';
                } else {
                    elements.profileHubFavorites.innerHTML = authFavoritesCache.slice(0, 18).map((f) => {
                        const title = escapeHtml(f.song_title || 'Unknown Song');
                        const artist = escapeHtml(f.artist || 'Unknown Artist');
                        return `<div class="auth-favorite-item">
                                  <div>
                                    <div class="auth-favorite-title">${artist} - ${title}</div>
                                  </div>
                                </div>`;
                    }).join('');
                }
            }

            if (elements.profileHubFriends) {
                if (!authFriendsCache.length) {
                    elements.profileHubFriends.innerHTML = '<div class="auth-recent-empty">No friends added yet.</div>';
                } else {
                    const myAvg = authStatsSummary.avgWpm || 0;
                    elements.profileHubFriends.innerHTML = authFriendsCache.map((f) => {
                        const diff = (Number(f.avg_wpm) || 0) - myAvg;
                        const diffText = `${diff > 0 ? '+' : ''}${diff} vs you`;
                        const avatar = buildFriendAvatarButton(f.username, f.avatar_url);
                        const encodedUsername = encodeURIComponent(f.username || '');
                        return `<div class="auth-friend-item">
                                  ${avatar}
                                  <div>
                                    <div class="auth-friend-name">${escapeHtml(f.username)}</div>
                                    <div class="auth-friend-meta">${f.games} games | avg ${f.avg_wpm} | best ${f.best_wpm} | acc ${f.avg_acc}%</div>
                                  </div>
                                  <div class="auth-friend-actions">
                                    <div class="auth-recent-score">${escapeHtml(diffText)}</div>
                                    <button class="auth-friend-btn" data-onclick="openFriendProfileFromList('${encodedUsername}','hub')">View profile</button>
                                  </div>
                                </div>`;
                    }).join('');
                    bindFriendAvatarPreview(elements.profileHubFriends);
                }
            }

            renderProfileHubComparison(getSelfSummaryStats());
            drawProfileHubChart(authGameResultsCache);
        }

        async function openProfileHub() {
            if (!ensureSupabaseReady()) return;
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                showToast('You need to be logged in.', 'error');
                return;
            }
            await refreshAuthUI();
            profileHubContext = { type: 'self', friend: null, source: 'self' };
            if (elements.profileHubOverlay) {
                elements.profileHubOverlay.classList.remove('hidden');
                renderProfileHub();
            }
        }

        async function openProfileScreen() {
            if (!ensureSupabaseReady()) return;
            setAccountViewMode('full');
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                openModal('profile');
                switchAuthTab('login');
                showToast('Login to open your profile.', 'info');
                return;
            }
            await openProfileHub();
        }

        async function openAccountSettings() {
            await openFriendsPanel();
        }

        async function openFriendsPanel() {
            setAccountViewMode('friends');
            openModal('profile');
            await refreshAuthUI();
            const user = authCurrentUser || await syncCurrentUser();
            if (!user) {
                switchAuthTab('login');
                showToast('Login to add friends.', 'info');
                return;
            }
            closeProfileHub();
            toggleProfileEditor(false);
            elements.authFriendsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => elements.authFriendUsername?.focus(), 120);
        }

        function closeProfileHub() {
            if (elements.profileHubOverlay) elements.profileHubOverlay.classList.add('hidden');
            profileHubContext = { type: 'self', friend: null, source: 'self' };
            profileHubCompareFriendKey = '';
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
            authStatsSummary = { games, bestWpm, avgWpm, avgAcc };

            if (elements.authStatGames) elements.authStatGames.textContent = String(games);
            if (elements.authStatBestWpm) elements.authStatBestWpm.textContent = String(bestWpm);
            if (elements.authStatAvgWpm) elements.authStatAvgWpm.textContent = String(avgWpm);
            if (elements.authStatAvgAcc) elements.authStatAvgAcc.textContent = `${avgAcc}%`;
            if (elements.authUserLevel) elements.authUserLevel.textContent = `Level ${computeProfileLevel(authStatsSummary)}`;
            renderAchievements(authStatsSummary);
            authGameResultsCache = data;
            authSongGroupsCache = groupResultsBySong(data);
            populateSongHistorySelector(authSongGroupsCache);
            renderSongHistoryDetails();
            renderRecentResults(data);
            renderProfileHub();
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
            if (elements.authFriendUsername) elements.authFriendUsername.value = '';
            if (elements.duelRoomCodeInput) elements.duelRoomCodeInput.value = '';
            if (elements.duelInviteTarget) elements.duelInviteTarget.value = '';
            if (elements.authUserBio) elements.authUserBio.value = '';
            if (elements.authAvatarFile) elements.authAvatarFile.value = '';
            if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
            authPendingAvatarFile = null;
            authStoredAvatarUrl = '';
            if (authAvatarPreviewUrl) {
                URL.revokeObjectURL(authAvatarPreviewUrl);
                authAvatarPreviewUrl = '';
            }
            if (elements.authLoginPassword) elements.authLoginPassword.type = 'password';
            if (elements.authRegisterPassword) elements.authRegisterPassword.type = 'password';
            if (elements.authRegisterPasswordVerify) elements.authRegisterPasswordVerify.type = 'password';
            document.querySelectorAll('.auth-password-toggle').forEach((btn) => {
                btn.textContent = 'Show';
                btn.setAttribute('aria-pressed', 'false');
                btn.setAttribute('aria-label', 'Show password');
            });
        }

        function togglePasswordVisibility(inputId, triggerButton) {
            const input = document.getElementById(inputId);
            if (!input || !triggerButton) return;
            const shouldShow = input.type === 'password';
            input.type = shouldShow ? 'text' : 'password';
            triggerButton.textContent = shouldShow ? 'Hide' : 'Show';
            triggerButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
            triggerButton.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
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
                const avatarUrl = sanitizeAvatarUrl(profile?.avatar_url || '');
                const bio = profile?.bio || '';
                const preferredPlayer = normalizePreferredPlayer(profile?.preferred_player || 'spotify');
                if (elements.authUserName) elements.authUserName.textContent = username;
                if (elements.authUserEmail) elements.authUserEmail.textContent = email;
                if (elements.authUserBio) elements.authUserBio.value = bio;
                if (elements.authUserAvatar) elements.authUserAvatar.src = avatarUrl || 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
                if (elements.headerAvatarImage) elements.headerAvatarImage.src = avatarUrl || 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
                setPreferredPlayer(preferredPlayer);
                authStoredAvatarUrl = avatarUrl || '';
                if (elements.authDeletePassword) elements.authDeletePassword.value = '';
                if (elements.authAvatarFile) elements.authAvatarFile.value = '';
                if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
                authPendingAvatarFile = null;
                resetCustomCoverInput();
                if (authAvatarPreviewUrl) {
                    URL.revokeObjectURL(authAvatarPreviewUrl);
                    authAvatarPreviewUrl = '';
                }
                toggleProfileEditor(false);
                await loadUserGameStats(user.id);
                await loadFriendsPanel();
                await loadFavoriteSongs(user.id);
                await renderDuelInvites();
                ensureDuelRealtimeInvitesSubscription(user.id);
                if (!state.duel.roomId) {
                    const resumableRoomId = await findResumableDuelRoomId();
                    if (resumableRoomId) {
                        state.duel.roomId = resumableRoomId;
                        state.duel.inRoom = true;
                    }
                }
                if (state.duel.inRoom && state.duel.roomId) {
                    ensureDuelRealtimeRoomSubscription(state.duel.roomId);
                    ensureDuelPolling();
                    await pollDuelRoom();
                } else {
                    clearDuelRealtimeRoomSubscription();
                    clearDuelPolling();
                    renderDuelPanel();
                }
                renderSetupFavoritesTab();
                renderProfileHub();
                await maybeOpenSharedResultFromLink();
            } else {
                resetAuthDashboardUI();
                setPreferredPlayer('spotify');
                clearDuelRealtimeInvitesSubscription();
                if (elements.authRememberMe) elements.authRememberMe.checked = shouldPersistSession();
                switchAuthTab(authTab);
                closeProfileHub();
                authStoredAvatarUrl = '';
                resetCustomCoverInput();
                if (elements.headerAvatarImage) elements.headerAvatarImage.src = 'https://placehold.co/80x80/0B2D45/3EE39E?text=IT';
                clearDuelState();
                renderSetupFavoritesTab();
            }
            setAccountViewMode(authAccountViewMode);
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
            const rawIdentifier = (elements.authLoginEmail?.value || '').trim();
            const identifier = normalizeEmail(rawIdentifier);
            const password = elements.authLoginPassword?.value || '';
            const remember = !!elements.authRememberMe?.checked;

            if (!identifier || !password) {
                showToast('Enter email/username and password.', 'error');
                return;
            }

            let email = identifier;
            if (!identifier.includes('@')) {
                const resolved = await supabase.rpc('get_login_email', {
                    login_identifier: identifier
                });
                const resolvedEmail = normalizeEmail(resolved?.data || '');
                if (!resolvedEmail) {
                    recordAuthAttempt('login', false);
                    showToast('Login failed. Check your credentials.', 'error');
                    return;
                }
                email = resolvedEmail;
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
            const isTouchMobileViewport = window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
            if (isTouchMobileViewport) {
                const prevScrollX = window.scrollX;
                const prevScrollY = window.scrollY;
                try {
                    elements.input.focus({ preventScroll: true });
                } catch (e) {
                    elements.input.focus();
                }
                const restoreScrollIfNeeded = () => {
                    if (Math.abs(window.scrollY - prevScrollY) > 2 || Math.abs(window.scrollX - prevScrollX) > 2) {
                        window.scrollTo(prevScrollX, prevScrollY);
                    }
                };
                requestAnimationFrame(restoreScrollIfNeeded);
                setTimeout(restoreScrollIfNeeded, 80);
                return;
            }
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

        function buildSpotifyResourceLink(resourceType, resourceId) {
            return `https://open.spotify.com/${resourceType}/${resourceId}`;
        }

        function upscaleItunesArtwork(url) {
            const raw = String(url || '');
            if (!raw) return '';
            return raw.replace(/\/[0-9]+x[0-9]+bb\./i, '/600x600bb.');
        }

        async function fetchSpotifyCandidatesByQuery(query) {
            const trimmed = String(query || '').trim();
            const spotifySearch = buildProviderSearchLink('spotify', trimmed);
            const deezerSearch = buildProviderSearchLink('deezer', trimmed);
            const youtubeMusicSearch = buildProviderSearchLink('youtube_music', trimmed);
            const fallback = {
                title: trimmed || 'Open in your player',
                subtitle: 'Search result',
                coverUrl: '',
                spotifyUrl: spotifySearch,
                deezerUrl: deezerSearch,
                youtubeMusicUrl: youtubeMusicSearch,
                searchUrl: spotifySearch
            };
            if (!trimmed) return [fallback];

            try {
                const q = encodeURIComponent(trimmed);
                const data = await fetchJsonWithRetry(`https://itunes.apple.com/search?term=${q}&entity=song&limit=6`, {}, 3400, 0);
                const rows = Array.isArray(data?.results) ? data.results : [];
                if (!rows.length) return [fallback];
                const mapped = rows.map((r) => {
                    const track = String(r?.trackName || '').trim();
                    const artistName = String(r?.artistName || '').trim();
                    const label = `${track} ${artistName}`.trim();
                    const normalizedQuery = label || trimmed;
                    const spotifyUrl = buildProviderSearchLink('spotify', normalizedQuery);
                    return {
                        title: track || trimmed,
                        subtitle: artistName || 'Search result',
                        coverUrl: upscaleItunesArtwork(r?.artworkUrl100 || r?.artworkUrl60 || r?.artworkUrl30 || ''),
                        spotifyUrl,
                        deezerUrl: buildProviderSearchLink('deezer', normalizedQuery),
                        youtubeMusicUrl: buildProviderSearchLink('youtube_music', normalizedQuery),
                        searchUrl: spotifyUrl
                    };
                }).filter((row) => row.spotifyUrl);
                return mapped.length ? mapped : [fallback];
            } catch (_err) {
                return [fallback];
            }
        }

        function applySpotifyCandidate(candidate) {
            const provider = normalizePreferredPlayer(state.preferredPlayer);
            const providerLabel = getPlayerLabel(provider);
            const targetUrl = getCandidateLinkForProvider(candidate, provider);
            const targetAutoplayUrl = withAutoplayParam(targetUrl, provider);
            const title = candidate?.title || `Open on ${providerLabel}`;
            const subtitle = candidate?.subtitle || 'Search result';
            const coverUrl = candidate?.coverUrl || '';
            const hasCover = Boolean(coverUrl);

            if (elements.videoSearchLink) elements.videoSearchLink.href = targetAutoplayUrl;
            if (elements.videoCoverLink) elements.videoCoverLink.href = targetAutoplayUrl;
            if (elements.videoTitleLink) {
                elements.videoTitleLink.href = targetAutoplayUrl;
                elements.videoTitleLink.textContent = title;
            }
            if (elements.videoSubtitle) elements.videoSubtitle.textContent = subtitle;
            if (elements.videoCoverImage) {
                elements.videoCoverImage.src = coverUrl;
                elements.videoCoverImage.alt = `${title} cover`;
            }
            if (elements.videoCoverLink) {
                elements.videoCoverLink.classList.toggle('has-image', hasCover);
            }
        }

        function extractSpotifyResource(raw) {
            if (!raw) return null;
            const input = String(raw).trim();
            const resourceFromUrl = input.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})/i);
            if (resourceFromUrl) {
                return { type: resourceFromUrl[1].toLowerCase(), id: resourceFromUrl[2] };
            }
            const resourceFromUri = input.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})$/i);
            if (resourceFromUri) {
                return { type: resourceFromUri[1].toLowerCase(), id: resourceFromUri[2] };
            }
            const plainId = input.match(/^[A-Za-z0-9]{22}$/);
            if (plainId) {
                return { type: 'track', id: plainId[0] };
            }
            return null;
        }

        function loadYouTubeCandidate(index) {
            const candidate = state.youtubeEmbedCandidates[index];
            if (!candidate) return;
            state.youtubeCandidateIndex = index;
            state.youtubeEmbedUrl = getCandidateLinkForProvider(candidate, state.preferredPlayer);
            applySpotifyCandidate(candidate);
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
            const queries = [...new Set([
                rawQuery,
                `${rawQuery} official`,
                `${rawQuery} lyrics`
            ].filter(Boolean))];

            state.youtubeEmbedCandidates = [];
            const seenLinks = new Set();
            for (const q of queries) {
                const candidates = await fetchSpotifyCandidatesByQuery(q);
                candidates.forEach((candidate) => {
                    const key = candidate.spotifyUrl || candidate.searchUrl;
                    if (!key || seenLinks.has(key)) return;
                    seenLinks.add(key);
                    state.youtubeEmbedCandidates.push(candidate);
                });
                if (state.youtubeEmbedCandidates.length >= 8) break;
            }
            if (state.youtubeEmbedCandidates.length === 0) {
                const fallbackSpotifyLink = buildProviderSearchLink('spotify', rawQuery);
                state.youtubeEmbedCandidates = [{
                    title: rawQuery || 'Open in your player',
                    subtitle: 'Search result',
                    coverUrl: '',
                    spotifyUrl: fallbackSpotifyLink,
                    deezerUrl: buildProviderSearchLink('deezer', rawQuery),
                    youtubeMusicUrl: buildProviderSearchLink('youtube_music', rawQuery),
                    searchUrl: fallbackSpotifyLink
                }];
            }
            state.youtubeCandidateIndex = 0;
            state.youtubeEmbedUrl = getCandidateLinkForProvider(state.youtubeEmbedCandidates[0], state.preferredPlayer);
            state.youtubeSearchUrl = buildProviderSearchLink(state.preferredPlayer, rawQuery);
            loadYouTubeCandidate(0);
        }

        function nextYouTubeResult() {
            if (!state.youtubeEmbedCandidates || state.youtubeEmbedCandidates.length === 0) {
                showToast("No music candidates available for this song.", "error");
                return;
            }
            const moved = tryNextYouTubeCandidate();
            if (moved) {
                showToast(`Trying another result (${currentYouTubeAttemptLabel()})...`, "info");
                return;
            }
            showToast("No more candidates.", "info");
        }

        function setYouTubeVideoManually() {
            const raw = prompt("Paste a Spotify URL, URI, or 22-char track ID:");
            if (!raw) return;
            const resource = extractSpotifyResource(raw);
            if (!resource) {
                showToast("Invalid Spotify URL/URI/ID.", "error");
                return;
            }
            const spotifyUrl = buildSpotifyResourceLink(resource.type, resource.id);
            state.youtubeEmbedCandidates = [{
                title: `${resource.type} (${resource.id.slice(0, 6)}...)`,
                subtitle: 'Manual Spotify link',
                coverUrl: '',
                spotifyUrl,
                deezerUrl: buildProviderSearchLink('deezer', `${resource.type} ${resource.id}`),
                youtubeMusicUrl: buildProviderSearchLink('youtube_music', `${resource.type} ${resource.id}`),
                searchUrl: spotifyUrl
            }];
            state.youtubeCandidateIndex = 0;
            state.youtubeEmbedUrl = spotifyUrl;
            toggleVideoPanel(true);
            loadYouTubeCandidate(0);
            showToast("Manual Spotify link loaded.", "info");
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
            if (!elements.videoPanel) return;
            const shouldOpen = forceState !== undefined
                ? forceState
                : elements.videoPanel.classList.contains('hidden');
            if (!shouldOpen) {
                elements.videoPanel.classList.add('hidden');
                elements.btnToggleVideo?.classList.remove('active');
                return;
            }
            if (!state.youtubeEmbedCandidates || state.youtubeEmbedCandidates.length === 0) {
                showToast("Load a song first to open video.", "info");
                return;
            }
            elements.videoPanel.classList.remove('hidden');
            elements.btnToggleVideo?.classList.add('active');
            loadYouTubeCandidate(state.youtubeCandidateIndex || 0);
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
            ['search', 'presets', 'custom', 'duel'].forEach(t => {
                const el = document.getElementById(`nav-${t}`);
                const view = document.getElementById(`view-${t}`);
                if (!el || !view) return;
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
            if (tabName === 'duel') {
                renderDuelPanel();
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
            hideSongLaunchOverlay();
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
            elements.sharedResultArea?.classList.add('hidden');
            elements.setupArea.classList.remove('hidden');
            elements.input.blur();
            toggleVideoPanel(false);
        }

        function updateFetchUI(isFetching, progress = 0, message = "") {
            const btnText = document.getElementById('search-btn-text');
            const loader = document.getElementById('search-loader');
            const fetchBtn = document.getElementById('btn-fetch-action');
            if (isFetching) {
                hideSearchSuggestions();
                btnText.classList.add('hidden');
                loader.classList.remove('hidden');
                fetchBtn.classList.add('opacity-70', 'cursor-not-allowed');
                elements.searchStatus.classList.remove('hidden');
                elements.searchStatusContainer.classList.remove('hidden');
                elements.searchStatus.textContent = message || "Searching...";
                elements.searchBar.style.width = `${progress}%`;
                elements.searchErrorContainer.classList.add('hidden'); 
                if (isSongLaunchOverlayActive) {
                    if (elements.songLaunchStatus) elements.songLaunchStatus.textContent = message || 'Searching...';
                    if (elements.songLaunchProgress) elements.songLaunchProgress.style.width = `${Math.max(6, Math.min(100, Number(progress) || 0))}%`;
                }
            } else {
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
                fetchBtn.classList.remove('opacity-70', 'cursor-not-allowed');
                elements.searchStatus.classList.add('hidden');
                elements.searchStatusContainer.classList.add('hidden');
                elements.searchBar.style.width = `0%`;
            }
        }

        function showSongLaunchOverlay(title, artist) {
            isSongLaunchOverlayActive = true;
            if (elements.songLaunchTitle) elements.songLaunchTitle.textContent = title || 'Loading song';
            if (elements.songLaunchArtist) elements.songLaunchArtist.textContent = artist || '';
            if (elements.songLaunchStatus) elements.songLaunchStatus.textContent = 'Preparing lyrics...';
            if (elements.songLaunchProgress) elements.songLaunchProgress.style.width = '8%';
            elements.songLaunchOverlay?.classList.remove('hidden');
        }

        function hideSongLaunchOverlay() {
            isSongLaunchOverlayActive = false;
            elements.songLaunchOverlay?.classList.add('hidden');
            if (elements.songLaunchProgress) elements.songLaunchProgress.style.width = '0%';
        }

        function normalizeLookupText(value) {
            return String(value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function stripFeaturing(value) {
            return String(value || '')
                .replace(/\s*[\(\[]?\s*(ft|feat|featuring)\.?\s+.*?[\)\]]?\s*$/i, '')
                .trim();
        }

        function stripTrailingMeta(value) {
            return String(value || '')
                .replace(/\s*-\s*(live|acoustic|remaster(ed)?|radio edit|version|bonus track).*$/i, '')
                .replace(/\s*[\(\[]\s*(live|acoustic|remaster(ed)?|radio edit|version|bonus track).*?[\)\]]\s*$/i, '')
                .trim();
        }

        function encodePathSegment(value) {
            return encodeURIComponent(String(value || '').trim());
        }

        function scoreLrcLibMatch(item, targetArtistNorm, targetTitleNorm) {
            const artistNorm = normalizeLookupText(item?.artistName || '');
            const titleNorm = normalizeLookupText(item?.trackName || '');
            if (!artistNorm || !titleNorm) return -1;
            let score = 0;
            if (artistNorm === targetArtistNorm) score += 80;
            else if (artistMatchesLoosely(artistNorm, targetArtistNorm)) score += 45;

            if (titleNorm === targetTitleNorm) score += 120;
            else if (titleNorm.includes(targetTitleNorm) || targetTitleNorm.includes(titleNorm)) score += 70;

            const targetTokens = targetTitleNorm.split(' ').filter(Boolean);
            const hitTokens = targetTokens.filter((token) => titleNorm.includes(token)).length;
            score += hitTokens * 8;

            if (rowHasLyrics(item)) score += 40;
            return score;
        }

        async function fetchJsonWithRetry(url, options = {}, timeoutMs = 7000, retries = 1) {
            let lastError = null;
            for (let attempt = 0; attempt <= retries; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                const upstream = options.signal;
                const abortForwarder = () => controller.abort();
                try {
                    if (upstream) upstream.addEventListener('abort', abortForwarder, { once: true });
                    const res = await fetch(url, { ...options, signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return await res.json();
                } catch (err) {
                    clearTimeout(timeoutId);
                    lastError = err;
                    if (attempt < retries) {
                        await new Promise((r) => setTimeout(r, 180 * (attempt + 1)));
                    }
                } finally {
                    if (upstream) upstream.removeEventListener('abort', abortForwarder);
                }
            }
            throw lastError || new Error('Request failed');
        }

        function rowHasLyrics(row) {
            return Boolean((row?.plainLyrics || '').trim() || (row?.syncedLyrics || '').trim());
        }

        function hideSearchSuggestions() {
            elements.artistSuggestions?.classList.add('hidden');
            elements.titleSuggestions?.classList.add('hidden');
        }

        function invalidateSearchSuggestions() {
            artistSuggestSeq++;
            titleSuggestSeq++;
            hideSearchSuggestions();
        }

        function renderSearchSuggestions(container, items, onSelect) {
            if (!container) return;
            if (!items || items.length === 0) {
                container.classList.add('hidden');
                container.innerHTML = '';
                return;
            }
            container.innerHTML = items.map((item) =>
                `<button class="search-suggest-item" type="button">${escapeHtml(item.label || item.value || '')}</button>`
            ).join('');
            const buttons = container.querySelectorAll('.search-suggest-item');
            buttons.forEach((btn, idx) => {
                btn.addEventListener('click', () => onSelect(items[idx]));
            });
            container.classList.remove('hidden');
        }

        async function fetchLrcLibSearchRaw(query) {
            try {
                const params = new URLSearchParams({ q: query });
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5600);
                const res = await fetch(`https://lrclib.net/api/search?${params}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (e) {
                return [];
            }
        }

        async function fetchItunesSongsByArtist(artistName) {
            try {
                const q = encodeURIComponent((artistName || '').trim());
                const url = `https://itunes.apple.com/search?term=${q}&entity=song&limit=120`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2800);
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!res.ok) return [];
                const data = await res.json();
                const rows = Array.isArray(data?.results) ? data.results : [];
                return rows.map((r) => ({
                    trackName: r?.trackName || '',
                    artistName: r?.artistName || '',
                    albumName: r?.collectionName || '',
                    artworkUrl100: r?.artworkUrl100 || '',
                    trackViewUrl: r?.trackViewUrl || '',
                    artistViewUrl: r?.artistViewUrl || ''
                }));
            } catch (e) {
                return [];
            }
        }

        async function fetchItunesSongsByQuery(queryText) {
            try {
                const q = encodeURIComponent((queryText || '').trim());
                const url = `https://itunes.apple.com/search?term=${q}&entity=song&limit=120`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2800);
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!res.ok) return [];
                const data = await res.json();
                const rows = Array.isArray(data?.results) ? data.results : [];
                return rows.map((r) => ({
                    trackName: r?.trackName || '',
                    artistName: r?.artistName || '',
                    albumName: r?.collectionName || '',
                    artworkUrl100: r?.artworkUrl100 || '',
                    trackViewUrl: r?.trackViewUrl || '',
                    artistViewUrl: r?.artistViewUrl || ''
                }));
            } catch (e) {
                return [];
            }
        }

        async function fetchLrcLibExactArtistTrack(artist, track) {
            try {
                const params = new URLSearchParams({
                    artist_name: String(artist || '').trim(),
                    track_name: String(track || '').trim()
                });
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5600);
                const res = await fetch(`https://lrclib.net/api/get?${params}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!res.ok) return [];
                const row = await res.json();
                if (!row || typeof row !== 'object') return [];
                return [row];
            } catch (e) {
                return [];
            }
        }

        function artistMatchesLoosely(rowArtistNorm, targetArtistNorm) {
            if (!rowArtistNorm || !targetArtistNorm) return false;
            if (rowArtistNorm.includes(targetArtistNorm) || targetArtistNorm.includes(rowArtistNorm)) return true;
            const targetTokens = targetArtistNorm.split(' ').filter(Boolean);
            if (!targetTokens.length) return false;
            return targetTokens.every((t) => rowArtistNorm.includes(t));
        }

        async function fetchItunesArtistSuggestions(query) {
            try {
                const q = encodeURIComponent((query || '').trim());
                const url = `https://itunes.apple.com/search?term=${q}&entity=musicArtist&limit=12`;
                const res = await fetch(url);
                if (!res.ok) return [];
                const data = await res.json();
                const rows = Array.isArray(data?.results) ? data.results : [];
                return rows
                    .map((r) => (r?.artistName || '').trim())
                    .filter(Boolean);
            } catch (e) {
                return [];
            }
        }

        async function loadArtistSuggestions() {
            if (state.isFetching) {
                hideSearchSuggestions();
                return;
            }
            const requestSeq = ++artistSuggestSeq;
            const artist = (elements.artistInput?.value || '').trim();
            if (artist.length < 2) {
                elements.artistSuggestions?.classList.add('hidden');
                return;
            }
            try {
                const rows = await fetchLrcLibSearchRaw(artist);
                if (state.isFetching || requestSeq !== artistSuggestSeq) return;
                const seen = new Set();
                const normArtist = normalizeLookupText(artist);
                const suggestions = [];
                rows.forEach((row) => {
                    const name = (row?.artistName || '').trim();
                    if (!name) return;
                    const key = normalizeLookupText(name);
                    if (!key || seen.has(key)) return;
                    if (!key.includes(normArtist)) return;
                    seen.add(key);
                    suggestions.push({ value: name, label: name });
                });
                if (suggestions.length < 5) {
                    const itunes = await fetchItunesArtistSuggestions(artist);
                    if (state.isFetching || requestSeq !== artistSuggestSeq) return;
                    itunes.forEach((name) => {
                        const key = normalizeLookupText(name);
                        if (!key || seen.has(key) || !key.includes(normArtist)) return;
                        seen.add(key);
                        suggestions.push({ value: name, label: name });
                    });
                }
                if (requestSeq !== artistSuggestSeq) return;
                renderSearchSuggestions(elements.artistSuggestions, suggestions.slice(0, 8), (item) => {
                    if (elements.artistInput) elements.artistInput.value = item.value;
                    elements.artistSuggestions?.classList.add('hidden');
                    elements.titleInput?.focus();
                    if ((elements.titleInput?.value || '').trim().length >= 1) {
                        loadTitleSuggestions();
                    }
                });
            } catch (e) {
                elements.artistSuggestions?.classList.add('hidden');
            }
        }

        async function loadTitleSuggestions() {
            if (state.isFetching) {
                hideSearchSuggestions();
                return;
            }
            const requestSeq = ++titleSuggestSeq;
            const artist = (elements.artistInput?.value || '').trim();
            const titlePart = (elements.titleInput?.value || '').trim();
            if (artist.length < 2 || titlePart.length < 1) {
                elements.titleSuggestions?.classList.add('hidden');
                return;
            }
            try {
                const rows = await fetchLrcLibSearchRaw(`${artist} ${titlePart}`.trim());
                if (state.isFetching || requestSeq !== titleSuggestSeq) return;
                const targetArtist = normalizeLookupText(artist);
                const targetTitle = normalizeLookupText(titlePart);
                const seen = new Set();
                const suggestions = [];
                rows.forEach((row) => {
                    const track = (row?.trackName || '').trim();
                    const artistName = (row?.artistName || '').trim();
                    if (!track || !artistName) return;
                    const artistNorm = normalizeLookupText(artistName);
                    const trackNorm = normalizeLookupText(track);
                    if (!artistNorm.includes(targetArtist)) return;
                    if (!trackNorm.includes(targetTitle)) return;
                    if (seen.has(trackNorm)) return;
                    seen.add(trackNorm);
                    suggestions.push({ value: track, label: `${track} - ${artistName}` });
                });
                if (requestSeq !== titleSuggestSeq) return;
                renderSearchSuggestions(elements.titleSuggestions, suggestions.slice(0, 10), (item) => {
                    if (elements.titleInput) elements.titleInput.value = item.value;
                    elements.titleSuggestions?.classList.add('hidden');
                });
            } catch (e) {
                elements.titleSuggestions?.classList.add('hidden');
            }
        }

        async function getArtistSongs(artistName) {
            const raw = (artistName || '').trim();
            if (!raw) return [];
            const cacheKey = normalizeLookupText(raw);
            if (state.artistSongsCache.has(cacheKey)) return state.artistSongsCache.get(cacheKey);
            const [lrRows, itRows] = await Promise.all([
                fetchLrcLibSearchRaw(raw),
                fetchItunesSongsByArtist(raw)
            ]);
            const lrRowsWithLyrics = lrRows.filter((row) => rowHasLyrics(row));
            // Prefer rows that already contain lyrics to avoid "song found but no lyrics".
            const rows = lrRowsWithLyrics.length > 0 ? lrRowsWithLyrics : [...lrRows, ...itRows];
            const normArtist = normalizeLookupText(raw);
            const map = new Map();
            rows.forEach((row) => {
                const track = (row?.trackName || '').trim();
                const artist = (row?.artistName || '').trim();
                const album = (row?.albumName || row?.album || '').trim();
                if (!track || !artist) return;
                const artistNorm = normalizeLookupText(artist);
                if (!artistNorm.includes(normArtist)) return;
                const key = `${normalizeLookupText(track)}|||${normalizeLookupText(artist)}`;
                if (!key || map.has(key)) return;
                map.set(key, {
                    title: track,
                    artist,
                    album,
                    artworkUrl100: row?.artworkUrl100 || '',
                    trackViewUrl: row?.trackViewUrl || '',
                    artistViewUrl: row?.artistViewUrl || '',
                    plainLyrics: (row?.plainLyrics || '').trim(),
                    syncedLyrics: (row?.syncedLyrics || '').trim()
                });
            });
            const songs = Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
            state.artistSongsCache.set(cacheKey, songs);
            return songs;
        }

        async function findArtistSongsByTerm(artistName, term) {
            const artist = (artistName || '').trim();
            const termText = (term || '').trim();
            if (!artist || termText.length < 2) return [];
            const cacheKey = `${normalizeLookupText(artist)}|||${normalizeLookupText(termText)}`;
            if (state.artistTermSearchCache.has(cacheKey)) {
                return state.artistTermSearchCache.get(cacheKey);
            }
            const targetArtist = normalizeLookupText(artist);
            const targetTerm = normalizeLookupText(termText);
            const [lrRows, lrExactRows, lrTermOnlyRows, itRows] = await Promise.all([
                fetchLrcLibSearchRaw(`${artist} ${termText}`),
                fetchLrcLibExactArtistTrack(artist, termText),
                fetchLrcLibSearchRaw(termText),
                fetchItunesSongsByQuery(`${artist} ${termText}`)
            ]);
            const lrMerged = [...lrRows, ...lrExactRows, ...lrTermOnlyRows];
            const lrWithLyrics = lrMerged.filter((row) => rowHasLyrics(row));
            const merged = lrWithLyrics.length > 0 ? lrWithLyrics : [...lrMerged, ...itRows];
            const map = new Map();
            merged.forEach((row) => {
                const track = (row?.trackName || '').trim();
                const rowArtist = (row?.artistName || '').trim();
                const album = (row?.albumName || row?.album || '').trim();
                if (!track || !rowArtist) return;
                const artistNorm = normalizeLookupText(rowArtist);
                const trackNorm = normalizeLookupText(track);
                if (!artistMatchesLoosely(artistNorm, targetArtist)) return;
                if (!trackNorm.includes(targetTerm)) return;
                const key = `${trackNorm}|||${artistNorm}`;
                if (map.has(key)) return;
                map.set(key, {
                    title: track,
                    artist: rowArtist,
                    album,
                    artworkUrl100: row?.artworkUrl100 || '',
                    trackViewUrl: row?.trackViewUrl || '',
                    artistViewUrl: row?.artistViewUrl || '',
                    plainLyrics: (row?.plainLyrics || '').trim(),
                    syncedLyrics: (row?.syncedLyrics || '').trim()
                });
            });
            const out = Array.from(map.values());
            state.artistTermSearchCache.set(cacheKey, out);
            return out;
        }

        async function renderArtistCatalogList(filterText = '', includeLiveMatches = false) {
            if (!elements.artistCatalogList) return;
            const q = normalizeLookupText(filterText || '');
            let songs = (state.artistCatalogSongs || []).filter((song) => {
                if (!q) return true;
                const title = normalizeLookupText(song.title);
                const album = normalizeLookupText(song.album || '');
                return title.includes(q) || album.includes(q);
            });

            const seq = ++artistCatalogFilterSeq;
            if (includeLiveMatches && q.length >= 2) {
                elements.artistCatalogList.innerHTML = '<div class="auth-recent-empty">Searching more songs...</div>';
                const live = await findArtistSongsByTerm(state.artistCatalogName || elements.artistInput?.value || '', filterText);
                if (seq !== artistCatalogFilterSeq) return;
                if (live.length) {
                    const byKey = new Map();
                    songs.forEach((song) => {
                        const key = `${normalizeLookupText(song.title)}|||${normalizeLookupText(song.artist)}`;
                        byKey.set(key, song);
                    });
                    live.forEach((song) => {
                        const key = `${normalizeLookupText(song.title)}|||${normalizeLookupText(song.artist)}`;
                        if (!byKey.has(key)) byKey.set(key, song);
                    });
                    songs = Array.from(byKey.values());
                }
            }

            if (!songs.length) {
                const artist = escapeHtml(state.artistCatalogName || elements.artistInput?.value || '');
                const term = escapeHtml(filterText || '');
                elements.artistCatalogList.innerHTML = `
                    <div class="auth-recent-empty">No songs match this filter.</div>
                    ${term ? `<button type="button" class="auth-friend-btn mx-auto" id="artist-direct-search-btn">Try direct search: ${artist} - ${term}</button>` : ''}
                `;
                const directBtn = document.getElementById('artist-direct-search-btn');
                if (directBtn) {
                    directBtn.addEventListener('click', async () => {
                        if (elements.titleInput) elements.titleInput.value = filterText;
                        await fetchLyrics();
                    });
                }
                return;
            }
            const groups = new Map();
            songs.forEach((song) => {
                const albumKey = (song.album || 'Singles / Unknown Album').trim() || 'Singles / Unknown Album';
                if (!groups.has(albumKey)) groups.set(albumKey, []);
                groups.get(albumKey).push(song);
            });

            const albumNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
            const html = albumNames.map((albumName) => {
                const albumSongs = groups.get(albumName) || [];
                const songsHtml = albumSongs
                    .sort((a, b) => a.title.localeCompare(b.title))
                    .map((song) => `
                        <div class="artist-song-item">
                            <button type="button" class="artist-song-main" data-song-title="${escapeHtml(song.title)}" data-song-artist="${escapeHtml(song.artist)}">
                                <span class="artist-song-title">${escapeHtml(song.title)}</span>
                                <span class="artist-song-meta">${escapeHtml(song.artist)}</span>
                            </button>
                            <button type="button"
                                    class="artist-song-fav${isSongFavorited(song.artist, song.title) ? ' active' : ''}"
                                    title="${isSongFavorited(song.artist, song.title) ? 'Already in favorites' : 'Add to favorites'}"
                                    data-song-title="${escapeHtml(song.title)}"
                                    data-song-artist="${escapeHtml(song.artist)}"
                                    data-onclick="addFavoriteFromCatalog('${encodeURIComponent(song.artist)}','${encodeURIComponent(song.title)}')">
                                &#9733;
                            </button>
                        </div>
                    `).join('');
                return `
                    <section class="artist-album-section">
                        <div class="artist-album-title">${escapeHtml(albumName)} <span>(${albumSongs.length})</span></div>
                        <div class="artist-album-songs">${songsHtml}</div>
                    </section>
                `;
            }).join('');

            elements.artistCatalogList.innerHTML = html;
            elements.artistCatalogList.querySelectorAll('.artist-song-main').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const title = btn.getAttribute('data-song-title') || '';
                    const artist = btn.getAttribute('data-song-artist') || (elements.artistInput?.value || '').trim();
                    await selectSongFromCatalog(title, artist);
                });
            });
        }

        async function selectSongFromCatalog(title, artist, options = {}) {
            if (!title || !artist) return;
            if (elements.artistInput) elements.artistInput.value = artist;
            if (elements.titleInput) elements.titleInput.value = title;
            if (options?.showLaunchOverlay) {
                showSongLaunchOverlay(title, artist);
            }
            const selectedKey = `${normalizeLookupText(title)}|||${normalizeLookupText(artist)}`;
            const selectedSong = (state.artistCatalogSongs || []).find((song) => {
                const key = `${normalizeLookupText(song.title)}|||${normalizeLookupText(song.artist)}`;
                return key === selectedKey;
            });
            const inlineLyrics = String(selectedSong?.plainLyrics || '').trim() || syncedToPlainLyrics(String(selectedSong?.syncedLyrics || ''));
            if (inlineLyrics) {
                const cacheKey = `${artist}-${title}`.toLowerCase();
                state.searchCache.set(cacheKey, {
                    lyrics: inlineLyrics,
                    syncedLyrics: String(selectedSong?.syncedLyrics || '')
                });
                await handleLyricsSuccess(inlineLyrics, title, artist, null, String(selectedSong?.syncedLyrics || ''));
                return;
            }
            await fetchLyrics();
        }

        async function loadArtistCatalog() {
            const artist = (elements.artistInput?.value || '').trim();
            if (artist.length < 2) {
                showToast('Type at least 2 letters of the band name.', 'error');
                return;
            }
            state.artistTermSearchCache.clear();
            invalidateSearchSuggestions();
            if (elements.titleInput) elements.titleInput.value = '';
            if (elements.artistCatalog) elements.artistCatalog.classList.add('hidden');
            await openArtistSongsModal(artist);
        }

        function renderArtistSpotlightList(artistName, songs) {
            if (!elements.artistSongsList) return;
            if (!songs || songs.length === 0) {
                elements.artistSongsList.innerHTML = '<div class="auth-recent-empty">No songs found for this artist right now.</div>';
                return;
            }
            elements.artistSongsList.innerHTML = songs.slice(0, 24).map((song, idx) => `
                <button type="button" class="artist-spotlight-item" data-song-index="${idx}">
                    <span class="artist-spotlight-rank">${idx + 1}</span>
                    <span>
                        <span class="artist-spotlight-title">${escapeHtml(song.title || 'Unknown song')}</span>
                        <span class="artist-spotlight-meta">${escapeHtml(song.album || artistName || 'Single')}</span>
                    </span>
                </button>
            `).join('');
            elements.artistSongsList.querySelectorAll('.artist-spotlight-item').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const index = Number(btn.getAttribute('data-song-index'));
                    if (!Number.isFinite(index)) return;
                    const song = artistSpotlightSongs[index];
                    if (!song?.title || !song?.artist) return;
                    await selectSongFromCatalog(song.title, song.artist, { showLaunchOverlay: true });
                });
            });
        }

        async function openArtistSongsModal(artistOverride = '') {
            const artistName = String(artistOverride || state.artist || elements.artistInput?.value || '').trim();
            if (!artistName) {
                showToast('No artist selected yet.', 'info');
                return;
            }
            elements.artistSongsModal?.classList.remove('hidden');
            if (elements.artistSongsTitle) elements.artistSongsTitle.textContent = artistName;
            if (elements.artistSongsStatus) elements.artistSongsStatus.textContent = 'Loading top songs...';
            if (elements.artistSongsList) elements.artistSongsList.innerHTML = '<div class="auth-recent-empty">Loading...</div>';
            if (elements.artistSongsCover) {
                elements.artistSongsCover.src = 'https://placehold.co/96x96/0B2D45/3EE39E?text=AR';
            }
            if (elements.artistSongsOpenPlayer) {
                elements.artistSongsOpenPlayer.href = buildProviderSearchLink(state.preferredPlayer, artistName);
            }

            try {
                const songs = await getArtistSongs(artistName);
                artistSpotlightSongs = songs || [];
                state.artistCatalogSongs = songs || [];
                state.artistCatalogName = artistName;
                const topCount = Math.min(24, artistSpotlightSongs.length);
                if (elements.artistSongsStatus) {
                    elements.artistSongsStatus.textContent = topCount
                        ? `${topCount} top songs found. Click one to start.`
                        : 'No songs found.';
                }
                const cover = artistSpotlightSongs.find((s) => s?.artworkUrl100)?.artworkUrl100 || '';
                if (elements.artistSongsCover && cover) {
                    elements.artistSongsCover.src = upscaleItunesArtwork(cover);
                }
                renderArtistSpotlightList(artistName, artistSpotlightSongs);
            } catch (_err) {
                artistSpotlightSongs = [];
                if (elements.artistSongsStatus) elements.artistSongsStatus.textContent = 'Could not load this artist now.';
                if (elements.artistSongsList) elements.artistSongsList.innerHTML = '<div class="auth-recent-empty">Try again in a few seconds.</div>';
            }
        }

        async function openRandomArtistSong() {
            if (!artistSpotlightSongs.length) return;
            const pick = artistSpotlightSongs[Math.floor(Math.random() * artistSpotlightSongs.length)];
            if (!pick?.title || !pick?.artist) return;
            await selectSongFromCatalog(pick.title, pick.artist, { showLaunchOverlay: true });
        }

        function closeArtistSongsModal() {
            elements.artistSongsModal?.classList.add('hidden');
        }

        function openAvatarPreview(src = '', label = '') {
            if (!elements.avatarPreviewOverlay || !elements.avatarPreviewImage || !elements.avatarPreviewName) return;
            const fallback = 'https://placehold.co/320x320/0B2D45/3EE39E?text=IT';
            const imageSrc = String(src || '').trim() || elements.authUserAvatar?.src || fallback;
            const imageLabel = String(label || '').trim() || elements.authUserName?.textContent || 'User avatar';
            elements.avatarPreviewImage.src = imageSrc;
            elements.avatarPreviewName.textContent = imageLabel;
            elements.avatarPreviewOverlay.classList.remove('hidden');
        }

        function openProfileHubAvatarPreview() {
            const src = elements.profileHubAvatar?.src || '';
            const label = elements.profileHubName?.textContent || 'User avatar';
            openAvatarPreview(src, label);
        }

        function closeAvatarPreview() {
            elements.avatarPreviewOverlay?.classList.add('hidden');
        }

        async function handleHeaderAvatarClick(event) {
            if (event && (event.shiftKey || event.ctrlKey || event.metaKey)) {
                const src = elements.headerAvatarImage?.src || '';
                const name = elements.authUserName?.textContent || 'User avatar';
                openAvatarPreview(src, name);
                return;
            }
            await openFriendsPanel();
        }

        async function fetchLyrics() {
            if (state.isFetching) return;
            invalidateSearchSuggestions();
            const artist = elements.artistInput.value.trim();
            const title = elements.titleInput.value.trim();
            if (!artist || !title) {
                hideSongLaunchOverlay();
                showToast("Load a band and select one song first.", "error");
                return;
            }
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
            if (signal.aborted) {
                hideSongLaunchOverlay();
                return;
            }
            try {
                updateFetchUI(true, 60, "Trying backup source...");
                const lyrics2 = await fetchFromLyricsOvh(artist, title, signal);
                if (lyrics2) {
                    state.searchCache.set(cacheKey, { lyrics: lyrics2, syncedLyrics: '' });
                    await handleLyricsSuccess(lyrics2, title, artist, signal, '');
                    return;
                }
            } catch(e) { console.warn("OVH failed", e); }
            if (signal.aborted) {
                hideSongLaunchOverlay();
                return;
            }
            state.isFetching = false;
            updateFetchUI(false);
            hideSongLaunchOverlay();
            const query = encodeURIComponent(`${artist} ${title} lyrics`);
            elements.googleFallbackLink.href = `https://www.google.com/search?q=${query}`;
            elements.searchError.textContent = "Could not find lyrics automatically.";
            elements.searchErrorContainer.classList.remove('hidden');
        }

        async function fetchFromLrcLib(artist, title, signal) {
            const artistClean = stripTrailingMeta(stripFeaturing(artist));
            const titleClean = stripTrailingMeta(stripFeaturing(title));
            // First try exact endpoint, then fallback to broader search.
            const exactPairs = [
                { a: artist, t: title },
                { a: artistClean, t: titleClean }
            ];
            for (const pair of exactPairs) {
                try {
                    const params = new URLSearchParams({
                        artist_name: pair.a,
                        track_name: pair.t
                    });
                    const row = await fetchJsonWithRetry(`https://lrclib.net/api/get?${params}`, { signal }, 7600, 1);
                    const synced = (row?.syncedLyrics || '').trim();
                    const plain = (row?.plainLyrics || '').trim();
                    const lyrics = plain || syncedToPlainLyrics(synced);
                    if (lyrics) return { lyrics, syncedLyrics: synced };
                } catch (e) {}
            }

            const queries = [...new Set([
                `${artist} ${title}`.trim(),
                `${artistClean} ${titleClean}`.trim(),
                `${titleClean} ${artistClean}`.trim(),
                titleClean,
                `${artistClean} ${stripTrailingMeta(titleClean)}`.trim()
            ])];

            const searchCalls = queries.map(async (q) => {
                try {
                    const params = new URLSearchParams({ q });
                    const data = await fetchJsonWithRetry(`https://lrclib.net/api/search?${params}`, { signal }, 7600, 1);
                    return Array.isArray(data) ? data : [];
                } catch (e) {
                    return [];
                }
            });
            const settled = await Promise.all(searchCalls);
            const allResults = settled.flat();

            if (allResults.length === 0) throw new Error("No results");

            const targetArtist = normalizeLookupText(artistClean);
            const targetTitle = normalizeLookupText(titleClean);
            const sorted = allResults
                .filter((item) => rowHasLyrics(item))
                .map((item) => ({ item, score: scoreLrcLibMatch(item, targetArtist, targetTitle) }))
                .sort((a, b) => b.score - a.score);
            const bestMatch = sorted[0]?.item || null;
            if (!bestMatch) throw new Error("No lyrics");

            const synced = bestMatch.syncedLyrics || '';
            const plain = (bestMatch.plainLyrics || '').trim();
            const lyrics = plain || syncedToPlainLyrics(synced);
            if (!lyrics) throw new Error("No lyrics");

            return { lyrics, syncedLyrics: synced };
        }

        async function fetchFromLyricsOvh(artist, title, signal) {
            const artistCandidates = [...new Set([
                artist,
                stripFeaturing(artist),
                stripTrailingMeta(stripFeaturing(artist))
            ].map((v) => String(v || '').trim()).filter(Boolean))];
            const titleCandidates = [...new Set([
                title,
                stripFeaturing(title),
                stripTrailingMeta(stripFeaturing(title))
            ].map((v) => String(v || '').trim()).filter(Boolean))];

            for (const a of artistCandidates) {
                for (const t of titleCandidates) {
                    try {
                        const url = `https://api.lyrics.ovh/v1/${encodePathSegment(a)}/${encodePathSegment(t)}`;
                        const data = await fetchJsonWithRetry(url, { signal }, 7600, 1);
                        if (data?.lyrics && String(data.lyrics).trim()) {
                            return data.lyrics;
                        }
                    } catch (e) {}
                }
            }
            throw new Error("No lyrics");
        }

        async function handleLyricsSuccess(lyricsRaw, title, artist, signal, syncedLyricsRaw = '') {
            updateFetchUI(true, 80, "Processing text...");
            const cleanedLyrics = cleanLyrics(lyricsRaw);
            state.isFetching = false;
            updateFetchUI(false);
            await updateYouTubeSource(artist, title);
            if (isSongLaunchOverlayActive) {
                closeArtistSongsModal();
            }
            toggleVideoPanel(true);
            startGame(cleanedLyrics, title, artist, "", syncedLyricsRaw);
        }

        function loadPreset(key) {
            const song = presets[key];
            state.isCustomGame = false;
            updateYouTubeSource(song.artist, song.title).catch(() => {});
            startGame(song.lyrics, song.title, song.artist, "");
        }

        function startCustomGame() {
            const text = (elements.customText?.value || '').trim();
            const trans = (elements.customTrans?.value || '').trim();
            if (!text) {
                showToast('Paste lyrics first.', 'error');
                return;
            }
            const limitError = validateCustomInputLimits(text, trans);
            if (limitError) {
                showToast(limitError, 'error');
                return;
            }
            const customTitle = buildCustomSongTitle(text);
            state.isCustomGame = true;
            startGame(text, customTitle, "Custom", trans);
            if (elements.customSaveFavorite?.checked) {
                addSongToFavorites('Custom', customTitle, false, {
                    sourceType: 'custom',
                    customLyrics: text,
                    customTranslation: trans,
                    customCoverFile: customPendingCoverFile
                }).catch(() => {});
            }
        }

        function startGame(text, title, artist, translationText = '', syncedLyricsRaw = '') {
            hideSongLaunchOverlay();
            state.currentLyricsRaw = String(text || '');
            state.currentTranslationRaw = String(translationText || '');
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
            if (elements.duelHud) {
                elements.duelHud.classList.toggle('hidden', !(state.duel.inRoom && state.duel.gameLaunched));
            }
            if (state.duel.inRoom && state.duel.gameLaunched) {
                setDuelHudProgress(0, 0, '0%', '0%', 'Duel running');
            }
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
            if (state.duel.inRoom && state.duel.startedAtMs > Date.now()) return;

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

        function requestRestart() {
            if (state.duel.inRoom && state.duel.gameLaunched && !elements.gameArea.classList.contains('hidden')) {
                showToast('Restart is disabled during duel mode.', 'info');
                return;
            }
            if (state.isPlaying) { clearInterval(state.timerInterval); state.isPlaying = false; }
            elements.restartModal.classList.remove('hidden');
        }
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

        function getShareAppUrl() {
            const configured = String(PUBLIC_APP_URL || '').trim();
            try {
                const url = new URL(window.location.href);
                const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3})$/i.test(url.hostname);
                if (isLocalHost) return configured;
                url.hash = '';
                url.search = '';
                return url.toString();
            } catch (_e) {
                return configured;
            }
        }

        function buildShareResultUrl(shareId) {
            const id = String(shareId || '').trim();
            if (!id) return '';
            const base = getShareAppUrl();
            if (!base) return '';
            try {
                const url = new URL(base);
                url.searchParams.set('share', id);
                return url.toString();
            } catch (_e) {
                return '';
            }
        }

        function parseShareIdFromLocation() {
            try {
                const url = new URL(window.location.href);
                const share = String(url.searchParams.get('share') || '').trim();
                if (!share) return '';
                return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(share)
                    ? share
                    : '';
            } catch (_e) {
                return '';
            }
        }

        function clearShareParamFromUrl() {
            try {
                const url = new URL(window.location.href);
                if (!url.searchParams.has('share')) return;
                url.searchParams.delete('share');
                const next = `${url.pathname}${url.search}${url.hash}`;
                window.history.replaceState({}, '', next);
            } catch (_e) {
                // no-op
            }
        }

        function buildShareResultText(payload) {
            if (!payload) return '';
            const modeLabel = String(payload.mode || 'normal').toUpperCase();
            const songLabel = payload.songTitle
                ? `${payload.songTitle}${payload.artist ? ` - ${payload.artist}` : ''}`
                : 'Custom lyrics';
            const appUrl = payload.shareUrl || payload.appUrl || getShareAppUrl();
            const lines = [
                'I just finished a run on Icarus Type',
                `${songLabel}`,
                `Mode: ${modeLabel}`,
                `WPM: ${payload.wpm} | Acc: ${payload.accuracy}% | Time: ${payload.durationSeconds}s`,
                `Raw: ${payload.raw} | Consistency: ${payload.consistency}%`
            ];
            if (appUrl) lines.push(appUrl);
            return lines.join('\n');
        }

        function closeSharedResultModal() {
            elements.sharedResultArea?.classList.add('hidden');
            goHome();
            clearShareParamFromUrl();
        }

        function openSharedResultModal(shared) {
            if (!elements.sharedResultArea) return;
            const owner = shared?.owner_username || 'player';
            const song = shared?.song_title
                ? `${shared.song_title}${shared.artist ? ` - ${shared.artist}` : ''}`
                : 'Custom lyrics';
            const mode = String(shared?.mode || 'normal').toUpperCase();
            const createdAt = shared?.created_at ? new Date(shared.created_at).toLocaleString() : '';
            if (elements.sharedResultUser) elements.sharedResultUser.textContent = owner;
            if (elements.sharedResultSong) elements.sharedResultSong.textContent = song;
            if (elements.sharedResultMeta) elements.sharedResultMeta.textContent = `${mode}${createdAt ? ` - ${createdAt}` : ''}`;
            if (elements.sharedResultWpm) elements.sharedResultWpm.textContent = String(shared?.wpm ?? 0);
            if (elements.sharedResultAcc) elements.sharedResultAcc.textContent = `${shared?.accuracy ?? 0}%`;
            if (elements.sharedResultRaw) elements.sharedResultRaw.textContent = String(shared?.raw ?? 0);
            if (elements.sharedResultConsistency) elements.sharedResultConsistency.textContent = `${shared?.consistency ?? 0}%`;
            elements.setupArea?.classList.add('hidden');
            elements.gameArea?.classList.add('hidden');
            elements.resultsArea?.classList.add('hidden');
            elements.sharedResultArea.classList.remove('hidden');
        }

        async function maybeOpenSharedResultFromLink() {
            if (!pendingSharedResultId || !supabase) return;
            const shareId = pendingSharedResultId;
            pendingSharedResultId = '';
            const { data, error } = await supabase.rpc('get_shared_result', {
                p_share_id: shareId
            });
            if (error || !data || !data.length) {
                showToast('Shared score not found.', 'error');
                clearShareParamFromUrl();
                return;
            }
            openSharedResultModal(data[0]);
        }

        async function shareLastResult() {
            const payload = state.lastResultShare;
            if (!payload) {
                showToast('Finish a test first to share your score.', 'error');
                return;
            }
            let shareUrl = payload.shareUrl || '';
            if (!shareUrl && supabase) {
                const user = authCurrentUser || await syncCurrentUser();
                if (user) {
                    const { data, error } = await supabase.rpc('create_shared_result', {
                        p_song_title: payload.songTitle || null,
                        p_artist: payload.artist || null,
                        p_mode: payload.mode || 'normal',
                        p_wpm: payload.wpm || 0,
                        p_accuracy: payload.accuracy || 0,
                        p_raw: payload.raw || 0,
                        p_consistency: payload.consistency || 0,
                        p_duration_seconds: payload.durationSeconds || 0
                    });
                    if (!error && data) {
                        shareUrl = buildShareResultUrl(data);
                        state.lastResultShare.shareId = data;
                        state.lastResultShare.shareUrl = shareUrl;
                    }
                }
            }
            const finalPayload = {
                ...payload,
                shareUrl
            };
            const text = buildShareResultText(finalPayload);
            const appUrl = finalPayload.shareUrl || finalPayload.appUrl || getShareAppUrl();
            const title = 'Icarus Type Score';

            if (navigator.share) {
                try {
                    await navigator.share({
                        title,
                        text,
                        url: appUrl || undefined
                    });
                    showToast('Score shared.', 'info');
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            if (navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    showToast('Score copied to clipboard.', 'info');
                    if (!appUrl) showToast('Set scripts/config/app.js PUBLIC_APP_URL to include a public link.', 'info');
                    return;
                } catch (_e) {
                    // fallback below
                }
            }

            window.prompt('Copy your score card:', text);
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
            const rawWpm = Math.round(netWpm * (accuracy / 100)) || 0;

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
            if (state.duel.inRoom && state.duel.gameLaunched) {
                sendDuelProgress(true, {
                    typedWords: state.words.length,
                    typedChars: totalCharsTyped,
                    wpm: netWpm,
                    accuracy
                }).catch(() => {});
                showToast('Duel result sent. Waiting for opponent...', 'info');
            }
            
            // Update Results UI
            elements.resWpmBig.textContent = netWpm;
            elements.resAccBig.textContent = `${accuracy}%`;
            elements.resRaw.textContent = rawWpm; 
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
            state.lastResultShare = {
                songTitle: state.songTitle || '',
                artist: state.artist || '',
                mode: currentMode,
                wpm: netWpm,
                accuracy,
                raw: rawWpm,
                consistency,
                durationSeconds: Math.round(timeSeconds),
                appUrl: getShareAppUrl(),
                shareId: '',
                shareUrl: ''
            };

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
            if (state.duel.inRoom && state.duel.gameLaunched) {
                sendDuelProgress(false).catch(() => {});
            }
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
                     if (state.duel.inRoom && state.duel.gameLaunched) {
                        sendDuelProgress(false, { wpm }).catch(() => {});
                     }
                     
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
            loadArtistCatalog,
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
            togglePasswordVisibility,
            loginWithProvider,
            registerAccount,
            loginAccount,
            logoutAccount,
            deleteAccount,
            sendFriendRequest,
            respondFriendRequest,
            createDuelRoomFromCurrentSong,
            joinDuelRoomByCode,
            joinDuelRoomByCodeFromView,
            invitePlayerToDuelRoom,
            invitePlayerToDuelRoomFromView,
            inviteDuelFriendByUsername,
            respondDuelInvite,
            goToDuelSongStep,
            goToDuelRoomStep,
            prepareAndStartDuel,
            startDuelCountdown,
            leaveCurrentDuelRoom,
            openFriendProfileFromList,
            saveProfileDetails,
            addCurrentSongToFavorites,
            removeFavoriteSong,
            toggleProfileEditor,
            triggerAvatarPicker,
            triggerCustomCoverPicker,
            openProfileHub,
            closeProfileHub,
            openProfileScreen,
            openFriendsPanel,
            openAccountSettings,
            handleHeaderAvatarClick,
            openArtistSongsModal,
            openRandomArtistSong,
            closeArtistSongsModal,
            openAvatarPreview,
            openProfileHubAvatarPreview,
            shareLastResult,
            playFavoriteFromSetup,
            addFavoriteFromCatalog,
            closeSharedResultModal,
            closeAvatarPreview,
        });

        elements.input.addEventListener('input', (e) => handleInput(elements.input.value));
        if (elements.artistInput) {
            elements.artistInput.addEventListener('input', () => {
                if (artistSuggestTimer) clearTimeout(artistSuggestTimer);
                artistSuggestTimer = setTimeout(() => loadArtistSuggestions(), 220);
            });
            elements.artistInput.addEventListener('focus', () => {
                if ((elements.artistInput.value || '').trim().length >= 2) {
                    loadArtistSuggestions();
                }
            });
        }
        if (elements.titleInput) {
            elements.titleInput.addEventListener('input', () => {
                if (titleSuggestTimer) clearTimeout(titleSuggestTimer);
                titleSuggestTimer = setTimeout(() => loadTitleSuggestions(), 220);
            });
            elements.titleInput.addEventListener('focus', () => {
                if ((elements.titleInput.value || '').trim().length >= 1 && (elements.artistInput?.value || '').trim().length >= 2) {
                    loadTitleSuggestions();
                }
            });
        }
        if (elements.artistSongFilter) {
            elements.artistSongFilter.addEventListener('input', () => {
                if (artistCatalogFilterTimer) clearTimeout(artistCatalogFilterTimer);
                artistCatalogFilterTimer = setTimeout(() => {
                    renderArtistCatalogList(elements.artistSongFilter.value || '', true);
                }, 220);
            });
        }
        if (elements.customText) {
            elements.customText.addEventListener('input', updateCustomInputCounters);
        }
        if (elements.customTrans) {
            elements.customTrans.addEventListener('input', updateCustomInputCounters);
        }
        if (elements.customCoverFile) {
            elements.customCoverFile.addEventListener('change', (e) => {
                const file = e.target.files?.[0] || null;
                if (!file) {
                    resetCustomCoverInput();
                    return;
                }
                if (!file.type.startsWith('image/')) {
                    showToast('Please select an image file.', 'error');
                    resetCustomCoverInput();
                    return;
                }
                if (file.size > CUSTOM_COVER_MAX_BYTES) {
                    showToast('Image must be up to 2MB.', 'error');
                    resetCustomCoverInput();
                    return;
                }
                customPendingCoverFile = file;
                if (elements.customCoverFileName) elements.customCoverFileName.textContent = file.name;
                if (customCoverPreviewUrl) {
                    URL.revokeObjectURL(customCoverPreviewUrl);
                }
                customCoverPreviewUrl = URL.createObjectURL(file);
                if (elements.customCoverPreview) {
                    elements.customCoverPreview.src = customCoverPreviewUrl;
                    elements.customCoverPreview.classList.remove('hidden');
                }
            });
        }
        if (elements.favoritesTabFilter) {
            elements.favoritesTabFilter.addEventListener('input', () => {
                favoritesFilterText = elements.favoritesTabFilter.value || '';
                renderSetupFavoritesTab();
            });
        }
        if (elements.favoritesTabSort) {
            elements.favoritesTabSort.addEventListener('change', () => {
                favoritesSortMode = elements.favoritesTabSort.value || 'recent';
                renderSetupFavoritesTab();
            });
        }
        if (elements.favoritesTabType) {
            elements.favoritesTabType.addEventListener('change', () => {
                favoritesTypeFilter = elements.favoritesTabType.value || 'all';
                renderSetupFavoritesTab();
            });
        }
        if (elements.favoritesTabArtist) {
            elements.favoritesTabArtist.addEventListener('change', () => {
                favoritesArtistFilter = elements.favoritesTabArtist.value || 'all';
                renderSetupFavoritesTab();
            });
        }
        document.addEventListener('click', (event) => {
            const target = event.target;
            const insideArtist = elements.artistInput?.parentElement?.contains(target);
            const insideTitle = elements.titleInput?.parentElement?.contains(target);
            if (!insideArtist) elements.artistSuggestions?.classList.add('hidden');
            if (!insideTitle) elements.titleSuggestions?.classList.add('hidden');
        });
        if (elements.authAvatarFile) {
            elements.authAvatarFile.addEventListener('change', (e) => {
                const file = e.target.files?.[0] || null;
                if (!file) {
                    authPendingAvatarFile = null;
                    if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
                    return;
                }
                if (!file.type.startsWith('image/')) {
                    showToast('Please select an image file.', 'error');
                    e.target.value = '';
                    authPendingAvatarFile = null;
                    if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
                    return;
                }
                const maxBytes = 2 * 1024 * 1024;
                if (file.size > maxBytes) {
                    showToast('Image must be up to 2MB.', 'error');
                    e.target.value = '';
                    authPendingAvatarFile = null;
                    if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = 'No file selected';
                    return;
                }
                authPendingAvatarFile = file;
                if (elements.authAvatarFileName) elements.authAvatarFileName.textContent = file.name;
                if (authAvatarPreviewUrl) {
                    URL.revokeObjectURL(authAvatarPreviewUrl);
                }
                authAvatarPreviewUrl = URL.createObjectURL(file);
                if (elements.authUserAvatar) {
                    elements.authUserAvatar.src = authAvatarPreviewUrl;
                }
            });
        }
        if (elements.authPlayerPref) {
            elements.authPlayerPref.addEventListener('click', (event) => {
                const btn = event.target?.closest?.('.auth-player-btn');
                if (!btn) return;
                const provider = btn.getAttribute('data-player') || 'spotify';
                setPreferredPlayer(provider);
            });
        }
        if (elements.authHistorySong) {
            elements.authHistorySong.addEventListener('change', () => renderSongHistoryDetails());
        }
        if (elements.profileHubCompareSelect) {
            elements.profileHubCompareSelect.addEventListener('change', () => {
                profileHubCompareFriendKey = normalizeLookupText(elements.profileHubCompareSelect.value || '');
                renderProfileHub();
            });
        }
        window.addEventListener('resize', () => { if(state.isPlaying) updateCaretPosition(); });
        elements.gameArea.addEventListener('click', () => { if(!state.isPreviewMode) focusTypingInput(); });
        if (elements.headerBrand) {
            elements.headerBrand.addEventListener('click', () => goHome());
        }
        if (elements.videoCoverImage) {
            elements.videoCoverImage.addEventListener('error', () => {
                elements.videoCoverImage.src = '';
                elements.videoCoverLink?.classList.remove('has-image');
            });
        }
        if (elements.videoCoverLink) {
            elements.videoCoverLink.addEventListener('click', openCandidateInPreferredPlayer);
        }
        if (elements.videoTitleLink) {
            elements.videoTitleLink.addEventListener('click', openCandidateInPreferredPlayer);
        }
        switchAuthTab('login');
        updateCustomInputCounters();
        renderDuelPanel();
        pendingSharedResultId = parseShareIdFromLocation();
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
            await maybeOpenSharedResultFromLink();
        })();
        renderSetupFavoritesTab();
        switchTab('search'); 


