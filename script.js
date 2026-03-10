// Fretboard Mastery — Guitar Note Trainer game logic with audio pitch detection

// =============================================
// DATA
// =============================================
const notes = ["E","F","F#","G","G#","A","A#","B","C","C#","D","D#"];
const strings = [
    ["E","F","F#","G","G#","A","A#","B","C","C#","D","D#"],
    ["B","C","C#","D","D#","E","F","F#","G","G#","A","A#"],
    ["G","G#","A","A#","B","C","C#","D","D#","E","F","F#"],
    ["D","D#","E","F","F#","G","G#","A","A#","B","C","C#"],
    ["A","A#","B","C","C#","D","D#","E","F","F#","G","G#"],
    ["E","F","F#","G","G#","A","A#","B","C","C#","D","D#"]
];

const NOTE_FREQUENCIES = {
    "C":  [32.70,65.41,130.81,261.63,523.25,1046.50],
    "C#": [34.65,69.30,138.59,277.18,554.37,1108.73],
    "D":  [36.71,73.42,146.83,293.66,587.33,1174.66],
    "D#": [38.89,77.78,155.56,311.13,622.25,1244.51],
    "E":  [41.20,82.41,164.81,329.63,659.25,1318.51],
    "F":  [43.65,87.31,174.61,349.23,698.46,1396.91],
    "F#": [46.25,92.50,185.00,369.99,739.99,1479.98],
    "G":  [49.00,98.00,196.00,392.00,783.99,1567.98],
    "G#": [51.91,103.83,207.65,415.30,830.61,1661.22],
    "A":  [55.00,110.00,220.00,440.00,880.00,1760.00],
    "A#": [58.27,116.54,233.08,466.16,932.33,1864.66],
    "B":  [61.74,123.47,246.94,493.88,987.77,1975.53]
};

// =============================================
// GAME STATE
// =============================================
let currentNote = "";
let score = 0;
let attempts = 10;
let totalAttempts = 0;
let correctClicks = 0;
let intervalTime = 4000;
let isPaused = false;
let gameActive = false;
let progressInterval = null;
let progressWidth = 0;

// FIX: Single-score-per-note flags
let noteAlreadyScored = false;
let scoreCooldown = false;

// FIX: Track pending nextNote timeout so we can cancel it if timer expires first
let nextNoteTimeout = null;

// Audio state
let audioContext = null;
let analyser = null;
let micStream = null;
let micActive = false;
let pitchDetectionLoop = null;
let lastDetectedNote = "";
let noteHoldCount = 0;
const NOTE_HOLD_THRESHOLD = 5;

// =============================================
// HELPER: Safe nextNote scheduler
// =============================================
function scheduleNextNote(delay) {
    if (nextNoteTimeout !== null) {
        clearTimeout(nextNoteTimeout);
        nextNoteTimeout = null;
    }
    nextNoteTimeout = setTimeout(() => {
        nextNoteTimeout = null;
        scoreCooldown = false;
        nextNote();
    }, delay);
}

// =============================================
// AUDIO / MIC
// =============================================
async function toggleMic() {
    if (micActive) stopMic();
    else await startMic();
}

async function startMic() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        micStream = stream;
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        micActive = true;
        document.getElementById('micButton').textContent = '🔇 Disconnect Audio';
        document.getElementById('micButton').classList.add('active');
        setAudioStatus('listening', 'Audio Interface Connected — Play a note!');
        startPitchDetection();
    } catch (err) {
        setAudioStatus('error', '❌ Microphone access denied. Check browser permissions.');
    }
}

function stopMic() {
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (pitchDetectionLoop) { cancelAnimationFrame(pitchDetectionLoop); pitchDetectionLoop = null; }
    micActive = false; analyser = null;
    document.getElementById('micButton').textContent = '🎤 Connect Audio';
    document.getElementById('micButton').classList.remove('active');
    setAudioStatus('', 'Microphone / Audio Interface not connected');
    document.getElementById('freqValue').textContent = '— Hz';
    document.getElementById('detectedNoteValue').textContent = '—';
    document.getElementById('volumeFill').style.width = '0%';
}

function setAudioStatus(cls, msg) {
    const el = document.getElementById('audioStatus');
    el.className = cls;
    document.getElementById('audioStatusText').textContent = msg;
}

function startPitchDetection() {
    const bufferLength = analyser.fftSize;
    const buffer = new Float32Array(bufferLength);

    function detect() {
        if (!micActive || !analyser) return;
        analyser.getFloatTimeDomainData(buffer);

        let rms = 0;
        for (let i = 0; i < bufferLength; i++) rms += buffer[i] * buffer[i];
        rms = Math.sqrt(rms / bufferLength);
        const volumePct = Math.min(100, rms * 600);
        document.getElementById('volumeFill').style.width = volumePct + '%';

        if (rms > 0.01) {
            const freq = autocorrelate(buffer, audioContext.sampleRate);
            if (freq > 0) {
                const detectedNote = frequencyToNote(freq);
                document.getElementById('freqValue').textContent = freq.toFixed(1) + ' Hz';
                document.getElementById('detectedNoteValue').textContent = detectedNote || '—';

                if (detectedNote) {
                    highlightDetectedNote(detectedNote);

                    if (gameActive && !isPaused && !noteAlreadyScored && !scoreCooldown && detectedNote === currentNote) {
                        document.getElementById('detectedNoteCard').classList.add('match');

                        if (lastDetectedNote === detectedNote) {
                            noteHoldCount++;
                            if (noteHoldCount >= NOTE_HOLD_THRESHOLD) {
                                noteHoldCount = 0;
                                handleAudioCorrect(detectedNote);
                            }
                        } else {
                            noteHoldCount = 1;
                        }
                    } else {
                        document.getElementById('detectedNoteCard').classList.remove('match');
                        if (detectedNote !== currentNote) noteHoldCount = 0;
                    }
                    lastDetectedNote = detectedNote;
                } else {
                    clearAudioHighlights();
                    document.getElementById('detectedNoteCard').classList.remove('match');
                    noteHoldCount = 0;
                }
            } else {
                document.getElementById('freqValue').textContent = '— Hz';
                document.getElementById('detectedNoteValue').textContent = '—';
                document.getElementById('detectedNoteCard').classList.remove('match');
                clearAudioHighlights();
                noteHoldCount = 0;
            }
        } else {
            document.getElementById('freqValue').textContent = '— Hz';
            document.getElementById('detectedNoteValue').textContent = '—';
            document.getElementById('detectedNoteCard').classList.remove('match');
            clearAudioHighlights();
            noteHoldCount = 0;
        }

        pitchDetectionLoop = requestAnimationFrame(detect);
    }

    detect();
}

function autocorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buffer[i]) < thres) { r1 = i; break; } }
    for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; } }

    const buf2 = buffer.slice(r1, r2);
    const c = new Float32Array(buf2.length).fill(0);
    for (let i = 0; i < buf2.length; i++)
        for (let j = 0; j < buf2.length - i; j++)
            c[i] += buf2[j] * buf2[j + i];

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < buf2.length; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }

    if (maxpos < 1) return -1;
    let T0 = maxpos;
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
}

function frequencyToNote(freq) {
    let closestNote = "";
    let minDist = Infinity;
    for (const [note, freqs] of Object.entries(NOTE_FREQUENCIES)) {
        for (const f of freqs) {
            const cents = Math.abs(1200 * Math.log2(freq / f));
            if (cents < minDist) { minDist = cents; closestNote = note; }
        }
    }
    return minDist < 50 ? closestNote : "";
}

function highlightDetectedNote(note) {
    clearAudioHighlights();
    if (!note) return;
    document.querySelectorAll('.fret-marker').forEach(m => {
        if (m.dataset.note === note && !m.classList.contains('correct')) {
            m.classList.add('audio-detected');
            m.textContent = note;
        }
    });
}

function clearAudioHighlights() {
    document.querySelectorAll('.fret-marker.audio-detected').forEach(m => {
        m.classList.remove('audio-detected');
        if (!m.classList.contains('correct')) m.textContent = '';
    });
}

function handleAudioCorrect(note) {
    if (!gameActive || isPaused || noteAlreadyScored || scoreCooldown) return;

    noteAlreadyScored = true;
    scoreCooldown = true;

    score++;
    correctClicks++;
    document.getElementById('scoreValue').textContent = score;
    updateAccuracy();

    const nd = document.getElementById('noteDisplay');
    nd.classList.add('correct-flash');
    setTimeout(() => nd.classList.remove('correct-flash'), 500);

    document.querySelectorAll('.fret-marker').forEach(m => {
        if (m.dataset.note === note) {
            m.classList.remove('audio-detected');
            m.classList.add('correct');
            m.textContent = note;
        }
    });

    playSuccessSound();
    scheduleNextNote(800);
}

// =============================================
// GAME LOGIC
// =============================================
function selectDifficulty(btn) {
    intervalTime = parseInt(btn.dataset.interval);
    document.querySelectorAll('.startButton').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    startGame();
}

function startGame() {
    score = 0;
    attempts = 10;
    totalAttempts = 0;
    correctClicks = 0;
    isPaused = false;
    gameActive = true;
    progressWidth = 0;
    noteAlreadyScored = false;
    scoreCooldown = false;
    noteHoldCount = 0;

    if (nextNoteTimeout !== null) {
        clearTimeout(nextNoteTimeout);
        nextNoteTimeout = null;
    }

    document.getElementById('scoreValue').textContent = '0';
    document.getElementById('attemptsValue').textContent = '10';
    document.getElementById('accuracyValue').textContent = '—';
    document.getElementById('noteDisplay').textContent = '—';
    document.getElementById('noteDisplay').className = '';
    document.getElementById('gameOverPanel').style.display = 'none';
    document.getElementById('pauseButton').style.display = 'inline-block';
    document.getElementById('pauseButton').textContent = '⏸ Pause';
    document.getElementById('targetNoteValue').textContent = '—';

    const mode = micActive
        ? '🎸 AUDIO MODE — Play the note on your guitar!'
        : '🖱️ CLICK MODE — Click the correct fret marker!';
    document.getElementById('modeIndicator').textContent = mode;
    document.getElementById('modeIndicator').className = micActive ? 'audio-mode' : 'click-mode';

    generateFretboard();
    nextNote();
    startProgress();
}

function pauseGame() {
    if (!gameActive) return;
    isPaused = !isPaused;
    document.getElementById('pauseButton').textContent = isPaused ? '▶ Resume' : '⏸ Pause';
}

function startProgress() {
    clearInterval(progressInterval);
    const bar = document.getElementById('progressBar');
    bar.style.width = '0%';
    progressWidth = 0;

    progressInterval = setInterval(() => {
        if (!isPaused && gameActive) {
            if (noteAlreadyScored || scoreCooldown) return;

            progressWidth += 100 / (intervalTime / 100);
            bar.style.width = Math.min(progressWidth, 100) + '%';

            if (progressWidth >= 100) {
                progressWidth = 0;
                bar.style.width = '0%';
                playTickSound();

                if (nextNoteTimeout !== null) {
                    clearTimeout(nextNoteTimeout);
                    nextNoteTimeout = null;
                }

                noteAlreadyScored = false;
                scoreCooldown = false;
                nextNote();
            }
        }
    }, 100);
}

function nextNote() {
    if (attempts === 0) { endGame(); return; }

    noteAlreadyScored = false;
    scoreCooldown = false;
    noteHoldCount = 0;
    lastDetectedNote = "";

    currentNote = notes[Math.floor(Math.random() * notes.length)];
    document.getElementById('noteDisplay').textContent = currentNote;
    document.getElementById('noteDisplay').className = '';
    document.getElementById('targetNoteValue').textContent = currentNote;
    document.getElementById('attemptsValue').textContent = attempts;
    attempts--;
    totalAttempts++;

    document.querySelectorAll('.fret-marker').forEach(m => {
        m.classList.remove('correct', 'wrong', 'audio-detected');
        m.textContent = '';
    });

    progressWidth = 0;
    document.getElementById('progressBar').style.width = '0%';
}

function endGame() {
    clearInterval(progressInterval);

    if (nextNoteTimeout !== null) {
        clearTimeout(nextNoteTimeout);
        nextNoteTimeout = null;
    }

    gameActive = false;
    noteAlreadyScored = false;
    scoreCooldown = false;
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('noteDisplay').textContent = '';
    document.getElementById('pauseButton').style.display = 'none';
    document.getElementById('targetNoteValue').textContent = '—';
    document.getElementById('modeIndicator').textContent = 'Game Over';
    document.getElementById('modeIndicator').className = '';

    const panel = document.getElementById('gameOverPanel');
    panel.style.display = 'block';
    document.getElementById('finalScore').textContent = score + ' / 10';

    let msg = '';
    if (score >= 9) msg = '🔥 LEGENDARY! You are a Fretboard Master!';
    else if (score >= 7) msg = '⚡ Excellent! Keep shredding!';
    else if (score >= 5) msg = '🌱 Good job! Practice makes perfect!';
    else msg = "🎸 Keep practicing! You'll get there!";
    document.getElementById('finalMsg').textContent = msg;
}

function updateAccuracy() {
    if (totalAttempts > 0) {
        const acc = Math.round((correctClicks / totalAttempts) * 100);
        document.getElementById('accuracyValue').textContent = acc + '%';
    }
}

// =============================================
// FRETBOARD GENERATION
// =============================================
function generateFretboard() {
    const fb = document.getElementById('fretboard');
    fb.innerHTML = '';

    const stringThicknesses = [1, 1.5, 2, 2.5, 3, 3.5];
    for (let i = 0; i < 6; i++) {
        const s = document.createElement('div');
        s.classList.add('string-line');
        s.style.top = `${(i * 36) + 18}px`;
        s.style.height = stringThicknesses[i] + 'px';
        s.style.background = 'linear-gradient(90deg, transparent, silver 8%, silver)';
        s.style.opacity = '0.7';
        fb.appendChild(s);
    }

    for (let si = 0; si < 6; si++) {
        for (let fi = 0; fi <= 12; fi++) {
            const cell = document.createElement('div');
            cell.classList.add('fret-cell');
            if (fi === 0) {
                const osn = document.createElement('div');
                osn.classList.add('open-string-note');
                osn.textContent = strings[si][0];
                cell.appendChild(osn);
            } else {
                const marker = document.createElement('div');
                marker.classList.add('fret-marker');
                marker.dataset.note = getNoteForFret(si, fi);
                marker.addEventListener('click', function() { handleClick(this); });
                cell.appendChild(marker);
            }
            fb.appendChild(cell);
        }
    }

    const fn = document.getElementById('fretNumbers');
    fn.innerHTML = '';
    const markerFrets = [3, 5, 7, 9, 12];
    for (let i = 0; i <= 12; i++) {
        const num = document.createElement('div');
        num.classList.add('fret-number');
        if (markerFrets.includes(i)) num.classList.add('marker-fret');
        num.textContent = i;
        fn.appendChild(num);
    }
}

function getNoteForFret(si, fi) {
    const open = strings[si][0];
    return notes[(notes.indexOf(open) + fi) % notes.length];
}

function handleClick(marker) {
    if (!gameActive || isPaused) return;
    if (marker.classList.contains('correct') || marker.classList.contains('wrong')) return;
    if (noteAlreadyScored || scoreCooldown) return;

    if (marker.dataset.note === currentNote) {
        noteAlreadyScored = true;
        scoreCooldown = true;
        score++;
        correctClicks++;
        document.getElementById('scoreValue').textContent = score;
        updateAccuracy();

        const nd = document.getElementById('noteDisplay');
        nd.classList.add('correct-flash');
        setTimeout(() => nd.classList.remove('correct-flash'), 400);

        document.querySelectorAll('.fret-marker').forEach(m => {
            if (m.dataset.note === currentNote) {
                m.classList.remove('wrong', 'audio-detected');
                m.classList.add('correct');
                m.textContent = currentNote;
            }
        });

        playSuccessSound();
        scheduleNextNote(700);
    } else {
        marker.classList.add('wrong');
        marker.textContent = marker.dataset.note;
        playErrorSound();
        setTimeout(() => {
            if (!marker.classList.contains('correct')) {
                marker.classList.remove('wrong');
                marker.textContent = '';
            }
        }, 600);
    }
}

// =============================================
// SOUND EFFECTS
// =============================================
function playSuccessSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

function playErrorSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

function playTickSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(); osc.stop(ctx.currentTime + 0.08);
    } catch(e) {}
}

// =============================================
// INIT
// =============================================
generateFretboard();
