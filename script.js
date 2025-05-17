
// --- DOM Elements ---
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const displayElement = document.getElementById('display');
const startStopButton = document.getElementById('startStop');
const resetButton = document.getElementById('reset');
const focusIndicator = document.getElementById('focus-indicator');
const sensitivitySlider = document.getElementById('sensitivity');
const themeSelector = document.getElementById('theme');
const calibrateButton = document.getElementById('calibrate');

// --- State Variables ---
let ctx;
let stream;
let isFaceDetected = false;
let isHeadDown = false;
let isStopwatchRunning = false;
let intervalId;
let startTime = 0;
let elapsedTime = 0;

// --- Calibration ---
let calibrationTiltAngle = 0; // Store calibrated tilt angle
let isCalibrating = false;

// --- Smoothing Filter ---
const tiltAngleBuffer = [];  // Store recent tilt angles
const tiltAngleBufferSize = 5; // Adjust for smoothing

// --- Settings ---
let distractionSensitivity = 50; // 1-100, higher = more sensitive

// --- Load Models ---
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    faceapi.nets.faceExpressionNet.loadFromUri('/models')
]).then(startVideo)
.catch(err => console.error("Error loading face-api models:", err));

// --- Webcam Access ---
function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(vidStream => {
            stream = vidStream;
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                video.play();

                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx = canvas.getContext('2d');
                startFaceDetection();
            };
        })
        .catch(err => console.error("Error accessing webcam:", err));
}

// --- Face Detection ---
async function startFaceDetection() {
    video.addEventListener('play', () => {
        const displaySize = { width: video.width, height: video.height };
        faceapi.matchDimensions(canvas, displaySize);

        setInterval(async () => {
            try {
                const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceExpressions();
                const resizedDetections = faceapi.resizeResults(detections, displaySize);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                faceapi.draw.drawDetections(canvas, resizedDetections);
                //faceapi.draw.drawFaceLandmarks(canvas, resizedDetections); // Optional landmarks

                if (detections.length > 0) {
                    isFaceDetected = true;
                    const face = detections[0];

                    //--- Smoothed Head Tilt ---
                    const nose = face.landmarks.getNose()[0];
                    const chin = face.landmarks.getChin()[0];

                    let tiltAngle = Math.atan2(chin.y - nose.y, chin.x - nose.x) * 180 / Math.PI;

                    // Add current angle to the buffer
                    tiltAngleBuffer.push(tiltAngle);
                    if (tiltAngleBuffer.length > tiltAngleBufferSize) {
                        tiltAngleBuffer.shift(); // Remove the oldest
                    }

                    // Calculate moving average
                    let smoothedTiltAngle = tiltAngleBuffer.reduce((sum, angle) => sum + angle, 0) / tiltAngleBuffer.length;

                    // Adjust for calibration and sensitivity
                    let adjustedTiltAngle = smoothedTiltAngle - calibrationTiltAngle;
                    const sensitivityThreshold = distractionSensitivity * 0.2;  // Scale sensitivity (adjust 0.2 as needed)

                    if (adjustedTiltAngle > sensitivityThreshold) { // Head Down (Tune thresholds carefully!)
                        isHeadDown = true;
                    } else {
                        isHeadDown = false;
                    }

                } else {
                    isFaceDetected = false;
                    isHeadDown = false;
                }

                updateStopwatchState();

            } catch (err) {
                console.error("Face detection error:", err);
                // Handle errors gracefully (e.g., display a message to the user)
            }
        }, 100); // Adjust interval as needed
    });
}

// --- Stopwatch Logic --- (Same as before)
function startStopwatch() {
    startTime = Date.now() - elapsedTime;
    intervalId = setInterval(updateDisplay, 10); // Update every 10 milliseconds (for more precision)
    isStopwatchRunning = true;
    startStopButton.textContent = 'Pause';
}

function pauseStopwatch() {
    clearInterval(intervalId);
    elapsedTime = Date.now() - startTime;
    isStopwatchRunning = false;
    startStopButton.textContent = 'Resume';
}

function resetStopwatch() {
    clearInterval(intervalId);
    elapsedTime = 0;
    updateDisplay();
    isStopwatchRunning = false;
    startStopButton.textContent = 'Start';
}

function updateDisplay() {
    const now = Date.now();
    elapsedTime = now - startTime;

    let ms = Math.floor((elapsedTime % 1000) / 10); // Two-digit milliseconds
    let seconds = Math.floor((elapsedTime / 1000) % 60);
    let minutes = Math.floor((elapsedTime / (1000 * 60)) % 60);
    let hours = Math.floor((elapsedTime / (1000 * 60 * 60)));

    ms = ms < 10 ? "0" + ms : ms;
    seconds = seconds < 10 ? "0" + seconds : seconds;
    minutes = minutes < 10 ? "0" + minutes : minutes;
    hours = hours < 10 ? "0" + hours : hours;

    displayElement.textContent = `${hours}:${minutes}:${seconds}.${ms}`;
}

// --- Combined Logic ---
function updateStopwatchState() {
    if (!isFaceDetected || !isHeadDown) {
        // If no face is detected OR head isn't down, pause
        if (isStopwatchRunning) {
            pauseStopwatch();
        }
        focusIndicator.style.borderColor = 'rgba(255, 0, 0, 0.7)'; // Red for distracted
    } else {
        // If face is detected AND head is down, and stopwatch is not running, start/resume
        if (!isStopwatchRunning) {
            startStopwatch();
        }
        focusIndicator.style.borderColor = 'rgba(0, 255, 0, 0.5)'; // Green for focused
    }
}
// --- Calibration ---
function startCalibration() {
    isCalibrating = true;
    calibrateButton.disabled = true; // Disable during calibration
    calibrateButton.textContent = "Calibrating...";
    // Take the average tilt angle over a short period to calibrate
    let calibrationSum = 0;
    let calibrationSamples = 10;
    let sampleCount = 0;

    const calibrationInterval = setInterval(() => {
        if (tiltAngleBuffer.length > 0) {
            calibrationSum += tiltAngleBuffer[tiltAngleBuffer.length - 1]; // Use the latest smoothed angle
            sampleCount++;

            if (sampleCount >= calibrationSamples) {
                clearInterval(calibrationInterval);
                calibrationTiltAngle = calibrationSum / calibrationSamples;
                isCalibrating = false;
                calibrateButton.disabled = false;
                calibrateButton.textContent = "Calibrate";
                alert("Calibration complete!  Sit in your normal study position.");
            }
        }
    }, 100); // Sample every 100ms
}

// --- Event Listeners ---
startStopButton.addEventListener('click', () => {
    if (isStopwatchRunning) {
        pauseStopwatch();
    } else {
        startStopwatch();
    }
});

resetButton.addEventListener('click', resetStopwatch);

// Sensitivity Slider
sensitivitySlider.addEventListener('input', () => {
    distractionSensitivity = parseInt(sensitivitySlider.value);
});

// Theme Selector
themeSelector.addEventListener('change', () => {
    const selectedTheme = themeSelector.value;
    document.body.className = selectedTheme; // Add theme class to body
});

// Calibration Button
calibrateButton.addEventListener('click', startCalibration);
