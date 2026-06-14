# CreepyKey PWA 🎧

CreepyKey is a studio-grade, serverless **Progressive Web App (PWA)** designed specifically for DJs, music producers, and selectors. It allows you to batch-analyse local folders of MP3 files entirely within your web browser to detect BPM and Musical Key, outputting compatible **Camelot Wheel** values.

Because it runs 100% client-side, your files never leave your computer—guaranteeing **100% privacy, zero server costs, and offline capability**.

---

## ✨ Key Features

*   📂 **Recursive Directory Processing**: Deep-scans selected folders using the *File System Access API*, bypassing the output folder to prevent loops.
*   🧠 **Off-Main-Thread DSP**: Mathematical calculations (peak-detection for BPM and selective DFT chromagram correlation for Key) run inside a background Web Worker to keep the UI smooth and responsive.
*   🛡️ **In-Place Binary ID3 Preservation**: Modifies MP3 buffers directly to inject compatible Camelot Key (`TKEY`) and BPM (`TBPM`) tags. Unlike typical libraries, it **preserves 100% of your existing tags** (Artwork, Title, Artist, Album, Ratings, and DJ cue points/beatgrids from Rekordbox, Serato, or Traktor).
*   🏷️ **Native Genre Extraction**: Automatically parses and decodes `TCON` (Genre) tags natively from the file binary, displaying them in the UI table and exporting them in CSV setlists.
*   🚥 **Harmonic Traffic Light System**: Selecting a processed track highlights compatible mixing partners (perfect matches, $\pm 1$ hour shift, or relative major/minor) while dimming incompatible ones.
*   🌊 **Interactive Waveform Deck**: Immediate preview playback with dynamic waveform renderings powered by `wavesurfer.js`.
*   📊 **Setlist Exports**: Instant downloads for standard `CSV` setlists and `M3U8` playlist files, ready to import into your library manager.

---

## 🛠️ Technology Stack

*   **Core**: HTML5, Vanilla CSS3 (Custom Variables), JavaScript (ES6+ Modules)
*   **Web APIs**: Web Audio API, Web Workers, Service Workers, File System Access API
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
*   **Offline Ready**: Built as a PWA, the service worker caches the application shell. Once visited online, you can launch and use CreepyKey completely offline in the DJ booth, studio, or on the road.
