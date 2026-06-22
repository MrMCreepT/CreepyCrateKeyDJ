# CreepyCrate&Key_DJ 🎧

CreepyCrate&Key_DJ is a studio-grade, serverless **Progressive Web App (PWA)** designed specifically for DJs, music producers, and selectors to prepare their crates and test transitions. It allows you to batch-analyse local folders of audio files entirely within your web browser to detect high-precision BPM, Musical Key, and Energy levels, updating file tags and structures in-place or into clean crates.

Because it runs 100% client-side, your files never leave your computer—guaranteeing **100% privacy, zero server costs, and offline capability**.

---

## ✨ Key Features

### 📦 Smart Library Preparation & File Tagging
*   📂 **Recursive Directory Processing**: Deep-scans selected folders using the *File System Access API*, bypassing the output folder to prevent loops.
*   🏷️ **In-Place Binary ID3 Preservation**: Modifies MP3 buffers directly to inject compatible Camelot Key (`TKEY`) and BPM (`TBPM`) tags. Unlike typical libraries, it **preserves 100% of your existing tags** (Artwork, Title, Artist, Album, Ratings, and DJ cue points/beatgrids from Rekordbox, Serato, or Traktor).
*   ⚙️ **Flexible Batch Action Panel**:
    *   **Rename Filename**: Prepends the key and DJ energy level to the output file name (e.g. `8A - 5 - Track.mp3`).
    *   **Prepend Key to Track Title**: Modifies the internal title tag (e.g. `8A - Track Title`).
    *   **Write Key & BPM Tags**: Injects `TKEY` and `TBPM` tags directly.
    *   **Fast Byte Copy**: If no tagging options are checked, performs a pure binary copy to ensure 100% tag and cue point preservation.
*   🏷️ **Native Genre Extraction**: Parses and decodes `TCON` (Genre) tags natively from the file binary, displaying them in the UI table and exporting them in CSV setlists.
*   🔄 **Smart Cleanups**:
    *   **In-Place Promotions**: Cleans the parent folder of original raw tracks and deletes redundant subfolders after successful processing.
    *   **Orphan Pruning**: Automatically runs a cleanup at the end of a batch, removing files in the processed crate that no longer exist in the source folder.
    *   **Double Prevention**: Automatically deletes old processed versions of a song if settings or key notations change, keeping folders free of doubles.

### 🧠 Studio-Grade DSP Analysis
*   🔥 **DJ Energy Level Estimation (1–10)**: Analyzes audio intensity (Root-Mean-Square level) of the audio buffer and maps it to a 1–10 Energy rating, complete with colorful dynamic flame indicators.
*   ⚡ **Dual-Layer Skip Optimization**:
    *   **Destination Check**: Instantly skips processing if the target file already exists and matches the selected tagging options.
    *   **Metadata Tag Bypass**: Scans the source file's ID3v2 headers for existing `TKEY` and `TBPM` tags to bypass slow audio decoding and worker analysis.
*   🧠 **Concurrent Worker Pool**: Instantiates a pool of background Web Workers (matching `navigator.hardwareConcurrency` up to 4 parallel slots) to decode and analyse files concurrently.
*   📈 **High-Precision BPM Autocorrelation**: Uses a 150 Hz LPF, a 10 Hz envelope follower, and a coarse-to-fine autocorrelation resonance model to detect tempo with **0.1 decimal BPM precision**.
*   🎡 **Low-Pass Transient Flux Beatgrid Offset**: Uses a 150 Hz LPF, 15 Hz envelope filter, and temporal onset flux detection to locate phase offsets. It scans 500 phase candidates with linear interpolation for sub-millisecond precision, and ignores silent/ambient intros.

### 🎡 Performance HUD & Setlist Builder
*   🎡 **Sliding Camelot Key Wheel Drawer**: Toggles via the **Harmonic Key Wheel 🎡** header button, sliding out as a sleek drawer with a glassmorphism backdrop-blur effect. Clicking any segment filters the track library in real-time to show only compatible harmonic matches.
*   🚥 **Harmonic Traffic Light System**: Selecting a processed track highlights compatible mixing partners (perfect matches, $\pm 1$ hour shift, or relative major/minor) while dimming incompatible ones.
*   📋 **Setlist Timeline Builder**: Drag and drop tracks from the library into the setlist, reorder them, and audit transitions in real-time. The transition auditor highlights key matching, tempo matching, and harmonic clashes with exact BPM offsets.
*   📊 **Setlist Exports**: Instant downloads for standard `CSV` setlists (with Energy metrics) and `M3U8` playlist files.

### 🎛️ Dual-Deck DJ Mixer
*   🎛️ **Dual-Deck DJ Mixer**: Load tracks directly from your preparing crate setlist to preview transitions.
*   📐 **Flexible Deck Layouts**: Toggle between Classic (side-by-side) decks or Stacked Waveforms (vertical mixing layout) to align beatgrids.
*   ⚡ **True DJ Phase Sync**: Sync matches tempo and applies a local nudge (at most ±half-beat) to phase-lock beatgrids together without jumping the playhead across the track.
*   🔇 **Web Audio Metronome & Jog Nudges**: Toggle an audible metronome click to verify beatgrid alignment. Shift grids manually by 10ms with grid buttons, or pitch-nudge by $\pm 3.5\%$ with jog bend controls.
*   🔄 **Quantized Loop Rolls**: Roll loops (`1`, `4`, `8`, or `16` beats) that snap to the nearest beatgrid line.

---

## 🛠️ Technology Stack

*   **Core**: HTML5, Vanilla CSS3 (Custom Variables), JavaScript (ES6+ Modules)
*   **Web APIs**: Web Audio API, Web Workers, Service Workers, File System Access API
*   **Standards-Compliant ID3 Encoding**: Dynamically encodes text frames (using ISO-8859-1 for ASCII or UTF-16 with BOM for international characters in ID3v2.3; UTF-8 in ID3v2.4) to guarantee native metadata rendering.
*   **Client-Side Libraries**:
    *   [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) (Interactive Waveforms)
    *   [browser-id3-writer](https://github.com/egoroof/browser-id3-writer) (Metadata tag writing fallback)

---

## 🚀 Getting Started

### Prerequisites

You need [Node.js](https://nodejs.org/) installed locally.

### Local Development

1.  Clone or navigate to the project directory:
    ```bash
    cd creepykey
    ```
2.  Install development dependencies:
    ```bash
    npm install
    ```
3.  Launch the development server:
    ```bash
    npm run dev
    ```
4.  Open the local address in your browser:
    *   **Local URL**: `http://localhost:5173`

---

## 🔒 Privacy & Offline Capability

*   **No Servers**: All audio decoding, analytical DSP, and file writing occur locally on your machine.
*   **Offline Ready**: Built as a PWA, the service worker caches the application shell. Once visited online, you can launch and use CreepyCrate&Key_DJ completely offline in the DJ booth, studio, or on the road.
