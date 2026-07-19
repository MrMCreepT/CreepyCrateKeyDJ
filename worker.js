// CreepyCrate Worker: Universal Electronic Music DSP Engine for Key, BPM, & Tagging System

self.onmessage = function(e) {
    const { taskId, channelData, sampleRate } = e.data;
    
    try {
        const bpm = detectBPM(channelData, sampleRate);
        const { keyText, camelotCode, correlationScore, isMajor } = detectKey(channelData, sampleRate);
        const tagsResult = extractUniversalElectronicTags(channelData, sampleRate, isMajor, correlationScore, bpm);
        
        self.postMessage({ 
            taskId, 
            bpm, 
            keyText, 
            camelotCode, 
            correlationScore,
            genre: tagsResult.genre,
            mood: tagsResult.mood,
            energyLevel: tagsResult.energyLevel,
            tags: tagsResult.vibesAndInstruments,
            grouping: tagsResult.grouping,
            comments: tagsResult.comments,
            success: true 
        });
    } catch (error) {
        self.postMessage({ taskId, error: error.message, success: false });
    }
};

/* ==========================================================================
   PART 1: ELEVATING KEY ANALYSIS ACCURACY (DSP PIPELINE)
   ========================================================================== */

function applyBandpassFilter(data, sampleRate, hpCutoff = 60, lpCutoff = 2200) {
    const filtered = new Float32Array(data.length);
    
    const w0_hp = (2 * Math.PI * hpCutoff) / sampleRate;
    const alpha_hp = Math.sin(w0_hp) / (2 * 0.7071);
    const cos_hp = Math.cos(w0_hp);
    const b0_hp = (1 + cos_hp) / 2;
    const b1_hp = -(1 + cos_hp);
    const b2_hp = (1 + cos_hp) / 2;
    const a0_hp = 1 + alpha_hp;
    const a1_hp = -2 * cos_hp;
    const a2_hp = 1 - alpha_hp;
    
    const w0_lp = (2 * Math.PI * lpCutoff) / sampleRate;
    const alpha_lp = Math.sin(w0_lp) / (2 * 0.7071);
    const cos_lp = Math.cos(w0_lp);
    const b0_lp = (1 - cos_lp) / 2;
    const b1_lp = 1 - cos_lp;
    const b2_lp = (1 - cos_lp) / 2;
    const a0_lp = 1 + alpha_lp;
    const a1_lp = -2 * cos_lp;
    const a2_lp = 1 - alpha_lp;
    
    let x1_hp = 0, x2_hp = 0, y1_hp = 0, y2_hp = 0;
    let x1_lp = 0, x2_lp = 0, y1_lp = 0, y2_lp = 0;
    
    for (let i = 0; i < data.length; i++) {
        const x = data[i];
        const y_hp = (b0_hp / a0_hp) * x + (b1_hp / a0_hp) * x1_hp + (b2_hp / a0_hp) * x2_hp 
                   - (a1_hp / a0_hp) * y1_hp - (a2_hp / a0_hp) * y2_hp;
        x2_hp = x1_hp; x1_hp = x; y2_hp = y1_hp; y1_hp = y_hp;
        
        const y_lp = (b0_lp / a0_lp) * y_hp + (b1_lp / a0_lp) * x1_lp + (b2_lp / a0_lp) * x2_lp 
                   - (a1_lp / a0_lp) * y1_lp - (a2_lp / a0_lp) * y2_lp;
        x2_lp = x1_lp; x1_lp = y_hp; y2_lp = y1_lp; y1_lp = y_lp;
        
        filtered[i] = y_lp;
    }
    
    return filtered;
}

function pearsonCorrelation(x, y) {
    const n = 12;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const diffX = x[i] - meanX;
        const diffY = y[i] - meanY;
        num += diffX * diffY;
        denX += diffX * diffX;
        denY += diffY * diffY;
    }
    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
}

function detectKey(channelData, sampleRate) {
    const totalSamples = channelData.length;
    
    // Multi-window sampling across the track (15%, 30%, 50%, 70%, 85%)
    const windowRatios = [0.15, 0.30, 0.50, 0.70, 0.85];
    const snippetSec = 10;
    const snippetSamples = Math.floor(snippetSec * sampleRate);
    
    const targetSampleRate = 11025;
    const factor = Math.max(1, Math.round(sampleRate / targetSampleRate));
    const dsSampleRate = sampleRate / factor;
    
    const minMidi = 35; // B1 (~61.7 Hz) - capturing sub-bass fundamentals
    const maxMidi = 84; // C6 (~1046.5 Hz)
    const numNotes = maxMidi - minMidi + 1;
    const freqs = new Float32Array(numNotes);
    for (let m = 0; m < numNotes; m++) {
        freqs[m] = 440 * Math.pow(2, (m + minMidi - 69) / 12);
    }
    
    const N = 1024;
    const hop = 512;
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
        window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    
    const cosTable = [];
    const sinTable = [];
    for (let f = 0; f < numNotes; f++) {
        const omega = (2 * Math.PI * freqs[f]) / dsSampleRate;
        const cosRow = new Float32Array(N);
        const sinRow = new Float32Array(N);
        for (let k = 0; k < N; k++) {
            cosRow[k] = Math.cos(omega * k);
            sinRow[k] = Math.sin(omega * k);
        }
        cosTable.push(cosRow);
        sinTable.push(sinRow);
    }
    
    const chromaTotal = new Float32Array(12);
    const chromaBass = new Float32Array(12);
    
    for (let w = 0; w < windowRatios.length; w++) {
        const centerSample = Math.floor(totalSamples * windowRatios[w]);
        const startSample = Math.max(0, Math.min(totalSamples - snippetSamples, centerSample - Math.floor(snippetSamples / 2)));
        if (startSample < 0 || startSample + snippetSamples > totalSamples) continue;
        
        const rawSnippet = channelData.subarray(startSample, startSample + snippetSamples);
        const filteredSnippet = applyBandpassFilter(rawSnippet, sampleRate, 60, 2200);
        
        const dsPcm = [];
        for (let i = 0; i < filteredSnippet.length; i += factor) {
            dsPcm.push(filteredSnippet[i]);
        }
        
        for (let offset = 0; offset + N <= dsPcm.length; offset += hop) {
            const frame = new Float32Array(N);
            for (let k = 0; k < N; k++) {
                frame[k] = dsPcm[offset + k] * window[k];
            }
            
            for (let f = 0; f < numNotes; f++) {
                const freq = freqs[f];
                if (freq < 60 || freq > 2000) continue;
                
                let real = 0;
                let imag = 0;
                const cosRow = cosTable[f];
                const sinRow = sinTable[f];
                for (let k = 0; k < N; k++) {
                    real += frame[k] * cosRow[k];
                    imag += frame[k] * sinRow[k];
                }
                const mag = Math.sqrt(real * real + imag * imag);
                const pitchClass = (minMidi + f) % 12;
                
                chromaTotal[pitchClass] += mag;
                if (freq <= 250) {
                    chromaBass[pitchClass] += mag * 1.5; // Weight sub-bass fundamentals heavier
                }
            }
        }
    }
    
    // Normalize chromaTotal
    const sumChroma = chromaTotal.reduce((a, b) => a + b, 0);
    if (sumChroma > 0) {
        for (let i = 0; i < 12; i++) {
            chromaTotal[i] /= sumChroma;
        }
    }
    
    // Normalize chromaBass
    const sumBass = chromaBass.reduce((a, b) => a + b, 0);
    if (sumBass > 0) {
        for (let i = 0; i < 12; i++) {
            chromaBass[i] /= sumBass;
        }
    }
    
    // Harmonic Overtone Attenuation: Suppress false 5th (+7 semitones) & major 3rd (+4 semitones) acoustic overtones
    const cleanedChroma = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
        cleanedChroma[i] = chromaTotal[i];
    }
    for (let i = 0; i < 12; i++) {
        const fifth = (i + 7) % 12;
        const majorThird = (i + 4) % 12;
        cleanedChroma[fifth] = Math.max(0, cleanedChroma[fifth] - chromaTotal[i] * 0.22);
        cleanedChroma[majorThird] = Math.max(0, cleanedChroma[majorThird] - chromaTotal[i] * 0.12);
    }
    
    // Normalize cleanedChroma
    const sumCleaned = cleanedChroma.reduce((a, b) => a + b, 0);
    if (sumCleaned > 0) {
        for (let i = 0; i < 12; i++) {
            cleanedChroma[i] /= sumCleaned;
        }
    }
    
    // Sha'ath Electronic Music Key Profiles (KeyFinder standard)
    const shaathMajor = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.383, 0.084, 0.352];
    const shaathMinor = [0.712, 0.084, 0.376, 0.608, 0.104, 0.460, 0.096, 0.715, 0.396, 0.116, 0.456, 0.096];
    
    // Temperley Key Profiles for secondary validation
    const temperleyMajor = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
    const temperleyMinor = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 3.5];
    
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    const camelotMap = {
        "C Major": "8B",  "C Minor": "5A", "C# Major": "3B", "C# Minor": "12A",
        "D Major": "10B", "D Minor": "7A", "D# Major": "5B", "D# Minor": "2A",
        "E Major": "12B", "E Minor": "9A", "F Major": "7B",  "F Minor": "4A",
        "F# Major": "2B", "F# Minor": "11A", "G Major": "9B",  "G Minor": "6A",
        "G# Major": "4B", "G# Minor": "1A", "A Major": "11B", "A Minor": "8A",
        "A# Major": "6B", "A# Minor": "3A", "B Major": "1B",  "B Minor": "10A"
    };
    
    const keyCandidates = [];
    
    for (let shift = 0; shift < 12; shift++) {
        const shiftedShaathMaj = new Array(12);
        const shiftedShaathMin = new Array(12);
        const shiftedTempMaj = new Array(12);
        const shiftedTempMin = new Array(12);
        
        for (let i = 0; i < 12; i++) {
            const idx = (i - shift + 12) % 12;
            shiftedShaathMaj[i] = shaathMajor[idx];
            shiftedShaathMin[i] = shaathMinor[idx];
            shiftedTempMaj[i] = temperleyMajor[idx];
            shiftedTempMin[i] = temperleyMinor[idx];
        }
        
        const sMajCorr = pearsonCorrelation(cleanedChroma, shiftedShaathMaj);
        const sMinCorr = pearsonCorrelation(cleanedChroma, shiftedShaathMin);
        const tMajCorr = pearsonCorrelation(cleanedChroma, shiftedTempMaj);
        const tMinCorr = pearsonCorrelation(cleanedChroma, shiftedTempMin);
        
        const majCombined = 0.75 * sMajCorr + 0.25 * tMajCorr;
        const minCombined = 0.75 * sMinCorr + 0.25 * tMinCorr;
        
        keyCandidates.push({ root: shift, isMajor: true, keyText: `${noteNames[shift]} Major`, score: majCombined });
        keyCandidates.push({ root: shift, isMajor: false, keyText: `${noteNames[shift]} Minor`, score: minCombined });
    }
    
    keyCandidates.sort((a, b) => b.score - a.score);
    
    let bestKey = keyCandidates[0];
    let secondBest = keyCandidates[1];
    
    // Relative Major / Relative Minor Bass Disambiguation
    // If the top 2 candidates are relative major/minor (e.g. C Major [0] vs A Minor [9], delta root = +3 semitones for Major)
    // and their correlation scores are within 0.05 of each other, check bass fundamental root.
    if (secondBest && (bestKey.score - secondBest.score < 0.05)) {
        let majCandidate = null;
        let minCandidate = null;
        if (bestKey.isMajor && !secondBest.isMajor) {
            majCandidate = bestKey;
            minCandidate = secondBest;
        } else if (!bestKey.isMajor && secondBest.isMajor) {
            minCandidate = bestKey;
            majCandidate = secondBest;
        }
        
        if (majCandidate && minCandidate) {
            const isRelativePair = ((minCandidate.root + 3) % 12) === majCandidate.root;
            if (isRelativePair) {
                const minBassEnergy = chromaBass[minCandidate.root] || 0;
                const majBassEnergy = chromaBass[majCandidate.root] || 0;
                
                // In electronic music, minor keys heavily dominate, and bass root is decisive
                if (minBassEnergy >= majBassEnergy * 0.85) {
                    bestKey = minCandidate;
                } else {
                    bestKey = majCandidate;
                }
            }
        }
    }
    
    return {
        keyText: bestKey.keyText,
        camelotCode: camelotMap[bestKey.keyText] || "Unknown",
        correlationScore: parseFloat(bestKey.score.toFixed(3)),
        isMajor: bestKey.isMajor
    };
}

/* ==========================================================================
   PART 2: MASTER PLAYLIST SEPARATION DSP TAG CALCULATOR (4-TIER ARCHITECTURE)
   ========================================================================== */

function extractUniversalElectronicTags(channelData, sampleRate, isMajor = false, correlationScore = 0.8, bpmVal = 124) {
    const len = channelData.length;
    const bpm = (typeof bpmVal === 'number' && bpmVal > 0) ? bpmVal : 124;
    
    // 1. Loudness, Crest Factor, Energy Level
    const sampleLimit = Math.min(len, 2000000);
    const step = Math.max(1, Math.floor(sampleLimit / 100000));
    let sumSquares = 0;
    let peakAmp = 0;
    let count = 0;
    
    for (let i = 0; i < sampleLimit; i += step) {
        const absVal = Math.abs(channelData[i]);
        if (absVal > peakAmp) peakAmp = absVal;
        sumSquares += absVal * absVal;
        count++;
    }
    
    const rms = Math.sqrt(sumSquares / count);
    const rmsDbFS = 20 * Math.log10(rms + 1e-9);
    const crestFactor = rms > 0 ? peakAmp / rms : 0;
    
    let energyLevel = Math.round(((rms - 0.04) / (0.28 - 0.04)) * 9) + 1;
    energyLevel = Math.max(1, Math.min(10, energyLevel));
    
    // LAYER 1: Set Placement / Energy Transition Tag
    let setTimeEnergy = "Build";
    if (rmsDbFS < -13.5) setTimeEnergy = "Start";
    else if (rmsDbFS > -8.5 && crestFactor < 4.2) setTimeEnergy = "Peak";
    else if (rmsDbFS > -7.2) setTimeEnergy = "Sustain";
    
    // Multiband Normalized Spectral Analysis
    const fftWindowSize = 2048;
    const numWindows = Math.min(40, Math.floor(len / fftWindowSize));
    const halfN = fftWindowSize / 2;
    
    let subBandEnergy = 0;       // 20 - 80 Hz
    let lowMidBandEnergy = 0;    // 80 - 300 Hz
    let midBandEnergy = 0;       // 300 - 1500 Hz
    let vocalBandEnergy = 0;     // 300 - 3400 Hz
    let highFreqEnergy = 0;      // 5000 - 12000 Hz
    let totalBandEnergy = 0;
    
    let activeBinsCount = 0;
    let prevSpectrum = null;
    let totalSpectralFlux = 0;
    let sharpTransientSpikes = 0;
    let acidResonancePeakRatioSum = 0;
    let vocalPeakRatioSum = 0;
    let pianoKeysRatioSum = 0;
    let guitarChankRatioSum = 0;
    let congaPercRatioSum = 0;
    let jackinSwingSpikes = 0;
    let synthLeadPeakRatioSum = 0;
    let reeseModulationCount = 0;
    let organCount = 0;
    
    for (let w = 0; w < numWindows; w++) {
        const offset = Math.floor((len / (numWindows + 1)) * (w + 1));
        const spectrum = new Float32Array(halfN);
        
        let windowVocalSum = 0, windowVocalCount = 0, windowVocalMax = 0;
        let windowLowMidSum = 0, windowLowMidCount = 0, windowLowMidMax = 0;
        let windowAcidSum = 0, windowAcidCount = 0, windowAcidMax = 0;
        let windowGuitarSum = 0, windowGuitarCount = 0, windowGuitarMax = 0;
        let windowSynthSum = 0, windowSynthCount = 0, windowSynthMax = 0;
        
        for (let k = 0; k < halfN; k++) {
            const freq = (k * sampleRate) / fftWindowSize;
            if (freq > 20000) break;
            
            let real = 0, imag = 0;
            const omega = (2 * Math.PI * k) / fftWindowSize;
            for (let n = 0; n < fftWindowSize; n += 4) {
                const val = channelData[offset + n] || 0;
                real += val * Math.cos(omega * n);
                imag += val * Math.sin(omega * n);
            }
            const mag = Math.sqrt(real * real + imag * imag) / (fftWindowSize / 2);
            spectrum[k] = mag;
            
            if (mag > 0.005) activeBinsCount++;
            totalBandEnergy += mag;
            
            if (freq >= 20 && freq <= 80) subBandEnergy += mag;
            if (freq >= 80 && freq <= 300) {
                lowMidBandEnergy += mag;
                windowLowMidSum += mag;
                windowLowMidCount++;
                if (mag > windowLowMidMax) windowLowMidMax = mag;
            }
            if (freq >= 300 && freq <= 1500) midBandEnergy += mag;
            if (freq >= 300 && freq <= 3400) {
                vocalBandEnergy += mag;
                windowVocalSum += mag;
                windowVocalCount++;
                if (mag > windowVocalMax) windowVocalMax = mag;
            }
            if (freq >= 5000 && freq <= 12000) highFreqEnergy += mag;
            
            if (freq >= 400 && freq <= 2200) {
                windowAcidSum += mag;
                windowAcidCount++;
                if (mag > windowAcidMax) windowAcidMax = mag;
            }
            if (freq >= 1000 && freq <= 4000) {
                windowGuitarSum += mag;
                windowGuitarCount++;
                if (mag > windowGuitarMax) windowGuitarMax = mag;
            }
            if (freq >= 800 && freq <= 4500) {
                windowSynthSum += mag;
                windowSynthCount++;
                if (mag > windowSynthMax) windowSynthMax = mag;
            }
        }
        
        const acidAvg = windowAcidCount > 0 ? windowAcidSum / windowAcidCount : 0.0001;
        if (windowAcidMax / acidAvg > 4.8 && windowAcidMax > 0.025) acidResonancePeakRatioSum++;
        
        const vocalAvg = windowVocalCount > 0 ? windowVocalSum / windowVocalCount : 0.0001;
        if (windowVocalMax / vocalAvg > 3.8 && windowVocalMax > 0.020) vocalPeakRatioSum++;
        if (windowVocalMax > 0.035 && isMajor) organCount++;
        
        const lowMidAvg = windowLowMidCount > 0 ? windowLowMidSum / windowLowMidCount : 0.0001;
        if (windowLowMidMax / lowMidAvg > 4.2 && windowLowMidMax > 0.030) pianoKeysRatioSum++;
        
        const guitarAvg = windowGuitarCount > 0 ? windowGuitarSum / windowGuitarCount : 0.0001;
        if (windowGuitarMax / guitarAvg > 3.8 && windowGuitarMax > 0.020) guitarChankRatioSum++;
        
        const synthAvg = windowSynthCount > 0 ? windowSynthSum / windowSynthCount : 0.0001;
        if (windowSynthMax / synthAvg > 4.5 && windowSynthMax > 0.025) synthLeadPeakRatioSum++;
        
        if (lowMidAvg > 0.022 && isMajor) congaPercRatioSum++;
        
        if (prevSpectrum) {
            let flux = 0;
            for (let k = 0; k < halfN; k++) {
                const diff = spectrum[k] - prevSpectrum[k];
                if (diff > 0) flux += diff;
            }
            totalSpectralFlux += flux;
            if (flux > 0.18) sharpTransientSpikes++;
            if (flux > 0.10 && flux <= 0.17) jackinSwingSpikes++;
            
            const prevSub = prevSpectrum.subarray(2, 8).reduce((a, b) => a + b, 0);
            const currSub = spectrum.subarray(2, 8).reduce((a, b) => a + b, 0);
            if (Math.abs(currSub - prevSub) > 0.04) reeseModulationCount++;
        }
        prevSpectrum = spectrum;
    }
    
    // LAYER 3: Mood
    let mood = "Floating / Dreamy";
    const avgFlux = numWindows > 1 ? totalSpectralFlux / (numWindows - 1) : 0;
    const subRatio = totalBandEnergy > 0 ? subBandEnergy / totalBandEnergy : 0;
    const lowMidRatio = totalBandEnergy > 0 ? lowMidBandEnergy / totalBandEnergy : 0;
    const vocalRatio = totalBandEnergy > 0 ? vocalBandEnergy / totalBandEnergy : 0;
    const highRatio = totalBandEnergy > 0 ? highFreqEnergy / totalBandEnergy : 0;
    
    if (isMajor && (vocalRatio > 0.35 || correlationScore > 0.75)) {
        mood = "Happy";
    } else if (!isMajor && lowMidRatio > 0.35 && sharpTransientSpikes >= 12) {
        mood = "Aggressive";
    } else if (!isMajor && lowMidRatio > 0.32) {
        mood = "Dark";
    } else if (isMajor && vocalRatio > 0.28) {
        mood = "Emotional / Introspective";
    }
    
    // TIER 1: INSTRUMENTS & BASSLINE (Pick top 1-2)
    const instrumentCandidates = [];
    if (pianoKeysRatioSum >= 6 && isMajor) instrumentCandidates.push({ name: "Piano", score: pianoKeysRatioSum * 3.0 });
    if (vocalPeakRatioSum >= 6) {
        if (isMajor) instrumentCandidates.push({ name: "Rhodes / Keys", score: vocalPeakRatioSum * 2.5 });
        else instrumentCandidates.push({ name: "Singing", score: vocalPeakRatioSum * 3.5 });
    }
    if (synthLeadPeakRatioSum >= 8) instrumentCandidates.push({ name: "Synthesizer Lead", score: synthLeadPeakRatioSum * 2.8 });
    if (organCount >= 8) instrumentCandidates.push({ name: "Organ", score: organCount * 2.5 });
    if (guitarChankRatioSum >= 6) instrumentCandidates.push({ name: "Guitar", score: guitarChankRatioSum * 3.0 });
    if (congaPercRatioSum >= 8) instrumentCandidates.push({ name: "Congas", score: congaPercRatioSum * 2.5 });
    if (acidResonancePeakRatioSum >= 8) {
        instrumentCandidates.push({ name: "Acid", score: acidResonancePeakRatioSum * 3.5 });
        instrumentCandidates.push({ name: "GrindyBass", score: acidResonancePeakRatioSum * 3.0 });
    }
    if (reeseModulationCount >= 10 && (bpm >= 160 || bpm <= 140)) {
        instrumentCandidates.push({ name: "Reese Bass", score: reeseModulationCount * 2.5 });
    }
    if (subRatio > 0.22) instrumentCandidates.push({ name: "BoomingBass", score: subRatio * 120 });
    else if (lowMidRatio > 0.34) instrumentCandidates.push({ name: "WalkingBass", score: lowMidRatio * 100 });
    
    instrumentCandidates.sort((a, b) => b.score - a.score);
    const topInstruments = [];
    const seenInst = new Set();
    for (const item of instrumentCandidates) {
        if (!seenInst.has(item.name)) {
            seenInst.add(item.name);
            topInstruments.push(item.name);
        }
        if (topInstruments.length >= 2) break;
    }
    
    // TIER 2: GROOVE & RHYTHM STYLE (Pick top 1)
    const grooveCandidates = [];
    if (bpm >= 165 && bpm <= 185) {
        grooveCandidates.push({ name: "Jungle Beats", score: 50 });
        grooveCandidates.push({ name: "Breakbeat", score: 45 });
    } else if (bpm >= 135 && bpm <= 150 && crestFactor < 4.5) {
        grooveCandidates.push({ name: "Breakbeat", score: 40 });
        grooveCandidates.push({ name: "Half-Time", score: 35 });
    } else if (bpm >= 138 && bpm <= 150 && sharpTransientSpikes >= 14) {
        grooveCandidates.push({ name: "Rolling 16ths", score: 40 });
    } else if (jackinSwingSpikes >= 12) {
        grooveCandidates.push({ name: "Swung 16ths", score: jackinSwingSpikes * 3.0 });
        grooveCandidates.push({ name: "Jackin' Groove", score: jackinSwingSpikes * 2.8 });
    } else if (congaPercRatioSum >= 10 && (midBandEnergy / totalBandEnergy) > 0.30) {
        grooveCandidates.push({ name: "Afro", score: congaPercRatioSum * 2.5 });
    } else if (vocalRatio < 0.12 && avgFlux < 0.10) {
        grooveCandidates.push({ name: "Dubby", score: 35 });
    } else if (sharpTransientSpikes >= 18) {
        grooveCandidates.push({ name: "Driving", score: sharpTransientSpikes * 1.5 });
    } else {
        grooveCandidates.push({ name: "4/4 Straight", score: 20 });
    }
    
    grooveCandidates.sort((a, b) => b.score - a.score);
    const topGroove = grooveCandidates.length > 0 ? [grooveCandidates[0].name] : [];
    
    // TIER 3: VIBE & ATMOSPHERE (Pick top 1)
    const vibeCandidates = [];
    if (bpm >= 135 && isMajor && correlationScore > 0.75) {
        vibeCandidates.push({ name: "Euphoric", score: 50 });
    } else if (rmsDbFS > -7.5 && acidResonancePeakRatioSum >= 6) {
        vibeCandidates.push({ name: "Industrial", score: 40 });
    } else if (isMajor && vocalRatio > 0.32) {
        vibeCandidates.push({ name: "Soulful / Musical", score: vocalRatio * 100 });
    } else if (isMajor && correlationScore > 0.70) {
        vibeCandidates.push({ name: "Melodic", score: correlationScore * 40 });
    } else if (!isMajor && lowMidRatio > 0.32 && avgFlux < 0.10) {
        vibeCandidates.push({ name: "Deep", score: lowMidRatio * 90 });
    } else if (bpm >= 122 && bpm <= 132 && sharpTransientSpikes >= 12) {
        vibeCandidates.push({ name: "Techy", score: 30 });
    } else if (avgFlux < 0.08 && subRatio < 0.12) {
        vibeCandidates.push({ name: "Ambient", score: 40 });
    }
    
    vibeCandidates.sort((a, b) => b.score - a.score);
    const topVibe = vibeCandidates.length > 0 ? [vibeCandidates[0].name] : [];
    
    // Combine Tier 1 (1-2 Instruments) + Tier 2 (1 Groove) + Tier 3 (1 Vibe) into 3-4 distinct tags
    const finalTags = Array.from(new Set([...topInstruments, ...topGroove, ...topVibe]));
    if (finalTags.length === 0) {
        if (subRatio > 0.18) finalTags.push("BoomingBass");
        if (isMajor) finalTags.push("Melodic");
        else finalTags.push("Deep");
    }
    
    const commentsString = finalTags.join(", ");
    
    return {
        genre: setTimeEnergy, // Set-time energy rating (e.g. Start, Build, Peak, Sustain)
        mood: mood,
        energyLevel,
        vibesAndInstruments: finalTags,
        grouping: `Energy ${energyLevel}`,
        comments: commentsString
    };
}

/* ==========================================================================
   BPM DETECTION (AUTOCORRELATION & FALLBACK)
   ========================================================================== */

function detectBPM(channelData, sampleRate) {
    const startSec = 10;
    const durationSec = 60;
    const startSample = Math.min(channelData.length, Math.floor(startSec * sampleRate));
    const endSample = Math.min(channelData.length, Math.floor((startSec + durationSec) * sampleRate));
    const analysisLength = endSample - startSample;
    
    if (analysisLength < sampleRate * 10) {
        return detectBpmFallback(channelData, sampleRate);
    }
    
    const lpCutoff = 150;
    const lpRc = 1 / (2 * Math.PI * lpCutoff);
    const lpAlpha = 1 / (lpRc * sampleRate + 1);
    
    const envCutoff = 10;
    const envRc = 1 / (2 * Math.PI * envCutoff);
    const envAlpha = 1 / (envRc * sampleRate + 1);
    
    let lpState = 0;
    let envState = 0;
    
    const targetDsRate = 1000;
    const dsStep = Math.round(sampleRate / targetDsRate);
    const dsSampleRate = sampleRate / dsStep;
    
    const fluxLength = Math.floor(analysisLength / dsStep);
    const flux = new Float32Array(fluxLength);
    let prevEnv = 0;
    
    for (let i = 0; i < fluxLength; i++) {
        const blockStart = startSample + i * dsStep;
        const blockEnd = blockStart + dsStep;
        for (let j = blockStart; j < blockEnd; j++) {
            const x = channelData[j];
            lpState = lpState + lpAlpha * (x - lpState);
            const rectified = Math.abs(lpState);
            envState = envState + envAlpha * (rectified - envState);
        }
        flux[i] = Math.max(0, envState - prevEnv);
        prevEnv = envState;
    }
    
    const coarseDsFactor = 5;
    const flux200 = new Float32Array(Math.floor(fluxLength / coarseDsFactor));
    for (let i = 0; i < flux200.length; i++) {
        flux200[i] = flux[i * coarseDsFactor];
    }
    const sampleRate200 = dsSampleRate / coarseDsFactor;
    
    function getAutocorr(data, lag) {
        let sum = 0;
        const len = data.length;
        const start = Math.floor(len * 0.1);
        const end = Math.floor(len * 0.9);
        const lagInt = Math.floor(lag);
        const lagFrac = lag - lagInt;
        
        if (lagFrac === 0) {
            for (let t = start; t < end - lagInt; t++) {
                sum += data[t] * data[t + lagInt];
            }
        } else {
            const oneMinusFrac = 1 - lagFrac;
            for (let t = start; t < end - lagInt - 1; t++) {
                const interp = data[t + lagInt] * oneMinusFrac + data[t + lagInt + 1] * lagFrac;
                sum += data[t] * interp;
            }
        }
        return sum;
    }
    
    let bestCoarseBpm = 120;
    let maxCoarseScore = -1;
    
    for (let bpm = 60; bpm <= 180; bpm++) {
        const lag = (60 / bpm) * sampleRate200;
        const r1 = getAutocorr(flux200, lag);
        const r2 = getAutocorr(flux200, lag * 2);
        const score = r1 + 0.5 * r2;
        
        if (score > maxCoarseScore) {
            maxCoarseScore = score;
            bestCoarseBpm = bpm;
        }
    }
    
    let bestBpm = bestCoarseBpm;
    let maxFineScore = -1;
    
    for (let bpm = bestCoarseBpm - 2; bpm <= bestCoarseBpm + 2; bpm += 0.1) {
        const lag = (60 / bpm) * dsSampleRate;
        const r1 = getAutocorr(flux, lag);
        const r2 = getAutocorr(flux, lag * 2);
        const score = r1 + 0.5 * r2;
        
        if (score > maxFineScore) {
            maxFineScore = score;
            bestBpm = bpm;
        }
    }
    
    return bestBpm > 0 ? parseFloat(bestBpm.toFixed(1)) : 'Unknown';
}

function detectBpmFallback(channelData, sampleRate) {
    let peaks = [];
    const threshold = 0.8; 
    let maxAmp = 0;
    for (let i = 0; i < channelData.length; i++) {
        if (channelData[i] > maxAmp) maxAmp = channelData[i];
    }
    const peakThreshold = maxAmp * threshold;
    for (let i = 0; i < channelData.length; i++) {
        if (channelData[i] > peakThreshold) {
            peaks.push(i);
            i += Math.floor(sampleRate / 4); 
        }
    }
    let intervals = {};
    for (let i = 1; i < peaks.length; i++) {
        const interval = peaks[i] - peaks[i - 1];
        const tempo = Math.round(60 / (interval / sampleRate));
        if (tempo > 60 && tempo < 200) {
            intervals[tempo] = (intervals[tempo] || 0) + 1;
        }
    }
    let maxCount = 0;
    let detectedBpm = 0;
    for (const [tempo, count] of Object.entries(intervals)) {
        if (count > maxCount) {
            maxCount = count;
            detectedBpm = tempo;
        }
    }
    return detectedBpm > 0 ? detectedBpm : 'Unknown';
}
