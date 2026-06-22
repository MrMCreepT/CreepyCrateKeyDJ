// This script runs on a separate thread to prevent browser freezing
self.onmessage = function(e) {
    const { taskId, channelData, sampleRate } = e.data;
    
    try {
        const bpm = detectBPM(channelData, sampleRate);
        const { keyText, camelotCode } = detectKey(channelData, sampleRate);
        
        self.postMessage({ taskId, bpm, keyText, camelotCode, success: true });
    } catch (error) {
        self.postMessage({ taskId, error: error.message, success: false });
    }
};

function detectBPM(channelData, sampleRate) {
    // We analyze the first 60 seconds of the track (starting at 10s to skip silent intros)
    const startSec = 10;
    const durationSec = 60;
    const startSample = Math.min(channelData.length, Math.floor(startSec * sampleRate));
    const endSample = Math.min(channelData.length, Math.floor((startSec + durationSec) * sampleRate));
    const analysisLength = endSample - startSample;
    
    if (analysisLength < sampleRate * 10) {
        // Fallback to simpler method or analyze whatever we have
        return detectBpmFallback(channelData, sampleRate);
    }
    
    // 150 Hz Low-Pass Filter
    const lpCutoff = 150;
    const lpRc = 1 / (2 * Math.PI * lpCutoff);
    const lpAlpha = 1 / (lpRc * sampleRate + 1);
    
    // 10 Hz Envelope Low-Pass Filter
    const envCutoff = 10;
    const envRc = 1 / (2 * Math.PI * envCutoff);
    const envAlpha = 1 / (envRc * sampleRate + 1);
    
    let lpState = 0;
    let envState = 0;
    
    // Downsample envelope to 1000 Hz
    const targetDsRate = 1000;
    const dsStep = Math.round(sampleRate / targetDsRate);
    const dsSampleRate = sampleRate / dsStep; // Exact downsampled sample rate (~1000 Hz)
    
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
    
    // Coarse Search (60 to 180 BPM, step 1) using 200 Hz downsampled data
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
    
    // Fine Search (bestCoarseBpm - 2 to bestCoarseBpm + 2, step 0.1) using 1000 Hz data
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

function pearsonCorrelation(x, y) {
    const n = 12;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
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

function detectKey(pcm, sampleRate) {
    // 1. Downsample to ~11025 Hz to speed up calculation and target musical range
    const targetSampleRate = 11025;
    const factor = Math.round(sampleRate / targetSampleRate);
    const dsSampleRate = sampleRate / factor;
    
    // Extract a 5-second snippet from the middle
    const midPoint = Math.floor(pcm.length / 2);
    const snippetLength = Math.min(pcm.length, sampleRate * 5);
    const start = Math.max(0, midPoint - Math.floor(snippetLength / 2));
    
    const dsPcm = [];
    for (let i = start; i < start + snippetLength; i += factor) {
        dsPcm.push(pcm[i]);
    }
    
    // 2. Define notes to analyze: MIDI 36 (C2, 65.4Hz) to 84 (C6, 1046.5Hz)
    const minMidi = 36;
    const maxMidi = 84;
    const numNotes = maxMidi - minMidi + 1;
    const freqs = [];
    for (let m = minMidi; m <= maxMidi; m++) {
        freqs.push(440 * Math.pow(2, (m - 69) / 12));
    }
    
    // Frame settings
    const N = 1024; // ~93ms frames
    const hop = 512;
    const chroma = new Array(12).fill(0);
    
    // Precompute Hann window
    const window = new Float32Array(N);
    for (let n = 0; n < N; n++) {
        window[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    
    // Precompute Cos/Sin tables for the DFT
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
    
    // Process frames
    for (let offset = 0; offset + N <= dsPcm.length; offset += hop) {
        // Apply window
        const frame = new Float32Array(N);
        for (let k = 0; k < N; k++) {
            frame[k] = dsPcm[offset + k] * window[k];
        }
        
        // DFT for each note frequency
        for (let f = 0; f < numNotes; f++) {
            let real = 0;
            let imag = 0;
            const cosRow = cosTable[f];
            const sinRow = sinTable[f];
            for (let k = 0; k < N; k++) {
                real += frame[k] * cosRow[k];
                imag += frame[k] * sinRow[k];
            }
            const energy = real * real + imag * imag;
            const pitchClass = (minMidi + f) % 12;
            chroma[pitchClass] += energy;
        }
    }
    
    // Normalize chroma
    const sumChroma = chroma.reduce((a, b) => a + b, 0);
    if (sumChroma > 0) {
        for (let i = 0; i < 12; i++) {
            chroma[i] /= sumChroma;
        }
    }
    
    // Krumhansl-Schmuckler profiles
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    const camelotMap = {
        "C Major": "8B",  "C Minor": "5A", "C# Major": "3B", "C# Minor": "12A",
        "D Major": "10B", "D Minor": "7A", "D# Major": "5B", "D# Minor": "2A",
        "E Major": "12B", "E Minor": "9A", "F Major": "7B",  "F Minor": "4A",
        "F# Major": "2B", "F# Minor": "11A", "G Major": "9B",  "G Minor": "6A",
        "G# Major": "4B", "G# Minor": "1A", "A Major": "11B", "A Minor": "8A",
        "A# Major": "6B", "A# Minor": "3A", "B Major": "1B",  "B Minor": "10A"
    };
    
    let bestCorrelation = -Infinity;
    let detectedKey = "Unknown";
    
    // Shift profiles and calculate Pearson correlation
    for (let shift = 0; shift < 12; shift++) {
        // Shift profiles
        const shiftedMajor = new Array(12);
        const shiftedMinor = new Array(12);
        for (let i = 0; i < 12; i++) {
            shiftedMajor[i] = majorProfile[(i - shift + 12) % 12];
            shiftedMinor[i] = minorProfile[(i - shift + 12) % 12];
        }
        
        const majCorr = pearsonCorrelation(chroma, shiftedMajor);
        const minCorr = pearsonCorrelation(chroma, shiftedMinor);
        
        if (majCorr > bestCorrelation) {
            bestCorrelation = majCorr;
            detectedKey = `${noteNames[shift]} Major`;
        }
        if (minCorr > bestCorrelation) {
            bestCorrelation = minCorr;
            detectedKey = `${noteNames[shift]} Minor`;
        }
    }
    
    return {
        keyText: detectedKey,
        camelotCode: camelotMap[detectedKey] || "Unknown"
    };
}
