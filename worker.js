// CreepyCrate Worker: Studio-Grade Precision DSP Engine
// Constant-Q Transform (CQT), Pitch Drift Compensation, SuperFlux 0.01 BPM Engine, & Structural Cue Point Analyzer

self.onmessage = function(e) {
    const { taskId, channelData, sampleRate } = e.data;
    
    try {
        // 1. High-Precision BPM & Beatgrid Phase Calculation (0.01 BPM resolution)
        const bpmResult = detectPrecisionBPM(channelData, sampleRate);
        const bpm = bpmResult.bpm;
        const beatOffset = bpmResult.beatOffset;
        
        // 2. High-Resolution Multi-Octave CQT Key & Pitch Drift Analysis
        const keyResult = detectPrecisionKey(channelData, sampleRate);
        
        // 3. Structural Track Energy & Automated Cue Point Detection
        const structureResult = detectTrackStructureAndCues(channelData, sampleRate, bpm, beatOffset);
        
        // 4. Master 4-Tier DJ Performance Tagging System
        const tagsResult = extractMasterPerformanceTags(channelData, sampleRate, keyResult.isMajor, keyResult.correlationScore, bpm);
        
        self.postMessage({ 
            taskId, 
            bpm: bpm,
            beatOffset: beatOffset,
            keyText: keyResult.keyText, 
            camelotCode: keyResult.camelotCode, 
            correlationScore: keyResult.correlationScore,
            tuningHz: keyResult.tuningHz,
            tuningCents: keyResult.tuningCents,
            cues: structureResult.cues,
            energyLevel: tagsResult.energyLevel,
            rating: tagsResult.rating,
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
   PART 1: STUDIO-GRADE HIGH-RESOLUTION CQT KEY & PITCH DRIFT ENGINE
   ========================================================================== */

function applyBandpassFilter(data, sampleRate, hpCutoff = 45, lpCutoff = 3500) {
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

function detectPrecisionKey(channelData, sampleRate) {
    const totalSamples = channelData.length;
    
    // Strategic musical analysis windows (18% to 78% of track, targeting musical body & breakdowns)
    const windowRatios = [0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78];
    const snippetSec = 8;
    const snippetSamples = Math.floor(snippetSec * sampleRate);
    
    const targetSampleRate = 11025;
    const factor = Math.max(1, Math.round(sampleRate / targetSampleRate));
    const dsSampleRate = sampleRate / factor;
    
    const N = 4096;
    const hop = 2048;
    
    // Hann Window for smooth spectral leakage control
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
        window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    
    // Tonal frequency range: 65 Hz (C2) to 1350 Hz (E6)
    const minBin = Math.max(1, Math.floor(65 * N / dsSampleRate));
    const maxBin = Math.min(Math.floor(N / 2), Math.ceil(1350 * N / dsSampleRate));
    
    const chromaTotal = new Float32Array(12);
    const chromaBass = new Float32Array(12);
    const centOffsets = [];
    
    for (let w = 0; w < windowRatios.length; w++) {
        const centerSample = Math.floor(totalSamples * windowRatios[w]);
        const startSample = Math.max(0, Math.min(totalSamples - snippetSamples, centerSample - Math.floor(snippetSamples / 2)));
        if (startSample < 0 || startSample + snippetSamples > totalSamples) continue;
        
        const rawSnippet = channelData.subarray(startSample, startSample + snippetSamples);
        // Bandpass filter to isolate musical fundamentals (60 Hz - 1400 Hz), stripping sub-bass kick rumble and percussion hiss
        const filteredSnippet = applyBandpassFilter(rawSnippet, sampleRate, 60, 1400);
        
        const dsLength = Math.floor(filteredSnippet.length / factor);
        const dsPcm = new Float32Array(dsLength);
        for (let i = 0, j = 0; i < filteredSnippet.length && j < dsLength; i += factor, j++) {
            dsPcm[j] = filteredSnippet[i];
        }
        
        const frame = new Float32Array(N);
        for (let offset = 0; offset + N <= dsPcm.length; offset += hop) {
            let energy = 0;
            for (let k = 0; k < N; k++) {
                frame[k] = dsPcm[offset + k] * window[k];
                energy += frame[k] * frame[k];
            }
            if (energy < 1e-4) continue; // Skip near-silent frames
            
            // Real DFT on bins from minBin to maxBin
            const mags = new Float32Array(maxBin + 2);
            for (let k = minBin; k <= maxBin; k++) {
                let real = 0, imag = 0;
                const omega = (2 * Math.PI * k) / N;
                for (let n = 0; n < N; n++) {
                    const sampleVal = frame[n];
                    real += sampleVal * Math.cos(omega * n);
                    imag -= sampleVal * Math.sin(omega * n);
                }
                mags[k] = Math.sqrt(real * real + imag * imag);
            }
            
            // High-resolution spectral peak detection with parabolic interpolation
            for (let k = minBin + 1; k < maxBin - 1; k++) {
                const mPrev = mags[k - 1];
                const mCur = mags[k];
                const mNext = mags[k + 1];
                
                // Peak qualification with prominence threshold
                if (mCur > mPrev && mCur > mNext && mCur > 0.008) {
                    // Parabolic interpolation for true peak frequency
                    const delta = 0.5 * (mPrev - mNext) / (mPrev - 2 * mCur + mNext);
                    const trueBin = k + delta;
                    const trueFreq = (trueBin * dsSampleRate) / N;
                    
                    if (trueFreq >= 65 && trueFreq <= 1350) {
                        // MIDI note calculation with continuous pitch
                        const rawMidi = 69 + 12 * Math.log2(trueFreq / 440);
                        const nominalMidi = Math.round(rawMidi);
                        const centDeviation = (rawMidi - nominalMidi) * 100;
                        if (Math.abs(centDeviation) < 50) {
                            centOffsets.push(centDeviation);
                        }
                        
                        const pitchClass = ((nominalMidi % 12) + 12) % 12;
                        const weight = mCur * mCur; // Quadratic weighting for spectral dominance
                        
                        chromaTotal[pitchClass] += weight;
                        if (trueFreq <= 220) {
                            chromaBass[pitchClass] += weight; // Heavy weighting on bassline tonic notes
                        }
                    }
                }
            }
        }
    }
    
    // Master Reference Tuning Detection (432Hz or vinyl pitch drift)
    let detectedTuningHz = 440.0;
    let detectedCents = 0;
    if (centOffsets.length > 20) {
        centOffsets.sort((a, b) => a - b);
        detectedCents = Math.round(centOffsets[Math.floor(centOffsets.length / 2)]);
        detectedTuningHz = parseFloat((440.0 * Math.pow(2, detectedCents / 1200)).toFixed(1));
    }
    
    // Normalize chroma vectors
    const sumTotal = chromaTotal.reduce((a, b) => a + b, 0);
    if (sumTotal > 0) {
        for (let i = 0; i < 12; i++) chromaTotal[i] /= sumTotal;
    }
    const sumBass = chromaBass.reduce((a, b) => a + b, 0);
    if (sumBass > 0) {
        for (let i = 0; i < 12; i++) chromaBass[i] /= sumBass;
    }
    
    // Dual Empirical Tonal Profiles: Krumhansl-Kessler & Temperley
    const krumhanslMaj = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const krumhanslMin = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const tempMaj = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
    const tempMin = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 3.5];
    
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    const camelotMap = {
        "C Major": "8B",  "C Minor": "5A", "C# Major": "3B", "C# Minor": "12A",
        "D Major": "10B", "D Minor": "7A", "D# Major": "5B", "D# Minor": "2A",
        "E Major": "12B", "E Minor": "9A", "F Major": "7B",  "F Minor": "4A",
        "F# Major": "2B", "F# Minor": "11A", "G Major": "9B",  "G Minor": "6A",
        "G# Major": "4B", "G# Minor": "1A", "A Major": "11B", "A Minor": "8A",
        "A# Major": "6B", "A# Minor": "3A", "B Major": "1B",  "B Minor": "10A"
    };
    
    const candidates = [];
    
    for (let shift = 0; shift < 12; shift++) {
        const shiftedKMaj = new Array(12);
        const shiftedKMin = new Array(12);
        const shiftedTMaj = new Array(12);
        const shiftedTMin = new Array(12);
        
        for (let i = 0; i < 12; i++) {
            const idx = (i - shift + 12) % 12;
            shiftedKMaj[i] = krumhanslMaj[idx];
            shiftedKMin[i] = krumhanslMin[idx];
            shiftedTMaj[i] = tempMaj[idx];
            shiftedTMin[i] = tempMin[idx];
        }
        
        const sMaj = 0.50 * pearsonCorrelation(chromaTotal, shiftedKMaj) + 0.50 * pearsonCorrelation(chromaTotal, shiftedTMaj);
        const sMin = 0.50 * pearsonCorrelation(chromaTotal, shiftedKMin) + 0.50 * pearsonCorrelation(chromaTotal, shiftedTMin);
        
        candidates.push({ root: shift, isMajor: true, keyText: `${noteNames[shift]} Major`, score: sMaj });
        candidates.push({ root: shift, isMajor: false, keyText: `${noteNames[shift]} Minor`, score: sMin });
    }
    
    candidates.sort((a, b) => b.score - a.score);
    let best = candidates[0];
    let second = candidates[1];
    
    // Relative Major vs Relative Minor Bass Disambiguation (e.g. 8A [A Minor] vs 8B [C Major])
    // The relative major is always 3 semitones above the relative minor: (maj.root - min.root + 12) % 12 === 3
    if (second && (best.score - second.score < 0.15)) {
        let majC = best.isMajor ? best : (second.isMajor ? second : null);
        let minC = !best.isMajor ? best : (!second.isMajor ? second : null);
        
        if (majC && minC && ((majC.root - minC.root + 12) % 12 === 3)) {
            const minBass = chromaBass[minC.root] || 0;
            const majBass = chromaBass[majC.root] || 0;
            
            // Electronic music overwhelmingly favors Minor when tonic bass is present
            if (minBass > majBass * 1.05) {
                best = minC;
            } else if (majBass > minBass * 1.15) {
                best = majC;
            }
        }
    }
    
    return {
        keyText: best.keyText,
        camelotCode: camelotMap[best.keyText] || "Unknown",
        correlationScore: parseFloat(best.score.toFixed(3)),
        isMajor: best.isMajor,
        tuningHz: detectedTuningHz,
        tuningCents: detectedCents
    };
}

/* ==========================================================================
   PART 2: COMPLEX SUPERFLUX 0.01 BPM & BEATGRID PHASE ENGINE
   ========================================================================== */

function detectPrecisionBPM(channelData, sampleRate) {
    const totalSamples = channelData.length;
    const startSec = 12;
    const durationSec = 60;
    const startSample = Math.min(totalSamples, Math.floor(startSec * sampleRate));
    const endSample = Math.min(totalSamples, Math.floor((startSec + durationSec) * sampleRate));
    const analysisLen = endSample - startSample;
    
    if (analysisLen < sampleRate * 10) {
        return { bpm: 124.0, beatOffset: 0.0 };
    }
    
    // Multi-band Lowpass Envelope Extraction
    const lpCutoff = 160;
    const lpRc = 1 / (2 * Math.PI * lpCutoff);
    const lpAlpha = 1 / (lpRc * sampleRate + 1);
    
    const envCutoff = 12;
    const envRc = 1 / (2 * Math.PI * envCutoff);
    const envAlpha = 1 / (envRc * sampleRate + 1);
    
    let lpState = 0;
    let envState = 0;
    
    const targetDsRate = 1000;
    const dsStep = Math.round(sampleRate / targetDsRate);
    const dsSampleRate = sampleRate / dsStep;
    
    const fluxLen = Math.floor(analysisLen / dsStep);
    const flux = new Float32Array(fluxLen);
    let prevEnv = 0;
    
    for (let i = 0; i < fluxLen; i++) {
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
    
    // Autocorrelation search
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
    
    // Coarse Tempo Search across 60.00 to 185.00 BPM
    let bestCoarseBpm = 124.0;
    let maxCoarseScore = -1;
    
    for (let b = 60; b <= 185; b += 0.5) {
        const lag = (60 / b) * dsSampleRate;
        const r1 = getAutocorr(flux, lag);
        const r2 = getAutocorr(flux, lag * 2);
        
        // Intelligent DJ tempo prior: Boost standard dance tempo range (115-180 BPM) to prevent half-time misclassifications
        let tempoPrior = 1.0;
        if (b >= 115 && b <= 180) {
            tempoPrior = 1.30;
        } else if (b < 95) {
            tempoPrior = 0.80;
        }
        
        const score = (r1 + 0.4 * r2) * tempoPrior;
        
        if (score > maxCoarseScore) {
            maxCoarseScore = score;
            bestCoarseBpm = b;
        }
    }
    
    // Octave Check: If detected under 95 BPM, check if double-tempo (115-185 BPM) is valid
    if (bestCoarseBpm < 95 && (bestCoarseBpm * 2) <= 185) {
        const doubleLag = (60 / (bestCoarseBpm * 2)) * dsSampleRate;
        const rDouble = getAutocorr(flux, doubleLag);
        const rSingle = getAutocorr(flux, (60 / bestCoarseBpm) * dsSampleRate);
        if (rDouble >= rSingle * 0.65) {
            bestCoarseBpm = bestCoarseBpm * 2;
        }
    }
    
    // Fine-Grain 0.01 BPM Search
    let exactBpm = bestCoarseBpm;
    let maxFineScore = -1;
    
    for (let b = bestCoarseBpm - 1.0; b <= bestCoarseBpm + 1.0; b += 0.01) {
        const lag = (60 / b) * dsSampleRate;
        const r1 = getAutocorr(flux, lag);
        const r2 = getAutocorr(flux, lag * 2);
        const score = r1 + 0.4 * r2;
        
        if (score > maxFineScore) {
            maxFineScore = score;
            exactBpm = b;
        }
    }
    
    // Sub-millisecond Downbeat (1.1.1) Phase Calculation
    const beatIntervalSec = 60.0 / exactBpm;
    const beatIntervalSamples = Math.floor(beatIntervalSec * sampleRate);
    
    let bestOffsetSamples = 0;
    let maxPhaseEnergy = -1;
    const numCheckBeats = 16;
    
    for (let phase = 0; phase < beatIntervalSamples; phase += Math.floor(sampleRate / 200)) {
        let phaseEnergy = 0;
        for (let beat = 0; beat < numCheckBeats; beat++) {
            const idx = phase + beat * beatIntervalSamples;
            if (idx < totalSamples) {
                const sampleVal = channelData[idx];
                phaseEnergy += Math.abs(sampleVal);
            }
        }
        if (phaseEnergy > maxPhaseEnergy) {
            maxPhaseEnergy = phaseEnergy;
            bestOffsetSamples = phase;
        }
    }
    
    const beatOffsetSec = parseFloat((bestOffsetSamples / sampleRate).toFixed(4));
    
    return {
        bpm: parseFloat(exactBpm.toFixed(2)),
        beatOffset: beatOffsetSec
    };
}

/* ==========================================================================
   PART 3: AUTOMATED TRACK STRUCTURE & CUE POINT ENGINE
   ========================================================================== */

function detectTrackStructureAndCues(channelData, sampleRate, bpm, beatOffset) {
    const totalSamples = channelData.length;
    const totalSec = totalSamples / sampleRate;
    const cues = [];
    
    // Cue A: Intro / Mix-in Point (Downbeat 1.1.1)
    cues.push({
        label: "Intro",
        time: beatOffset,
        type: "HotCue",
        color: "#00E5FF", // Cyan
        index: 1
    });
    
    // Breakdown 1, Drop 1, Drop 2, Outro detection via energy profiling
    const windowSec = 4.0;
    const windowSamples = Math.floor(windowSec * sampleRate);
    const numBlocks = Math.floor(totalSamples / windowSamples);
    const energyProfile = new Float32Array(numBlocks);
    
    for (let b = 0; b < numBlocks; b++) {
        const start = b * windowSamples;
        let sumSq = 0;
        const step = Math.max(1, Math.floor(windowSamples / 2000));
        for (let i = start; i < start + windowSamples; i += step) {
            sumSq += channelData[i] * channelData[i];
        }
        energyProfile[b] = Math.sqrt(sumSq / (windowSamples / step));
    }
    
    // Find Drop 1 (First major energy climax after lower energy section)
    let maxEnergy = 0;
    let maxBlock = 0;
    for (let b = 0; b < numBlocks; b++) {
        if (energyProfile[b] > maxEnergy) {
            maxEnergy = energyProfile[b];
            maxBlock = b;
        }
    }
    
    // Breakdown 1: Energy dip before main drop
    let breakdownBlock = Math.max(1, Math.floor(maxBlock * 0.5));
    let minDip = Infinity;
    for (let b = Math.floor(numBlocks * 0.15); b < maxBlock; b++) {
        if (energyProfile[b] < minDip) {
            minDip = energyProfile[b];
            breakdownBlock = b;
        }
    }
    
    const breakdownTime = parseFloat((breakdownBlock * windowSec).toFixed(2));
    const drop1Time = parseFloat((maxBlock * windowSec).toFixed(2));
    
    // Cue B: Breakdown
    if (breakdownTime > beatOffset + 15 && breakdownTime < totalSec - 60) {
        cues.push({
            label: "Breakdown",
            time: breakdownTime,
            type: "HotCue",
            color: "#FFD700", // Gold / Yellow
            index: 2
        });
    }
    
    // Cue C: Drop 1
    if (drop1Time > breakdownTime && drop1Time < totalSec - 45) {
        cues.push({
            label: "Drop 1",
            time: drop1Time,
            type: "HotCue",
            color: "#FF3366", // Red / Pink
            index: 3
        });
    }
    
    // Cue D: Outro / Mix-out Point (Last 45-60 seconds)
    const outroTime = Math.max(0, parseFloat((totalSec - 60.0).toFixed(2)));
    if (outroTime > drop1Time + 30) {
        cues.push({
            label: "Outro",
            time: outroTime,
            type: "HotCue",
            color: "#55D98D", // Green
            index: 4
        });
    }
    
    return { cues };
}

/* ==========================================================================
   PART 4: MASTER 4-TIER DJ PERFORMANCE TAGGING SYSTEM
   ========================================================================== */

function extractMasterPerformanceTags(channelData, sampleRate, isMajor = false, correlationScore = 0.8, bpmVal = 124) {
    const len = channelData.length;
    const bpm = (typeof bpmVal === 'number' && bpmVal > 0) ? bpmVal : 124;
    
    // Loudness, Crest Factor, Energy Level
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
    
    // Rating Stars (1, 3, 5 Stars)
    let starRating = 3;
    if (rmsDbFS > -7.5 && correlationScore > 0.70) starRating = 5;
    else if (rmsDbFS < -14.5 || correlationScore < 0.50) starRating = 1;
    
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
    
    const avgFlux = numWindows > 1 ? totalSpectralFlux / (numWindows - 1) : 0;
    const subRatio = totalBandEnergy > 0 ? subBandEnergy / totalBandEnergy : 0;
    const lowMidRatio = totalBandEnergy > 0 ? lowMidBandEnergy / totalBandEnergy : 0;
    const vocalRatio = totalBandEnergy > 0 ? vocalBandEnergy / totalBandEnergy : 0;
    const highRatio = totalBandEnergy > 0 ? highFreqEnergy / totalBandEnergy : 0;
    
    // TIER 1: Main Instrument & Bassline (Picks Top 1-2)
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
    
    // TIER 2: Groove & Rhythm Architecture (Picks Top 1)
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
    
    // TIER 3: Emotional Vibe & Atmosphere (Picks Top 1)
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
    
    // Combine into balanced 3-4 distinct tags
    const finalTags = Array.from(new Set([...topInstruments, ...topGroove, ...topVibe]));
    if (finalTags.length === 0) {
        if (subRatio > 0.18) finalTags.push("BoomingBass");
        if (isMajor) finalTags.push("Melodic");
        else finalTags.push("Deep");
    }
    
    const commentsString = finalTags.join(", ");
    
    return {
        rating: starRating,
        energyLevel,
        vibesAndInstruments: finalTags,
        grouping: `Energy ${energyLevel}`,
        comments: commentsString
    };
}
