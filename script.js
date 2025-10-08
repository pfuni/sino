(function() {
    'use strict';

    // --- KONFIGURACJA STAŁYCH ---
    const PINYIN_NO_TONE_JSON_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/no-tone-pinyin-hanzi-table.json';
    const PINYIN_TONE_HANZI_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/pinyin-hanzi-table.json';
    
    const MAX_SUGGESTIONS = 30; 
    const MAX_DECODED_HANZI_PER_SEQUENCE = 5; 
    const MAX_SEQUENCE_LENGTH = 5; 
    const MAX_SYLLABLE_LENGTH = 6; 
    const PARALLAX_SENSITIVITY = 25; 

    // Pobieranie kolorów z CSS/Root
    const getCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const getDynamicColor = (name) => getCssVariable(name); 

    const SUCCESS_COLOR = '#4CAF50';
    const ERROR_COLOR = '#f44336';
    
    const DEFAULT_ACCENT_COLOR = '#ff66a4'; 
    const WORD_MODE_COLOR = '#cc0000'; 

    // --- ZMIENNE STANU ---
    let P_H_LOOKUP_TABLE = {}; // Pinyin bez tonu -> [Hanzi]
    let P_A_H_LOOKUP_TABLE = {}; // Pinyin z akcentem -> [Hanzi]
    let selectedSyllables = []; 
    let hanziWriters = [];
    let currentMode = 'CHAR'; 
    let tempSelection = null; 
    
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
    
    const modeCharBtn = document.getElementById('mode-char-btn');
    const modeWordBtn = document.getElementById('mode-word-btn');
    const darkModeToggle = document.getElementById('dark-mode-toggle'); 
    const inputDescText = document.getElementById('input-desc-text');


    // --- FUNKCJE POMOCNICZE (TONY I KONWERSJA) ---
    function convertPinyinWithToneNumberToAccent(pinyin) {
        if (!pinyin) return '';
        const toneMap = {
            'a': ['ā', 'á', 'ǎ', 'à'], 'e': ['ē', 'é', 'ě', 'è'], 'i': ['ī', 'í', 'ǐ', 'ì'],
            'o': ['ō', 'ó', 'ǒ', 'ò'], 'u': ['ū', 'ú', 'ǔ', 'ù'], 'v': ['ǖ', 'ǘ', 'ǚ', 'ǜ']
        };
        
        let processedPinyin = pinyin.toLowerCase().trim();
        
        // Obsługa ciągu pinyin ze spacjami
        if (processedPinyin.includes(' ')) {
             return processedPinyin.split(' ').map(s => convertPinyinWithToneNumberToAccent(s)).join(' ');
        }
        
        const toneMatch = processedPinyin.match(/[1-5]$/);
        
        if (!toneMatch) {
            return processedPinyin.replace(/[1-5]/g, '');
        } 
        if (toneMatch[0] === '5') {
            return processedPinyin.replace(/[1-5]/g, '');
        }
        
        const tone = parseInt(toneMatch[0]);
        let syllable = processedPinyin.slice(0, -1);
        const toneIndex = tone - 1;

        // Reguły umieszczania akcentu (priorytet: a > e > ou > o > i, u, v)
        if (syllable.includes('a')) {
            syllable = syllable.replace('a', toneMap.a[toneIndex]);
        } else if (syllable.includes('e')) {
            syllable = syllable.replace('e', toneMap.e[toneIndex]);
        } else if (syllable.includes('ou')) { 
            syllable = syllable.replace('o', toneMap.o[toneIndex]);
        } else if (syllable.includes('o')) {
            syllable = syllable.replace('o', toneMap.o[toneIndex]);
        } else {
            const priorityVowels = ['i', 'u', 'v']; 
            for (let i = syllable.length - 1; i >= 0; i--) {
                const char = syllable[i];
                if (priorityVowels.includes(char)) {
                    syllable = syllable.substring(0, i) + toneMap[char][toneIndex] + syllable.substring(i + 1);
                    break;
                }
            }
        }
        return syllable;
    }

    const convertPinyinTone = convertPinyinWithToneNumberToAccent;

    function stripTone(pinyin) {
        return pinyin.replace(/[1-5]/g, '').trim();
    }
    
    // --- FUNKCJA KOPIOWANIA (Z FALLBACKIEM) ---
    async function copyToClipboard(text) {
        if (!text || text.length === 0 || text === '?') return false;
        
        let success = false;

        // 1. Próba użycia nowoczesnego Clipboard API
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                 await navigator.clipboard.writeText(text);
                 success = true;
            } else {
                 throw new Error("Clipboard API not available.");
            }
        } catch (err) {
            // 2. Metoda awaryjna (Fallback) z użyciem document.execCommand
            try {
                const tempInput = document.createElement('textarea');
                tempInput.value = text;
                tempInput.style.position = 'fixed'; 
                tempInput.style.opacity = '0';      
                document.body.appendChild(tempInput);
                
                tempInput.focus();
                tempInput.select(); 
                
                // Wykonaj polecenie kopiowania
                success = document.execCommand('copy');
                
                document.body.removeChild(tempInput);

            } catch (errFallback) {
                console.error('Błąd metody awaryjnej (execCommand):', errFallback);
                success = false;
            }
        }
        
        // Aktualizacja statusu (TYLKO jeśli wywołano z handleFinalSearch)
        if (searchButton.contains(document.activeElement)) { 
            if (success) {
                 statusMessage.textContent += ` (Skopiowano do schowka!)`; 
            } else {
                 statusMessage.textContent += ` (Kopiowanie nieudane. Zrób to ręcznie.)`;
                 statusMessage.style.color = ERROR_COLOR; 
            }
        }
        
        return success;
    }

    // --- ŁADOWANIE DANYCH ---
    async function loadPinyinData() {
        pinyinInput.disabled = true;
        searchButton.disabled = true;
        loadingStatus.textContent = 'Ładowanie słowników, proszę czekać...';
        loadingStatus.style.color = getDynamicColor('--secondary-text-color');

        const promises = [
            loadJsonData(PINYIN_NO_TONE_JSON_URL, 'P_H_LOOKUP_TABLE'),
            loadJsonData(PINYIN_TONE_HANZI_URL, 'P_A_H_LOOKUP_TABLE'),
        ];

        await Promise.all(promises);

        pinyinInput.disabled = false;
        searchButton.disabled = false;
        pinyinInput.focus();

        if (Object.keys(P_H_LOOKUP_TABLE).length > 0) {
            loadingStatus.textContent = `Słowniki gotowe! Aktualny tryb: Znak (Pojedyncza Sylaba).`;
            loadingStatus.style.color = SUCCESS_COLOR;
        } else {
             loadingStatus.textContent = `Błąd: Nie udało się załadować danych (sprawdź połączenie). Aplikacja może nie działać poprawnie.`;
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
                    } else if (targetVariable === 'P_A_H_LOOKUP_TABLE') {
                         P_A_H_LOOKUP_TABLE = data; 
                    } 
                    resolve();
                })
                .catch(e => {
                     console.error(`Błąd ładowania danych z ${url}:`, e);
                     resolve();
                });
        });
    }
    
    // --- OBSŁUGA TRYBÓW I UI ---

    function resetUiState() {
        selectedSyllables = [];
        pinyinInput.value = '';
        suggestionsDropdown.style.display = 'none';
        hanziOutput.textContent = '?';
        pinyinOutput.textContent = '';
        animationContainer.innerHTML = '';
        hanziWriters = [];
        statusMessage.textContent = '';
        pinyinPrefixDisplay.textContent = ''; 
        tempSelection = null; 
        
        // 🟢 KOREKTA: Upewnienie się, że placeholder jest przywracany
        pinyinInput.placeholder = currentMode === 'CHAR' ? "Wpisz sylabę (np. ni)" : "Wpisz pinyin (np. wo3 ai4 ni3)"; 
    }
    
    function setMode(newMode) {
        if (currentMode === newMode) return;
        
        resetUiState(); 
        currentMode = newMode;
        pinyinInput.style.width = 'auto'; 

        if (newMode === 'WORD') {
            inputDescText.innerHTML = 'Wpisz ciąg pinyin (np. nihao lub wo3 ai4 ni3). <br><span style="color: red; font-weight: bold;">(UWAGA: Zatwierdzenie frazy wymaga podania numeru tonu (1-5)!)<br><span style="color: red; font-weight: bold;">WERSJA BETA TEGO TRYBU</span>';
            pinyinInput.placeholder = "Wpisz pinyin";
            pinyinInput.style.width = '100%'; 
            loadingStatus.textContent = `Słowniki gotowe! Aktualny tryb: CIĄG`;
            document.documentElement.style.setProperty('--accent-color', WORD_MODE_COLOR);

        } else {
            inputDescText.innerHTML = 'Wpisz sylabę. Znak pojawi się automatycznie po dodaniu tonu (1-5).';
            pinyinInput.placeholder = "Wpisz sylabę (np. ni)";
            loadingStatus.textContent = `Słowniki gotowe! Aktualny tryb: ZNAK`;
            document.documentElement.style.setProperty('--accent-color', DEFAULT_ACCENT_COLOR);
        }
        
        const activeBtn = (newMode === 'CHAR') ? modeCharBtn : modeWordBtn;
        const inactiveBtn = (newMode === 'CHAR') ? modeWordBtn : modeCharBtn;
        
        activeBtn.classList.add('active');
        inactiveBtn.classList.remove('active');
        
        pinyinInput.focus();
    }
    
    // --- FUNKCJE DLA TRYBU CIEMNEGO ---
    function toggleDarkMode() {
        const body = document.body;
        const isDarkMode = body.classList.toggle('dark-mode');
        
        localStorage.setItem('dark-mode', isDarkMode); 

        darkModeToggle.textContent = isDarkMode ? 'Tryb Ciemny' : 'Tryb Jasny';
        darkModeToggle.style.backgroundColor = isDarkMode ? '#888' : '#444';
        
        if (selectedSyllables.length > 0) {
            animateAllStrokes(selectedSyllables.map(s => s.hanzi).join(''));
        }
    }

    function initializeDarkMode() {
        const savedMode = localStorage.getItem('dark-mode');
        
        if (savedMode === 'true' || (savedMode === null && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.add('dark-mode');
            darkModeToggle.textContent = 'Tryb Ciemny';
            darkModeToggle.style.backgroundColor = '#888';
        }
    }

    // --- FUNKCJA DEKODOWANIA PINYIN (W Trybie Słowo używana tylko do sugestii) ---
    function decodePinyinSequence(pinyin) {
        if (!pinyin || pinyin.length === 0) return [];
        
        const dp = [[]]; 
        const pinyinLen = pinyin.length;
        
        dp[0].push([]); 

        for (let i = 1; i <= pinyinLen; i++) {
            dp[i] = [];
            for (let j = Math.max(0, i - MAX_SYLLABLE_LENGTH); j < i; j++) {
                const currentPinyin = pinyin.substring(j, i);
                
                if (P_H_LOOKUP_TABLE.hasOwnProperty(currentPinyin)) {
                    if (dp[j].length > 0) {
                        for (const prevSequence of dp[j]) {
                            if (prevSequence.length < MAX_SEQUENCE_LENGTH) {
                                dp[i].push([...prevSequence, currentPinyin]);
                            }
                        }
                    }
                }
            }
        }
        
        const finalSequences = dp[pinyinLen] || [];
        const hanziSyllablePairs = [];
        
        for (let i = 0; i < finalSequences.length && i < MAX_DECODED_HANZI_PER_SEQUENCE; i++) {
            const syllableSequence = finalSequences[i];
            
            const hanziSequence = syllableSequence.map(s => P_H_LOOKUP_TABLE[s] ? P_H_LOOKUP_TABLE[s][0] : '');
            
            const combinedHanzi = hanziSequence.join('');
            const combinedPinyinNoTone = syllableSequence.join('');
            
            const pinyinWithDefaultTone = syllableSequence.map(s => s + '5').join(' '); 
            
            hanziSyllablePairs.push({
                hanzi: combinedHanzi,
                pinyinNoTone: combinedPinyinNoTone,
                pinyinWithTone: pinyinWithDefaultTone 
            });
        }
        
        return hanziSyllablePairs;
    }


    // --- WIDOK I INTERAKCJE ---
    
    function updateInputDisplay() {
        if (currentMode === 'CHAR') {
            const hanziParts = selectedSyllables.map(s => s.hanzi);
            const prefixText = selectedSyllables.map(s => stripTone(s.pinyinWithTone)).join(' ') + (selectedSyllables.length > 0 ? ' ' : '');
            pinyinPrefixDisplay.textContent = prefixText;
            
            const currentInputLength = tempSelection ? 0 : pinyinInput.value.length;
            pinyinInput.style.width = (currentInputLength * 18 + 20) + 'px'; 
            
            // 🟢 KOREKTA: Kontrola placeholder
            if (selectedSyllables.length > 0 && pinyinInput.value.length === 0) {
                 pinyinInput.placeholder = ''; 
            } else {
                 pinyinInput.placeholder = "Wpisz sylabę (np. ni)";
            }
            // 🟢 KONIEC KOREKTY

            if (tempSelection) {
                 hanziOutput.textContent = hanziParts.join('') + tempSelection.hanzi;
                 pinyinOutput.textContent = convertPinyinTone(prefixText + tempSelection.pinyinWithTone);
            } else {
                 const finalHanzi = hanziParts.join('');
                 hanziOutput.textContent = finalHanzi || '?';
                 const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
                 pinyinOutput.textContent = pinyinWithAccent.join(' ');
            }
            
        } else { // Tryb Słowo
            const prefixPartsWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
            const prefixText = prefixPartsWithAccent.join(' ') + (selectedSyllables.length > 0 ? ' ' : '');
            pinyinPrefixDisplay.textContent = prefixText; 

            // 🟢 KOREKTA: Kontrola placeholder w trybie WORD
            if (selectedSyllables.length > 0 && pinyinInput.value.length === 0) {
                 pinyinInput.placeholder = 'Wpisz kolejną frazę...'; // Mniej natarczywy placeholder
            } else {
                 pinyinInput.placeholder = "Wpisz pinyin (np. wo3 ai4 ni3)";
            }
            // 🟢 KONIEC KOREKTY
            
            if (selectedSyllables.length > 0) {
                hanziOutput.textContent = selectedSyllables.map(s => s.hanzi).join('');
                pinyinOutput.textContent = prefixText; 
            } else {
                hanziOutput.textContent = '?';
                pinyinOutput.textContent = '';
            }
        }
    }

    function addSuggestionItem(syllableData, index) {
        const div = document.createElement('div');
        const num = index + 1;
        
        const pinyinText = convertPinyinTone(syllableData.pinyinWithTone); 
        const secondaryColor = getDynamicColor('--secondary-text-color');
        const accentColor = getDynamicColor('--accent-color');
        
        const displayText = `${syllableData.hanzi} (<span style="font-style: italic; font-weight: 500; color: ${accentColor}; font-family: 'Arial Unicode MS', 'Lucida Sans Unicode', Arial, sans-serif;">${pinyinText}</span>)`;

        div.innerHTML = `<span style="font-weight: 700; color: ${secondaryColor}; margin-right: 5px;">${num}.</span> ${displayText}`;
        div.className = 'suggestion-item';
        div.setAttribute('data-hanzi', syllableData.hanzi);
        div.setAttribute('data-pinyin-withtone', syllableData.pinyinWithTone);
        div.setAttribute('data-pinyin-notone', stripTone(syllableData.pinyinWithTone)); 
        
        suggestionsDropdown.appendChild(div);
    }

    function showSuggestions() {
        suggestionsDropdown.innerHTML = '';
        suggestionsDropdown.style.display = 'none';
        
        const inputRaw = pinyinInput.value.trim().toLowerCase(); 
        
        if (inputRaw.length === 0 || Object.keys(P_H_LOOKUP_TABLE).length === 0) {
            tempSelection = null;
            updateInputDisplay();
            return [];
        }

        let suggestionList = [];
        let inputWasHandled = false;

        if (currentMode === 'CHAR') {
            const input = inputRaw.replace(/\s/g, ''); 
            const toneMatch = input.match(/[1-5]$/);
            const baseInput = toneMatch ? stripTone(input) : input;
            
            // 1. Obsługa pełnego pinyin z tonem (np. ni3) -> AUTOMATYCZNE ZATWIERDZENIE
            if (toneMatch && P_H_LOOKUP_TABLE.hasOwnProperty(baseInput)) {
                const pinyinWithToneNumber = baseInput + toneMatch[0]; 
                const pinyinWithAccent = convertPinyinTone(pinyinWithToneNumber); 
                
                if (P_A_H_LOOKUP_TABLE[pinyinWithAccent]) {
                    const firstHanzi = P_A_H_LOOKUP_TABLE[pinyinWithAccent][0];
                    
                    if (firstHanzi) {
                        selectNextStep({
                            pinyinNoTone: baseInput,
                            hanzi: firstHanzi,
                            pinyinWithTone: pinyinWithToneNumber
                        });
                        inputWasHandled = true;
                        return [];
                    }
                }
            }
            
            // 2. Wyszukiwanie sugestii (np. ni)
            let suggestionsCount = 0;
            for (const baseSyllable in P_H_LOOKUP_TABLE) {
                // Logika dla DOKŁADNEGO DOPASOWANIA
                if (baseSyllable === baseInput && suggestionsCount < MAX_SUGGESTIONS) { 
                    const possibleHanzi = P_H_LOOKUP_TABLE[baseSyllable];
                    
                    // Iteruj przez WSZYSTKIE możliwe znaki dla TEJ sylaby
                    for(const hanzi of possibleHanzi) {
                        if (suggestionsCount >= MAX_SUGGESTIONS) break; 
                        
                        // Ton 5 jest domyślny, gdy wprowadzamy pinyin bez tonu w CHAR mode
                        const pinyinWithToneNumber = baseSyllable + '5'; 

                        suggestionList.push({ 
                            pinyinNoTone: baseSyllable, 
                            hanzi: hanzi, 
                            pinyinWithTone: pinyinWithToneNumber 
                        });
                        suggestionsCount++;
                    }
                }
            }
            
            if (!inputWasHandled && suggestionList.length > 0) {
                 tempSelection = suggestionList[0];
            } else {
                 tempSelection = null;
            }
            
        } else { // Tryb Słowo
            // Brak sugestii (suggestionList jest pusta) i brak podglądu (tempSelection)
            const inputSegments = inputRaw.split(/\s+/).filter(s => s.length > 0);
            
            if (inputSegments.length === 0) {
                 tempSelection = null;
                 updateInputDisplay();
                 return []; 
            }
            
            suggestionList = []; 
            tempSelection = null;
        }

        if (suggestionList.length > 0) {
            suggestionsDropdown.style.display = 'block'; 
            suggestionList.forEach((data, index) => {
                 addSuggestionItem(data, index);
            });
        }
        
        updateInputDisplay();
        return suggestionList; 
    }

    function selectNextStep(syllableData) {
        if (currentMode === 'WORD') {
            // W trybie WORD, wybieramy całą frazę
            selectedSyllables = []; 
            selectedSyllables.push(syllableData); 
            pinyinInput.value = ''; 
            suggestionsDropdown.style.display = 'none';
            tempSelection = null;

            updateInputDisplay();
            animateAllStrokes(syllableData.hanzi);
            statusMessage.textContent = `Wybrano frazę: "${syllableData.hanzi}". Kontynuuj wpisywanie.`;
            statusMessage.style.color = SUCCESS_COLOR;
        } else { // Tryb Znak
            selectedSyllables.push(syllableData);
            pinyinInput.value = '';
            suggestionsDropdown.style.display = 'none';
            tempSelection = null;

            updateInputDisplay();
            const currentHanzi = selectedSyllables.map(s => s.hanzi).join('');
            animateAllStrokes(currentHanzi);

            statusMessage.textContent = 'Wybrano znak. Wprowadź następną sylabę lub naciśnij ZAKOŃCZ.';
            statusMessage.style.color = getDynamicColor('--secondary-text-color');
            pinyinInput.focus();
        }
    }

    function handleFinalSearch() {
        if (currentMode === 'CHAR') {
            if (tempSelection) {
                selectNextStep(tempSelection);
                tempSelection = null; 
                return;
            }
            
            if (pinyinInput.value.length === 0 && selectedSyllables.length === 0) {
                 statusMessage.textContent = 'Sesja zresetowana. Rozpocznij wpisywanie.';
                 statusMessage.style.color = getDynamicColor('--secondary-text-color');
                 resetUiState(); 
                 return;
            }

            const displayHanzi = selectedSyllables.map(s => s.hanzi).join('');
            const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
            
            hanziOutput.textContent = displayHanzi || '?';
            pinyinOutput.textContent = pinyinWithAccent.join(' ');
            
            if (displayHanzi.length > 0) {
                statusMessage.textContent = `WYNIK: ${displayHanzi}`;
                statusMessage.style.color = SUCCESS_COLOR;
                animateAllStrokes(displayHanzi);
                
                // Kopiowanie i natychmiastowy reset
                copyToClipboard(displayHanzi);
                resetUiState(); 
            } else {
                statusMessage.textContent = 'Wprowadź pinyin, aby zobaczyć wyniki.';
                statusMessage.style.color = ERROR_COLOR;
            }
            

        } else { // Tryb Słowo
            let finalHanzi = '';
            let pinyinSegments = [];

            if (selectedSyllables.length > 0 && pinyinInput.value.trim().length === 0) {
                // Koniec sesji (ENTER w pustym polu)
                finalHanzi = selectedSyllables.map(s => s.hanzi).join('');
                
                statusMessage.textContent = `WYNIK KOŃCOWY: ${finalHanzi}`;
                statusMessage.style.color = SUCCESS_COLOR;
                animateAllStrokes(finalHanzi);
                
                // Kopiowanie i natychmiastowy reset
                copyToClipboard(finalHanzi);
                resetUiState(); 

                return;

            } else {
                // Przetwarzanie surowego inputu (np. "wo3 ai4 ni3" po wciśnięciu ENTER)
                const inputRaw = pinyinInput.value.trim().toLowerCase();
                if (inputRaw.length > 0) {
                    const segments = inputRaw.split(/\s+/).filter(s => s.length > 0);
                    let hanziFromSegments = [];
                    
                    // Wymaganie jawnego tonu dla zatwierdzenia
                    pinyinSegments = segments.map(segment => {
                        const toneMatch = segment.match(/[1-5]$/);
                        const cleanSegment = stripTone(segment);
                        
                        const ton = toneMatch ? toneMatch[0] : ''; 
                        
                        if (P_H_LOOKUP_TABLE.hasOwnProperty(cleanSegment) && ton.length > 0) {
                             // Tylko jeśli sylaba jest poprawna ORAZ podano ton, akceptujemy segment
                            hanziFromSegments.push(P_H_LOOKUP_TABLE[cleanSegment][0]); 
                            return cleanSegment + ton; 
                        }
                        
                        // Zwracamy pusty segment, jeśli brakuje tonu, co jest pożądane
                        return ''; 
                    }).filter(s => s.length > 0); 
                    
                    // Komunikat błędu
                    if (pinyinSegments.length === 0) {
                         statusMessage.textContent = 'Wprowadź poprawne pinyin z tonami (1-5) i spacjami, aby zatwierdzić frazę.';
                         statusMessage.style.color = ERROR_COLOR;
                         pinyinInput.value = '';
                         return;
                    }

                    finalHanzi = hanziFromSegments.join('');
                    
                    // Łączymy nową frazę z już wybranymi sylabami
                    const newSyllableData = { 
                        hanzi: finalHanzi,
                        pinyinNoTone: pinyinSegments.map(stripTone).join(''),
                        pinyinWithTone: pinyinSegments.join(' ') 
                    };
                    
                    selectedSyllables.push(newSyllableData);
                    
                    pinyinInput.value = ''; // Wyczyść pole wejścia, ale kontynuuj
                    
                } else {
                     statusMessage.textContent = 'Sesja zresetowana. Rozpocznij wpisywanie.';
                     statusMessage.style.color = getDynamicColor('--secondary-text-color');
                     resetUiState(); 
                     return;
                }
            }
            
            // Ostateczne wyświetlanie wyniku 
            const finalDisplayHanzi = selectedSyllables.map(s => s.hanzi).join('');
            const finalDisplayPinyin = convertPinyinTone(selectedSyllables.map(s => s.pinyinWithTone).join(' '));

            hanziOutput.textContent = finalDisplayHanzi || '?';
            pinyinOutput.textContent = finalDisplayPinyin; 

            if (finalDisplayHanzi.length > 0) {
                statusMessage.textContent = `WYNIK: ${finalDisplayHanzi}. Wpisz kolejną frazę lub naciśnij ZAKOŃCZ, aby zakończyć sesję.`;
                statusMessage.style.color = SUCCESS_COLOR;
                animateAllStrokes(finalDisplayHanzi);
                
                // Kopiowanie
                copyToClipboard(finalDisplayHanzi);
            } else {
                statusMessage.textContent = 'Wprowadź pinyin, aby zobaczyć wyniki.';
                statusMessage.style.color = ERROR_COLOR;
            }
        }
    }
    
    // --- OBSŁUGA KLAWIATURY I INNYCH EVENTÓW ---

    function handleKeyDown(e) {
        if (e.key === 'Backspace' && pinyinInput.value.length === 0) {
            e.preventDefault();
            if (currentMode === 'CHAR' && selectedSyllables.length > 0) {
                selectedSyllables.pop();
                pinyinPrefixDisplay.textContent = selectedSyllables.map(s => stripTone(s.pinyinWithTone)).join(' ') + (selectedSyllables.length > 0 ? ' ' : '');
                pinyinInput.focus();
                showSuggestions();
            } else if (currentMode === 'WORD' && selectedSyllables.length > 0) {
                // Backspace usuwa ostatnią zatwierdzoną frazę w trybie Słowo (jeśli pole jest puste)
                selectedSyllables.pop(); 
                updateInputDisplay(); 
                if (selectedSyllables.length === 0) {
                    resetUiState();
                } else {
                     animateAllStrokes(selectedSyllables.map(s => s.hanzi).join(''));
                }
            }
        }
    }


    function animateAllStrokes(hanziText) {
        animationContainer.innerHTML = '';
        hanziWriters = [];
        
        const charCount = hanziText.length;
        let size = 160;

        if (charCount > 10) size = 50; 
        else if (charCount > 6) size = 80;
        else if (charCount > 4) size = 100;
        else if (charCount > 2) size = 120;


        for (let i = 0; i < charCount; i++) {
            const char = hanziText[i];
            const charDiv = document.createElement('div');
            charDiv.id = `hanzi-writer-${i}`;
            charDiv.style.cssText = `width: ${size}px; height: ${size}px; margin: 5px; flex-shrink: 0;`; 
            animationContainer.appendChild(charDiv);

            try {
                 const currentAccent = getDynamicColor('--accent-color');
                 const writer = HanziWriter.create(charDiv.id, char, {
                    width: size, height: size, padding: 5, strokeColor: currentAccent,
                    delayBetweenLoops: 0, showHintAfterMisses: 1, drawingSpeed: 0.5,
                 });

                setTimeout(() => writer.animateCharacter(), i * 50);
                hanziWriters.push(writer);
                
                charDiv.writer = writer; 
                charDiv.addEventListener('contextmenu', (e) => {
                     e.preventDefault(); 
                     writer.animateCharacter(); 
                });

            } catch(e) {
                console.error("HanziWriter failed for char:", char, e);
            }
        }
    }
    
    function handleParallax(e) {
        const x = (window.innerWidth / 2 - e.clientX) / PARALLAX_SENSITIVITY;
        const y = (window.innerHeight / 2 - e.clientY) / PARALLAX_SENSITIVITY;
        const backgroundMountains = document.getElementById('background-mountains');
        if (backgroundMountains) {
            backgroundMountains.style.transform = `translate(${x}px, ${y}px)`;
        }
    }


    // --- EVENT LISTENERS I INICJALIZACJA ---
    
    modeCharBtn.addEventListener('click', () => setMode('CHAR'));
    modeWordBtn.addEventListener('click', () => setMode('WORD'));
    
    darkModeToggle.addEventListener('click', toggleDarkMode);

    pinyinInput.addEventListener('input', () => {
        showSuggestions();
    });
    
    pinyinInput.addEventListener('keydown', handleKeyDown);

    pinyinInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleFinalSearch();
        }
    });

    suggestionsDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        
        if (item) {
            const hanzi = item.getAttribute('data-hanzi');
            const pinyinWithTone = item.getAttribute('data-pinyin-withtone');
            
            const syllableData = {
                 hanzi: hanzi,
                 pinyinNoTone: stripTone(pinyinWithTone),
                 pinyinWithTone: pinyinWithTone
            };
            
            selectNextStep(syllableData);
        }
    });

    searchButton.addEventListener('click', handleFinalSearch);
    pinyinDisplayWrapper.addEventListener('click', () => pinyinInput.focus());

    // NOWY EVENT LISTENER DLA hanziOutput (Kopiowanie po kliknięciu)
    hanziOutput.addEventListener('click', () => {
        const textToCopy = hanziOutput.textContent.trim();

        if (textToCopy && textToCopy !== '?') {
            const success = copyToClipboard(textToCopy); 

            // Używamy tymczasowego statusu do powiadomienia
            const tempStatus = statusMessage.textContent;
            statusMessage.textContent = success ? 'Skopiowano Hanzi! ✅' : 'Kopiowanie nieudane. Zrób to ręcznie.';
            statusMessage.style.color = success ? SUCCESS_COLOR : ERROR_COLOR;
            
            // Przywracamy poprzedni status po krótkim czasie
            setTimeout(() => {
                // Sprawdzamy, czy status nie został już nadpisany przez inne operacje
                if (statusMessage.textContent.includes('Skopiowano Hanzi!') || statusMessage.textContent.includes('Kopiowanie nieudane')) {
                    statusMessage.textContent = tempStatus;
                    // Reset koloru, jeśli poprzedni status nie był pusty
                    if (tempStatus.length > 0) {
                        statusMessage.style.color = getDynamicColor('--secondary-text-color'); 
                    } else {
                         statusMessage.style.color = 'inherit';
                    }
                }
            }, 1000); 
        }
    });

    document.addEventListener('mousemove', handleParallax);


    // Uruchomienie aplikacji
    loadPinyinData().then(() => {
        setMode('CHAR'); 
        initializeDarkMode(); 
    });

})();
