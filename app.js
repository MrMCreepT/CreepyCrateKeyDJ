if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    });
}

// UI Elements
const folderBtn = document.getElementById('folder-btn');
const exportRekordboxBtn = document.getElementById('export-rekordbox-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportM3u8Btn = document.getElementById('export-m3u8-btn');
const resultsBody = document.getElementById('results-body');
const tracksTable = document.getElementById('tracks-table');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const notationSelect = document.getElementById('notation-select');
const optFilename = document.getElementById('opt-filename');
const optTitle = document.getElementById('opt-title');
const optTags = document.getElementById('opt-tags');

// Player Elements
const playerDeck = document.getElementById('player-deck');
const playPauseBtn = document.getElementById('play-pause-btn');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const playerTrackName = document.getElementById('player-track-name');
const playerBpm = document.getElementById('player-bpm');
const playerKey = document.getElementById('player-key');
const playerGenre = document.getElementById('player-genre');

// State Management
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const poolSize = Math.min(navigator.hardwareConcurrency || 2, 4);
const workers = [];
const workerCallbacks = {};
for (let i = 0; i < poolSize; i++) {
    const worker = new Worker('worker.js');
    worker.onmessage = (e) => {
        const { taskId, bpm, camelotCode, keyText, correlationScore, energyLevel, tags, grouping, comments, success, error } = e.data;
        if (workerCallbacks[taskId]) {
            workerCallbacks[taskId]({ bpm, camelotCode, keyText, correlationScore, energyLevel, tags, grouping, comments, success, error });
            delete workerCallbacks[taskId];
        }
    };
    workers.push(worker);
}
const fileRegistry = {}; 
let exportData = []; // Stores processed track metadata for export
let currentObjectUrl = null;
let isAnalyzing = false;

let wavesurfer = null;
document.addEventListener('DOMContentLoaded', () => {
    wavesurfer = WaveSurfer.create({
        container: '#waveform-container',
        waveColor: '#201838',
        progressColor: '#c084fc',
        cursorColor: '#f3e8ff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 50,
        normalize: true,
    });

    wavesurfer.on('play', () => {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    });

    wavesurfer.on('pause', () => {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    });

    playPauseBtn.addEventListener('click', () => {
        wavesurfer.playPause();
    });

    // Spacebar Play/Pause Hotkey
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
                return;
            }
            if (wavesurfer && playerDeck.classList.contains('visible')) {
                e.preventDefault();
                wavesurfer.playPause();
            }
        }
    });

    renderCamelotWheel();
    setupSorting();
    setupSidebarFilterListeners();
    initMixerDecks();
    initRotaryKnobs();
    initHotCues('a');
    initHotCues('b');
    initBeatJump();
    setupDragAndDropHandlers();

    const demoBtn = document.getElementById('demo-btn');
    if (demoBtn) {
        demoBtn.addEventListener('click', generateStudioDemoTracks);
    }
});

function analyseInWorker(channelData, sampleRate, workerIndex) {
    return new Promise((resolve) => {
        const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        workerCallbacks[taskId] = resolve;
        workers[workerIndex].postMessage({ taskId, channelData, sampleRate });
    });
}

function formatKey(camelotCode, keyText, format) {
    return format === 'camelot' ? camelotCode : keyText;
}

function getCompatibleKeys(camelotCode) {
    if (!camelotCode || camelotCode === "Unknown") return [];
    const match = camelotCode.match(/^(\d+)([AB])$/);
    if (!match) return [];
    
    const hour = parseInt(match[1], 10);
    const letter = match[2];
    
    const exactHour = hour;
    const hourMinus = hour === 1 ? 12 : hour - 1;
    const hourPlus = hour === 12 ? 1 : hour + 1;
    const oppositeLetter = letter === 'A' ? 'B' : 'A';
    
    return [
        `${exactHour}${letter}`,
        `${hourMinus}${letter}`,
        `${hourPlus}${letter}`,
        `${exactHour}${oppositeLetter}`
    ];
}

// Recursive function to deeply scan folders for DJ audio files
async function getAudioFilesRecursively(dirHandle) {
    let files = [];
    const validExtensions = ['.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.ogg', '.aac'];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            const lower = entry.name.toLowerCase();
            if (validExtensions.some(ext => lower.endsWith(ext))) {
                files.push(entry);
            }
        } else if (entry.kind === 'directory' && entry.name !== 'Processed_Tracks') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const nestedFiles = await getAudioFilesRecursively(subDirHandle);
            files = files.concat(nestedFiles);
        }
    }
    return files;
}

resultsBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr.track-row.ready');
    if (!row) return;

    if (row.classList.contains('selected-master')) {
        tracksTable.classList.remove('has-selection');
        row.classList.remove('selected-master');
        document.querySelectorAll('tr.track-row').forEach(r => r.classList.remove('harmonic-match'));
        wavesurfer.pause();
        playerDeck.classList.remove('visible');
        highlightKeyOnWheel(null);
        return;
    }

    tracksTable.classList.add('has-selection');
    document.querySelectorAll('tr.track-row').forEach(r => {
        r.classList.remove('selected-master', 'harmonic-match');
    });

    row.classList.add('selected-master');
    const selectedKey = row.getAttribute('data-key');
    highlightKeyOnWheel(selectedKey);
    const matches = getCompatibleKeys(selectedKey);

    document.querySelectorAll('tr.track-row.ready').forEach(r => {
        if (r !== row && matches.includes(r.getAttribute('data-key'))) {
            r.classList.add('harmonic-match');
        }
    });

    const rowId = row.id;
    if (fileRegistry[rowId]) {
        const file = fileRegistry[rowId];
        
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
        }
        currentObjectUrl = URL.createObjectURL(file);
        
        playerTrackName.textContent = row.querySelector('.new-name').textContent;
        playerBpm.textContent = `${row.getAttribute('data-bpm')} BPM`;
        const format = notationSelect.value;
        playerKey.textContent = formatKey(selectedKey, row.getAttribute('data-key-text'), format);
        playerGenre.textContent = row.getAttribute('data-genre') || "Unknown";
        playerDeck.classList.add('visible');

        wavesurfer.load(currentObjectUrl);
        wavesurfer.once('ready', () => {
            wavesurfer.play();
        });
    }
});

folderBtn.addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await startProcessingDirectory(dirHandle);
    } catch (err) {
        console.error("Folder selection cancelled or failed:", err);
        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
    }
});

async function startProcessingDirectory(dirHandle) {
    try {
        isAnalyzing = true;
        
        resultsBody.innerHTML = ''; 
        tracksTable.classList.remove('has-selection');
        playerDeck.classList.remove('visible');
        if (wavesurfer) wavesurfer.pause();
        
        for (let key in fileRegistry) delete fileRegistry[key];
        exportData = []; 

        folderBtn.disabled = true;
        if (exportRekordboxBtn) exportRekordboxBtn.disabled = true;
        exportCsvBtn.disabled = true;
        exportM3u8Btn.disabled = true;
        
        folderBtn.innerHTML = "Scanning folders...";
        progressContainer.style.display = 'block';
        progressText.style.display = 'block';

        const filesToProcess = await getAudioFilesRecursively(dirHandle);

        if (filesToProcess.length === 0) {
            folderBtn.disabled = false;
            folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
            progressText.textContent = "No MP3 files found in the selected folder.";
            isAnalyzing = false;
            return;
        }

        let processedCount = 0;
        updateProgress(0, filesToProcess.length);

        const outDirHandle = await dirHandle.getDirectoryHandle('Processed_Tracks', { create: true });
        const queue = [...filesToProcess];
        
        const runNext = async (workerIndex) => {
            if (queue.length === 0) return;
            const entry = queue.shift();
            try {
                await processBatchFile(entry, outDirHandle, workerIndex);
            } catch (err) {
                console.error("Error processing file in queue:", err);
            }
            processedCount++;
            updateProgress(processedCount, filesToProcess.length);
            await runNext(workerIndex);
        };

        const promises = [];
        for (let i = 0; i < Math.min(poolSize, filesToProcess.length); i++) {
            promises.push(runNext(i));
        }
        await Promise.all(promises);

        // Clean orphan files from Processed_Tracks that don't match any processed track in this batch
        try {
            const validNewNames = new Set(exportData.map(d => d.newName));
            for await (const entry of outDirHandle.values()) {
                if (entry.kind === 'file' && !validNewNames.has(entry.name)) {
                    await outDirHandle.removeEntry(entry.name);
                    console.log(`Pruned orphaned processed track: ${entry.name}`);
                }
            }
        } catch (e) {
            console.error("Error cleaning orphaned files:", e);
        }

        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
        progressText.textContent = "Batch Processing Complete!";

        if (exportData.length > 0) {
            if (exportRekordboxBtn) exportRekordboxBtn.disabled = false;
            exportCsvBtn.disabled = false;
            exportM3u8Btn.disabled = false;
        }

    } catch (err) {
        console.error("Folder processing failed:", err);
        folderBtn.disabled = false;
        folderBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Select Folder to Process`;
    } finally {
        isAnalyzing = false;
    }
}

function updateProgress(current, total) {
    const percentage = total === 0 ? 0 : (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `Analysing ${current} of ${total} files...`;
}

async function processBatchFile(fileHandle, outDirHandle, workerIndex) {
    const rowId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = 'track-row';
    tr.innerHTML = `
        <td class="track-name" title="${fileHandle.name}">${fileHandle.name}</td>
        <td class="new-name" title="-">-</td>
        <td class="bpm-value">-</td>
        <td>
            <span class="badge" style="background-color: var(--border-colour); color: var(--text-main);">-</span>
            <span class="match-indicator">Match</span>
        </td>
        <td class="energy-value">-</td>
        <td class="genre-value">-</td>
        <td class="tags-value">-</td>
        <td class="status loading">Analysing...</td>
        <td class="action-cell">-</td>
    `;
    resultsBody.appendChild(tr);

    try {
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        // Parse existing ID3 tags from input file
        const parsedTags = parseID3TagsFromBuffer(arrayBuffer);
        const genre = parsedTags.genre || "Unknown";
        
        // Decode audio data for client-side DSP analysis
        const audioBufferCopy = arrayBuffer.slice(0); 
        const decodedAudio = await audioContext.decodeAudioData(audioBufferCopy);
        const channelData = decodedAudio.getChannelData(0);
        
        // Run full Web Worker DSP analysis (Key, BPM, Energy, Mood, Vibes, Instruments)
        const dspResult = await analyseInWorker(channelData, decodedAudio.sampleRate, workerIndex);
        if (!dspResult.success) throw new Error(dspResult.error);
        
        const result = {
            success: true,
            camelotCode: dspResult.camelotCode,
            keyText: dspResult.keyText,
            bpm: dspResult.bpm
        };
        const energyLevel = dspResult.energyLevel || calculateEnergyLevel(channelData);
        const performanceTags = dspResult.tags || [];
        const groupingStr = dspResult.grouping || `Energy ${energyLevel}`;
        const commentsStr = dspResult.comments || performanceTags.join(", ");
        const genreVal = dspResult.genre || (genre !== "Unknown" ? genre : "House");
        const beatOffset = locateBeatGrid(channelData, decodedAudio.sampleRate, result.bpm);

        const format = notationSelect.value;
        const chosenKey = formatKey(result.camelotCode, result.keyText, format);
        
        // Determine saved filename based on the Rename Filename option
        const energyStr = (energyLevel !== '--') ? `${energyLevel} - ` : '';
        const cleanFilename = stripKeyPrefix(file.name);
        const savedFilename = optFilename.checked ? `${chosenKey} - ${energyStr}${cleanFilename}` : file.name;

        // Clean duplicate processed files in Processed_Tracks if filename changed
        const cleanFile = stripKeyPrefix(file.name);
        try {
            for await (const entry of outDirHandle.values()) {
                if (entry.kind === 'file') {
                    const cleanEntry = stripKeyPrefix(entry.name);
                    if (cleanEntry === cleanFile && entry.name !== savedFilename) {
                        await outDirHandle.removeEntry(entry.name);
                    }
                }
            }
        } catch (e) {
            console.error("Error cleaning duplicate entries:", e);
        }

        // Write ID3 tags (TKEY Camelot code, TBPM, TIT1 Grouping, COMM Comments, TCON Genre, TIT2 Title)
        let outputBuffer = arrayBuffer;
        if (optTitle.checked || optTags.checked) {
            const titleKeyPrefix = `${chosenKey}${energyLevel !== '--' ? ` - ${energyLevel}` : ''}`;
            outputBuffer = updateID3Tags(arrayBuffer, result.camelotCode, result.bpm, {
                prependTitle: optTitle.checked,
                titleKeyPrefix: titleKeyPrefix,
                writeTags: optTags.checked,
                grouping: groupingStr,
                comments: commentsStr,
                genre: genreVal
            }, file.name);
        }

        const savedFile = new File([outputBuffer], savedFilename, { type: file.type });
        const newFileHandle = await outDirHandle.getFileHandle(savedFilename, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(outputBuffer);
        await writable.close();

        fileRegistry[rowId] = savedFile;

        exportData.push({
            originalName: file.name,
            newName: savedFilename,
            bpm: result.bpm,
            key: result.camelotCode,
            keyText: result.keyText,
            energy: energyLevel,
            genre: genreVal,
            rating: dspResult.rating || 3,
            tuningHz: dspResult.tuningHz || 440.0,
            tuningCents: dspResult.tuningCents || 0,
            cues: dspResult.cues || [],
            tags: performanceTags,
            grouping: groupingStr,
            comments: commentsStr,
            beatOffset: dspResult.beatOffset || beatOffset,
            fileObject: savedFile,
            rowId: rowId
        });

        const trackIndex = exportData.length - 1;
        const badgeColour = result.camelotCode !== "Unknown" ? `var(--cam-${result.camelotCode.toLowerCase()})` : "var(--border-colour)";

        tr.setAttribute('data-key', result.camelotCode);
        tr.setAttribute('data-key-text', result.keyText);
        tr.setAttribute('data-bpm', result.bpm);
        tr.setAttribute('data-energy', energyLevel);
        tr.setAttribute('data-genre', genreVal);
        tr.setAttribute('data-tags', commentsStr || performanceTags.join(', '));
        tr.classList.add('ready');

        const newNameEl = document.querySelector(`#${rowId} .new-name`);
        newNameEl.textContent = savedFilename;
        newNameEl.setAttribute('title', savedFilename);

        const bpmEl = document.querySelector(`#${rowId} .bpm-value`);
        if (bpmEl) {
            bpmEl.innerHTML = `
                <div class="bpm-container">
                    <span class="bpm-num">${result.bpm}</span>
                    <div class="bpm-multiplier-btns">
                        <button class="bpm-btn btn-bpm-double" title="Double BPM (x2)" data-row="${rowId}">2×</button>
                        <button class="bpm-btn btn-bpm-half" title="Halve BPM (/2)" data-row="${rowId}">½</button>
                    </div>
                </div>
            `;
            
            bpmEl.querySelector('.btn-bpm-double').addEventListener('click', (e) => {
                e.stopPropagation();
                adjustTrackBpm(rowId, 2.0);
            });
            
            bpmEl.querySelector('.btn-bpm-half').addEventListener('click', (e) => {
                e.stopPropagation();
                adjustTrackBpm(rowId, 0.5);
            });
        }

        document.querySelector(`#${rowId} .energy-value`).innerHTML = getEnergyBarHtml(energyLevel);

        const genreEl = document.querySelector(`#${rowId} .genre-value`);
        genreEl.textContent = genreVal;
        genreEl.setAttribute('title', genreVal);

        const tagsEl = document.querySelector(`#${rowId} .tags-value`);
        if (tagsEl) {
            tagsEl.innerHTML = renderTagBadgesHtml(performanceTags);
        }
        
        const badge = document.querySelector(`#${rowId} .badge`);
        badge.textContent = chosenKey;
        badge.style.backgroundColor = badgeColour;
        badge.style.color = '#000';

        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = 'Saved';
        status.className = 'status complete';

        const actionCell = document.querySelector(`#${rowId} .action-cell`);
        if (actionCell) {
            actionCell.innerHTML = `
                <button class="action-icon-btn add-to-setlist-btn" data-index="${trackIndex}" title="Add to Setlist Timeline">
                    + Setlist
                </button>
            `;
            actionCell.querySelector('.add-to-setlist-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                addTrackToSetlist(trackIndex);
                
                const btn = e.currentTarget;
                const originalText = btn.textContent;
                btn.textContent = 'Added ✔';
                btn.style.color = 'var(--match-colour)';
                btn.style.borderColor = 'var(--match-colour)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.color = '';
                    btn.style.borderColor = '';
                }, 1000);
            });
        }

    } catch (error) {
        console.error(`Error processing ${fileHandle.name}:`, error);
        const status = document.querySelector(`#${rowId} .status`);
        status.textContent = 'Error';
        status.className = 'status error';
    }
}

function adjustTrackBpm(rowId, multiplier) {
    const tr = document.getElementById(rowId);
    if (!tr) return;
    
    const bpmNumEl = tr.querySelector('.bpm-num');
    const currentBpm = parseFloat(tr.getAttribute('data-bpm')) || (bpmNumEl ? parseFloat(bpmNumEl.textContent) : 0);
    if (!currentBpm || currentBpm <= 0) return;
    
    const newBpm = parseFloat((currentBpm * multiplier).toFixed(2));
    if (bpmNumEl) bpmNumEl.textContent = newBpm.toFixed(2);
    tr.setAttribute('data-bpm', newBpm);
    
    const track = exportData.find(d => d.rowId === rowId);
    if (track) {
        track.bpm = newBpm;
        
        if (track.fileObject) {
            track.fileObject.arrayBuffer().then(buf => {
                const updatedBuf = updateID3Tags(buf, track.key, newBpm, {
                    prependTitle: optTitle.checked,
                    titleKeyPrefix: `${formatKey(track.key, track.keyText, notationSelect.value)}${track.energy !== '--' ? ` - ${track.energy}` : ''}`,
                    writeTags: optTags.checked,
                    grouping: track.grouping,
                    comments: track.comments,
                    genre: track.genre
                }, track.originalName);
                
                const updatedFile = new File([updatedBuf], track.newName, { type: track.fileObject.type });
                fileRegistry[rowId] = updatedFile;
                track.fileObject = updatedFile;
            }).catch(e => console.error("Error updating ID3 with new BPM:", e));
        }
    }
    
    if (typeof currentLoadedRowId !== 'undefined' && currentLoadedRowId === rowId) {
        const playerBpmEl = document.getElementById('player-bpm');
        if (playerBpmEl) playerBpmEl.textContent = `${newBpm.toFixed(2)} BPM`;
    }
}

const camelotToStandard = {
    "8B": "C Major",  "5A": "C Minor", "3B": "C# Major", "12A": "C# Minor",
    "10B": "D Major", "7A": "D Minor", "5B": "D# Major", "2A": "D# Minor",
    "12B": "E Major", "9A": "E Minor", "7B": "F Major",  "4A": "F Minor",
    "2B": "F# Major", "11A": "F# Minor", "9B": "G Major",  "6A": "G Minor",
    "4B": "G# Major", "1A": "G# Minor", "11B": "A Major", "8A": "A Minor",
    "6B": "A# Major", "3A": "A# Minor", "1B": "B Major",  "10A": "B Minor"
};

const standardToCamelot = {};
for (const [cam, std] of Object.entries(camelotToStandard)) {
    standardToCamelot[std] = cam;
}

function resolveKey(keyString) {
    if (!keyString) return null;
    let clean = keyString.trim().replace(/\0+$/, '');
    if (!clean) return null;
    
    // Check direct Camelot format anywhere in string (e.g. "8A", "11B", "8A - 7", "8A/12A")
    const camelotMatch = clean.match(/\b([1-9]|1[0-2])([ABab])\b/);
    if (camelotMatch) {
        const num = camelotMatch[1];
        const letter = camelotMatch[2].toUpperCase();
        const code = num + letter;
        if (camelotToStandard[code]) {
            return {
                camelotCode: code,
                keyText: camelotToStandard[code]
            };
        }
    }
    
    // Normalize string for standard key lookup
    let normalized = clean.toLowerCase()
        .replace(/[-\/].*$/, '') // Remove secondary hyphen or slash parts
        .replace(/\s+/g, ' ')
        .trim();
        
    const stdLookup = {
        "c": "C Major", "c maj": "C Major", "c major": "C Major",
        "cm": "C Minor", "c min": "C Minor", "c minor": "C Minor", "cmin": "C Minor", "cminor": "C Minor",
        
        "c#": "C# Major", "c# maj": "C# Major", "c# major": "C# Major", "db": "C# Major", "db maj": "C# Major", "db major": "C# Major",
        "c#m": "C# Minor", "c# min": "C# Minor", "c# minor": "C# Minor", "c#min": "C# Minor", "dbm": "C# Minor", "db min": "C# Minor", "db minor": "C# Minor",
        
        "d": "D Major", "d maj": "D Major", "d major": "D Major",
        "dm": "D Minor", "d min": "D Minor", "d minor": "D Minor", "dmin": "D Minor", "dminor": "D Minor",
        
        "d#": "D# Major", "d# maj": "D# Major", "d# major": "D# Major", "eb": "D# Major", "eb maj": "D# Major", "eb major": "D# Major",
        "d#m": "D# Minor", "d# min": "D# Minor", "d# minor": "D# Minor", "d#min": "D# Minor", "ebm": "D# Minor", "eb min": "D# Minor", "eb minor": "D# Minor",
        
        "e": "E Major", "e maj": "E Major", "e major": "E Major",
        "em": "E Minor", "e min": "E Minor", "e minor": "E Minor", "emin": "E Minor", "eminor": "E Minor",
        
        "f": "F Major", "f maj": "F Major", "f major": "F Major",
        "fm": "F Minor", "f min": "F Minor", "f minor": "F Minor", "fmin": "F Minor", "fminor": "F Minor",
        
        "f#": "F# Major", "f# maj": "F# Major", "f# major": "F# Major", "gb": "F# Major", "gb maj": "F# Major", "gb major": "F# Major",
        "f#m": "F# Minor", "f# min": "F# Minor", "f# minor": "F# Minor", "f#min": "F# Minor", "gbm": "F# Minor", "gb min": "F# Minor", "gb minor": "F# Minor",
        
        "g": "G Major", "g maj": "G Major", "g major": "G Major",
        "gm": "G Minor", "g min": "G Minor", "g minor": "G Minor", "gmin": "G Minor", "gminor": "G Minor",
        
        "g#": "G# Major", "g# maj": "G# Major", "g# major": "G# Major", "ab": "G# Major", "ab maj": "G# Major", "ab major": "G# Major",
        "g#m": "G# Minor", "g# min": "G# Minor", "g# minor": "G# Minor", "g#min": "G# Minor", "abm": "G# Minor", "ab min": "G# Minor", "ab minor": "G# Minor",
        
        "a": "A Major", "a maj": "A Major", "a major": "A Major",
        "am": "A Minor", "a min": "A Minor", "a minor": "A Minor", "amin": "A Minor", "aminor": "A Minor",
        
        "a#": "A# Major", "a# maj": "A# Major", "a# major": "A# Major", "bb": "A# Major", "bb maj": "A# Major", "bb major": "A# Major",
        "a#m": "A# Minor", "a# min": "A# Minor", "a# minor": "A# Minor", "a#min": "A# Minor", "bbm": "A# Minor", "bb min": "A# Minor", "bb minor": "A# Minor",
        
        "b": "B Major", "b maj": "B Major", "b major": "B Major",
        "bm": "B Minor", "b min": "B Minor", "b minor": "B Minor", "bmin": "B Minor", "bminor": "B Minor"
    };
    
    if (stdLookup[normalized]) {
        const resolvedStd = stdLookup[normalized];
        return {
            camelotCode: standardToCamelot[resolvedStd],
            keyText: resolvedStd
        };
    }
    
    return null;
}

// Custom native ID3v2 parser to extract TCON (Genre), TKEY (Key), TBPM (BPM), and TIT2 (Title)
function parseID3TagsFromBuffer(arrayBuffer) {
    const tags = { genre: "Unknown", key: null, bpm: null, title: null, grouping: null, comments: null };
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8[0] !== 0x49 || uint8[1] !== 0x44 || uint8[2] !== 0x33) {
        return tags;
    }
    
    const majorVersion = uint8[3];
    const flags = uint8[5];
    const tagSize = ((uint8[6] & 0x7F) << 21) | 
                    ((uint8[7] & 0x7F) << 14) | 
                    ((uint8[8] & 0x7F) << 7) | 
                    (uint8[9] & 0x7F);
                    
    let offset = 10;
    if (flags & 0x40) {
        const extHeaderSize = ((uint8[offset] & 0x7F) << 21) | 
                              ((uint8[offset+1] & 0x7F) << 14) | 
                              ((uint8[offset+2] & 0x7F) << 7) | 
                              (uint8[offset+3] & 0x7F);
        offset += 4 + extHeaderSize;
    }
    
    const endOfTags = 10 + tagSize;
    const genresList = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz", "Acid Punk", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychadelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Jazz", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock", "Drum Solo", "Acapella", "Euro-House", "Dance Hall"];

    while (offset + 10 <= endOfTags) {
        const frameId = String.fromCharCode(uint8[offset], uint8[offset+1], uint8[offset+2], uint8[offset+3]);
        if (uint8[offset] === 0) break;
        
        let frameSize = 0;
        if (majorVersion === 3) {
            frameSize = (uint8[offset+4] << 24) | (uint8[offset+5] << 16) | (uint8[offset+6] << 8) | uint8[offset+7];
        } else if (majorVersion === 4) {
            frameSize = ((uint8[offset+4] & 0x7F) << 21) | ((uint8[offset+5] & 0x7F) << 14) | ((uint8[offset+6] & 0x7F) << 7) | (uint8[offset+7] & 0x7F);
        } else {
            break;
        }
        
        if (frameSize <= 0) break;
        const totalFrameSize = 10 + frameSize;
        if (offset + totalFrameSize > endOfTags) break;
        
        if (frameId === 'TCON') {
            let genreVal = decodeTextFrame(uint8, offset, frameSize);
            const match = genreVal.match(/^\((\d+)\)$/);
            if (match) {
                const id = parseInt(match[1], 10);
                if (id >= 0 && id < genresList.length) {
                    genreVal = genresList[id];
                }
            }
            tags.genre = genreVal || "Unknown";
        } else if (frameId === 'TKEY') {
            tags.key = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'TBPM') {
            tags.bpm = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'TIT2') {
            tags.title = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'TIT1') {
            tags.grouping = decodeTextFrame(uint8, offset, frameSize);
        } else if (frameId === 'COMM') {
            const commText = decodeTextFrame(uint8, offset + 4, frameSize > 4 ? frameSize - 4 : frameSize);
            tags.comments = commText;
        }
        
        offset += totalFrameSize;
    }
    return tags;
}

// Custom native ID3v2 frame-preserving editor
function decodeTextFrame(uint8, offset, frameSize) {
    const encoding = uint8[offset + 10];
    const textBytes = uint8.subarray(offset + 11, offset + 10 + frameSize);
    let text = "";
    try {
        if (encoding === 0) {
            text = String.fromCharCode.apply(null, textBytes);
        } else if (encoding === 1) {
            text = new TextDecoder('utf-16').decode(textBytes);
        } else if (encoding === 2) {
            text = new TextDecoder('utf-16be').decode(textBytes);
        } else if (encoding === 3) {
            text = new TextDecoder('utf-8').decode(textBytes);
        }
    } catch (e) {
        text = "";
    }
    return text.replace(/\0+$/, '').trim();
}

function encodeText(str, majorVersion) {
    let isAscii = true;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) {
            isAscii = false;
            break;
        }
    }
    
    if (majorVersion === 4) {
        return {
            encoding: 3, // UTF-8
            bytes: new TextEncoder().encode(str)
        };
    } else {
        if (isAscii) {
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                bytes[i] = str.charCodeAt(i);
            }
            return { encoding: 0, bytes }; // Latin-1
        } else {
            const bytes = new Uint8Array(2 + str.length * 2);
            bytes[0] = 0xFF; // BOM LE
            bytes[1] = 0xFE;
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                bytes[2 + i * 2] = code & 0xFF;
                bytes[2 + i * 2 + 1] = (code >> 8) & 0xFF;
            }
            return { encoding: 1, bytes }; // UTF-16 with BOM
        }
    }
}

function createTextFrame(id, text, majorVersion = 3) {
    const encoded = encodeText(text, majorVersion);
    const frameSize = 1 + encoded.bytes.length; // 1 byte encoding + text bytes
    const frameData = new Uint8Array(10 + frameSize);
    
    frameData[0] = id.charCodeAt(0);
    frameData[1] = id.charCodeAt(1);
    frameData[2] = id.charCodeAt(2);
    frameData[3] = id.charCodeAt(3);
    
    if (majorVersion === 4) {
        // Syncsafe integer for ID3v2.4
        frameData[4] = (frameSize >> 21) & 0x7F;
        frameData[5] = (frameSize >> 14) & 0x7F;
        frameData[6] = (frameSize >> 7) & 0x7F;
        frameData[7] = frameSize & 0x7F;
    } else {
        // Standard 32-bit big endian for ID3v2.3
        frameData[4] = (frameSize >> 24) & 0xFF;
        frameData[5] = (frameSize >> 16) & 0xFF;
        frameData[6] = (frameSize >> 8) & 0xFF;
        frameData[7] = frameSize & 0xFF;
    }
    
    frameData[8] = 0;
    frameData[9] = 0;
    frameData[10] = encoded.encoding;
    frameData.set(encoded.bytes, 11);
    
    return frameData;
}
function createCommentFrame(text, majorVersion = 3) {
    if (!text) return null;
    const lang = [0x65, 0x6E, 0x67]; // "eng"
    const isAscii = /^[\x00-\x7F]*$/.test(text);
    const encoding = (majorVersion === 4) ? 3 : (isAscii ? 0 : 1);
    
    let textBytes;
    if (encoding === 3) {
        textBytes = new TextEncoder().encode(text);
    } else if (encoding === 0) {
        textBytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) textBytes[i] = text.charCodeAt(i);
    } else {
        textBytes = new Uint8Array(2 + text.length * 2);
        textBytes[0] = 0xFF; textBytes[1] = 0xFE; // BOM LE
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            textBytes[2 + i * 2] = code & 0xFF;
            textBytes[2 + i * 2 + 1] = (code >> 8) & 0xFF;
        }
    }
    
    const descTermLen = (encoding === 1) ? 2 : 1;
    const payloadSize = 1 + 3 + descTermLen + textBytes.length;
    const frameData = new Uint8Array(10 + payloadSize);
    
    frameData[0] = 0x43; frameData[1] = 0x4F; frameData[2] = 0x4D; frameData[3] = 0x4D; // COMM
    
    if (majorVersion === 4) {
        frameData[4] = (payloadSize >> 21) & 0x7F;
        frameData[5] = (payloadSize >> 14) & 0x7F;
        frameData[6] = (payloadSize >> 7) & 0x7F;
        frameData[7] = payloadSize & 0x7F;
    } else {
        frameData[4] = (payloadSize >> 24) & 0xFF;
        frameData[5] = (payloadSize >> 16) & 0xFF;
        frameData[6] = (payloadSize >> 8) & 0xFF;
        frameData[7] = payloadSize & 0xFF;
    }
    
    frameData[8] = 0; frameData[9] = 0;
    frameData[10] = encoding;
    frameData[11] = lang[0]; frameData[12] = lang[1]; frameData[13] = lang[2];
    
    let writeIdx = 14 + descTermLen;
    frameData.set(textBytes, writeIdx);
    
    return frameData;
}

function renderTagBadgesHtml(tags) {
    if (!tags || (Array.isArray(tags) && tags.length === 0)) return '<span style="color: var(--text-muted);">-</span>';
    const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length === 0) return '<span style="color: var(--text-muted);">-</span>';
    const badgesHtml = tagList.map(tag => `<span class="tag-badge" title="${tag}">${tag}</span>`).join('');
    return `<div class="tags-container">${badgesHtml}</div>`;
}

function stripKeyPrefix(title) {
    const regex = /^(\d{1,2}[ABab]|[A-G]#?b?(?:\s*(?:Major|Minor|maj|min|m|M)))(?:\s*-\s*\d{1,2})?\s*-\s*/i;
    return title.replace(regex, '');
}

function updateID3Tags(arrayBuffer, camelotCode, bpm, options, fallbackFilename) {
    const uint8 = new Uint8Array(arrayBuffer);
    
    // Check for ID3 header
    if (uint8[0] !== 0x49 || uint8[1] !== 0x44 || uint8[2] !== 0x33) {
        if (!options.writeTags && !options.prependTitle) {
            return arrayBuffer;
        }
        return createMinimalID3Tag(arrayBuffer, camelotCode, bpm, options, fallbackFilename);
    }
    
    const majorVersion = uint8[3];
    const revision = uint8[4];
    const flags = uint8[5];
    const tagSize = ((uint8[6] & 0x7F) << 21) | 
                    ((uint8[7] & 0x7F) << 14) | 
                    ((uint8[8] & 0x7F) << 7) | 
                    (uint8[9] & 0x7F);
                    
    let offset = 10;
    if (flags & 0x40) {
        const extHeaderSize = ((uint8[offset] & 0x7F) << 21) | 
                              ((uint8[offset+1] & 0x7F) << 14) | 
                              ((uint8[offset+2] & 0x7F) << 7) | 
                              (uint8[offset+3] & 0x7F);
        offset += 4 + extHeaderSize;
    }
    
    const preservedFrames = [];
    const newFrames = [];
    const endOfTags = 10 + tagSize;
    let foundTitle = false;
    
    while (offset + 10 <= endOfTags) {
        const frameId = String.fromCharCode(uint8[offset], uint8[offset+1], uint8[offset+2], uint8[offset+3]);
        if (uint8[offset] === 0) break; // Padding
        
        let frameSize = 0;
        if (majorVersion === 3) {
            frameSize = (uint8[offset+4] << 24) | (uint8[offset+5] << 16) | (uint8[offset+6] << 8) | uint8[offset+7];
        } else if (majorVersion === 4) {
            frameSize = ((uint8[offset+4] & 0x7F) << 21) | ((uint8[offset+5] & 0x7F) << 14) | ((uint8[offset+6] & 0x7F) << 7) | (uint8[offset+7] & 0x7F);
        } else {
            return arrayBuffer;
        }
        
        if (frameSize <= 0) break;
        
        const totalFrameSize = 10 + frameSize;
        if (offset + totalFrameSize > endOfTags) break;
        
        if (frameId === 'TKEY' || frameId === 'TBPM' || frameId === 'TIT1' || frameId === 'COMM') {
            if (options.writeTags) {
                offset += totalFrameSize;
                continue; // Skip so we can replace with new target values
            }
        }
        
        if (frameId === 'TIT2') {
            foundTitle = true;
            if (options.prependTitle) {
                const originalTitle = decodeTextFrame(uint8, offset, frameSize);
                const prefix = `${options.titleKeyPrefix || camelotCode} - `;
                const cleanTitle = stripKeyPrefix(originalTitle);
                const newTitle = prefix + cleanTitle;
                
                newFrames.push(createTextFrame('TIT2', newTitle, majorVersion));
                offset += totalFrameSize;
                continue;
            }
        }
        
        preservedFrames.push(uint8.subarray(offset, offset + totalFrameSize));
        offset += totalFrameSize;
    }
    
    // Add new TKEY, TBPM, TIT1 (Grouping), COMM (Comments) if writeTags is enabled
    if (options.writeTags) {
        if (camelotCode && camelotCode !== 'Unknown') {
            newFrames.push(createTextFrame('TKEY', camelotCode, majorVersion));
        }
        if (bpm && bpm !== 'Unknown') {
            newFrames.push(createTextFrame('TBPM', bpm.toString(), majorVersion));
        }
        if (options.grouping) {
            newFrames.push(createTextFrame('TIT1', options.grouping, majorVersion));
        }
        if (options.comments) {
            const commFrame = createCommentFrame(options.comments, majorVersion);
            if (commFrame) newFrames.push(commFrame);
        }
    }
    
    // Add new TIT2 if not found and prependTitle is requested
    if (options.prependTitle && !foundTitle) {
        const cleanName = fallbackFilename.replace(/\.[^/.]+$/, "");
        newFrames.push(createTextFrame('TIT2', `${options.titleKeyPrefix || camelotCode} - ${cleanName}`, majorVersion));
    }
    
    let framesSizeSum = 0;
    preservedFrames.forEach(f => framesSizeSum += f.length);
    newFrames.forEach(f => framesSizeSum += f.length);
    
    const paddingSize = 1024;
    const newTagSize = framesSizeSum + paddingSize;
    
    const audioDataOffset = 10 + tagSize;
    const audioDataLength = uint8.length - audioDataOffset;
    
    const newFileBuffer = new Uint8Array(10 + newTagSize + audioDataLength);
    
    // Write Header
    newFileBuffer[0] = 0x49; // I
    newFileBuffer[1] = 0x44; // D
    newFileBuffer[2] = 0x33; // 3
    newFileBuffer[3] = majorVersion;
    newFileBuffer[4] = revision;
    newFileBuffer[5] = flags & ~0x40;
    
    newFileBuffer[6] = (newTagSize >> 21) & 0x7F;
    newFileBuffer[7] = (newTagSize >> 14) & 0x7F;
    newFileBuffer[8] = (newTagSize >> 7) & 0x7F;
    newFileBuffer[9] = newTagSize & 0x7F;
    
    let writeOffset = 10;
    
    preservedFrames.forEach(f => {
        newFileBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    newFrames.forEach(f => {
        newFileBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    for (let i = 0; i < paddingSize; i++) {
        newFileBuffer[writeOffset + i] = 0;
    }
    writeOffset += paddingSize;
    
    newFileBuffer.set(uint8.subarray(audioDataOffset), writeOffset);
    
    return newFileBuffer.buffer;
}

function createMinimalID3Tag(arrayBuffer, camelotCode, bpm, options, fallbackFilename) {
    const newFrames = [];
    if (options.prependTitle) {
        const cleanName = fallbackFilename.replace(/\.[^/.]+$/, "");
        newFrames.push(createTextFrame('TIT2', `${options.titleKeyPrefix || camelotCode} - ${cleanName}`, 3));
    }
    if (options.writeTags) {
        if (camelotCode && camelotCode !== 'Unknown') {
            newFrames.push(createTextFrame('TKEY', camelotCode, 3));
        }
        if (bpm && bpm !== 'Unknown') {
            newFrames.push(createTextFrame('TBPM', bpm.toString(), 3));
        }
        if (options.grouping) {
            newFrames.push(createTextFrame('TIT1', options.grouping, 3));
        }
        if (options.comments) {
            const commFrame = createCommentFrame(options.comments, 3);
            if (commFrame) newFrames.push(commFrame);
        }
    }
    
    let framesSizeSum = 0;
    newFrames.forEach(f => framesSizeSum += f.length);
    
    const paddingSize = 256;
    const tagSize = framesSizeSum + paddingSize;
    
    const uint8 = new Uint8Array(arrayBuffer);
    const newBuffer = new Uint8Array(10 + tagSize + uint8.length);
    
    newBuffer[0] = 0x49; newBuffer[1] = 0x44; newBuffer[2] = 0x33; // ID3
    newBuffer[3] = 3; newBuffer[4] = 0; newBuffer[5] = 0; // version 2.3.0
    
    newBuffer[6] = (tagSize >> 21) & 0x7F;
    newBuffer[7] = (tagSize >> 14) & 0x7F;
    newBuffer[8] = (tagSize >> 7) & 0x7F;
    newBuffer[9] = tagSize & 0x7F;
    
    let writeOffset = 10;
    newFrames.forEach(f => {
        newBuffer.set(f, writeOffset);
        writeOffset += f.length;
    });
    
    writeOffset += paddingSize;
    newBuffer.set(uint8, writeOffset);
    
    return newBuffer.buffer;
}


// Tab Close Protection
window.addEventListener('beforeunload', (e) => {
    if (isAnalyzing) {
        e.preventDefault();
        e.returnValue = 'Batch analysis is currently in progress. Are you sure you want to leave and lose progress?';
    }
});

// Drag and drop handlers
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!folderBtn.disabled) {
        document.body.classList.add('drag-over');
    }
});

window.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    if (folderBtn.disabled) return;
    
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
        const item = items[0];
        if (item.kind === 'file') {
            if (typeof item.getAsFileSystemHandle === 'function') {
                try {
                    const handle = await item.getAsFileSystemHandle();
                    if (handle.kind === 'directory') {
                        // Request readwrite permission
                        const opt = { mode: 'readwrite' };
                        if (await handle.queryPermission(opt) === 'granted' || await handle.requestPermission(opt) === 'granted') {
                            await startProcessingDirectory(handle);
                        }
                    } else {
                        alert("Please drop a folder, not individual files.");
                    }
                } catch (err) {
                    console.error("Error getting directory handle:", err);
                }
            } else {
                alert("This browser does not support drag and drop directory handles. Please click 'Select Folder to Process' instead.");
            }
        }
    }
});

// Inject Drag-over style dynamically
const dragOverStyle = document.createElement('style');
dragOverStyle.textContent = `
    body.drag-over {
        position: relative;
    }
    body.drag-over::after {
        content: "Drop Folder to Process";
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(13, 13, 18, 0.95);
        border: 4px dashed var(--accent-colour);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        font-weight: 800;
        color: var(--accent-colour);
        z-index: 9999;
        pointer-events: none;
        box-sizing: border-box;
    }
`;
document.head.appendChild(dragOverStyle);

// Exports
if (exportRekordboxBtn) {
    exportRekordboxBtn.addEventListener('click', () => {
        if (exportData.length === 0) return;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<DJ_PLAYLISTS Version="1.0.0">\n`;
        xml += `  <PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>\n`;
        xml += `  <COLLECTION Entries="${exportData.length}">\n`;

        exportData.forEach((track, index) => {
            const trackId = index + 1;
            const name = (track.newName || track.originalName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const comments = (track.comments || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const grouping = (track.grouping || `Energy ${track.energy || 5}`).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const genre = (track.genre || 'House').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const key = track.key || '8A';
            const bpm = parseFloat(track.bpm) || 124.0;
            const beatOffset = track.beatOffset || 0.0;
            
            xml += `    <TRACK TrackID="${trackId}" Name="${name}" Artist="Unknown" AverageBpm="${bpm.toFixed(2)}" Tonality="${key}" Comments="${comments}" Grouping="${grouping}" Genre="${genre}" Location="Processed_Tracks/${name}">\n`;
            xml += `      <TEMPO Beginning="${beatOffset.toFixed(3)}" Bpm="${bpm.toFixed(2)}" Metro="4/4" Battito="1"/>\n`;
            
            if (track.cues && Array.isArray(track.cues)) {
                track.cues.forEach((cue, cueIdx) => {
                    const cueName = (cue.label || `Cue ${cueIdx+1}`).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    const cueTime = (cue.time || 0.0).toFixed(3);
                    xml += `      <POSITION_MARK Name="${cueName}" Type="0" Start="${cueTime}" Num="${cueIdx}" Red="0" Green="229" Blue="255"/>\n`;
                });
            }
            
            xml += `    </TRACK>\n`;
        });

        xml += `  </COLLECTION>\n`;
        xml += `  <PLAYLISTS>\n`;
        xml += `    <NODE Type="0" Name="ROOT">\n`;
        xml += `      <NODE Name="CreepyCrate DJ Collection" Type="1" KeyType="0" Entries="${exportData.length}">\n`;
        exportData.forEach((track, index) => {
            xml += `        <TRACK Key="${index + 1}"/>\n`;
        });
        xml += `      </NODE>\n`;
        xml += `    </NODE>\n`;
        xml += `  </PLAYLISTS>\n`;
        xml += `</DJ_PLAYLISTS>\n`;

        const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' });
        triggerDownload(blob, `CreepyCrate_Rekordbox_Collection_${Date.now()}.xml`);
    });
}

exportCsvBtn.addEventListener('click', () => {
    if (exportData.length === 0) return;
    
    const format = notationSelect.value;
    let csvContent = "Original Name,New Filename,BPM,Key,Energy,Genre,Performance Tags,Grouping\n";
    exportData.forEach(track => {
        const ogName = `"${track.originalName.replace(/"/g, '""')}"`;
        const newName = `"${track.newName.replace(/"/g, '""')}"`;
        const keyVal = formatKey(track.key, track.keyText, format);
        const energyVal = track.energy || '--';
        const genreVal = `"${(track.genre || "Unknown").replace(/"/g, '""')}"`;
        const tagsVal = `"${(track.comments || (track.tags ? track.tags.join(', ') : '')).replace(/"/g, '""')}"`;
        const groupVal = `"${(track.grouping || `Energy ${energyVal}`).replace(/"/g, '""')}"`;
        csvContent += `${ogName},${newName},${track.bpm},${keyVal},${energyVal},${genreVal},${tagsVal},${groupVal}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `CreepyCrate_Key_DJ_Setlist_${Date.now()}.csv`);
});

exportM3u8Btn.addEventListener('click', () => {
    if (exportData.length === 0) return;

    let m3u8Content = "#EXTM3U\n";
    exportData.forEach(track => {
        m3u8Content += `#EXTINF:-1,${track.newName.replace('.mp3', '')}\n`;
        m3u8Content += `Processed_Tracks/${track.newName}\n`; 
    });

    const blob = new Blob([m3u8Content], { type: 'application/x-mpegURL;charset=utf-8;' });
    triggerDownload(blob, `CreepyCrate_Key_DJ_Playlist_${Date.now()}.m3u8`);
});

function triggerDownload(blob, filename) {
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Next-Level Industry Features Helper Functions

// 1. Audio Energy Level Calculator (RMS-based)
function calculateEnergyLevel(channelData) {
    const len = channelData.length;
    // Fast-sample: read up to 100,000 points to keep execution sub-millisecond
    const sampleLimit = Math.min(len, 2000000);
    let sumSquares = 0;
    const step = Math.max(1, Math.floor(sampleLimit / 100000));
    let count = 0;
    
    for (let i = 0; i < sampleLimit; i += step) {
        const val = channelData[i];
        sumSquares += val * val;
        count++;
    }
    
    const rms = Math.sqrt(sumSquares / count);
    
    // Scale RMS from typical ranges [0.04, 0.28] to a [1, 10] energy integer
    const minRms = 0.04;
    const maxRms = 0.28;
    let energy = Math.round(((rms - minRms) / (maxRms - minRms)) * 9) + 1;
    energy = Math.max(1, Math.min(10, energy));
    return energy;
}

// 2. Styled Energy Flame Rating HTML
function getEnergyBarHtml(level) {
    if (level === '--' || isNaN(level)) return '<span style="color: var(--text-muted);">--</span>';
    
    let barColor = 'var(--accent-colour)'; // low (cyan)
    if (level >= 8) barColor = '#ff3d00'; // high (red-orange)
    else if (level >= 5) barColor = '#ffb300'; // medium (amber)
    
    let flames = '';
    const numFlames = Math.ceil(level / 2); // 1 to 5 flame symbols
    for (let i = 0; i < 5; i++) {
        if (i < numFlames) {
            flames += `<span style="color: ${barColor}; filter: drop-shadow(0 0 2px ${barColor});">🔥</span>`;
        } else {
            flames += '<span style="opacity: 0.12;">🔥</span>';
        }
    }
    
    return `<div class="energy-bar-container" title="Energy Level: ${level}/10">${flames}</div>`;
}

// 3. Render Responsive SVG Camelot Wheel
function renderCamelotWheel() {
    const container = document.getElementById('camelot-wheel-container');
    if (!container) return;
    
    const size = 270;
    const center = size / 2;
    const rOuter = size / 2 - 8;
    const rMiddle = size / 2 - 40;
    const rInner = size / 2 - 72;
    
    let svgHtml = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">`;
    
    // Sectors hours in traditional 12-hour wheel format starting from 12 o'clock (12B/12A, 1B/1A, etc.)
    const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    
    const getCoordinates = (percent) => {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    };
    
    for (let i = 0; i < 12; i++) {
        const hour = hours[i];
        // -0.25 percent shifts 0 degrees to 12 o'clock
        const startPercent = (i - 0.5) / 12 - 0.25;
        const endPercent = (i + 0.5) / 12 - 0.25;
        
        const [startXOuter, startYOuter] = getCoordinates(startPercent);
        const [endXOuter, endYOuter] = getCoordinates(endPercent);
        
        const [startXMiddle, startYMiddle] = getCoordinates(startPercent);
        const [endXMiddle, endYMiddle] = getCoordinates(endPercent);
        
        const [startXInner, startYInner] = getCoordinates(startPercent);
        const [endXInner, endYInner] = getCoordinates(endPercent);
        
        // Outer Ring Path (Major Keys - B)
        const pathB = [
            `M ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            `L ${center + startXOuter * rOuter} ${center + startYOuter * rOuter}`,
            `A ${rOuter} ${rOuter} 0 0 1 ${center + endXOuter * rOuter} ${center + endYOuter * rOuter}`,
            `L ${center + endXMiddle * rMiddle} ${center + endYMiddle * rMiddle}`,
            `A ${rMiddle} ${rMiddle} 0 0 0 ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            'Z'
        ].join(' ');
        
        // Inner Ring Path (Minor Keys - A)
        const pathA = [
            `M ${center + startXInner * rInner} ${center + startYInner * rInner}`,
            `L ${center + startXMiddle * rMiddle} ${center + startYMiddle * rMiddle}`,
            `A ${rMiddle} ${rMiddle} 0 0 1 ${center + endXMiddle * rMiddle} ${center + endYMiddle * rMiddle}`,
            `L ${center + endXInner * rInner} ${center + endYInner * rInner}`,
            `A ${rInner} ${rInner} 0 0 0 ${center + startXInner * rInner} ${center + startYInner * rInner}`,
            'Z'
        ].join(' ');
        
        const midPercent = i / 12 - 0.25;
        const [midX, midY] = getCoordinates(midPercent);
        const textB_R = (rOuter + rMiddle) / 2;
        const textA_R = (rMiddle + rInner) / 2;
        
        const keyB = `${hour}B`;
        const keyA = `${hour}A`;
        
        svgHtml += `
            <g class="wheel-group">
                <!-- B (Major) Outer Sector -->
                <path d="${pathB}" class="wheel-segment segment-b" data-key="${keyB}" fill="#161622" stroke="#222230" stroke-width="1.2" cursor="pointer">
                    <title>${keyB} (${camelotToStandard[keyB]})</title>
                </path>
                <text x="${center + midX * textB_R}" y="${center + midY * textB_R + 3.5}" fill="#9595aa" font-size="9.5" font-weight="700" text-anchor="middle" pointer-events="none">${keyB}</text>
                
                <!-- A (Minor) Inner Sector -->
                <path d="${pathA}" class="wheel-segment segment-a" data-key="${keyA}" fill="#111119" stroke="#222230" stroke-width="1.2" cursor="pointer">
                    <title>${keyA} (${camelotToStandard[keyA]})</title>
                </path>
                <text x="${center + midX * textA_R}" y="${center + midY * textA_R + 3.5}" fill="#78788c" font-size="9" font-weight="700" text-anchor="middle" pointer-events="none">${keyA}</text>
            </g>
        `;
    }
    
    // Add center display HUD
    svgHtml += `
        <circle cx="${center}" cy="${center}" r="${rInner}" fill="#0a0a0f" stroke="#222230" stroke-width="1.8" />
        <text x="${center}" y="${center - 4}" fill="var(--accent-colour)" font-size="11.5" font-weight="800" text-anchor="middle" letter-spacing="0.5px">HARMONIC</text>
        <text x="${center}" y="${center + 11}" fill="#78788c" font-size="9.5" font-weight="700" text-anchor="middle" letter-spacing="0.5px">HUD</text>
    `;
    
    svgHtml += '</svg>';
    container.innerHTML = svgHtml;
    
    // Bind segment click triggers
    container.querySelectorAll('.wheel-segment').forEach(seg => {
        seg.addEventListener('click', (e) => {
            const key = e.target.getAttribute('data-key');
            toggleKeyFilter(key);
        });
    });
}

// 4. Highlight Key and Compatible Sectors on Wheel
function highlightKeyOnWheel(camelotCode) {
    document.querySelectorAll('.wheel-segment').forEach(seg => {
        seg.classList.remove('selected', 'compatible');
        seg.style.fill = '';
        seg.style.fillOpacity = '';
        seg.style.filter = '';
        seg.style.stroke = '';
    });
    
    if (!camelotCode || camelotCode === 'Unknown') return;
    
    const target = document.querySelector(`.wheel-segment[data-key="${camelotCode}"]`);
    if (target) {
        target.classList.add('selected');
        const color = `var(--cam-${camelotCode.toLowerCase()})`;
        target.style.fill = color;
        target.style.filter = `drop-shadow(0 0 5px ${color})`;
        target.style.stroke = '#ffffff';
    }
    
    const compatible = getCompatibleKeys(camelotCode);
    compatible.forEach(key => {
        if (key === camelotCode) return;
        const compSeg = document.querySelector(`.wheel-segment[data-key="${key}"]`);
        if (compSeg) {
            compSeg.classList.add('compatible');
            const color = `var(--cam-${key.toLowerCase()})`;
            compSeg.style.fill = color;
            compSeg.style.fillOpacity = '0.35';
            compSeg.style.stroke = color;
        }
    });
}

// 5. Toggle List Key Filter via Wheel segments
let activeFilterKey = null;
function toggleKeyFilter(key) {
    const tableRows = document.querySelectorAll('tr.track-row.ready');
    const container = document.getElementById('camelot-wheel-container');
    const textCenter = container.querySelector('text[fill="var(--accent-colour)"]');
    const textSub = container.querySelector('text[fill="#78788c"]');
    
    if (activeFilterKey === key) {
        activeFilterKey = null;
        tableRows.forEach(r => r.style.display = '');
        highlightKeyOnWheel(null);
        if (textCenter) textCenter.textContent = "HARMONIC";
        if (textSub) textSub.textContent = "HUD";
    } else {
        activeFilterKey = key;
        const compatibles = [key, ...getCompatibleKeys(key)];
        tableRows.forEach(r => {
            const rowKey = r.getAttribute('data-key');
            r.style.display = compatibles.includes(rowKey) ? '' : 'none';
        });
        highlightKeyOnWheel(key);
        if (textCenter) textCenter.textContent = key;
        if (textSub) textSub.textContent = "FILTER ON";
    }
}

// 6. Header Column Sorting Setup
let sortCol = null;
let sortAsc = true;
function setupSorting() {
    document.querySelectorAll('th.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (sortCol === col) {
                if (sortAsc) {
                    sortAsc = false;
                } else {
                    sortCol = null;
                }
            } else {
                sortCol = col;
                sortAsc = true;
            }
            updateSortIndicators();
            sortTable();
        });
    });
}

function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(header => {
        const col = header.getAttribute('data-col');
        const icon = header.querySelector('.sort-icon');
        if (col === sortCol) {
            icon.textContent = sortAsc ? ' ▲' : ' ▼';
            header.classList.add('active-sort');
        } else {
            icon.textContent = '';
            header.classList.remove('active-sort');
        }
    });
}

function sortTable() {
    const tbody = document.getElementById('results-body');
    const rows = Array.from(tbody.querySelectorAll('tr.track-row'));
    
    if (!sortCol) {
        // Fallback to original insertion order
        rows.sort((a, b) => {
            return parseInt(a.id.split('-')[2]) - parseInt(b.id.split('-')[2]);
        });
    } else {
        rows.sort((a, b) => {
            let valA, valB;
            
            if (sortCol === 'originalName') {
                valA = a.querySelector('.track-name').textContent.toLowerCase();
                valB = b.querySelector('.track-name').textContent.toLowerCase();
            } else if (sortCol === 'newName') {
                valA = a.querySelector('.new-name').textContent.toLowerCase();
                valB = b.querySelector('.new-name').textContent.toLowerCase();
            } else if (sortCol === 'bpm') {
                valA = parseFloat(a.getAttribute('data-bpm')) || 0;
                valB = parseFloat(b.getAttribute('data-bpm')) || 0;
            } else if (sortCol === 'key') {
                valA = getKeySortOrder(a.getAttribute('data-key'));
                valB = getKeySortOrder(b.getAttribute('data-key'));
            } else if (sortCol === 'energy') {
                valA = parseInt(a.getAttribute('data-energy')) || 0;
                valB = parseInt(b.getAttribute('data-energy')) || 0;
            } else if (sortCol === 'genre') {
                valA = (a.getAttribute('data-genre') || '').toLowerCase();
                valB = (b.getAttribute('data-genre') || '').toLowerCase();
            } else if (sortCol === 'tags') {
                valA = (a.getAttribute('data-tags') || '').toLowerCase();
                valB = (b.getAttribute('data-tags') || '').toLowerCase();
            } else if (sortCol === 'status') {
                valA = a.querySelector('.status').textContent.toLowerCase();
                valB = b.querySelector('.status').textContent.toLowerCase();
            }
            
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    }
    
    rows.forEach(row => tbody.appendChild(row));
}

function getKeySortOrder(camelotCode) {
    if (!camelotCode || camelotCode === 'Unknown') return 999;
    const match = camelotCode.match(/^(\d+)([AB])$/);
    if (!match) return 999;
    
    const num = parseInt(match[1], 10);
    const ring = match[2];
    return (ring === 'A' ? 0 : 12) + num;
}

// 7. Beatgrid phase offset detection logic
function locateBeatGrid(channelData, sampleRate, bpm) {
    if (!bpm || bpm === 'Unknown' || isNaN(bpm)) return 0;
    const beatIntervalSamples = (60 / bpm) * sampleRate;
    
    // Process the first 45 seconds of the audio
    const searchSeconds = 45;
    const searchLimit = Math.min(channelData.length, sampleRate * searchSeconds);
    
    // 150 Hz Low-Pass Filter for isolating kicks
    const lpCutoff = 150;
    const lpRc = 1 / (2 * Math.PI * lpCutoff);
    const lpAlpha = 1 / (lpRc * sampleRate + 1);
    
    // 15 Hz Low-Pass Filter for envelope smoothing
    const envCutoff = 15;
    const envRc = 1 / (2 * Math.PI * envCutoff);
    const lpAlphaEnv = 1 / (envRc * sampleRate + 1);
    
    let lpState = 0;
    let envState = 0;
    
    const stepSize = 64; // ~1.45ms resolution at 44.1kHz
    const fluxLength = Math.floor(searchLimit / stepSize);
    const flux = new Float32Array(fluxLength);
    
    let prevEnvValue = 0;
    
    for (let i = 0; i < fluxLength; i++) {
        const blockStart = i * stepSize;
        const blockEnd = blockStart + stepSize;
        for (let j = blockStart; j < blockEnd; j++) {
            const x = channelData[j];
            // 150 Hz LPF
            lpState = lpState + lpAlpha * (x - lpState);
            // Rectify and 15 Hz Envelope LPF
            const rectified = Math.abs(lpState);
            envState = envState + lpAlphaEnv * (rectified - envState);
        }
        
        // Compute temporal flux
        const currentEnvValue = envState;
        flux[i] = Math.max(0, currentEnvValue - prevEnvValue);
        prevEnvValue = currentEnvValue;
    }
    
    // Find peak flux to identify active beat level
    let maxFlux = 0;
    for (let i = 0; i < fluxLength; i++) {
        if (flux[i] > maxFlux) maxFlux = flux[i];
    }
    
    // Skip silent/ambient intro by locating the first block exceeding 15% of maxFlux
    let startBlock = 0;
    for (let i = 0; i < fluxLength; i++) {
        if (flux[i] > 0.15 * maxFlux) {
            startBlock = i;
            break;
        }
    }
    
    // Phase search setup
    const beatIntervalBlocks = beatIntervalSamples / stepSize;
    let bestOffsetBlocks = 0;
    let maxScore = -1;
    
    const numCandidates = 500;
    const numBeatsToSum = 32;
    
    // Interpolated lookup for precise candidate scoring
    function getInterpolatedFlux(index) {
        if (index < 0 || index >= fluxLength - 1) return 0;
        const base = Math.floor(index);
        const frac = index - base;
        return flux[base] * (1 - frac) + flux[base + 1] * frac;
    }
    
    for (let c = 0; c < numCandidates; c++) {
        const offsetBlocks = (c / numCandidates) * beatIntervalBlocks;
        let score = 0;
        
        // Find the first beat index starting at or after the detected startBlock
        const startK = Math.ceil((startBlock - offsetBlocks) / beatIntervalBlocks);
        
        for (let k = 0; k < numBeatsToSum; k++) {
            const blockIdx = offsetBlocks + (startK + k) * beatIntervalBlocks;
            if (blockIdx < fluxLength) {
                score += getInterpolatedFlux(blockIdx);
            }
        }
        
        if (score > maxScore) {
            maxScore = score;
            bestOffsetBlocks = offsetBlocks;
        }
    }
    
    const bestOffsetSamples = bestOffsetBlocks * stepSize;
    return bestOffsetSamples / sampleRate;
}

// Toggle Key Wheel Drawer
const btnToggleWheel = document.getElementById('btn-toggle-wheel');
const btnCloseWheel = document.getElementById('btn-close-wheel');
const wheelDrawerOverlay = document.getElementById('wheel-drawer-overlay');

if (btnToggleWheel && btnCloseWheel && wheelDrawerOverlay) {
    btnToggleWheel.addEventListener('click', () => {
        wheelDrawerOverlay.classList.add('active');
    });

    btnCloseWheel.addEventListener('click', () => {
        wheelDrawerOverlay.classList.remove('active');
    });

    wheelDrawerOverlay.addEventListener('click', (e) => {
        if (e.target === wheelDrawerOverlay) {
            wheelDrawerOverlay.classList.remove('active');
        }
    });
}

// 8. View switching tab listeners
const btnViewCrate = document.getElementById('btn-view-crate');
const btnViewSetlist = document.getElementById('btn-view-setlist');
const crateView = document.getElementById('crate-view');
const setlistView = document.getElementById('setlist-view');

if (btnViewCrate && btnViewSetlist) {
    btnViewCrate.addEventListener('click', () => {
        btnViewCrate.classList.add('active');
        btnViewSetlist.classList.remove('active');
        crateView.style.display = 'flex';
        setlistView.style.display = 'none';
    });

    btnViewSetlist.addEventListener('click', () => {
        btnViewSetlist.classList.add('active');
        btnViewCrate.classList.remove('active');
        setlistView.style.display = 'flex';
        crateView.style.display = 'none';
        
        if (wavesurfer) wavesurfer.pause();
        
        populateSidebarGenres();
        renderSetlistSidebar();
        renderSetlistTimeline();
    });
}

// 9. Setlist Flow & Timeline reordering
let setlistTracks = [];
let timelineIdCounter = 0;

function addTrackToSetlist(trackIndex) {
    const track = exportData[trackIndex];
    if (!track) return;
    
    setlistTracks.push({
        trackIndex: trackIndex,
        id: `setlist-item-${timelineIdCounter++}`
    });
    
    renderSetlistTimeline();
}

function removeTrackFromSetlist(index) {
    setlistTracks.splice(index, 1);
    renderSetlistTimeline();
}

let sidebarSearchVal = '';
let sidebarGenreVal = 'all';
let sidebarCompatOnly = false;

function setupSidebarFilterListeners() {
    const search = document.getElementById('sidebar-search');
    const genreFilter = document.getElementById('sidebar-genre-filter');
    const compatFilter = document.getElementById('sidebar-compat-filter');
    
    if (search) {
        search.addEventListener('input', (e) => {
            sidebarSearchVal = e.target.value.toLowerCase();
            renderSetlistSidebar();
        });
    }
    
    if (genreFilter) {
        genreFilter.addEventListener('change', (e) => {
            sidebarGenreVal = e.target.value;
            renderSetlistSidebar();
        });
    }
    
    if (compatFilter) {
        compatFilter.addEventListener('change', (e) => {
            sidebarCompatOnly = e.target.checked;
            renderSetlistSidebar();
        });
    }
}

function populateSidebarGenres() {
    const genreFilter = document.getElementById('sidebar-genre-filter');
    if (!genreFilter) return;
    
    const currentSelection = genreFilter.value;
    const genres = new Set();
    
    exportData.forEach(track => {
        if (track.genre && track.genre !== 'Unknown') {
            genres.add(track.genre);
        }
    });
    
    const sortedGenres = Array.from(genres).sort();
    
    let html = '<option value="all">All Genres</option>';
    sortedGenres.forEach(g => {
        html += `<option value="${g}">${g}</option>`;
    });
    
    genreFilter.innerHTML = html;
    
    if (sortedGenres.includes(currentSelection)) {
        genreFilter.value = currentSelection;
        sidebarGenreVal = currentSelection;
    } else {
        genreFilter.value = 'all';
        sidebarGenreVal = 'all';
    }
}

function renderSetlistSidebar() {
    const listContainer = document.getElementById('setlist-library-list');
    if (!listContainer) return;
    
    if (exportData.length === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">
                No tracks analyzed yet. Click 'Crate Library' to select a folder.
            </div>
        `;
        return;
    }
    
    let activeKey = null;
    if (wavesurferA && wavesurferA.getDuration() > 0 && loadedTrackIndexA !== -1) {
        activeKey = exportData[loadedTrackIndexA].key;
    } else if (wavesurferB && wavesurferB.getDuration() > 0 && loadedTrackIndexB !== -1) {
        activeKey = exportData[loadedTrackIndexB].key;
    }
    
    let html = '';
    const format = notationSelect.value;
    let filteredCount = 0;
    
    exportData.forEach((track, index) => {
        // 1. Search Query Filter
        if (sidebarSearchVal) {
            if (!track.originalName.toLowerCase().includes(sidebarSearchVal)) {
                return;
            }
        }
        
        // 2. Genre Dropdown Filter
        if (sidebarGenreVal !== 'all') {
            if (track.genre !== sidebarGenreVal) {
                return;
            }
        }
        
        // 3. Harmonic Key Compatibility Filter (matching Deck A/B active track)
        if (sidebarCompatOnly && activeKey) {
            const compatibleList = getCompatibleKeys(activeKey);
            if (!compatibleList.includes(track.key)) {
                return;
            }
        }
        
        filteredCount++;
        
        const keyVal = formatKey(track.key, track.keyText, format);
        const keyBadgeColor = track.key !== "Unknown" ? `var(--cam-${track.key.toLowerCase()})` : "var(--border-colour)";
        
        html += `
            <div class="setlist-lib-item" data-index="${index}">
                <div class="setlist-lib-title" title="${track.originalName}">${track.originalName}</div>
                <div class="setlist-lib-meta">
                    <span class="badge" style="background-color: ${keyBadgeColor}; color: #000; font-size: 0.75rem; padding: 2px 6px; font-weight: 800;">${keyVal}</span>
                    <span style="font-family: monospace; font-size: 0.8rem; font-weight: bold; color: var(--accent-colour);">${track.bpm} BPM</span>
                    <button class="action-icon-btn add-to-timeline-btn" data-index="${index}" title="Add to Setlist Timeline" style="color: var(--accent-colour);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    if (filteredCount === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem 0;">
                No matching tracks found.
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = html;
    
    listContainer.querySelectorAll('.add-to-timeline-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            addTrackToSetlist(idx);
        });
    });

    listContainer.querySelectorAll('.setlist-lib-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.add-to-timeline-btn')) return;
            const idx = parseInt(item.getAttribute('data-index'), 10);
            addTrackToSetlist(idx);
        });
    });
}

function renderSetlistTimeline() {
    const container = document.getElementById('setlist-timeline');
    if (!container) return;
    
    if (setlistTracks.length === 0) {
        container.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding: 2.2rem 0; font-size: 0.85rem; font-weight: 500;">
                Drag tracks from the sidebar library here or click their '+' button to build your set.
            </div>
        `;
        updateMixerControlsState();
        return;
    }
    
    const format = notationSelect.value;
    let html = '';
    
    for (let i = 0; i < setlistTracks.length; i++) {
        const item = setlistTracks[i];
        const track = exportData[item.trackIndex];
        const keyVal = formatKey(track.key, track.keyText, format);
        const keyBadgeColor = track.key !== "Unknown" ? `var(--cam-${track.key.toLowerCase()})` : "var(--border-colour)";
        
        html += `
            <div class="timeline-card" id="${item.id}" data-index="${i}" draggable="true">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex-grow: 1;">
                    <div class="timeline-card-drag-handle">☰</div>
                    <div class="timeline-card-details">
                        <div class="timeline-card-title" title="${track.originalName}">${track.originalName}</div>
                        <div class="timeline-card-meta">
                            <span class="badge" style="background-color: ${keyBadgeColor}; color: #000; font-size: 0.75rem; padding: 1px 5px; font-weight: 800;">${keyVal}</span>
                            <span style="font-family: monospace; font-size: 0.8rem; font-weight: bold; color: var(--accent-colour);">${track.bpm} BPM</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">${track.genre || "Unknown"}</span>
                        </div>
                    </div>
                </div>
                <div class="timeline-card-actions">
                    <button class="action-icon-btn load-deck-btn load-deck-a-btn" data-deck="a" data-index="${i}" title="Load to Deck A">LOAD A</button>
                    <button class="action-icon-btn load-deck-btn load-deck-b-btn" data-deck="b" data-index="${i}" title="Load to Deck B">LOAD B</button>
                    <button class="action-icon-btn delete-btn remove-timeline-btn" data-index="${i}" title="Remove from Setlist">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
        `;
        
        if (i < setlistTracks.length - 1) {
            const nextItem = setlistTracks[i + 1];
            const nextTrack = exportData[nextItem.trackIndex];
            const transInfo = getTransitionCompatibility(track, nextTrack);
            
            html += `
                <div class="transition-flow-indicator ${transInfo.class}">
                    <span>${transInfo.icon}</span>
                    <span>${transInfo.text}</span>
                    <span style="font-family: monospace; font-size: 0.75rem; opacity: 0.8;">(${transInfo.bpmDiff > 0 ? '+' : ''}${transInfo.bpmDiff.toFixed(1)}% BPM)</span>
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
    
    container.querySelectorAll('.remove-timeline-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            removeTrackFromSetlist(idx);
        });
    });
    
    container.querySelectorAll('.load-deck-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            loadTrackToDeck(deck, idx);
        });
    });
    
    setupTimelineDragAndDrop();
    updateMixerControlsState();
}

function getTransitionCompatibility(track1, track2) {
    const bpm1 = parseFloat(track1.bpm);
    const bpm2 = parseFloat(track2.bpm);
    let bpmDiff = 0;
    if (bpm1 > 0 && bpm2 > 0) {
        bpmDiff = ((bpm2 - bpm1) / bpm1) * 100;
    }
    
    const key1 = track1.key;
    const key2 = track2.key;
    
    if (key1 === 'Unknown' || key2 === 'Unknown') {
        return { class: 'compatible', icon: '❓', text: 'Unknown Key Transition', bpmDiff };
    }
    
    if (key1 === key2) {
        return { class: 'perfect', icon: '✨', text: 'Perfect Match (Same Key)', bpmDiff };
    }
    
    const compKeys = getCompatibleKeys(key1);
    if (compKeys.includes(key2)) {
        const match1 = key1.match(/^(\d+)([AB])$/);
        const match2 = key2.match(/^(\d+)([AB])$/);
        const h1 = parseInt(match1[1], 10);
        const l1 = match1[2];
        const h2 = parseInt(match2[1], 10);
        const l2 = match2[2];
        
        let typeText = 'Compatible Key';
        if (l1 !== l2) {
            typeText = 'Relative Major/Minor';
        } else if (h2 === (h1 === 12 ? 1 : h1 + 1) || h2 === (h1 === 1 ? 12 : h1 - 1)) {
            typeText = 'Adjacent Hour Shift';
        }
        
        return { class: 'perfect', icon: '✅', text: typeText, bpmDiff };
    }
    
    const match1 = key1.match(/^(\d+)([AB])$/);
    const match2 = key2.match(/^(\d+)([AB])$/);
    const h1 = parseInt(match1[1], 10);
    const l1 = match1[2];
    const h2 = parseInt(match2[1], 10);
    const l2 = match2[2];
    
    const dist = Math.abs(h2 - h1);
    const circularDist = Math.min(dist, 12 - dist);
    
    if (l1 === l2 && circularDist === 2) {
        return { class: 'compatible', icon: '⚡', text: 'Energy Boost (+2 Hours)', bpmDiff };
    }
    
    if (Math.abs(bpmDiff) <= 3) {
        return { class: 'compatible', icon: '🎚️', text: 'Tempo Match (BPM Compatible)', bpmDiff };
    }
    
    return { class: 'clash', icon: '⚠️', text: 'Harmonic Clash', bpmDiff };
}

function setupTimelineDragAndDrop() {
    const container = document.getElementById('setlist-timeline');
    const cards = container.querySelectorAll('.timeline-card');
    
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.getAttribute('data-index'));
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            renderSetlistTimeline();
        });
    });
    
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
        
        const afterElement = getDragAfterElement(container, e.clientY);
        const dragging = container.querySelector('.dragging');
        if (dragging) {
            if (afterElement == null) {
                container.appendChild(dragging);
            } else {
                container.insertBefore(dragging, afterElement);
            }
        }
    });
    
    container.addEventListener('dragleave', () => {
        container.classList.remove('drag-over');
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        
        const reordered = [];
        container.querySelectorAll('.timeline-card').forEach(card => {
            const oldIdx = parseInt(card.getAttribute('data-index'), 10);
            reordered.push(setlistTracks[oldIdx]);
        });
        
        setlistTracks = reordered;
        renderSetlistTimeline();
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.timeline-card:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 10. Dual-Deck DJ Mixer controls
let wavesurferA = null;
let wavesurferB = null;
let activeObjectUrlA = null;
let activeObjectUrlB = null;

let trackBpmA = 0;
let trackBpmB = 0;
let trackOffsetA = 0;
let trackOffsetB = 0;

// High-Resolution Hardware Audio Reference Clock & Closed-Loop PI PLL State
let currentEffectiveRateA = 1.0;
let currentEffectiveRateB = 1.0;
let basePitchRateA = 1.0;
let basePitchRateB = 1.0;
let pllIntegralError = 0.0;
let deckA_clockAnchor = { mediaTime: 0, ctxTime: 0, rate: 1.0 };
let deckB_clockAnchor = { mediaTime: 0, ctxTime: 0, rate: 1.0 };

function updateDeckClockAnchor(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    const anchor = deck === 'a' ? deckA_clockAnchor : deckB_clockAnchor;
    const rate = deck === 'a' ? currentEffectiveRateA : currentEffectiveRateB;
    if (!ws) return;
    anchor.mediaTime = ws.getCurrentTime() || 0;
    anchor.ctxTime = audioContext ? audioContext.currentTime : 0;
    anchor.rate = rate;
}

function onDeckTimeUpdate(deck, time) {
    const anchor = deck === 'a' ? deckA_clockAnchor : deckB_clockAnchor;
    const rate = deck === 'a' ? currentEffectiveRateA : currentEffectiveRateB;
    const nowCtx = audioContext ? audioContext.currentTime : 0;
    
    // Extrapolated time since last anchor
    const extrapolated = anchor.mediaTime + (nowCtx - anchor.ctxTime) * anchor.rate;
    const diff = Math.abs(extrapolated - time);
    
    if (diff > 0.08) {
        // Hard jump or seek detected
        anchor.mediaTime = time;
        anchor.ctxTime = nowCtx;
        anchor.rate = rate;
    } else {
        // Soft low-pass blending (0.1 weight) to align with audio decoder clock without stair-stepping
        anchor.mediaTime = extrapolated * 0.9 + time * 0.1;
        anchor.ctxTime = nowCtx;
        anchor.rate = rate;
    }
}

function getDeckHighResTime(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    const anchor = deck === 'a' ? deckA_clockAnchor : deckB_clockAnchor;
    if (!ws) return 0;
    if (!ws.isPlaying()) {
        return ws.getCurrentTime() || 0;
    }
    const elapsedCtx = (audioContext ? audioContext.currentTime : 0) - anchor.ctxTime;
    if (elapsedCtx < 0 || elapsedCtx > 2.0) {
        updateDeckClockAnchor(deck);
        return ws.getCurrentTime() || 0;
    }
    return anchor.mediaTime + elapsedCtx * anchor.rate;
}

function initMixerDecks() {
    if (wavesurferA || wavesurferB) return;
    
    wavesurferA = WaveSurfer.create({
        container: '#waveform-a',
        waveColor: '#201838',
        progressColor: '#a855f7',
        cursorColor: '#f3e8ff',
        barWidth: 2,
        barGap: 1,
        height: 85,
        normalize: true
    });
    
    wavesurferB = WaveSurfer.create({
        container: '#waveform-b',
        waveColor: '#201838',
        progressColor: '#e879f9',
        cursorColor: '#fce7f3',
        barWidth: 2,
        barGap: 1,
        height: 85,
        normalize: true
    });
    
    wavesurferA.on('play', () => {
        updateDeckClockAnchor('a');
        document.getElementById('deck-a-play').classList.add('playing');
        document.getElementById('deck-a-play').textContent = 'Pause';
        updateMixerControlsState();
    });
    wavesurferA.on('pause', () => {
        updateDeckClockAnchor('a');
        document.getElementById('deck-a-play').classList.remove('playing');
        document.getElementById('deck-a-play').textContent = 'Play';
        updateMixerControlsState();
    });
    wavesurferA.on('seeking', () => updateDeckClockAnchor('a'));
    wavesurferA.on('seek', () => updateDeckClockAnchor('a'));
    
    wavesurferB.on('play', () => {
        updateDeckClockAnchor('b');
        document.getElementById('deck-b-play').classList.add('playing');
        document.getElementById('deck-b-play').textContent = 'Pause';
        updateMixerControlsState();
    });
    wavesurferB.on('pause', () => {
        updateDeckClockAnchor('b');
        document.getElementById('deck-b-play').classList.remove('playing');
        document.getElementById('deck-b-play').textContent = 'Play';
        updateMixerControlsState();
    });
    wavesurferB.on('seeking', () => updateDeckClockAnchor('b'));
    wavesurferB.on('seek', () => updateDeckClockAnchor('b'));
    
    document.getElementById('deck-a-play').addEventListener('click', () => playDeckQuantized('a'));
    document.getElementById('deck-b-play').addEventListener('click', () => playDeckQuantized('b'));
    
    const sliderPitchA = document.getElementById('deck-a-pitch');
    const labelPitchA = document.getElementById('deck-a-pitch-label');
    sliderPitchA.addEventListener('input', () => {
        const rate = parseFloat(sliderPitchA.value);
        basePitchRateA = rate;
        currentEffectiveRateA = rate;
        deckA_clockAnchor.rate = rate;
        labelPitchA.textContent = `${rate.toFixed(2)}x`;
        wavesurferA.setPlaybackRate(rate);
        if (trackBpmA > 0) {
            const currentBpm = trackBpmA * rate;
            document.getElementById('deck-a-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
            
            // Master Tempo Tracking: If Deck B is synced to Deck A, track master tempo with full precision!
            if (syncLockedB && trackBpmB > 0) {
                const targetRateB = currentBpm / trackBpmB;
                basePitchRateB = targetRateB;
                currentEffectiveRateB = targetRateB;
                deckB_clockAnchor.rate = targetRateB;
                const sliderB = document.getElementById('deck-b-pitch');
                sliderB.value = targetRateB.toFixed(4);
                document.getElementById('deck-b-pitch-label').textContent = `${targetRateB.toFixed(2)}x`;
                wavesurferB.setPlaybackRate(targetRateB);
                document.getElementById('deck-b-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
                pllIntegralError = 0;
            }
        }
    });
    
    const sliderPitchB = document.getElementById('deck-b-pitch');
    const labelPitchB = document.getElementById('deck-b-pitch-label');
    sliderPitchB.addEventListener('input', () => {
        const rate = parseFloat(sliderPitchB.value);
        basePitchRateB = rate;
        currentEffectiveRateB = rate;
        deckB_clockAnchor.rate = rate;
        labelPitchB.textContent = `${rate.toFixed(2)}x`;
        wavesurferB.setPlaybackRate(rate);
        if (trackBpmB > 0) {
            const currentBpm = trackBpmB * rate;
            document.getElementById('deck-b-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
            
            // Master Tempo Tracking: If Deck A is synced to Deck B, track master tempo with full precision!
            if (syncLockedA && trackBpmA > 0) {
                const targetRateA = currentBpm / trackBpmA;
                basePitchRateA = targetRateA;
                currentEffectiveRateA = targetRateA;
                deckA_clockAnchor.rate = targetRateA;
                const sliderA = document.getElementById('deck-a-pitch');
                sliderA.value = targetRateA.toFixed(4);
                document.getElementById('deck-a-pitch-label').textContent = `${targetRateA.toFixed(2)}x`;
                wavesurferA.setPlaybackRate(targetRateA);
                document.getElementById('deck-a-bpm-display').textContent = `${currentBpm.toFixed(1)} BPM`;
                pllIntegralError = 0;
            }
        }
    });
    
    document.getElementById('deck-a-vol').addEventListener('input', updateDeckVolumes);
    document.getElementById('deck-b-vol').addEventListener('input', updateDeckVolumes);
    document.getElementById('crossfader').addEventListener('input', updateDeckVolumes);
    
    document.getElementById('deck-a-sync').addEventListener('click', () => toggleSyncDeck('a'));
    document.getElementById('deck-b-sync').addEventListener('click', () => toggleSyncDeck('b'));
    
    document.getElementById('deck-a-master-key').addEventListener('click', () => toggleDeckMasterKey('a'));
    document.getElementById('deck-b-master-key').addEventListener('click', () => toggleDeckMasterKey('b'));
    
    document.getElementById('btn-automix').addEventListener('click', triggerAutoMix);
    
    // Grid Nudges & Set Downbeat (1.1.1)
    document.getElementById('deck-a-grid-left').addEventListener('click', () => nudgeGrid('a', 'left'));
    document.getElementById('deck-a-grid-right').addEventListener('click', () => nudgeGrid('a', 'right'));
    document.getElementById('deck-b-grid-left').addEventListener('click', () => nudgeGrid('b', 'left'));
    document.getElementById('deck-b-grid-right').addEventListener('click', () => nudgeGrid('b', 'right'));
    
    document.getElementById('deck-a-set-downbeat').addEventListener('click', () => setDownbeatToCurrentPlayhead('a'));
    document.getElementById('deck-b-set-downbeat').addEventListener('click', () => setDownbeatToCurrentPlayhead('b'));
    
    // Jog Platter Bends
    document.getElementById('deck-a-bend-left').addEventListener('click', () => triggerJogBend('a', 'left'));
    document.getElementById('deck-a-bend-right').addEventListener('click', () => triggerJogBend('a', 'right'));
    document.getElementById('deck-b-bend-left').addEventListener('click', () => triggerJogBend('b', 'left'));
    document.getElementById('deck-b-bend-right').addEventListener('click', () => triggerJogBend('b', 'right'));
    
    // Metronome Toggles
    const metroBtnA = document.getElementById('deck-a-metronome');
    metroBtnA.addEventListener('click', () => {
        metronomeActiveA = !metronomeActiveA;
        if (metronomeActiveA) {
            metroBtnA.classList.add('active');
            metroBtnA.querySelector('span:last-child').textContent = '🔊';
            audioContext.resume();
        } else {
            metroBtnA.classList.remove('active');
            metroBtnA.querySelector('span:last-child').textContent = '🔇';
        }
    });
    
    const metroBtnB = document.getElementById('deck-b-metronome');
    metroBtnB.addEventListener('click', () => {
        metronomeActiveB = !metronomeActiveB;
        if (metronomeActiveB) {
            metroBtnB.classList.add('active');
            metroBtnB.querySelector('span:last-child').textContent = '🔊';
            audioContext.resume();
        } else {
            metroBtnB.classList.remove('active');
            metroBtnB.querySelector('span:last-child').textContent = '🔇';
        }
    });
    
    // Quantized Loop Sizes & Toggles
    document.querySelectorAll('.loop-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const size = parseInt(btn.getAttribute('data-size'), 10);
            setLoopSize(deck, size);
        });
    });
    
    document.getElementById('deck-a-loop-toggle').addEventListener('click', () => toggleLoop('a'));
    document.getElementById('deck-b-loop-toggle').addEventListener('click', () => toggleLoop('b'));
    
    // Layout switcher
    const btnToggleLayout = document.getElementById('btn-toggle-layout');
    const decksContainer = document.querySelector('.decks-container');
    let isLayoutStacked = false;
    
    if (btnToggleLayout && decksContainer) {
        btnToggleLayout.addEventListener('click', () => {
            isLayoutStacked = !isLayoutStacked;
            if (isLayoutStacked) {
                decksContainer.classList.add('layout-stacked');
                btnToggleLayout.textContent = 'Layout: Stacked';
                btnToggleLayout.classList.add('active');
            } else {
                decksContainer.classList.remove('layout-stacked');
                btnToggleLayout.textContent = 'Layout: Side-by-Side';
                btnToggleLayout.classList.remove('active');
            }
            // Redraw waveforms
            setTimeout(() => {
                if (wavesurferA) drawBeatGridLines('a', trackBpmA, trackOffsetA);
                if (wavesurferB) drawBeatGridLines('b', trackBpmB, trackOffsetB);
            }, 100);
        });
    }
    
    initSyncEngineLoop();
}

function updateDeckVolumes() {
    const volAEl = document.getElementById('deck-a-vol');
    const volBEl = document.getElementById('deck-b-vol');
    const crossEl = document.getElementById('crossfader');
    const curveEl = document.getElementById('crossfader-curve');
    if (!volAEl || !volBEl || !crossEl) return;
    
    const volA = parseFloat(volAEl.value);
    const volB = parseFloat(volBEl.value);
    const crossValue = parseFloat(crossEl.value); // -1 to +1
    const curve = curveEl ? curveEl.value : 'smooth';
    
    let gainA = 1;
    let gainB = 1;
    
    if (curve === 'smooth') {
        // Equal Power Crossfade curve
        const norm = (crossValue + 1) / 2; // 0 to 1
        gainA = Math.cos(norm * 0.5 * Math.PI);
        gainB = Math.sin(norm * 0.5 * Math.PI);
    } else if (curve === 'cut') {
        // Scratch / sharp cut curve
        gainA = crossValue > 0.90 ? 0 : 1;
        gainB = crossValue < -0.90 ? 0 : 1;
    } else {
        // Linear crossfade
        if (crossValue > 0) {
            gainA = 1 - crossValue;
            gainB = 1;
        } else {
            gainA = 1;
            gainB = 1 + crossValue;
        }
    }
    
    const finalGainA = Math.max(0, Math.min(1, volA * gainA));
    const finalGainB = Math.max(0, Math.min(1, volB * gainB));
    
    if (audioGraphA && audioGraphA.gainNode) {
        audioGraphA.gainNode.gain.setValueAtTime(finalGainA, audioContext.currentTime);
    }
    if (audioGraphB && audioGraphB.gainNode) {
        audioGraphB.gainNode.gain.setValueAtTime(finalGainB, audioContext.currentTime);
    }
    
    if (wavesurferA) wavesurferA.setVolume(finalGainA);
    if (wavesurferB) wavesurferB.setVolume(finalGainB);
}

function loadTrackToDeck(deck, timelineIdx) {
    initMixerDecks();
    
    const setlistItem = setlistTracks[timelineIdx];
    if (!setlistItem) return;
    
    const track = exportData[setlistItem.trackIndex];
    if (!track || !track.fileObject) return;
    
    const objectUrl = URL.createObjectURL(track.fileObject);
    
    if (deck === 'a') {
        if (activeObjectUrlA) URL.revokeObjectURL(activeObjectUrlA);
        activeObjectUrlA = objectUrl;
        loadedTrackIndexA = setlistItem.trackIndex;
        
        document.getElementById('deck-a-title').textContent = track.originalName;
        document.getElementById('deck-a-bpm-display').textContent = `${track.bpm} BPM`;
        
        // Reset Loop & Metronome states
        loopActiveA = false;
        const loopBtn = document.getElementById('deck-a-loop-toggle');
        loopBtn.textContent = 'LOOP OFF';
        loopBtn.classList.remove('active');
        
        metronomeActiveA = false;
        const metroBtn = document.getElementById('deck-a-metronome');
        metroBtn.classList.remove('active');
        metroBtn.querySelector('span:last-child').textContent = '🔇';
        
        trackBpmA = parseFloat(track.bpm) || 120;
        trackOffsetA = track.beatOffset || 0.0;
        
        enableDeckControls('a', true);
        
        wavesurferA.load(objectUrl);
        wavesurferA.unAll();
        
        basePitchRateA = 1.0;
        currentEffectiveRateA = 1.0;
        updateDeckClockAnchor('a');
        
        wavesurferA.on('play', () => {
            updateDeckClockAnchor('a');
            document.getElementById('deck-a-play').classList.add('playing');
            document.getElementById('deck-a-play').textContent = 'Pause';
            updateMixerControlsState();
        });
        wavesurferA.on('pause', () => {
            updateDeckClockAnchor('a');
            document.getElementById('deck-a-play').classList.remove('playing');
            document.getElementById('deck-a-play').textContent = 'Play';
            updateMixerControlsState();
        });
        wavesurferA.on('seeking', () => updateDeckClockAnchor('a'));
        wavesurferA.on('seek', () => updateDeckClockAnchor('a'));
        
        wavesurferA.once('decode', () => {
            const decoded = wavesurferA.getDecodedData();
            if (decoded) {
                const channelData = decoded.getChannelData(0);
                
                // On-the-fly beatgrid extraction
                if (!track.beatOffset) {
                    track.beatOffset = locateBeatGrid(channelData, decoded.sampleRate, trackBpmA);
                }
                trackOffsetA = track.beatOffset || 0.0;
                
                // On-the-fly energy extraction
                if (!track.energy || track.energy === '--') {
                    track.energy = calculateEnergyLevel(channelData);
                    if (track.rowId) {
                        const row = document.getElementById(track.rowId);
                        if (row) {
                            row.setAttribute('data-energy', track.energy);
                            const energyVal = row.querySelector('.energy-value');
                            if (energyVal) energyVal.innerHTML = getEnergyBarHtml(track.energy);
                        }
                    }
                }
            }
            
            wavesurferA.setPlaybackRate(1.00);
            applyMasterKeySettings('a');
            setupDeckAudioGraph('a', wavesurferA);
            populateTrackHotCues('a', track);
            drawBeatGridLines('a', trackBpmA, trackOffsetA);
            updateMixerControlsState();
            updateDeckClockAnchor('a');
        });
        
        wavesurferA.on('timeupdate', (time) => {
            onDeckTimeUpdate('a', time);
            updateDeckTimeDisplay('a', time, wavesurferA.getDuration());
            checkMetronomeTick('a', time);
            checkLoopBoundaries('a', time);
        });
        
    } else {
        if (activeObjectUrlB) URL.revokeObjectURL(activeObjectUrlB);
        activeObjectUrlB = objectUrl;
        loadedTrackIndexB = setlistItem.trackIndex;
        
        document.getElementById('deck-b-title').textContent = track.originalName;
        document.getElementById('deck-b-bpm-display').textContent = `${track.bpm} BPM`;
        
        // Reset Loop & Metronome states
        loopActiveB = false;
        const loopBtn = document.getElementById('deck-b-loop-toggle');
        loopBtn.textContent = 'LOOP OFF';
        loopBtn.classList.remove('active');
        
        metronomeActiveB = false;
        const metroBtn = document.getElementById('deck-b-metronome');
        metroBtn.classList.remove('active');
        metroBtn.querySelector('span:last-child').textContent = '🔇';
        
        trackBpmB = parseFloat(track.bpm) || 120;
        trackOffsetB = track.beatOffset || 0.0;
        
        enableDeckControls('b', true);
        
        wavesurferB.load(objectUrl);
        wavesurferB.unAll();
        
        basePitchRateB = 1.0;
        currentEffectiveRateB = 1.0;
        updateDeckClockAnchor('b');
        
        wavesurferB.on('play', () => {
            updateDeckClockAnchor('b');
            document.getElementById('deck-b-play').classList.add('playing');
            document.getElementById('deck-b-play').textContent = 'Pause';
            updateMixerControlsState();
        });
        wavesurferB.on('pause', () => {
            updateDeckClockAnchor('b');
            document.getElementById('deck-b-play').classList.remove('playing');
            document.getElementById('deck-b-play').textContent = 'Play';
            updateMixerControlsState();
        });
        wavesurferB.on('seeking', () => updateDeckClockAnchor('b'));
        wavesurferB.on('seek', () => updateDeckClockAnchor('b'));
        
        wavesurferB.once('decode', () => {
            const decoded = wavesurferB.getDecodedData();
            if (decoded) {
                const channelData = decoded.getChannelData(0);
                
                // On-the-fly beatgrid extraction
                if (!track.beatOffset) {
                    track.beatOffset = locateBeatGrid(channelData, decoded.sampleRate, trackBpmB);
                }
                trackOffsetB = track.beatOffset || 0.0;
                
                // On-the-fly energy extraction
                if (!track.energy || track.energy === '--') {
                    track.energy = calculateEnergyLevel(channelData);
                    if (track.rowId) {
                        const row = document.getElementById(track.rowId);
                        if (row) {
                            row.setAttribute('data-energy', track.energy);
                            const energyVal = row.querySelector('.energy-value');
                            if (energyVal) energyVal.innerHTML = getEnergyBarHtml(track.energy);
                        }
                    }
                }
            }
            
            wavesurferB.setPlaybackRate(1.00);
            applyMasterKeySettings('b');
            setupDeckAudioGraph('b', wavesurferB);
            populateTrackHotCues('b', track);
            drawBeatGridLines('b', trackBpmB, trackOffsetB);
            updateMixerControlsState();
            updateDeckClockAnchor('b');
        });
        
        wavesurferB.on('timeupdate', (time) => {
            onDeckTimeUpdate('b', time);
            updateDeckTimeDisplay('b', time, wavesurferB.getDuration());
            checkMetronomeTick('b', time);
            checkLoopBoundaries('b', time);
        });
    }
}

function drawBeatGridLines(deck, bpm, offset) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    const containerId = deck === 'a' ? 'waveform-a' : 'waveform-b';
    const container = document.getElementById(containerId);
    if (!container || !ws) return;
    
    container.querySelectorAll('.beatgrid-line').forEach(l => l.remove());
    
    const duration = ws.getDuration();
    if (!duration || duration <= 0) return;
    const beatInterval = 60 / bpm;
    let t = offset;
    
    while (t > beatInterval) {
        t -= beatInterval;
    }
    
    const wsWrapper = container.querySelector('div');
    if (!wsWrapper) return;
    
    let beatIndex = 0;
    while (t < duration) {
        const percent = (t / duration) * 100;
        const line = document.createElement('div');
        const isDownbeat = (beatIndex % 4 === 0);
        line.className = `beatgrid-line ${isDownbeat ? 'downbeat' : 'regular-beat'}`;
        line.style.left = `${percent}%`;
        if (isDownbeat) {
            const barNum = Math.floor(beatIndex / 4) + 1;
            line.setAttribute('data-bar', `${barNum}.1`);
        }
        wsWrapper.appendChild(line);
        t += beatInterval;
        beatIndex++;
    }
}

function setDownbeatToCurrentPlayhead(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    if (!ws) return;
    
    const currentTime = ws.getCurrentTime();
    const bpm = deck === 'a' ? trackBpmA : trackBpmB;
    if (bpm <= 0) return;
    
    const beatInterval = 60 / bpm;
    const newOffset = parseFloat((currentTime % beatInterval).toFixed(4));
    
    if (deck === 'a') {
        trackOffsetA = newOffset;
        if (loadedTrackIndexA !== -1 && exportData[loadedTrackIndexA]) {
            exportData[loadedTrackIndexA].beatOffset = newOffset;
        }
        drawBeatGridLines('a', trackBpmA, trackOffsetA);
    } else {
        trackOffsetB = newOffset;
        if (loadedTrackIndexB !== -1 && exportData[loadedTrackIndexB]) {
            exportData[loadedTrackIndexB].beatOffset = newOffset;
        }
        drawBeatGridLines('b', trackBpmB, trackOffsetB);
    }
    
    const btn = document.getElementById(`deck-${deck}-set-downbeat`);
    if (btn) {
        btn.textContent = 'SET ✔';
        setTimeout(() => { btn.textContent = 'SET 1.1.1'; }, 1000);
    }
}

let syncLockedA = false;
let syncLockedB = false;

function playDeckQuantized(deck) {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const wsTarget = deck === 'a' ? wavesurferA : wavesurferB;
    const wsMaster = deck === 'a' ? wavesurferB : wavesurferA;
    const masterDeck = deck === 'a' ? 'b' : 'a';
    const bpmMaster = deck === 'a' ? trackBpmB : trackBpmA;
    const isLocked = deck === 'a' ? syncLockedA : syncLockedB;
    
    if (!wsTarget) return;
    
    if (wsTarget.isPlaying()) {
        wsTarget.pause();
        updateDeckClockAnchor(deck);
        return;
    }
    
    // If master is playing and sync is locked, align phase right before play start
    if (wsMaster && wsMaster.isPlaying() && bpmMaster > 0 && isLocked) {
        alignDeckPhaseToMaster(deck, masterDeck);
    }
    
    wsTarget.play();
    updateDeckClockAnchor(deck);
}

function updatePhaseMeterDisplay(slave, diffMs) {
    const diffEl = document.getElementById('sync-phase-diff');
    const barEl = document.getElementById('phase-meter-bar');
    const badgeEl = document.getElementById('sync-active-badge');
    if (!diffEl || !barEl || !badgeEl) return;
    
    if (slave === 'idle') {
        diffEl.textContent = '0.0 ms';
        diffEl.style.color = 'var(--text-muted)';
        barEl.style.width = '0px';
        barEl.style.transform = 'translateX(0)';
        badgeEl.textContent = 'SYNC OFF';
        badgeEl.classList.remove('locked');
        return;
    }
    
    badgeEl.textContent = `SYNC (${slave.toUpperCase()})`;
    badgeEl.classList.add('locked');
    
    const absMs = Math.abs(diffMs);
    diffEl.textContent = `${diffMs >= 0 ? '+' : ''}${diffMs.toFixed(1)} ms`;
    
    if (absMs < 2.0) {
        diffEl.style.color = '#34d399'; // Locked green
    } else if (absMs < 15.0) {
        diffEl.style.color = '#fbbf24'; // Amber nudging
    } else {
        diffEl.style.color = '#f87171'; // Red out of sync
    }
    
    // Max visual bar deflection is 40px left or right
    const maxPx = 40;
    const px = Math.max(-maxPx, Math.min(maxPx, (diffMs / 40.0) * maxPx));
    barEl.style.width = `${Math.abs(px)}px`;
    barEl.style.transform = px >= 0 ? 'translateX(0)' : `translateX(${px}px)`;
    barEl.style.background = absMs < 2.0 ? '#34d399' : (absMs < 15.0 ? '#fbbf24' : '#f87171');
}

function toggleSyncDeck(targetDeck) {
    if (!wavesurferA || !wavesurferB) return;
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    const syncBtnA = document.getElementById('deck-a-sync');
    const syncBtnB = document.getElementById('deck-b-sync');
    
    if (targetDeck === 'a') {
        if (trackBpmA <= 0 || trackBpmB <= 0) return;
        
        if (syncLockedA) {
            // Disengage sync on Deck A
            syncLockedA = false;
            if (syncBtnA) {
                syncBtnA.classList.remove('sync-locked');
                syncBtnA.textContent = 'Sync to B';
            }
            updatePhaseMeterDisplay('idle', 0);
        } else {
            // Engage sync on Deck A (Deck B is Master)
            syncLockedA = true;
            syncLockedB = false;
            pllIntegralError = 0.0;
            if (syncBtnA) {
                syncBtnA.classList.add('sync-locked');
                syncBtnA.textContent = 'SYNC LOCKED';
            }
            if (syncBtnB) {
                syncBtnB.classList.remove('sync-locked');
                syncBtnB.textContent = 'Sync to A';
            }
            
            // Match tempo to Master Deck B with full 64-bit IEEE precision
            const currentBpmB = trackBpmB * basePitchRateB;
            const targetRateA = currentBpmB / trackBpmA;
            basePitchRateA = targetRateA;
            currentEffectiveRateA = targetRateA;
            deckA_clockAnchor.rate = targetRateA;
            
            const sliderA = document.getElementById('deck-a-pitch');
            if (sliderA) sliderA.value = targetRateA.toFixed(4);
            document.getElementById('deck-a-pitch-label').textContent = `${targetRateA.toFixed(2)}x`;
            wavesurferA.setPlaybackRate(targetRateA);
            document.getElementById('deck-a-bpm-display').textContent = `${currentBpmB.toFixed(1)} BPM`;
            
            // Align phase immediately if Master Deck B is rolling
            if (wavesurferB.isPlaying()) {
                alignDeckPhaseToMaster('a', 'b');
            }
            updatePhaseMeterDisplay('a', 0);
        }
    } else {
        if (trackBpmA <= 0 || trackBpmB <= 0) return;
        
        if (syncLockedB) {
            // Disengage sync on Deck B
            syncLockedB = false;
            if (syncBtnB) {
                syncBtnB.classList.remove('sync-locked');
                syncBtnB.textContent = 'Sync to A';
            }
            updatePhaseMeterDisplay('idle', 0);
        } else {
            // Engage sync on Deck B (Deck A is Master)
            syncLockedB = true;
            syncLockedA = false;
            pllIntegralError = 0.0;
            if (syncBtnB) {
                syncBtnB.classList.add('sync-locked');
                syncBtnB.textContent = 'SYNC LOCKED';
            }
            if (syncBtnA) {
                syncBtnA.classList.remove('sync-locked');
                syncBtnA.textContent = 'Sync to B';
            }
            
            // Match tempo to Master Deck A with full 64-bit IEEE precision
            const currentBpmA = trackBpmA * basePitchRateA;
            const targetRateB = currentBpmA / trackBpmB;
            basePitchRateB = targetRateB;
            currentEffectiveRateB = targetRateB;
            deckB_clockAnchor.rate = targetRateB;
            
            const sliderB = document.getElementById('deck-b-pitch');
            if (sliderB) sliderB.value = targetRateB.toFixed(4);
            document.getElementById('deck-b-pitch-label').textContent = `${targetRateB.toFixed(2)}x`;
            wavesurferB.setPlaybackRate(targetRateB);
            document.getElementById('deck-b-bpm-display').textContent = `${currentBpmA.toFixed(1)} BPM`;
            
            // Align phase immediately if Master Deck A is rolling
            if (wavesurferA.isPlaying()) {
                alignDeckPhaseToMaster('b', 'a');
            }
            updatePhaseMeterDisplay('b', 0);
        }
    }
}

function alignDeckPhaseToMaster(slave, master) {
    if (!wavesurferA || !wavesurferB) return;
    const wsSlave = slave === 'a' ? wavesurferA : wavesurferB;
    const bpmMaster = master === 'a' ? trackBpmA : trackBpmB;
    const rateMaster = master === 'a' ? basePitchRateA : basePitchRateB;
    const effBpm = bpmMaster * rateMaster;
    if (effBpm <= 0) return;
    
    const beatSec = 60.0 / effBpm;
    const offsetMaster = master === 'a' ? trackOffsetA : trackOffsetB;
    const offsetSlave = slave === 'a' ? trackOffsetA : trackOffsetB;
    
    const tMaster = getDeckHighResTime(master);
    const tSlave = getDeckHighResTime(slave);
    
    let phaseMaster = (tMaster - offsetMaster) % beatSec;
    if (phaseMaster < 0) phaseMaster += beatSec;
    
    let phaseSlave = (tSlave - offsetSlave) % beatSec;
    if (phaseSlave < 0) phaseSlave += beatSec;
    
    let diff = phaseSlave - phaseMaster;
    if (diff > beatSec * 0.5) diff -= beatSec;
    if (diff < -beatSec * 0.5) diff += beatSec;
    
    const targetTime = tSlave - diff;
    const dur = wsSlave.getDuration();
    if (targetTime >= 0 && targetTime <= dur) {
        wsSlave.setTime(targetTime);
        updateDeckClockAnchor(slave);
        pllIntegralError = 0.0;
    }
}

let syncEngineInterval = null;
function initSyncEngineLoop() {
    if (syncEngineInterval) return;
    syncEngineInterval = setInterval(() => {
        if (!wavesurferA || !wavesurferB) return;
        if (!wavesurferA.isPlaying() || !wavesurferB.isPlaying()) {
            if (!syncLockedA && !syncLockedB) {
                updatePhaseMeterDisplay('idle', 0);
            }
            return;
        }
        
        if (syncLockedA) {
            maintainDeckPhaseLock('a', 'b');
        } else if (syncLockedB) {
            maintainDeckPhaseLock('b', 'a');
        } else {
            // Passive phase monitoring between active decks
            const bpmA = trackBpmA * basePitchRateA;
            if (bpmA > 0) {
                const beatSec = 60.0 / bpmA;
                const pA = ((getDeckHighResTime('a') - trackOffsetA) % beatSec + beatSec) % beatSec;
                const pB = ((getDeckHighResTime('b') - trackOffsetB) % beatSec + beatSec) % beatSec;
                let diff = pB - pA;
                if (diff > beatSec * 0.5) diff -= beatSec;
                if (diff < -beatSec * 0.5) diff += beatSec;
                updatePhaseMeterDisplay('idle', diff * 1000);
            }
        }
    }, 25);
}

function maintainDeckPhaseLock(slave, master) {
    const wsSlave = slave === 'a' ? wavesurferA : wavesurferB;
    const bpmMaster = master === 'a' ? trackBpmA : trackBpmB;
    const bpmSlave = slave === 'a' ? trackBpmA : trackBpmB;
    const rateMaster = master === 'a' ? basePitchRateA : basePitchRateB;
    const effBpm = bpmMaster * rateMaster;
    if (effBpm <= 0 || bpmSlave <= 0) return;
    
    const nominalTargetRateSlave = effBpm / bpmSlave;
    const beatSec = 60.0 / effBpm;
    const offsetMaster = master === 'a' ? trackOffsetA : trackOffsetB;
    const offsetSlave = slave === 'a' ? trackOffsetA : trackOffsetB;
    
    const tMaster = getDeckHighResTime(master);
    const tSlave = getDeckHighResTime(slave);
    
    let phaseMaster = (tMaster - offsetMaster) % beatSec;
    if (phaseMaster < 0) phaseMaster += beatSec;
    
    let phaseSlave = (tSlave - offsetSlave) % beatSec;
    if (phaseSlave < 0) phaseSlave += beatSec;
    
    let diff = phaseSlave - phaseMaster;
    if (diff > beatSec * 0.5) diff -= beatSec;
    if (diff < -beatSec * 0.5) diff += beatSec;
    
    const diffMs = diff * 1000;
    updatePhaseMeterDisplay(slave, diffMs);
    
    // Large jump (e.g. manual seek, cue trigger, or loop hop > 45ms): snap seek immediately
    if (Math.abs(diff) > 0.045) {
        const target = tSlave - diff;
        if (target >= 0 && target <= wsSlave.getDuration()) {
            wsSlave.setTime(target);
            updateDeckClockAnchor(slave);
            pllIntegralError = 0.0;
        }
    } else {
        // Continuous Proportional-Integral (PI) closed loop
        const dt = 0.025;
        pllIntegralError += diff * dt;
        // Anti-windup clamping on integral accumulator
        pllIntegralError = Math.max(-0.06, Math.min(0.06, pllIntegralError));
        
        const Kp = 1.2;
        const Ki = 0.4;
        const correction = -(Kp * diff + Ki * pllIntegralError);
        // Clamp correction within +/- 3.5% smooth pull
        const clampedCorrection = Math.max(-0.035, Math.min(0.035, correction));
        
        const effectiveRate = nominalTargetRateSlave * (1.0 + clampedCorrection);
        wsSlave.setPlaybackRate(effectiveRate);
        
        if (slave === 'a') {
            currentEffectiveRateA = effectiveRate;
            deckA_clockAnchor.rate = effectiveRate;
        } else {
            currentEffectiveRateB = effectiveRate;
            deckB_clockAnchor.rate = effectiveRate;
        }
    }
}

// Backward-compatibility wrapper for any external callers
function syncDeckTo(targetDeck) {
    toggleSyncDeck(targetDeck);
}

let isAutomixing = false;
function triggerAutoMix() {
    if (isAutomixing) return;
    if (!wavesurferA || !wavesurferB) return;
    
    const isPlayingA = wavesurferA.isPlaying();
    const isPlayingB = wavesurferB.isPlaying();
    
    if (!isPlayingA && !isPlayingB) return;
    if (isPlayingA && isPlayingB) return;
    
    isAutomixing = true;
    document.getElementById('btn-automix').disabled = true;
    
    const sourceDeck = isPlayingA ? 'a' : 'b';
    const targetDeck = sourceDeck === 'a' ? 'b' : 'a';
    
    const wsSrc = sourceDeck === 'a' ? wavesurferA : wavesurferB;
    const wsTgt = sourceDeck === 'a' ? wavesurferB : wavesurferA;
    
    const bpmSrc = sourceDeck === 'a' ? trackBpmA : trackBpmB;
    
    syncDeckTo(targetDeck);
    wsTgt.play();
    
    const transitionDurationSec = (64 / bpmSrc) * 60;
    const startTime = Date.now();
    const startCrossValue = sourceDeck === 'a' ? -1 : 1;
    const endCrossValue = sourceDeck === 'a' ? 1 : -1;
    
    const crossfader = document.getElementById('crossfader');
    
    const fadeInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(1, elapsed / transitionDurationSec);
        
        const currentValue = startCrossValue + progress * (endCrossValue - startCrossValue);
        crossfader.value = currentValue.toFixed(2);
        updateDeckVolumes();
        
        if (progress >= 1) {
            clearInterval(fadeInterval);
            wsSrc.pause();
            
            crossfader.value = endCrossValue.toString();
            updateDeckVolumes();
            
            isAutomixing = false;
            document.getElementById('btn-automix').disabled = false;
            updateMixerControlsState();
        }
    }, 100);
}

function updateMixerControlsState() {
    const isLoadedA = wavesurferA && wavesurferA.getDuration() > 0;
    const isLoadedB = wavesurferB && wavesurferB.getDuration() > 0;
    
    document.getElementById('deck-a-sync').disabled = !(isLoadedA && isLoadedB);
    document.getElementById('deck-b-sync').disabled = !(isLoadedA && isLoadedB);
    document.getElementById('btn-automix').disabled = !(isLoadedA && isLoadedB && (wavesurferA.isPlaying() || wavesurferB.isPlaying()));
}

// -------------------------------------------------------------
// Advanced DJ Mixer Implementation (Nudge, Jog Bend, Loop, Metronome)
// -------------------------------------------------------------
let loadedTrackIndexA = -1;
let loadedTrackIndexB = -1;

let loopActiveA = false;
let loopActiveB = false;
let loopStartA = 0;
let loopStartB = 0;
let loopEndA = 0;
let loopEndB = 0;
let loopSizeA = 1;
let loopSizeB = 1;

let metronomeActiveA = false;
let metronomeActiveB = false;
let lastTickIndexA = -1;
let lastTickIndexB = -1;

let bendTimeoutA = null;
let bendTimeoutB = null;

let masterKeyActiveA = true;
let masterKeyActiveB = true;

function toggleDeckMasterKey(deck) {
    if (deck === 'a') {
        masterKeyActiveA = !masterKeyActiveA;
        applyMasterKeySettings('a');
    } else {
        masterKeyActiveB = !masterKeyActiveB;
        applyMasterKeySettings('b');
    }
}

function applyMasterKeySettings(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    const active = deck === 'a' ? masterKeyActiveA : masterKeyActiveB;
    const btn = document.getElementById(`deck-${deck}-master-key`);
    
    if (ws) {
        const media = ws.getMediaElement();
        if (media) {
            media.preservesPitch = active;
            media.mozPreservesPitch = active;
            media.webkitPreservesPitch = active;
        }
    }
    
    if (btn) {
        if (active) {
            btn.classList.add('active');
            btn.textContent = 'KEY LOCK';
            btn.style.background = deck === 'a' ? 'var(--accent-colour)' : '#e3e553';
            btn.style.color = '#000';
            btn.style.borderColor = deck === 'a' ? 'var(--accent-colour)' : '#e3e553';
        } else {
            btn.classList.remove('active');
            btn.textContent = 'KEY LOCK OFF';
            btn.style.background = 'var(--surface-colour)';
            btn.style.color = 'var(--text-muted)';
            btn.style.borderColor = 'var(--border-colour)';
        }
    }
}

function enableDeckControls(deck, enabled) {
    const d = deck.toLowerCase();
    document.getElementById(`deck-${d}-play`).disabled = !enabled;
    document.getElementById(`deck-${d}-pitch`).disabled = !enabled;
    document.getElementById(`deck-${d}-master-key`).disabled = !enabled;
    
    document.getElementById(`deck-${d}-grid-left`).disabled = !enabled;
    document.getElementById(`deck-${d}-grid-right`).disabled = !enabled;
    document.getElementById(`deck-${d}-set-downbeat`).disabled = !enabled;
    document.getElementById(`deck-${d}-bend-left`).disabled = !enabled;
    document.getElementById(`deck-${d}-bend-right`).disabled = !enabled;
    document.getElementById(`deck-${d}-metronome`).disabled = !enabled;
    document.getElementById(`deck-${d}-loop-toggle`).disabled = !enabled;
    
    document.querySelectorAll(`.loop-size-btn[data-deck="${d}"]`).forEach(btn => {
        btn.disabled = !enabled;
    });
}

function nudgeGrid(deck, direction) {
    const step = 0.01; // 10ms step size
    if (deck === 'a') {
        trackOffsetA += (direction === 'right' ? step : -step);
        if (trackOffsetA < 0) trackOffsetA = 0;
        
        if (loadedTrackIndexA !== -1 && exportData[loadedTrackIndexA]) {
            exportData[loadedTrackIndexA].beatOffset = trackOffsetA;
        }
        drawBeatGridLines('a', trackBpmA, trackOffsetA);
    } else {
        trackOffsetB += (direction === 'right' ? step : -step);
        if (trackOffsetB < 0) trackOffsetB = 0;
        
        if (loadedTrackIndexB !== -1 && exportData[loadedTrackIndexB]) {
            exportData[loadedTrackIndexB].beatOffset = trackOffsetB;
        }
        drawBeatGridLines('b', trackBpmB, trackOffsetB);
    }
}

function triggerJogBend(deck, direction) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    if (!ws || !ws.isPlaying()) return;
    
    const slider = document.getElementById(`deck-${deck}-pitch`);
    const originalRate = parseFloat(slider.value) || 1.0;
    
    const bendAmount = 0.035; // 3.5% speed bend
    const targetRate = direction === 'right' ? originalRate + bendAmount : originalRate - bendAmount;
    
    ws.setPlaybackRate(targetRate);
    
    if (deck === 'a') {
        if (bendTimeoutA) clearTimeout(bendTimeoutA);
        bendTimeoutA = setTimeout(() => {
            wavesurferA.setPlaybackRate(originalRate);
            bendTimeoutA = null;
        }, 150);
    } else {
        if (bendTimeoutB) clearTimeout(bendTimeoutB);
        bendTimeoutB = setTimeout(() => {
            wavesurferB.setPlaybackRate(originalRate);
            bendTimeoutB = null;
        }, 150);
    }
}

function checkMetronomeTick(deck, time) {
    const active = deck === 'a' ? metronomeActiveA : metronomeActiveB;
    if (!active) return;
    
    const bpm = deck === 'a' ? trackBpmA : trackBpmB;
    const offset = deck === 'a' ? trackOffsetA : trackOffsetB;
    const slider = document.getElementById(`deck-${deck}-pitch`);
    const rate = parseFloat(slider.value) || 1.0;
    const currentBpm = bpm * rate;
    
    if (currentBpm <= 0) return;
    
    const interval = 60 / currentBpm;
    const relativeTime = time - offset;
    const beatIndex = Math.round(relativeTime / interval);
    const beatTime = offset + beatIndex * interval;
    
    const windowSec = 0.035; // 35ms beat-matching precision window
    const dist = Math.abs(time - beatTime);
    const lastIdx = deck === 'a' ? lastTickIndexA : lastTickIndexB;
    
    if (dist < windowSec && beatIndex !== lastIdx && beatIndex >= 0) {
        if (deck === 'a') lastTickIndexA = beatIndex;
        else lastTickIndexB = beatIndex;
        
        playMetronomeClick();
    }
}

function playMetronomeClick() {
    try {
        const osc = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        osc.frequency.setValueAtTime(900, audioContext.currentTime); // synth beep frequency
        gainNode.gain.setValueAtTime(0.18, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.035);
        
        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.04);
    } catch (e) {
        console.warn("Could not trigger metronome tick:", e);
    }
}

function toggleLoop(deck) {
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    if (!ws) return;
    
    const active = deck === 'a' ? loopActiveA : loopActiveB;
    const button = document.getElementById(`deck-${deck}-loop-toggle`);
    
    if (!active) {
        // Turning loop ON: quantize playhead to nearest beat
        const bpm = deck === 'a' ? trackBpmA : trackBpmB;
        const offset = deck === 'a' ? trackOffsetA : trackOffsetB;
        const rate = parseFloat(document.getElementById(`deck-${deck}-pitch`).value) || 1.0;
        const currentBpm = bpm * rate;
        
        if (currentBpm <= 0) return;
        
        const interval = 60 / currentBpm;
        const time = ws.getCurrentTime();
        const relativeTime = time - offset;
        const beatIndex = Math.round(relativeTime / interval);
        
        const start = offset + beatIndex * interval;
        const size = deck === 'a' ? loopSizeA : loopSizeB;
        const end = start + size * interval;
        
        if (deck === 'a') {
            loopStartA = start;
            loopEndA = end;
            loopActiveA = true;
        } else {
            loopStartB = start;
            loopEndB = end;
            loopActiveB = true;
        }
        
        button.textContent = `LOOP ON (${size}B)`;
        button.classList.add('active');
    } else {
        // Turning loop OFF
        if (deck === 'a') loopActiveA = false;
        else loopActiveB = false;
        
        button.textContent = 'LOOP OFF';
        button.classList.remove('active');
    }
}

function setLoopSize(deck, size) {
    if (deck === 'a') {
        loopSizeA = size;
        if (loopActiveA && wavesurferA) {
            const bpm = trackBpmA;
            const rate = parseFloat(document.getElementById('deck-a-pitch').value) || 1.0;
            const interval = 60 / (bpm * rate);
            loopEndA = loopStartA + size * interval;
            document.getElementById('deck-a-loop-toggle').textContent = `LOOP ON (${size}B)`;
        }
    } else {
        loopSizeB = size;
        if (loopActiveB && wavesurferB) {
            const bpm = trackBpmB;
            const rate = parseFloat(document.getElementById('deck-b-pitch').value) || 1.0;
            const interval = 60 / (bpm * rate);
            loopEndB = loopStartB + size * interval;
            document.getElementById('deck-b-loop-toggle').textContent = `LOOP ON (${size}B)`;
        }
    }
    
    document.querySelectorAll(`.loop-size-btn[data-deck="${deck}"]`).forEach(btn => {
        const btnSize = parseInt(btn.getAttribute('data-size'), 10);
        if (btnSize === size) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function checkLoopBoundaries(deck, time) {
    const active = deck === 'a' ? loopActiveA : loopActiveB;
    if (!active) return;
    
    const start = deck === 'a' ? loopStartA : loopStartB;
    const end = deck === 'a' ? loopEndA : loopEndB;
    const ws = deck === 'a' ? wavesurferA : wavesurferB;
    
    if (ws && time >= end) {
        ws.setTime(start);
        updateDeckClockAnchor(deck);
    }
}

/* ==========================================================================
   STUDIO HARDWARE AUDIO ENGINE: WEB AUDIO DSP, VU METERS & PERFORMANCE CONTROLS
   ========================================================================== */

let audioGraphA = null;
let audioGraphB = null;
let isVuAnimationRunning = false;

function setupDeckAudioGraph(deck, ws) {
    if (deck === 'a' && audioGraphA) return audioGraphA;
    if (deck === 'b' && audioGraphB) return audioGraphB;
    if (!ws) return null;
    
    const media = ws.getMediaElement();
    if (!media) return null;
    
    try {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const source = audioContext.createMediaElementSource(media);
        
        const eqLow = audioContext.createBiquadFilter();
        eqLow.type = 'lowshelf';
        eqLow.frequency.value = 250;
        eqLow.gain.value = 0;
        
        const eqMid = audioContext.createBiquadFilter();
        eqMid.type = 'peaking';
        eqMid.frequency.value = 1000;
        eqMid.Q.value = 1.0;
        eqMid.gain.value = 0;
        
        const eqHi = audioContext.createBiquadFilter();
        eqHi.type = 'highshelf';
        eqHi.frequency.value = 3500;
        eqHi.gain.value = 0;
        
        const filterNode = audioContext.createBiquadFilter();
        filterNode.type = 'allpass';
        filterNode.frequency.value = 1000;
        
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.8;
        
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        
        source.connect(eqLow);
        eqLow.connect(eqMid);
        eqMid.connect(eqHi);
        eqHi.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioContext.destination);
        
        const graph = {
            source,
            eqLow,
            eqMid,
            eqHi,
            filterNode,
            gainNode,
            analyser,
            kills: { low: false, mid: false, hi: false }
        };
        
        if (deck === 'a') audioGraphA = graph;
        else audioGraphB = graph;
        
        if (!isVuAnimationRunning) {
            isVuAnimationRunning = true;
            startVuAnimation();
        }
        
        updateDeckVolumes();
        return graph;
    } catch (e) {
        console.warn(`Deck ${deck} Web Audio graph notice:`, e);
        return null;
    }
}

function startVuAnimation() {
    const dataA = new Uint8Array(32);
    const dataB = new Uint8Array(32);
    
    function loop() {
        if (audioGraphA && audioGraphA.analyser && wavesurferA && wavesurferA.isPlaying()) {
            audioGraphA.analyser.getByteFrequencyData(dataA);
            let sum = 0;
            for (let i = 0; i < 16; i++) sum += dataA[i];
            const avg = sum / 16;
            const level = Math.min(12, Math.floor((avg / 180) * 12));
            updateVuLeds('a', level);
        } else {
            updateVuLeds('a', 0);
        }
        
        if (audioGraphB && audioGraphB.analyser && wavesurferB && wavesurferB.isPlaying()) {
            audioGraphB.analyser.getByteFrequencyData(dataB);
            let sum = 0;
            for (let i = 0; i < 16; i++) sum += dataB[i];
            const avg = sum / 16;
            const level = Math.min(12, Math.floor((avg / 180) * 12));
            updateVuLeds('b', level);
        } else {
            updateVuLeds('b', 0);
        }
        
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

function updateVuLeds(deck, activeCount) {
    const segs = document.querySelectorAll(`#deck-${deck}-vu .vu-seg`);
    segs.forEach((seg, idx) => {
        if (idx < activeCount) {
            seg.classList.add('lit');
        } else {
            seg.classList.remove('lit');
        }
    });
}

function updateDeckTimeDisplay(deck, time, duration) {
    const el = document.getElementById(`deck-${deck}-time-display`);
    if (!el || !duration) return;
    const remaining = Math.max(0, duration - time);
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    const ms = Math.floor((remaining % 1) * 10);
    el.textContent = `-${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

/* ==========================================================================
   ROTARY HARDWARE KNOBS & KILL BUTTONS
   ========================================================================== */

function initRotaryKnobs() {
    const knobs = document.querySelectorAll('.rotary-knob');
    knobs.forEach(knob => {
        const deck = knob.getAttribute('data-deck');
        const param = knob.getAttribute('data-param');
        let currentAngle = 0; // -135 to +135 deg
        let startY = 0;
        let isDragging = false;

        const onPointerMove = (e) => {
            if (!isDragging) return;
            const deltaY = startY - e.clientY;
            startY = e.clientY;
            currentAngle = Math.max(-135, Math.min(135, currentAngle + deltaY * 1.8));
            knob.style.transform = `rotate(${currentAngle}deg)`;
            applyKnobValue(deck, param, currentAngle);
        };

        const onPointerUp = () => {
            isDragging = false;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        knob.addEventListener('pointerdown', (e) => {
            isDragging = true;
            startY = e.clientY;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });

        // Double-click resets to center (0deg = bypass/flat)
        knob.addEventListener('dblclick', () => {
            currentAngle = 0;
            knob.style.transform = `rotate(0deg)`;
            applyKnobValue(deck, param, 0);
        });

        // Mousewheel rotation
        knob.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 8 : -8;
            currentAngle = Math.max(-135, Math.min(135, currentAngle + delta));
            knob.style.transform = `rotate(${currentAngle}deg)`;
            applyKnobValue(deck, param, currentAngle);
        });
    });

    // Kill buttons
    document.querySelectorAll('.kill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const band = btn.getAttribute('data-band');
            btn.classList.toggle('active');
            const isKill = btn.classList.contains('active');
            toggleBandKill(deck, band, isKill);
        });
    });
}

function applyKnobValue(deck, param, angle) {
    const graph = deck === 'a' ? audioGraphA : audioGraphB;
    if (!graph) return;
    
    const norm = angle / 135; // -1 to +1
    
    if (param === 'filter') {
        if (Math.abs(angle) < 6) {
            graph.filterNode.type = 'allpass';
            graph.filterNode.frequency.setValueAtTime(1000, audioContext.currentTime);
        } else if (angle < 0) {
            // Low Pass Filter sweep
            graph.filterNode.type = 'lowpass';
            const freq = 120 * Math.pow(160, (1 + norm));
            graph.filterNode.frequency.setValueAtTime(Math.max(100, Math.min(20000, freq)), audioContext.currentTime);
        } else {
            // High Pass Filter sweep
            graph.filterNode.type = 'highpass';
            const freq = 20 * Math.pow(380, norm);
            graph.filterNode.frequency.setValueAtTime(Math.max(20, Math.min(8000, freq)), audioContext.currentTime);
        }
        return;
    }

    // EQ -40dB up to +6dB
    let gainDb = 0;
    if (angle <= 0) {
        gainDb = (angle / 135) * 40;
    } else {
        gainDb = (angle / 135) * 6;
    }

    const node = param === 'hi' ? graph.eqHi : (param === 'mid' ? graph.eqMid : graph.eqLow);
    if (node && !graph.kills[param]) {
        node.gain.setValueAtTime(gainDb, audioContext.currentTime);
    }
}

function toggleBandKill(deck, band, isKill) {
    const graph = deck === 'a' ? audioGraphA : audioGraphB;
    if (!graph) return;
    graph.kills[band] = isKill;
    const node = band === 'hi' ? graph.eqHi : (band === 'mid' ? graph.eqMid : graph.eqLow);
    if (node) {
        node.gain.setValueAtTime(isKill ? -70 : 0, audioContext.currentTime);
    }
}

/* ==========================================================================
   PERFORMANCE HOT CUES & BEAT JUMP
   ========================================================================== */

const deckHotCues = {
    a: [null, null, null, null],
    b: [null, null, null, null]
};

function initHotCues(deck) {
    for (let i = 0; i < 4; i++) {
        const btn = document.getElementById(`deck-${deck}-cue-${i}`);
        if (!btn) continue;
        btn.addEventListener('click', (e) => {
            const ws = deck === 'a' ? wavesurferA : wavesurferB;
            if (!ws) return;
            
            if (e.shiftKey) {
                // Clear cue
                deckHotCues[deck][i] = null;
                btn.classList.remove('set');
                btn.querySelector('.hot-cue-time').textContent = '--:--';
                return;
            }
            
            if (deckHotCues[deck][i] === null) {
                // Set Hot Cue at current playhead
                const time = ws.getCurrentTime();
                deckHotCues[deck][i] = time;
                btn.classList.add('set');
                const m = Math.floor(time / 60);
                const s = Math.floor(time % 60);
                const ms = Math.floor((time % 1) * 10);
                btn.querySelector('.hot-cue-time').textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
            } else {
                // Quantized jump to Hot Cue
                const time = deckHotCues[deck][i];
                ws.setTime(time);
                
                const isLocked = deck === 'a' ? syncLockedA : syncLockedB;
                const master = deck === 'a' ? 'b' : 'a';
                const wsMaster = master === 'a' ? wavesurferA : wavesurferB;
                if (isLocked && wsMaster && wsMaster.isPlaying()) {
                    alignDeckPhaseToMaster(deck, master);
                }
                
                if (!ws.isPlaying()) ws.play();
            }
        });
    }
}

function populateTrackHotCues(deck, track) {
    const cues = track.cues || [];
    for (let i = 0; i < 4; i++) {
        const btn = document.getElementById(`deck-${deck}-cue-${i}`);
        if (!btn) continue;
        
        if (cues[i] && cues[i].time !== undefined) {
            const time = cues[i].time;
            deckHotCues[deck][i] = time;
            btn.classList.add('set');
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60);
            const ms = Math.floor((time % 1) * 10);
            btn.querySelector('.hot-cue-time').textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
            btn.setAttribute('title', cues[i].label || `Cue ${i+1}`);
        } else {
            deckHotCues[deck][i] = null;
            btn.classList.remove('set');
            btn.querySelector('.hot-cue-time').textContent = '--:--';
        }
    }
}

function initBeatJump() {
    document.querySelectorAll('.jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deck = btn.getAttribute('data-deck');
            const beats = parseInt(btn.getAttribute('data-beats'), 10);
            const ws = deck === 'a' ? wavesurferA : wavesurferB;
            const bpm = deck === 'a' ? trackBpmA : trackBpmB;
            if (!ws || bpm <= 0) return;
            const currentPitch = parseFloat(document.getElementById(`deck-${deck}-pitch`).value) || 1.0;
            const currentBpm = bpm * currentPitch;
            const jumpSec = beats * (60.0 / currentBpm);
            const targetTime = Math.max(0, Math.min(ws.getDuration(), ws.getCurrentTime() + jumpSec));
            ws.setTime(targetTime);
        });
    });
}

/* ==========================================================================
   STUDIO DEMO TRACKS SYNTHESIZER
   ========================================================================== */

async function generateStudioDemoTracks() {
    const demoBtn = document.getElementById('demo-btn');
    if (demoBtn) {
        demoBtn.disabled = true;
        demoBtn.innerHTML = `Synthesizing Demos...`;
    }
    
    try {
        const demo1 = await synthesizeDemoAudio({
            bpm: 124.0,
            keyRoot: 220.0, // A3
            isMinor: true,
            title: "Deep Tech Horizon",
            camelot: "8A",
            standard: "A Minor",
            energy: 7,
            genre: "Deep House",
            cues: [
                { time: 0.0, label: "Intro 1.1.1" },
                { time: 7.742, label: "Drop 1" },
                { time: 15.484, label: "Breakdown" },
                { time: 23.226, label: "Peak Drop" }
            ]
        });
        
        const demo2 = await synthesizeDemoAudio({
            bpm: 126.0,
            keyRoot: 164.81, // E3 (Camelot 9A harmonic match)
            isMinor: true,
            title: "Neon Sunset Groove",
            camelot: "9A",
            standard: "E Minor",
            energy: 8,
            genre: "Tech House",
            cues: [
                { time: 0.0, label: "Intro 1.1.1" },
                { time: 7.619, label: "Drop 1" },
                { time: 15.238, label: "Breakdown" },
                { time: 22.857, label: "Drop 2" }
            ]
        });
        
        injectTrackIntoLibrary(demo1);
        injectTrackIntoLibrary(demo2);
        
        // Auto-load demo 1 into Deck A and demo 2 into Deck B for instant hands-on mixing
        initMixerDecks();
        loadTrackToDeck('a', 0);
        loadTrackToDeck('b', 1);
        
        if (exportRekordboxBtn) exportRekordboxBtn.disabled = false;
        exportCsvBtn.disabled = false;
        exportM3u8Btn.disabled = false;
        
        if (demoBtn) {
            demoBtn.innerHTML = `✔ Demos Loaded!`;
            setTimeout(() => {
                demoBtn.disabled = false;
                demoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg> Load Studio Demos`;
            }, 2000);
        }
    } catch (e) {
        console.error("Demo synthesis error:", e);
        if (demoBtn) {
            demoBtn.disabled = false;
            demoBtn.innerHTML = `Load Studio Demos`;
        }
    }
}

async function synthesizeDemoAudio({ bpm, keyRoot, isMinor, title, camelot, standard, energy, genre, cues }) {
    const bars = 16;
    const duration = (bars * 4 * 60) / bpm;
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const beatInterval = 60.0 / bpm;
    
    // Synthesize 909 kicks on quarter notes
    for (let beat = 0; beat < bars * 4; beat++) {
        const time = beat * beatInterval;
        
        const kickOsc = offlineCtx.createOscillator();
        const kickGain = offlineCtx.createGain();
        kickOsc.connect(kickGain);
        kickGain.connect(offlineCtx.destination);
        
        kickOsc.frequency.setValueAtTime(140, time);
        kickOsc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
        
        kickGain.gain.setValueAtTime(0.85, time);
        kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
        
        kickOsc.start(time);
        kickOsc.stop(time + 0.3);
        
        // Hi-Hat on offbeats
        const hatTime = time + beatInterval * 0.5;
        const hatBuf = offlineCtx.createBuffer(1, Math.floor(sampleRate * 0.05), sampleRate);
        const data = hatBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.012));
        const hatSrc = offlineCtx.createBufferSource();
        const hatFilter = offlineCtx.createBiquadFilter();
        hatFilter.type = 'highpass';
        hatFilter.frequency.value = 7500;
        const hatGain = offlineCtx.createGain();
        hatGain.gain.value = 0.35;
        
        hatSrc.buffer = hatBuf;
        hatSrc.connect(hatFilter);
        hatFilter.connect(hatGain);
        hatGain.connect(offlineCtx.destination);
        
        hatSrc.start(hatTime);
    }
    
    // Synthesize rolling bassline on 16ths
    const bassNotes = isMinor ? [keyRoot * 0.5, keyRoot * 0.594, keyRoot * 0.667, keyRoot * 0.749] : [keyRoot * 0.5, keyRoot * 0.561, keyRoot * 0.667, keyRoot * 0.749];
    for (let bar = 0; bar < bars; bar++) {
        for (let step = 0; step < 16; step++) {
            if (step % 2 === 1 || step === 0 || step === 6 || step === 10) {
                const noteTime = bar * (beatInterval * 4) + step * (beatInterval * 0.25);
                const noteFreq = bassNotes[(bar + Math.floor(step / 4)) % bassNotes.length];
                
                const bassOsc = offlineCtx.createOscillator();
                bassOsc.type = 'sawtooth';
                const bassFilter = offlineCtx.createBiquadFilter();
                bassFilter.type = 'lowpass';
                bassFilter.frequency.setValueAtTime(450, noteTime);
                bassFilter.frequency.exponentialRampToValueAtTime(140, noteTime + 0.12);
                
                const bassGain = offlineCtx.createGain();
                bassGain.gain.setValueAtTime(0.48, noteTime);
                bassGain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.15);
                
                bassOsc.connect(bassFilter);
                bassFilter.connect(bassGain);
                bassGain.connect(offlineCtx.destination);
                
                bassOsc.frequency.setValueAtTime(noteFreq, noteTime);
                bassOsc.start(noteTime);
                bassOsc.stop(noteTime + 0.18);
            }
        }
    }
    
    const rendered = await offlineCtx.startRendering();
    const wavBlob = audioBufferToWavBlob(rendered);
    const fileName = `${camelot} - ${energy} - ${title}.wav`;
    const file = new File([wavBlob], fileName, { type: 'audio/wav' });
    
    return {
        file,
        fileName,
        title,
        bpm: bpm.toFixed(2),
        key: camelot,
        keyText: standard,
        energy,
        genre,
        cues,
        beatOffset: 0.0,
        tags: [genre, "Club Ready", "Mastered"]
    };
}

function audioBufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const numSamples = buffer.length;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);
    
    function writeString(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    
    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    const ch0 = buffer.getChannelData(0);
    const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;
    
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        let s0 = Math.max(-1, Math.min(1, ch0[i]));
        view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF, true);
        offset += 2;
        if (numChannels > 1) {
            let s1 = Math.max(-1, Math.min(1, ch1[i]));
            view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF, true);
            offset += 2;
        }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function injectTrackIntoLibrary(trackData) {
    const rowId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    fileRegistry[rowId] = trackData.file;
    
    const trackEntry = {
        originalName: trackData.title + ".wav",
        newName: trackData.fileName,
        bpm: trackData.bpm,
        key: trackData.key,
        keyText: trackData.keyText,
        energy: trackData.energy,
        genre: trackData.genre,
        rating: 5,
        tuningHz: 440.0,
        tuningCents: 0,
        cues: trackData.cues,
        tags: trackData.tags,
        grouping: `Energy ${trackData.energy}`,
        comments: trackData.tags.join(", "),
        beatOffset: trackData.beatOffset,
        fileObject: trackData.file,
        rowId: rowId
    };
    
    exportData.push(trackEntry);
    const trackIndex = exportData.length - 1;
    
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = 'track-row ready';
    tr.setAttribute('data-key', trackData.key);
    tr.setAttribute('data-key-text', trackData.keyText);
    tr.setAttribute('data-bpm', trackData.bpm);
    tr.setAttribute('data-energy', trackData.energy);
    tr.setAttribute('data-genre', trackData.genre);
    tr.setAttribute('data-tags', trackData.tags.join(', '));
    
    const badgeColour = `var(--cam-${trackData.key.toLowerCase()})`;
    
    tr.innerHTML = `
        <td class="track-name" title="${trackData.title}">${trackData.title}</td>
        <td class="new-name" title="${trackData.fileName}">${trackData.fileName}</td>
        <td class="bpm-value">
            <div class="bpm-container">
                <span class="bpm-num">${trackData.bpm}</span>
                <div class="bpm-multiplier-btns">
                    <button class="bpm-btn btn-bpm-double" title="Double BPM" data-row="${rowId}">2×</button>
                    <button class="bpm-btn btn-bpm-half" title="Halve BPM" data-row="${rowId}">½</button>
                </div>
            </div>
        </td>
        <td>
            <span class="badge" style="background-color: ${badgeColour}; color: #000;">${trackData.key}</span>
            <span class="match-indicator">Match</span>
        </td>
        <td class="energy-value">${getEnergyBarHtml(trackData.energy)}</td>
        <td class="genre-value">${trackData.genre}</td>
        <td class="tags-value">${renderTagBadgesHtml(trackData.tags)}</td>
        <td class="status complete">Ready</td>
        <td class="action-cell">
            <button class="action-icon-btn add-to-setlist-btn" data-index="${trackIndex}" title="Add to Setlist Timeline">
                + Setlist
            </button>
        </td>
    `;
    
    tr.querySelector('.btn-bpm-double').addEventListener('click', (e) => {
        e.stopPropagation();
        adjustTrackBpm(rowId, 2.0);
    });
    tr.querySelector('.btn-bpm-half').addEventListener('click', (e) => {
        e.stopPropagation();
        adjustTrackBpm(rowId, 0.5);
    });
    tr.querySelector('.add-to-setlist-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackToSetlist(trackIndex);
    });
    
    resultsBody.appendChild(tr);
    addTrackToSetlist(trackIndex);
    populateSidebarGenres();
    renderSetlistSidebar();
}

/* ==========================================================================
   DRAG AND DROP FILE PROCESSING
   ========================================================================== */

function setupDragAndDropHandlers() {
    ['dragenter', 'dragover'].forEach(name => {
        window.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.add('drop-zone-active');
        });
    });
    
    ['dragleave', 'drop'].forEach(name => {
        window.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.remove('drop-zone-active');
        });
    });
    
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        const validExtensions = ['.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.ogg', '.aac'];
        const files = Array.from(e.dataTransfer.files).filter(f => {
            const lower = f.name.toLowerCase();
            return validExtensions.some(ext => lower.endsWith(ext));
        });
        if (files.length > 0) {
            await processUploadedFileList(files);
        }
    });
}

async function processUploadedFileList(files) {
    if (!files || files.length === 0) return;
    
    isAnalyzing = true;
    progressContainer.style.display = 'block';
    progressText.style.display = 'block';
    updateProgress(0, files.length);
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rowId = `track-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        const tr = document.createElement('tr');
        tr.id = rowId;
        tr.className = 'track-row';
        tr.innerHTML = `
            <td class="track-name" title="${file.name}">${file.name}</td>
            <td class="new-name" title="-">-</td>
            <td class="bpm-value">-</td>
            <td>
                <span class="badge" style="background-color: var(--border-colour); color: var(--text-main);">-</span>
                <span class="match-indicator">Match</span>
            </td>
            <td class="energy-value">-</td>
            <td class="genre-value">-</td>
            <td class="tags-value">-</td>
            <td class="status loading">Analysing...</td>
            <td class="action-cell">-</td>
        `;
        resultsBody.appendChild(tr);
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const parsedTags = parseID3TagsFromBuffer(arrayBuffer);
            const genre = parsedTags.genre || "Unknown";
            
            const decodedAudio = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            const channelData = decodedAudio.getChannelData(0);
            
            const workerIndex = i % poolSize;
            const dspResult = await analyseInWorker(channelData, decodedAudio.sampleRate, workerIndex);
            
            const bpm = dspResult.bpm || 120.0;
            const camelotCode = dspResult.camelotCode || "8A";
            const keyText = dspResult.keyText || "A Minor";
            const energyLevel = dspResult.energyLevel || calculateEnergyLevel(channelData);
            const performanceTags = dspResult.tags || [];
            const groupingStr = dspResult.grouping || `Energy ${energyLevel}`;
            const commentsStr = dspResult.comments || performanceTags.join(", ");
            const genreVal = dspResult.genre || (genre !== "Unknown" ? genre : "House");
            const beatOffset = dspResult.beatOffset || locateBeatGrid(channelData, decodedAudio.sampleRate, bpm);
            
            const format = notationSelect.value;
            const chosenKey = formatKey(camelotCode, keyText, format);
            const energyStr = (energyLevel !== '--') ? `${energyLevel} - ` : '';
            const cleanFilename = stripKeyPrefix(file.name);
            const savedFilename = optFilename.checked ? `${chosenKey} - ${energyStr}${cleanFilename}` : file.name;
            
            fileRegistry[rowId] = file;
            
            exportData.push({
                originalName: file.name,
                newName: savedFilename,
                bpm: bpm,
                key: camelotCode,
                keyText: keyText,
                energy: energyLevel,
                genre: genreVal,
                rating: dspResult.rating || 3,
                tuningHz: dspResult.tuningHz || 440.0,
                tuningCents: dspResult.tuningCents || 0,
                cues: dspResult.cues || [],
                tags: performanceTags,
                grouping: groupingStr,
                comments: commentsStr,
                beatOffset: beatOffset,
                fileObject: file,
                rowId: rowId
            });
            
            const trackIndex = exportData.length - 1;
            const badgeColour = camelotCode !== "Unknown" ? `var(--cam-${camelotCode.toLowerCase()})` : "var(--border-colour)";
            
            tr.setAttribute('data-key', camelotCode);
            tr.setAttribute('data-key-text', keyText);
            tr.setAttribute('data-bpm', bpm);
            tr.setAttribute('data-energy', energyLevel);
            tr.setAttribute('data-genre', genreVal);
            tr.setAttribute('data-tags', commentsStr || performanceTags.join(', '));
            tr.classList.add('ready');
            
            tr.querySelector('.new-name').textContent = savedFilename;
            tr.querySelector('.bpm-value').innerHTML = `
                <div class="bpm-container">
                    <span class="bpm-num">${bpm}</span>
                    <div class="bpm-multiplier-btns">
                        <button class="bpm-btn btn-bpm-double" title="Double BPM" data-row="${rowId}">2×</button>
                        <button class="bpm-btn btn-bpm-half" title="Halve BPM" data-row="${rowId}">½</button>
                    </div>
                </div>
            `;
            tr.querySelector('.btn-bpm-double').addEventListener('click', (e) => {
                e.stopPropagation();
                adjustTrackBpm(rowId, 2.0);
            });
            tr.querySelector('.btn-bpm-half').addEventListener('click', (e) => {
                e.stopPropagation();
                adjustTrackBpm(rowId, 0.5);
            });
            
            tr.querySelector('.energy-value').innerHTML = getEnergyBarHtml(energyLevel);
            tr.querySelector('.genre-value').textContent = genreVal;
            tr.querySelector('.tags-value').innerHTML = renderTagBadgesHtml(performanceTags);
            
            const badge = tr.querySelector('.badge');
            badge.textContent = chosenKey;
            badge.style.backgroundColor = badgeColour;
            badge.style.color = '#000';
            
            const status = tr.querySelector('.status');
            status.textContent = 'Ready';
            status.className = 'status complete';
            
            const actionCell = tr.querySelector('.action-cell');
            actionCell.innerHTML = `
                <button class="action-icon-btn add-to-setlist-btn" data-index="${trackIndex}" title="Add to Setlist Timeline">
                    + Setlist
                </button>
            `;
            actionCell.querySelector('.add-to-setlist-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                addTrackToSetlist(trackIndex);
            });
            
            addTrackToSetlist(trackIndex);
            
        } catch (err) {
            console.error(`Error analysing ${file.name}:`, err);
            const status = tr.querySelector('.status');
            if (status) {
                status.textContent = 'Error';
                status.className = 'status error';
            }
        }
        
        updateProgress(i + 1, files.length);
    }
    
    isAnalyzing = false;
    progressText.textContent = "Processing Complete!";
    if (exportRekordboxBtn) exportRekordboxBtn.disabled = false;
    exportCsvBtn.disabled = false;
    exportM3u8Btn.disabled = false;
    populateSidebarGenres();
    renderSetlistSidebar();
}



