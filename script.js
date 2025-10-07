(function() {
    'use strict';

    // --- KONFIGURACJA STAŁYCH ---
    const PINYIN_NO_TONE_JSON_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/no-tone-pinyin-hanzi-table.json';
    const PINYIN_HANZI_JSON_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/pinyin-hanzi-table.json';
    const MAX_SUGGESTIONS = 9;

    // Pobieranie kolorów z CSS/Root
    const getCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const SUCCESS_COLOR = getCssVariable('--success-color');
    const ERROR_COLOR = getCssVariable('--error-color');
    const SECONDARY_TEXT_COLOR = getCssVariable('--secondary-text-color');
    const ACCENT_COLOR = getCssVariable('--accent-color');

    // --- ZMIENNE STANU ---
    let P_H_LOOKUP_TABLE = {}; 
    let SUGGESTION_LOOKUP_TABLE = {}; 
    let selectedSyllables = [];
    let hanziWriters = [];

    // --- ELEMENTY DOM ---
    const loadingStatus = document.getElementById('loading-status');
    const pinyinInput = document.getElementById('pinyin-input');
    const pinyinPrefixDisplay = document.getElementById('pinyin-prefix');
    const pinyinDisplayWrapper = document.getElementById('pinyin-display-wrapper');
    const searchButton = document.getElementById('search-btn');
    const hanziOutput = document.getElementById('hanzi-output');
    const pinyinOutput = document.getElementById('pinyin-output');
    const animationContainer = document.getElementById('animation-container');
    const statusMessage = document.getElementById('status-message');
    const suggestionsDropdown = document.getElementById('suggestions-dropdown');
    
    // POPRAWIONE ODWOŁANIE DO JEDNEJ WARSTWY PARALAKSY
    const backgroundMountains = document.getElementById('background-mountains'); 

    // --- FUNKCJE POMOCNICZE (TONY I KONWERSJA) ---
    function convertPinyinTone(pinyin) {
        if (!pinyin) return '';
        const toneMap = {
            'a': ['ā', 'á', 'ǎ', 'à'], 'e': ['ē', 'é', 'ě', 'è'], 'i': ['ī', 'í', 'ǐ', 'ì'],
            'o': ['ō', 'ó', 'ǒ', 'ò'], 'u': ['ū', 'ú', 'ǔ', 'ù'], 'v': ['ǖ', 'ǘ', 'ǚ', 'ǜ']
        };
        let processedPinyin = pinyin.toLowerCase().replace(/\s/g, '');
        const toneMatch = processedPinyin.match(/[1-5]$/);
        if (!toneMatch) return processedPinyin;
        const tone = parseInt(toneMatch[0]);
        let syllable = processedPinyin.slice(0, -1);
        if (tone === 5) return syllable;
        const toneIndex = tone - 1;

        if (syllable.includes('a')) {
            syllable = syllable.replace('a', toneMap.a[toneIndex]);
        } else if (syllable.includes('e')) {
            syllable = syllable.replace('e', toneMap.e[toneIndex]);
        } else if (syllable.includes('ou')) {
            syllable = syllable.replace('o', toneMap.o[toneIndex]);
        } else if (syllable.includes('o')) {
            syllable = syllable.replace('o', toneMap.o[toneIndex]);
        } else {
            const vowels = ['i', 'u', 'v'];
            for (let i = syllable.length - 1; i >= 0; i--) {
                const char = syllable[i];
                if (vowels.includes(char)) {
                    syllable = syllable.substring(0, i) + toneMap[char][toneIndex] + syllable.substring(i + 1);
                    break;
                }
            }
        }
        return syllable;
    }

    function stripTone(pinyin) {
        return pinyin.replace(/[1-5]/g, '').trim();
    }

    function getToneInfo(pinyinNoTone, hanzi) {
        const pinyinWithTone = SUGGESTION_LOOKUP_TABLE[pinyinNoTone]?.get(hanzi);
        return pinyinWithTone || pinyinNoTone;
    }

    // --- ŁADOWANIE DANYCH ---
    async function loadPinyinData() {
        pinyinInput.disabled = true;
        searchButton.disabled = true;
        loadingStatus.textContent = 'Ładowanie słowników, proszę czekać...';
        loadingStatus.style.color = SECONDARY_TEXT_COLOR;

        await loadJsonData(PINYIN_NO_TONE_JSON_URL, 'P_H_LOOKUP_TABLE');
        await loadJsonData(PINYIN_HANZI_JSON_URL, 'SUGGESTION_LOOKUP_TABLE');

        pinyinInput.disabled = false;
        searchButton.disabled = false;
        pinyinInput.focus();

        if (Object.keys(P_H_LOOKUP_TABLE).length > 0) {
            loadingStatus.textContent = `Słowniki gotowe! Rozpocznij pisanie.`;
            loadingStatus.style.color = SUCCESS_COLOR;
        } else {
             loadingStatus.textContent = `Błąd: Nie udało się załadować danych do konwersji (sprawdź połączenie). Pisanie jest możliwe, ale funkcje konwersji są wyłączone.`;
             statusMessage.style.color = ERROR_COLOR; 
        }
    }

    function loadJsonData(url, targetVariable) {
        return new Promise((resolve) => {
            fetch(url)
                .then(response => response.ok ? response.json() : Promise.reject(`HTTP ${response.status}`))
                .then(data => {
                    if (targetVariable === 'P_H_LOOKUP_TABLE') {
                        P_H_LOOKUP_TABLE = data;
                    } else if (targetVariable === 'SUGGESTION_LOOKUP_TABLE') {
                        for (const pinyinWithTone in data) {
                            if (data.hasOwnProperty(pinyinWithTone)) {
                                if (data[pinyinWithTone].length === 1) {
                                    const pinyinNoTone = stripTone(pinyinWithTone);
                                    const hanzi = data[pinyinWithTone][0];
                                    if (!SUGGESTION_LOOKUP_TABLE[pinyinNoTone]) {
                                         SUGGESTION_LOOKUP_TABLE[pinyinNoTone] = new Map();
                                    }
                                    SUGGESTION_LOOKUP_TABLE[pinyinNoTone].set(hanzi, pinyinWithTone);
                                }
                            }
                        }
                    }
                    resolve();
                })
                .catch(e => {
                     console.error(`Błąd ładowania danych z ${url}:`, e);
                     resolve();
                });
        });
    }
    
    loadPinyinData();

    // --- WIDOK I INTERAKCJE ---
    function updateInputDisplay() {
        const hanziParts = selectedSyllables.map(s => s.hanzi);
        const pinyinNoToneParts = selectedSyllables.map(s => s.pinyinNoTone);
        const prefixText = pinyinNoToneParts.join(' ') + (pinyinNoToneParts.length > 0 ? ' ' : '');
        pinyinPrefixDisplay.textContent = prefixText;

        pinyinInput.style.width = (pinyinInput.value.length * 10 + 20) + 'px';
        pinyinInput.placeholder = (pinyinInput.value.length === 0 && selectedSyllables.length > 0) ? '' : 'Wpisz sylabę';

        hanziOutput.textContent = hanziParts.join('') || '?';
        const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
        pinyinOutput.textContent = pinyinWithAccent.join(' ');
    }

    function showSuggestions() {
        suggestionsDropdown.innerHTML = '';
        suggestionsDropdown.style.display = 'none';

        const input = pinyinInput.value.trim().toLowerCase();
        if (input.length === 0 || Object.keys(P_H_LOOKUP_TABLE).length === 0) return;

        let suggestionsCount = 0;

        for (const syllable in P_H_LOOKUP_TABLE) {
            if (syllable.startsWith(input) && suggestionsCount < MAX_SUGGESTIONS) {
                const possibleHanzi = P_H_LOOKUP_TABLE[syllable];
                for(const hanzi of possibleHanzi) {
                     if (suggestionsCount < MAX_SUGGESTIONS) {
                        const pinyinWithTone = getToneInfo(syllable, hanzi);
                         addSuggestionItem({ pinyinNoTone: syllable, hanzi: hanzi, pinyinWithTone: pinyinWithTone }, suggestionsCount);
                         suggestionsCount++;
                     }
                }
            }
        }
        if (suggestionsCount > 0) {
            suggestionsDropdown.style.display = 'block';
        }
    }

    function addSuggestionItem(syllableData, index) {
        const div = document.createElement('div');
        const num = index + 1;
        const pinyinAccent = convertPinyinTone(syllableData.pinyinWithTone);
        const displayText = `${syllableData.hanzi} (<span style="font-style: italic; font-weight: 500; color: ${ACCENT_COLOR}; font-family: 'Arial Unicode MS', 'Lucida Sans Unicode', Arial, sans-serif;">${pinyinAccent}</span>)`;

        div.innerHTML = `<span style="font-weight: 700; color: ${SECONDARY_TEXT_COLOR}; margin-right: 5px;">${num}.</span> ${displayText}`;
        div.className = 'suggestion-item';
        div.setAttribute('data-hanzi', syllableData.hanzi);
        div.setAttribute('data-pinyin-withtone', syllableData.pinyinWithTone);
        div.setAttribute('data-pinyin-notone', syllableData.pinyinNoTone); 
        
        div.addEventListener('click', () => selectNextStep(syllableData));
        suggestionsDropdown.appendChild(div);
    }

    function selectNextStep(syllableData) {
        selectedSyllables.push(syllableData);
        pinyinInput.value = '';
        suggestionsDropdown.style.display = 'none';

        updateInputDisplay();
        const currentHanzi = selectedSyllables.map(s => s.hanzi).join('');
        animateAllStrokes(currentHanzi);

        showSuggestions();
        statusMessage.textContent = 'Wybrano znak. Wprowadź następną sylabę lub naciśnij ZAKOŃCZ.';
        statusMessage.style.color = SECONDARY_TEXT_COLOR;
    }

    function handleBackspace(e) {
        if (pinyinInput.value.length === 0 && selectedSyllables.length > 0) {
            e.preventDefault();
            selectedSyllables.pop();
            updateInputDisplay();
            animateAllStrokes(selectedSyllables.map(s => s.hanzi).join(''));
            showSuggestions();
            statusMessage.textContent = 'Cofnięto. Kontynuuj wpisywanie lub wybierz z listy.';
            statusMessage.style.color = SECONDARY_TEXT_COLOR;
        } else if (selectedSyllables.length === 0 && pinyinInput.value.length === 0) {
             hanziOutput.textContent = '?';
             pinyinOutput.textContent = '';
             animationContainer.innerHTML = '';
             hanziWriters = [];
             statusMessage.textContent = '';
        }
    }

    function handleFinalSearch() {
        const displayHanzi = selectedSyllables.map(s => s.hanzi).join('');

        if (displayHanzi.length > 0) {
            statusMessage.textContent = `WYNIK KOŃCOWY: ${displayHanzi}`;
            statusMessage.style.color = SUCCESS_COLOR;
        } else {
             statusMessage.textContent = 'Sesja zresetowana. Rozpocznij wpisywanie.';
             statusMessage.style.color = SECONDARY_TEXT_COLOR;
        }

        hanziOutput.textContent = displayHanzi.length > 0 ? displayHanzi : '?';
        const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
        pinyinOutput.textContent = pinyinWithAccent.join(' ');
        animateAllStrokes(displayHanzi);
        
        selectedSyllables = [];
        pinyinInput.value = '';
        updateInputDisplay();
        suggestionsDropdown.style.display = 'none';
    }

    // --- ANIMACJA KRESEK (HANZI WRITER) ---
    function animateAllStrokes(hanziText) {
        animationContainer.innerHTML = '';
        hanziWriters = [];

        const charCount = hanziText.length;
        let size = 160;

        if (charCount > 6) size = 80;
        else if (charCount > 4) size = 100;
        else if (charCount > 2) size = 120;
        else size = 160;

        for (let i = 0; i < charCount; i++) {
            const char = hanziText[i];
            const charDiv = document.createElement('div');
            charDiv.id = `hanzi-writer-${i}`;
            charDiv.style.cssText = `width: ${size}px; height: ${size}px; margin: 5px;`;
            animationContainer.appendChild(charDiv);

            try {
                 const writer = HanziWriter.create(charDiv.id, char, {
                    width: size, height: size, padding: 5, strokeColor: ACCENT_COLOR,
                    delayBetweenLoops: 0, showHintAfterMisses: 1, drawingSpeed: 0.5,
                 });

                setTimeout(() => writer.animateCharacter(), i * 50);
                hanziWriters.push(writer);
                
                charDiv.writer = writer; 
                charDiv.addEventListener('contextmenu', (e) => {
                     e.preventDefault(); 
                     writer.animateCharacter(); // PPM resetuje animację
                });

            } catch(e) {
                charDiv.textContent = char;
                charDiv.style.textAlign = 'center';
                charDiv.style.lineHeight = `${size}px`;
                charDiv.style.fontSize = `${size * 0.6}px`;
            }
        }
    }
    
    // ===========================================
    // --- LOGIKA PARALAKSY DLA JEDNEJ WARSTWY ---
    // ===========================================
    
    const PARALLAX_SENSITIVITY = 250; 

    document.addEventListener('mousemove', (e) => {
        // Sprawdzenie, czy element istnieje
        if (!backgroundMountains) return; 

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        const offsetX = e.clientX - centerX;
        const offsetY = e.clientY - centerY;
        
        // Obliczenia i aplikacja stylu
        const newPosX = (50 - (offsetX / centerX) * PARALLAX_SENSITIVITY).toFixed(2);
        const newPosY = (50 - (offsetY / centerY) * PARALLAX_SENSITIVITY).toFixed(2);
        backgroundMountains.style.backgroundPosition = `${newPosX}% ${newPosY}%`;
    });

    // --- EVENT LISTENERS ---
    pinyinDisplayWrapper.addEventListener('click', () => pinyinInput.focus());
    pinyinInput.addEventListener('input', () => {
        updateInputDisplay();
        showSuggestions();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') handleBackspace(e);

        if (suggestionsDropdown.style.display === 'block' && e.key >= '1' && e.key <= '9') {
            const index = parseInt(e.key) - 1;
            const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
            if (index >= 0 && index < items.length) {
                e.preventDefault();
                const item = items[index];
                const syllableData = {
                    hanzi: item.getAttribute('data-hanzi'),
                    pinyinNoTone: item.getAttribute('data-pinyin-notone'),
                    pinyinWithTone: item.getAttribute('data-pinyin-withtone')
                };
                selectNextStep(syllableData);
            }
        }
        if (e.key === 'Escape') suggestionsDropdown.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
        if (!pinyinDisplayWrapper.contains(e.target) && !suggestionsDropdown.contains(e.target) && e.target !== searchButton) {
            suggestionsDropdown.style.display = 'none';
        }
    });

    searchButton.addEventListener('click', handleFinalSearch);
    pinyinInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleFinalSearch();
        }
    });
    
    // --- KOPIOWANIE DO SCHOWKA ---
    hanziOutput.addEventListener('click', () => {
        const textToCopy = hanziOutput.textContent.trim();

        if (textToCopy === '?' || textToCopy.length === 0 || textToCopy === '[PINYIN]') {
             statusMessage.textContent = 'Brak gotowego tekstu (Hanzi) do skopiowania.';
             statusMessage.style.color = ERROR_COLOR;
             return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
             navigator.clipboard.writeText(textToCopy).then(() => {
                statusMessage.textContent = `Skopiowano: "${textToCopy}" do schowka!`;
                statusMessage.style.color = SUCCESS_COLOR;
             }).catch(err => {
                statusMessage.textContent = 'Błąd kopiowania. Wymagane kliknięcie lub bezpieczny kontekst.';
                statusMessage.style.color = ERROR_COLOR;
             });
        } else {
             statusMessage.textContent = 'Błąd: Twoja przeglądarka nie wspiera standardowego kopiowania.';
             statusMessage.style.color = ERROR_COLOR;
        }
    });

})(); // Koniec głównej funkcji IIFE
