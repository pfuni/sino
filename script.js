(function() {
    'use strict';

    // --- KONFIGURACJA STAŁYCH ---
    const PINYIN_NO_TONE_JSON_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/no-tone-pinyin-hanzi-table.json';
    const PINYIN_TONE_HANZI_URL = 'https://raw.githubusercontent.com/guoyunhe/pinyin-json/refs/heads/master/pinyin-hanzi-table.json';
    
    const MAX_SUGGESTIONS = 30; // Zwiększony limit
    const MAX_DECODED_HANZI_PER_SEQUENCE = 5; 
    const MAX_SEQUENCE_LENGTH = 5; 
    const MAX_SYLLABLE_LENGTH = 4; 
    const PARALLAX_SENSITIVITY = 25; 

    // Pobieranie kolorów z CSS/Root
    const getCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const SUCCESS_COLOR = getCssVariable('--success-color');
    const ERROR_COLOR = getCssVariable('--error-color');
    const SECONDARY_TEXT_COLOR = getCssVariable('--secondary-text-color');
    const ACCENT_COLOR = getCssVariable('--accent-color');

    // --- ZMIENNE STANU ---
    let P_H_LOOKUP_TABLE = {}; 
    let P_A_H_LOOKUP_TABLE = {}; 
    let selectedSyllables = [];
    let hanziWriters = [];
    let msnry = null; // ZMIANA: Zostawiamy zmienną, ale nie jest używana
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
    const backgroundMountains = document.getElementById('background-mountains');
    const modeToggleButton = document.getElementById('mode-toggle-btn');
    const inputDescText = document.getElementById('input-desc-text');
    
    // --- FUNKCJE POMOCNICZE (TONY I KONWERSJA) ---
    
    /**
     * Konwertuje pinyin z cyfrą tonu (np. 'ni3') na pinyin z akcentem (np. 'nǐ').
     */
    function convertPinyinWithToneNumberToAccent(pinyin) {
        if (!pinyin) return '';
        const toneMap = {
            'a': ['ā', 'á', 'ǎ', 'à'], 'e': ['ē', 'é', 'ě', 'è'], 'i': ['ī', 'í', 'ǐ', 'ì'],
            'o': ['ō', 'ó', 'ǒ', 'ò'], 'u': ['ū', 'ú', 'ǔ', 'ù'], 'v': ['ǖ', 'ǘ', 'ǚ', 'ǜ']
        };
        
        let processedPinyin = pinyin.toLowerCase().trim();
        
        if (processedPinyin.includes(' ')) {
             return processedPinyin.split(' ').map(s => convertPinyinWithToneNumberToAccent(s)).join(' ');
        }
        
        const toneMatch = processedPinyin.match(/[1-5]$/);
        
        if (!toneMatch || toneMatch[0] === '5') {
            return processedPinyin.replace(/[1-5]/g, '');
        } 
        
        const tone = parseInt(toneMatch[0]);
        let syllable = processedPinyin.slice(0, -1);
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

    function findPinyinWithTone(pinyinNoTone, hanzi) {
        const tones = ['1', '2', '3', '4', '5'];
        
        for (const tone of tones) {
            const pinyinWithToneNumber = pinyinNoTone + tone;
            const pinyinWithAccent = convertPinyinTone(pinyinWithToneNumber);
            
            if (P_A_H_LOOKUP_TABLE[pinyinWithAccent] && P_A_H_LOOKUP_TABLE[pinyinWithAccent].includes(hanzi)) {
                return pinyinWithToneNumber; 
            }
        }
        
        return pinyinNoTone + '5'; 
    }

    /**
     * Sprawdza, czy sekwencja sylab z numerami tonów (np. "ni3 hao3") 
     * jest zgodna z wejściem ciągłym (np. "ni3hao3").
     */
    function isPinyinSegmentMatch(pinyinWithSpacesAndTones, inputContinuous) {
        if (pinyinWithSpacesAndTones.length === 0) return false;

        const input = inputContinuous.toLowerCase().replace(/\s/g, '');
        const syllables = pinyinWithSpacesAndTones.split(' ').filter(s => s.length > 0);
        let currentIndex = 0;

        for (const syllable of syllables) {
            const toneMatch = syllable.match(/[1-5]$/);
            
            if (!toneMatch) {
                // Ta heurystyka działa tylko dla sylab z wyraźnym tonem
                return false; 
            }
            
            const segmentLength = syllable.length; 
            
            const expectedSegment = input.substring(currentIndex, currentIndex + segmentLength);
            
            if (expectedSegment !== syllable) {
                return false; 
            }
            
            currentIndex += segmentLength;
        }

        // Musi się zgadzać całe wejście z tonami
        return currentIndex === input.length;
    }
    
    // --- ŁADOWANIE DANYCH ---
    async function loadPinyinData() {
        pinyinInput.disabled = true;
        searchButton.disabled = true;
        loadingStatus.textContent = 'Ładowanie słowników, proszę czekać...';
        loadingStatus.style.color = SECONDARY_TEXT_COLOR;

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
    
    loadPinyinData();

    // --- PRZEŁĄCZANIE TRYBÓW ---
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
    }
    
    function toggleMode() {
        resetUiState(); 
        pinyinInput.style.width = 'auto'; 

        if (currentMode === 'CHAR') {
            currentMode = 'WORD';
            modeToggleButton.textContent = 'Aktualny Tryb: Słowo (IME)';
            inputDescText.innerHTML = 'Wpisz **ciąg pinyin ze spacjami** (np. *wo ai ni*), aby zatwierdzić sylaby, lub **ciągły pinyin** (np. *ni3hao3*), aby zobaczyć sugestie fraz.';
            pinyinInput.placeholder = "Wpisz pinyin (np. wo ai ni lub ni3hao3)";
            pinyinInput.style.width = '100%'; 
            loadingStatus.textContent = `Słowniki gotowe! Aktualny tryb: Słowo (IME - Ciągły Pinyin).`;
        } else {
            currentMode = 'CHAR';
            modeToggleButton.textContent = 'Aktualny Tryb: Znak';
            inputDescText.innerHTML = 'Wpisz sylabę. Znak pojawi się automatycznie po dodaniu **cyfry tonu** (1-5).';
            pinyinInput.placeholder = "Wpisz sylabę (np. ni)";
            loadingStatus.textContent = `Słowniki gotowe! Aktualny tryb: Znak (Pojedyncza Sylaba).`;
        }
        pinyinInput.focus();
    }
    
    modeToggleButton.addEventListener('click', toggleMode);

    // --- FUNKCJA DEKODOWANIA PINYIN (Tryb WORD) ---
    
    function decodePinyinSequence(pinyin) {
        const dp = [[]]; 
        const pinyinLen = pinyin.length;
        
        for (let i = 1; i <= pinyinLen; i++) {
            dp[i] = [];
            for (let j = Math.max(0, i - MAX_SYLLABLE_LENGTH); j < i; j++) {
                const currentPinyin = pinyin.substring(j, i);
                
                if (P_H_LOOKUP_TABLE.hasOwnProperty(currentPinyin)) {
                    if (j === 0) {
                        dp[i].push([currentPinyin]);
                    } else if (dp[j].length > 0) {
                        for (const prevSequence of dp[j]) {
                            if (prevSequence.length < MAX_SEQUENCE_LENGTH) {
                                dp[i].push([...prevSequence, currentPinyin]);
                            }
                        }
                    }
                }
            }
        }
        
        const finalResults = [];
        const fullSequences = dp[pinyinLen];

        for (const pinyinSequence of fullSequences) {
            let hanziSyllablePairs = [{ hanzi: '', pinyinNoTone: '' }]; 
            
            pinyinSequence.forEach((syllable) => {
                const possibleHanzi = P_H_LOOKUP_TABLE[syllable];
                let nextPairs = [];
                let counter = 0; 

                for (const currentPair of hanziSyllablePairs) {
                    for (const char of possibleHanzi) {
                        if (counter < MAX_DECODED_HANZI_PER_SEQUENCE * 2) { 
                             nextPairs.push({ 
                                 hanzi: currentPair.hanzi + char, 
                                 pinyinNoTone: currentPair.pinyinNoTone + syllable + ' ' 
                             });
                             counter++;
                        }
                    }
                }
                hanziSyllablePairs = nextPairs;
            });
            
            hanziSyllablePairs = hanziSyllablePairs.map(pair => ({
                 hanzi: pair.hanzi,
                 pinyinNoTone: pair.pinyinNoTone.trim()
            }));

            const uniqueHanziMap = new Map();
            
            for (const pair of hanziSyllablePairs) {
                if (uniqueHanziMap.has(pair.hanzi)) continue;
                
                const noToneSyllables = pair.pinyinNoTone.split(' ');
                
                let pinyinWithToneArray = [];

                for (let i = 0; i < pair.hanzi.length; i++) {
                    const hanziChar = pair.hanzi[i];
                    const pinyinNoToneChar = noToneSyllables[i];
                    
                    const pinyinWithToneChar = findPinyinWithTone(pinyinNoToneChar, hanziChar); 
                    
                    pinyinWithToneArray.push(pinyinWithToneChar);
                }
                
                const finalPinyinWithTone = pinyinWithToneArray.join(' ');

                finalResults.push({
                    pinyinNoTone: pair.pinyinNoTone, 
                    hanzi: pair.hanzi, 
                    pinyinWithTone: finalPinyinWithTone 
                });
                uniqueHanziMap.set(pair.hanzi, true);
            }
        }
        
        return finalResults.sort((a, b) => b.hanzi.length - a.hanzi.length);
    }
    
    // --- WIDOK I INTERAKCJE ---
    
    function updateInputDisplay() {
        if (currentMode === 'CHAR') {
            const hanziParts = selectedSyllables.map(s => s.hanzi);
            const prefixText = selectedSyllables.map(s => stripTone(s.pinyinWithTone)).join(' ') + (selectedSyllables.length > 0 ? ' ' : '');
            pinyinPrefixDisplay.textContent = prefixText;
            
            const currentInputLength = tempSelection ? 0 : pinyinInput.value.length;
            pinyinInput.style.width = (currentInputLength * 10 + 20) + 'px';
            pinyinInput.placeholder = (currentInputLength === 0 && (selectedSyllables.length > 0 || tempSelection)) ? '' : 'Wpisz sylabę';
            
            const finalHanzi = hanziParts.join('');
            hanziOutput.textContent = finalHanzi || '?';
            
            const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
            pinyinOutput.textContent = pinyinWithAccent.join(' ');
        } else {
            // *** ZMIANA DLA TRYBU WORD ***
            const currentInput = pinyinInput.value.trim().toLowerCase();
            
            // Wyświetl pinyin wprowadzony przez użytkownika
            pinyinPrefixDisplay.textContent = currentInput; 
            
            hanziOutput.textContent = selectedSyllables[0]?.hanzi || '?';
            
            const pinyinWithTone = selectedSyllables[0]?.pinyinWithTone;
            // Wyświetl poprawnie zdekodowany pinyin z akcentami
            pinyinOutput.textContent = pinyinWithTone ? convertPinyinTone(pinyinWithTone) : ''; 
        }
    }

    function showSuggestions() {
        suggestionsDropdown.innerHTML = '';
        suggestionsDropdown.style.display = 'none';
        
        if (tempSelection && pinyinInput.value.length > 0) {
            tempSelection = null;
            updateInputDisplay();
        }

        // ZMIANA: Pobieramy input z zachowaniem spacji (tylko trymujemy)
        const inputRaw = pinyinInput.value.trim().toLowerCase(); 
        
        // ZMIANA: Dodano warunek resetujący poprzedni wybór w Trybie Słowo
        if (inputRaw.length > 0 && currentMode === 'WORD' && selectedSyllables.length > 0) {
             // Jeśli zaczynamy pisać nowy ciąg w Trybie Słowo, resetujemy poprzedni wynik
             selectedSyllables = [];
             updateInputDisplay();
        }
        
        if (inputRaw.length === 0 || Object.keys(P_H_LOOKUP_TABLE).length === 0) return [];

        let suggestionList = [];
        let suggestionsCount = 0; 

        if (currentMode === 'CHAR') {
            // W Trybie Znak nadal usuwamy spacje
            const input = inputRaw.replace(/\s/g, ''); 
            
            const toneMatch = input.match(/[1-5]$/);
            const baseInput = toneMatch ? stripTone(input) : input;
            
            if (toneMatch) {
                // *** LOGIKA DOKŁADNEGO DOPASOWANIA TONU (np. ni3) ***
                
                if (!P_H_LOOKUP_TABLE.hasOwnProperty(baseInput)) {
                     return []; 
                }

                const pinyinWithToneNumber = baseInput + toneMatch[0]; 
                const pinyinWithAccent = convertPinyinTone(pinyinWithToneNumber); 
                
                if (P_A_H_LOOKUP_TABLE[pinyinWithAccent]) {
                    for (const hanzi of P_A_H_LOOKUP_TABLE[pinyinWithAccent]) {
                         if (suggestionsCount >= MAX_SUGGESTIONS) break;
                         
                         suggestionList.push({
                             pinyinNoTone: baseInput,
                             hanzi: hanzi,
                             pinyinWithTone: pinyinWithToneNumber
                         });
                         suggestionsCount++;
                    }
                }
                
                if (suggestionList.length > 0) {
                    suggestionsDropdown.style.display = 'block';
                    suggestionList.forEach((data, index) => {
                         addSuggestionItem(data, index);
                    });
                }
                return suggestionList; 
                
            } else {
                 // *** LOGIKA DLA BRAKU TONU (np. "ni") - POKAZUJE TYLKO TON NEUTRALNY/BRAK TONU ***
                 
                 for (const baseSyllable in P_H_LOOKUP_TABLE) {
                    if (baseSyllable.startsWith(baseInput)) {
                        
                         const possibleHanzi = P_H_LOOKUP_TABLE[baseSyllable];
                         
                         for(const hanzi of possibleHanzi) {
                              if (suggestionList.length >= MAX_SUGGESTIONS) break;
                              
                              const pinyinWithToneNumber = baseSyllable + '5'; 

                              suggestionList.push({ 
                                  pinyinNoTone: baseSyllable, 
                                  hanzi: hanzi, 
                                  pinyinWithTone: pinyinWithToneNumber 
                              });
                         }
                         
                    }
                    if (suggestionList.length >= MAX_SUGGESTIONS) break; 
                }
            }
        // Koniec bloku if (currentMode === 'CHAR')
        } else {
            // *** TRYB WORD (IME): OBSŁUGA SPACJI I PRIORYTETU TONÓW ***
            
            const inputSegments = inputRaw.split(/\s+/).filter(s => s.length > 0);
            
            if (inputSegments.length === 0) return []; 
            
            let rawSuggestions = [];

            // 1. Jeśli wpisano więcej niż jeden segment (np. "wo ai" lub "ni3 hao3")
            if (inputSegments.length > 1) {
                 // Traktujemy segmenty jako ZATWIERDZONE SYLABY.
                 
                 let finalHanzi = '';
                 let finalPinyinWithTone = '';
                 let pinyinNoTone = '';
                 let isValid = true;

                 for (const segment of inputSegments) {
                     const cleanSegment = stripTone(segment);
                     const toneMatch = segment.match(/[1-5]$/);
                     const tone = toneMatch ? toneMatch[0] : '5';
                     
                     if (!P_H_LOOKUP_TABLE.hasOwnProperty(cleanSegment)) {
                          isValid = false; 
                          break;
                     }
                     
                     const pinyinWithToneNumber = cleanSegment + tone;
                     const pinyinWithAccent = convertPinyinTone(pinyinWithToneNumber);
                     
                     // Znajdź Hanzi dla tego tonu
                     const hanziOptions = P_A_H_LOOKUP_TABLE[pinyinWithAccent] || P_H_LOOKUP_TABLE[cleanSegment] || [];

                     if (hanziOptions.length === 0) {
                         isValid = false; 
                         break;
                     }

                     const selectedHanzi = hanziOptions[0]; // Bierzemy pierwszy Hanzi
                     
                     finalHanzi += selectedHanzi;
                     finalPinyinWithTone += pinyinWithToneNumber + ' ';
                     pinyinNoTone += cleanSegment + ' ';
                 }
                 
                 if (isValid) {
                     rawSuggestions.push({
                         pinyinNoTone: pinyinNoTone.trim(),
                         hanzi: finalHanzi,
                         pinyinWithTone: finalPinyinWithTone.trim()
                     });
                 }

            } else {
                // 2. Jeśli wpisano ciąg bez spacji (np. "nihao" lub "ni3hao3")
                
                const cleanInput = stripTone(inputSegments[0]); 
                if (cleanInput.length < 2) return []; 
                
                rawSuggestions = decodePinyinSequence(cleanInput);
            }
            
            // --- LOGIKA PRIORYTETU TONÓW DLA CIĄGŁEGO WEJŚCIA (GDY NIE BYŁO SPACJI) ---
            
            // Tylko jeśli było to pojedyncze, ciągłe wejście pinyin (nie segmentowane spacjami)
            if (inputSegments.length === 1) {
                const inputContinuousForMatch = inputSegments[0]; 

                let prioritySuggestions = [];
                let otherSuggestions = [];

                const hasExplicitTones = inputContinuousForMatch.match(/[1-4]/); 

                for (const suggestion of rawSuggestions) {
                     const generatedPinyinWithTones = suggestion.pinyinWithTone; 

                     if (hasExplicitTones && isPinyinSegmentMatch(generatedPinyinWithTones, inputContinuousForMatch)) {
                         prioritySuggestions.push(suggestion);
                     } else {
                         otherSuggestions.push(suggestion);
                     }
                }
                
                suggestionList = [...prioritySuggestions, ...otherSuggestions].slice(0, MAX_SUGGESTIONS);

            } else {
                // Jeśli były segmenty (spacje), po prostu wyświetlamy to, co wygenerowaliśmy
                suggestionList = rawSuggestions.slice(0, MAX_SUGGESTIONS);
            }
        }
        
        // Ta sekcja wykonuje się TYLKO dla Trybu WORD lub Trybu CHAR bez tonu
        if (suggestionList.length > 0) {
            suggestionsDropdown.style.display = 'block';
            suggestionList.forEach((data, index) => {
                 addSuggestionItem(data, index);
            });
        }
        
        return suggestionList; 
    }

    function addSuggestionItem(syllableData, index) {
        const div = document.createElement('div');
        const num = index + 1;
        
        // Zawsze używamy pinyin z tonem do wyświetlenia w sugestii
        const pinyinText = convertPinyinTone(syllableData.pinyinWithTone); 
        
        const displayText = `${syllableData.hanzi} (<span style="font-style: italic; font-weight: 500; color: ${ACCENT_COLOR}; font-family: 'Arial Unicode MS', 'Lucida Sans Unicode', Arial, sans-serif;">${pinyinText}</span>)`;

        div.innerHTML = `<span style="font-weight: 700; color: ${SECONDARY_TEXT_COLOR}; margin-right: 5px;">${num}.</span> ${displayText}`;
        div.className = 'suggestion-item';
        div.setAttribute('data-hanzi', syllableData.hanzi);
        div.setAttribute('data-pinyin-withtone', syllableData.pinyinWithTone);
        div.setAttribute('data-pinyin-notone', stripTone(syllableData.pinyinWithTone)); 
        
        suggestionsDropdown.appendChild(div);
    }

    function selectNextStep(syllableData) {
        if (currentMode === 'WORD') {
            // W Trybie WORD: Ustawiamy JEDNĄ WYBRANĄ frazę
            selectedSyllables = [syllableData];
            pinyinInput.value = '';
            suggestionsDropdown.style.display = 'none';
            updateInputDisplay();
            animateAllStrokes(syllableData.hanzi);
            statusMessage.textContent = `Wybrano frazę: "${syllableData.hanzi}". Naciśnij ZAKOŃCZ.`;
            statusMessage.style.color = SUCCESS_COLOR;
        } else {
            // Logika Trybu CHAR
            selectedSyllables.push(syllableData);
            pinyinInput.value = '';
            suggestionsDropdown.style.display = 'none';

            updateInputDisplay();
            const currentHanzi = selectedSyllables.map(s => s.hanzi).join('');
            animateAllStrokes(currentHanzi);

            showSuggestions(); 
            statusMessage.textContent = 'Wybrano znak. Wprowadź następną sylabę lub naciśnij ZAKOŃCZ.';
            statusMessage.style.color = SECONDARY_TEXT_COLOR;
            pinyinInput.focus();
        }
    }

    function handleBackspace(e) {
        if (currentMode === 'CHAR') {
            if (tempSelection) {
                e.preventDefault();
                tempSelection = null;
                updateInputDisplay();
                showSuggestions(); 
                statusMessage.textContent = 'Cofnięto tymczasowy wybór. Wpisz pinyin.';
                statusMessage.style.color = SECONDARY_TEXT_COLOR;
                return;
            }
            
            if (pinyinInput.value.length === 0 && selectedSyllables.length > 0) {
                e.preventDefault();
                selectedSyllables.pop();
                updateInputDisplay();
                animateAllStrokes(selectedSyllables.map(s => s.hanzi).join(''));
                showSuggestions();
                statusMessage.textContent = 'Cofnięto. Kontynuuj wpisywanie lub wybierz z listy.';
                statusMessage.style.color = SECONDARY_TEXT_COLOR;
            } else if (selectedSyllables.length === 0 && pinyinInput.value.length === 0) {
                 resetUiState();
            }
        } else {
            // W Trybie WORD cofanie usuwa albo całe wpisywane słowo, albo całą wybraną frazę.
            if (pinyinInput.value.length === 0 && selectedSyllables.length > 0) {
                 e.preventDefault();
                 selectedSyllables = [];
                 hanziOutput.textContent = '?';
                 pinyinOutput.textContent = '';
                 animateAllStrokes('');
                 updateInputDisplay();
                 statusMessage.textContent = 'Usunięto wybraną frazę. Wpisz nowy ciąg.';
                 statusMessage.style.color = SECONDARY_TEXT_COLOR;
            }
        }
    }
    
    /**
     * Zapisuje sylabę i zatwierdza ją, jeśli wykryto ton.
     */
    function handleToneSelection(tone) {
        if (currentMode !== 'CHAR') return false; 

        const input = pinyinInput.value.trim().toLowerCase().replace(/\s/g, '');
        const basePinyin = stripTone(input);
        
        if (basePinyin.length < 1) return false;
        
        if (!P_H_LOOKUP_TABLE.hasOwnProperty(basePinyin)) {
             return false;
        }

        const pinyinWithToneNumber = basePinyin + tone;
        const pinyinWithAccent = convertPinyinTone(pinyinWithToneNumber);
        
        
        if (!P_A_H_LOOKUP_TABLE[pinyinWithAccent] || P_A_H_LOOKUP_TABLE[pinyinWithAccent].length === 0) {
             return false;
        }

        const selectedHanzi = P_A_H_LOOKUP_TABLE[pinyinWithAccent][0];
        
        const syllableData = {
            hanzi: selectedHanzi,
            pinyinNoTone: basePinyin,
            pinyinWithTone: pinyinWithToneNumber
        };
        
        selectNextStep(syllableData); 
        
        statusMessage.textContent = `Wybrano: ${selectedHanzi} (${convertPinyinTone(pinyinWithToneNumber)}). Wprowadź następną sylabę.`;
        statusMessage.style.color = SECONDARY_TEXT_COLOR;

        return true; 
    }

    function handleFinalSearch() {
        
        const currentInput = pinyinInput.value.trim().toLowerCase();
        
        if (currentInput.length > 0) {
             const suggestions = showSuggestions(); 
             if (suggestions.length > 0) {
                 // W Trybie WORD: Używamy selectNextStep, które ustawia suggestion[0] jako selectedSyllables
                 selectNextStep(suggestions[0]);
                 pinyinInput.value = ''; 
             }
        }
        
        const displayHanzi = selectedSyllables.map(s => s.hanzi).join('');

        if (displayHanzi.length > 0) {
            statusMessage.textContent = `WYNIK: ${displayHanzi}`;
            statusMessage.style.color = SUCCESS_COLOR;
        } else {
             statusMessage.textContent = 'Sesja zresetowana. Rozpocznij wpisywanie.';
             statusMessage.style.color = SECONDARY_TEXT_COLOR;
             resetUiState(); 
             return;
        }

        hanziOutput.textContent = displayHanzi.length > 0 ? displayHanzi : '?';
        
        let finalPinyin;
        if (currentMode === 'CHAR') {
             // W Trybie CHAR Enter musi zresetować, bo chcemy zatwierdzić całe zdanie
             const pinyinWithAccent = selectedSyllables.map(s => convertPinyinTone(s.pinyinWithTone));
             finalPinyin = pinyinWithAccent.join(' ');
             resetUiState(); 
        } else {
             // W Trybie WORD: Wyświetlamy wynik i nie resetujemy
             const pinyinWithTone = selectedSyllables[0]?.pinyinWithTone;
             finalPinyin = pinyinWithTone ? convertPinyinTone(pinyinWithTone) : '';
             // NIE resetUiState() - zachowujemy wybrany wynik, aby można było go skopiować/zobaczyć
        }
        pinyinOutput.textContent = finalPinyin;
        
        animateAllStrokes(displayHanzi);
    }
    
    // --- ANIMACJA KRESEK (HANZI WRITER) ---
    
    // ZMIANA: Usunięto initMasonry, ponieważ nie jest potrzebne w układzie flexbox

    function animateAllStrokes(hanziText) {
        animationContainer.innerHTML = '';
        hanziWriters = [];
        
        // ZMIANA: Usunięto gridSizer (element Masonry)

        const charCount = hanziText.length;
        let size = 160;

        // ZMIANA: Uproszczona logika rozmiaru
        if (charCount > 10) size = 50; 
        else if (charCount > 6) size = 80;
        else if (charCount > 4) size = 100;
        else if (charCount > 2) size = 120;
        // else size = 160;


        for (let i = 0; i < charCount; i++) {
            const char = hanziText[i];
            const charDiv = document.createElement('div');
            charDiv.id = `hanzi-writer-${i}`;
            // ZMIANA: Dodano flex-shrink, aby lepiej działało z Flexbox
            charDiv.style.cssText = `width: ${size}px; height: ${size}px; margin: 5px; flex-shrink: 0;`; 
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
                     writer.animateCharacter(); 
                });

            } catch(e) {
                charDiv.textContent = char;
                charDiv.style.textAlign = 'center';
                charDiv.style.lineHeight = `${size}px`;
                charDiv.style.fontSize = `${size * 0.6}px`;
            }
        }
        
        // ZMIANA: Usunięto initMasonry()
    }
    
    // --- LOGIKA PARALAKSY DLA JEDNEJ WARSTWY ---
    document.addEventListener('mousemove', (e) => {
        if (!backgroundMountains) return; 

        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        const offsetX = e.clientX - centerX;
        const offsetY = e.clientY - centerY;
        
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
        
        // Obsługa zapisu tonu (1-5) do selectedSyllables
        if (currentMode === 'CHAR' && e.key >= '1' && e.key <= '5') {
            const input = pinyinInput.value.trim().toLowerCase().replace(/\s/g, '');
            const basePinyin = stripTone(input);
            
            if (basePinyin.length > 0) {
                 if (input.match(/[1-5]$/)) return; 
                 
                 if (handleToneSelection(e.key)) {
                      e.preventDefault(); 
                      return; 
                 }
            }
        }
        
        if (e.key === 'Escape') suggestionsDropdown.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
        if (!pinyinDisplayWrapper.contains(e.target) && !suggestionsDropdown.contains(e.target) && e.target !== searchButton && e.target !== modeToggleButton) {
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
    
    // --- OBSŁUGA ZMIANY ROZMIARU (Dla Masonry) ---
    // ZMIANA: Usunięto msnry.layout()
    window.addEventListener('resize', () => {
        // Nie robimy nic, Flexbox zajmie się układem
    });

})();
