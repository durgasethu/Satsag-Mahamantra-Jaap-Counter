var key = "jaap_android_v22_all";
var vpKey = "jaap_vp_android_v8";
var calKey = "jaap_cal_android_v1";

var st = { b: 0, m: 0 };
var vp = null;
var defaultCal = { thr: 18, minM: 5.5, maxM: 14.0, pauseMax: 2.5, strict: 0.75, calibrated: false };
var cal = Object.assign({}, defaultCal);

try {
  var sv = JSON.parse(localStorage.getItem(key));
  if (sv && !isNaN(sv.b)) st.b = Number(sv.b);
  if (sv && !isNaN(sv.m)) st.m = Number(sv.m);
  var svp = JSON.parse(localStorage.getItem(vpKey));
  if (svp && svp.length === 32) vp = svp;
  var scal = JSON.parse(localStorage.getItem(calKey));
  if (scal && typeof scal.thr === "number") cal = Object.assign({}, defaultCal, scal);
} catch (e) {}

var bEl = document.getElementById("bEl");
var mEl = document.getElementById("mEl");
var lg = document.getElementById("lg");
var hd = document.getElementById("hd");
var mk = document.getElementById("mk");
var calBtn = document.getElementById("calBtn");
var calBox = document.getElementById("calBox");
var calStep = document.getElementById("calStep");
var calMsg = document.getElementById("calMsg");
var calNextBtn = document.getElementById("calNextBtn");
var calCancelBtn = document.getElementById("calCancelBtn");
var calInfo = document.getElementById("calInfo");

function draw() {
  try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {}
  bEl.textContent = st.b;
  mEl.textContent = st.m;
}
draw();

function addOne() {
  st.b++;
  if (st.b >= 108) { st.b = 0; st.m++; }
  draw();
}

function applyCalUI() {
  mk.style.left = Math.min(95, Math.max(2, cal.thr)) + "%";
  if (cal.calibrated) {
    calBtn.textContent = "Recalibrate Voice & Pace";
    calInfo.textContent = "Calibrated: Chant " + cal.minM.toFixed(1) + "s-" + cal.maxM.toFixed(1) + "s | Pause " + cal.pauseMax.toFixed(1) + "s | Sensitivity " + Math.round(cal.thr);
  } else {
    calBtn.textContent = "Calibrate Voice & Pace";
    calInfo.textContent = "Using default voice & pace settings. Tap Calibrate to personalize.";
  }
}
applyCalUI();

document.getElementById("tap").onclick = function() {
  addOne();
  lg.textContent = "Manual +1 added";
};

var rstBtn = document.getElementById("rstAll");
var rstConfirm = false;
var rstTimer = null;

rstBtn.onclick = function() {
  if (!rstConfirm) {
    rstConfirm = true;
    rstBtn.textContent = "Tap Again to Confirm Reset (" + st.b + " count, " + st.m + " malas)";
    rstBtn.classList.add("confirming");
    rstTimer = setTimeout(function() {
      rstConfirm = false;
      rstBtn.textContent = "Reset All Counts";
      rstBtn.classList.remove("confirming");
    }, 4000);
  } else {
    clearTimeout(rstTimer);
    rstConfirm = false;
    rstBtn.textContent = "Reset All Counts";
    rstBtn.classList.remove("confirming");
    try {
      localStorage.removeItem(key);
    } catch (e) {}
    st = { b: 0, m: 0 };
    draw();
    lg.textContent = "All counts reset to 0.";
  }
};

var run = false, busy = false, stream = null, ctx = null, an = null, timer = null, wakeLock = null, recog = null, keepAliveOsc = null;
var ch = false, t0 = 0, tLast = 0, smoothLv = 0, actF = 0, totF = 0;
var curSpecs = [];
var spokenText = "";

// Calibration state
var isCal = false;
var calRounds = [];
var calNoiseSamples = [];
var calRoundFrames = [];
var calRoundStart = 0;

var btn = document.getElementById("btn");
var sEl = document.getElementById("sEl");
var tEl = document.getElementById("tEl");
var fl = document.getElementById("fl");

function norm(v) {
  var m = 0;
  for (var i = 0; i < v.length; i++) m += v[i] * v[i];
  m = Math.sqrt(m);
  if (m === 0) return v;
  var o = [];
  for (var j = 0; j < v.length; j++) o.push(v[j] / m);
  return o;
}

function sim(a, b) {
  var d = 0, ma = 0, mb = 0;
  for (var i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  return (ma === 0 || mb === 0) ? 0 : d / (Math.sqrt(ma) * Math.sqrt(mb));
}

function avgSpec(list) {
  var a = [];
  for (var x = 0; x < 32; x++) a.push(0);
  if (list.length === 0) return a;
  for (var i = 0; i < list.length; i++) {
    for (var b = 0; b < 32; b++) a[b] += list[i][b];
  }
  for (var k = 0; k < 32; k++) a[k] /= list.length;
  return norm(a);
}

function checkWords(txt) {
  if (!txt) return true;
  var t = txt.toLowerCase();
  var words = t.trim().split(/\s+/);
  var hasRama = t.indexOf("ram") !== -1;
  var hasKrishna = t.indexOf("krish") !== -1;
  if (words.length >= 5) return hasRama && hasKrishna;
  return true;
}

function updateCalPrompt() {
  var step = calRounds.length + 1;
  calStep.textContent = "Calibration: Round " + step + " of 3";
  if (step === 1) {
    calMsg.textContent = "Chant all 16 words once at your natural pace, then tap \"One More Time\".";
    calNextBtn.textContent = "One More Time (1/3)";
  } else if (step === 2) {
    calMsg.textContent = "Good! Chant all 16 words a second time, then tap \"One More Time\".";
    calNextBtn.textContent = "One More Time (2/3)";
  } else {
    calMsg.textContent = "Almost done! Chant all 16 words a third time, then tap \"Done\".";
    calNextBtn.textContent = "Done (3/3)";
  }
}

function analyzeCalRound(frames, noiseFloor) {
  if (!frames || frames.length === 0) return null;
  var sortedLv = frames.map(function(f) { return f.lv; }).sort(function(a, b) { return a - b; });
  var p75 = sortedLv[Math.floor(sortedLv.length * 0.75)] || 0;
  var activeThr = Math.max(noiseFloor + 5, p75 * 0.45, 6);

  var firstT = null, lastT = null;
  var maxPause = 0, prevVoiceT = null;
  var activeLevels = [];
  var activeSpecs = [];

  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    if (f.lv >= activeThr) {
      if (firstT === null) firstT = f.t;
      if (prevVoiceT !== null) {
        var gap = f.t - prevVoiceT;
        if (gap > maxPause) maxPause = gap;
      }
      prevVoiceT = f.t;
      lastT = f.t;
      activeLevels.push(f.lv);
      activeSpecs.push(f.spec);
    }
  }

  if (firstT === null || lastT === null || activeSpecs.length < 10) return null;
  var dur = lastT - firstT;
  if (dur < 1.5) return null;

  var avgVoice = activeLevels.reduce(function(s, v) { return s + v; }, 0) / activeLevels.length;
  return {
    dur: dur,
    maxPause: maxPause,
    voiceLv: avgVoice,
    spec: avgSpec(activeSpecs)
  };
}

function finishCalibration() {
  var noiseFloor = 4;
  if (calNoiseSamples.length > 0) {
    var sNoise = calNoiseSamples.slice().sort(function(a, b) { return a - b; });
    noiseFloor = sNoise[Math.floor(sNoise.length * 0.5)];
  }

  var avgVoiceLv = calRounds.reduce(function(s, r) { return s + r.voiceLv; }, 0) / calRounds.length;
  var minDur = Math.min.apply(null, calRounds.map(function(r) { return r.dur; }));
  var maxDur = Math.max.apply(null, calRounds.map(function(r) { return r.dur; }));
  var longestPause = Math.max.apply(null, calRounds.map(function(r) { return r.maxPause; }));

  var newThr = Math.round(Math.min(65, Math.max(6, noiseFloor + (avgVoiceLv - noiseFloor) * 0.35)));
  var newMinM = Number(Math.max(2.0, minDur * 0.78).toFixed(1));
  var newMaxM = Number(Math.min(22.0, Math.max(9.0, maxDur * 1.45)).toFixed(1));
  var newPause = Number(Math.min(4.0, Math.max(0.8, longestPause * 1.35 + 0.3)).toFixed(1));

  var s01 = sim(calRounds[0].spec, calRounds[1].spec);
  var s12 = sim(calRounds[1].spec, calRounds[2].spec);
  var s02 = sim(calRounds[0].spec, calRounds[2].spec);
  var minSim = Math.min(s01, s12, s02);
  var newStrict = Number(Math.min(0.85, Math.max(0.58, minSim - 0.08)).toFixed(2));

  vp = avgSpec(calRounds.map(function(r) { return r.spec; }));
  cal = {
    thr: newThr,
    minM: newMinM,
    maxM: newMaxM,
    pauseMax: newPause,
    strict: newStrict,
    calibrated: true
  };

  try {
    localStorage.setItem(vpKey, JSON.stringify(vp));
    localStorage.setItem(calKey, JSON.stringify(cal));
  } catch (e) {}

  isCal = false;
  ch = false;
  spokenText = "";
  calBox.classList.remove("show");
  calBtn.classList.remove("active");
  applyCalUI();
  lg.textContent = "Calibration complete! Counts preserved. Ready to count.";
}

function cancelCalibration() {
  isCal = false;
  calRounds = [];
  calRoundFrames = [];
  ch = false;
  spokenText = "";
  calBox.classList.remove("show");
  calBtn.classList.remove("active");
  applyCalUI();
}

calBtn.onclick = async function() {
  if (isCal) {
    cancelCalibration();
    lg.textContent = "Calibration canceled.";
    return;
  }
  if (!run) {
    await startAudio();
    if (!run) return;
  }
  isCal = true;
  ch = false;
  spokenText = "";
  calRounds = [];
  calNoiseSamples = [];
  calRoundFrames = [];
  calRoundStart = performance.now() / 1000;
  calBtn.classList.add("active");
  calBtn.textContent = "Calibrating (3 Rounds)...";
  calBox.classList.add("show");
  updateCalPrompt();
  lg.textContent = "Calibrating Round 1 of 3... Chant all 16 words.";
};

calNextBtn.onclick = function() {
  if (!isCal) return;
  var noiseFloor = 4;
  if (calNoiseSamples.length > 0) {
    var sNoise = calNoiseSamples.slice().sort(function(a, b) { return a - b; });
    noiseFloor = sNoise[Math.floor(sNoise.length * 0.5)];
  }
  var parsed = analyzeCalRound(calRoundFrames, noiseFloor);
  if (!parsed) {
    lg.textContent = "Could not hear full chant. Please chant all 16 words, then tap button.";
    calRoundFrames = [];
    calRoundStart = performance.now() / 1000;
    return;
  }
  calRounds.push(parsed);
  calRoundFrames = [];
  calRoundStart = performance.now() / 1000;
  spokenText = "";

  if (calRounds.length >= 3) {
    finishCalibration();
  } else {
    updateCalPrompt();
    lg.textContent = "Round " + calRounds.length + " saved (" + parsed.dur.toFixed(1) + "s). Chant Round " + (calRounds.length + 1) + "...";
  }
};

calCancelBtn.onclick = function() {
  cancelCalibration();
  lg.textContent = "Calibration canceled.";
};

var clrCalBtn = document.getElementById("clrCal");
var clrConfirm = false;
var clrTimer = null;

clrCalBtn.onclick = function() {
if (!cal.calibrated && !vp) {
lg.textContent = "Already using default settings.";
return;
}
if (!clrConfirm) {
clrConfirm = true;
clrCalBtn.textContent = "Tap Again to Clear";
clrTimer = setTimeout(function() {
clrConfirm = false;
clrCalBtn.textContent = "Clear Calibration";
}, 4000);
} else {
clearTimeout(clrTimer);
clrConfirm = false;
clrCalBtn.textContent = "Clear Calibration";
vp = null;
cal = Object.assign({}, defaultCal);
cancelCalibration();
try {
localStorage.removeItem(vpKey);
localStorage.removeItem(calKey);
} catch (e) {}
applyCalUI();
lg.textContent = "Calibration cleared. Reverted to defaults.";
}
};
function startAndroidSpeech() {
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) return;
try {
recog = new SR();
recog.continuous = true;
recog.interimResults = true;
recog.lang = "en-IN";
recog.onresult = function(ev) {
var str = "";
for (var i = ev.resultIndex; i < ev.results.length; i++) {
str += ev.results[i].transcript + " ";
}
if (str.trim()) {
spokenText = (spokenText + " " + str).trim();
if (hd) hd.textContent = "Heard: " + spokenText.slice(-70);
}
};
recog.onerror = function(e) {
if (e.error === "no-speech" && run) {
try { recog.stop(); } catch (err) {}
}
};
recog.onend = function() {
if (run && recog) {
setTimeout(function() {
if (run && recog) { try { recog.start(); } catch (e) {} }
}, 150);
}
};
recog.start();
} catch (e) { recog = null; }
}
async function keepAwake() {
try {
if ("wakeLock" in navigator && !wakeLock) {
wakeLock = await navigator.wakeLock.request("screen");
wakeLock.addEventListener("release", function() {
wakeLock = null;
});
}
} catch (e) {}
}
document.addEventListener("visibilitychange", function() {
if (document.visibilityState === "visible" && run) {
keepAwake();
if (ctx && ctx.state === "suspended") ctx.resume();
}
});
function stopAudio() {
run = false;
ch = false;
if (isCal) cancelCalibration();
if (timer) { clearInterval(timer); timer = null; }
if (recog) { try { recog.stop(); } catch (e) {} recog = null; }
if (keepAliveOsc) { try { keepAliveOsc.stop(); } catch (e) {} keepAliveOsc = null; }
if (stream) {
stream.getTracks().forEach(function(t) { t.stop(); });
stream = null;
}
if (ctx) {
try { ctx.close(); } catch (e) {}
ctx = null;
}
if (wakeLock) {
try { wakeLock.release(); } catch (e) {}
wakeLock = null;
}
btn.textContent = "Start Voice Counting";
btn.classList.remove("on");
sEl.textContent = "Idle";
fl.style.width = "0%";
}
async function startAudio() {
if (busy) return;
busy = true;
try {
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
throw new Error("Mic requires HTTPS on Android Chrome");
}
var AudioCtx = window.AudioContext || window.webkitAudioContext;
ctx = new AudioCtx();
if (ctx.state === "suspended") await ctx.resume();
var silentGain = ctx.createGain();
silentGain.gain.value = 0.0001;
keepAliveOsc = ctx.createOscillator();
keepAliveOsc.frequency.value = 1;
keepAliveOsc.connect(silentGain);
silentGain.connect(ctx.destination);
keepAliveOsc.start();
stream = await navigator.mediaDevices.getUserMedia({
audio: {
echoCancellation: true,
noiseSuppression: true,
autoGainControl: true
}
});
var src = ctx.createMediaStreamSource(stream);
an = ctx.createAnalyser();
an.fftSize = 512;
src.connect(an);
var timeData = new Uint8Array(an.fftSize);
var freqData = new Uint8Array(an.frequencyBinCount);
run = true;
btn.textContent = "Stop Voice Counting";
btn.classList.add("on");
sEl.textContent = "Listening";
lg.textContent = "Android Listening for all 16 words...";
keepAwake();
startAndroidSpeech();
timer = setInterval(function() {
if (!run || !an) return;
if (ctx && ctx.state === "suspended") ctx.resume();
an.getByteTimeDomainData(timeData);
an.getByteFrequencyData(freqData);
var sum = 0;
for (var i = 0; i < timeData.length; i++) {
var v = (timeData[i] - 128) / 128;
sum += v * v;
}
var rms = Math.sqrt(sum / timeData.length) * 320;
smoothLv = smoothLv * 0.6 + rms * 0.4;
fl.style.width = Math.min(100, smoothLv) + "%";
var now = performance.now() / 1000;
var spec = [];
for (var b = 0; b < 32; b++) {
var bSum = 0;
for (var k = 0; k < 4; k++) bSum += freqData[b * 4 + k] || 0;
spec.push(bSum / 4);
}
if (isCal) {
if ((now - calRoundStart) < 0.45 && calRounds.length === 0) {
calNoiseSamples.push(smoothLv);
}
calRoundFrames.push({ t: now, lv: smoothLv, spec: norm(spec) });
sEl.textContent = "Calibrating (" + (calRounds.length + 1) + "/3)";
tEl.textContent = "Round " + (calRounds.length + 1) + " elapsed: " + (now - calRoundStart).toFixed(1) + "s";
return;
}
var thr = cal.thr;
var minM = cal.minM;
var maxM = cal.maxM;
var pauseMax = cal.pauseMax;
var strict = cal.strict;
if (smoothLv > thr) {
if (!ch) {
ch = true;
t0 = now;
actF = 0;
totF = 0;
curSpecs = [];
spokenText = "";
if (hd) hd.textContent = "";
}
tLast = now;
actF++;
totF++;
curSpecs.push(norm(spec));
sEl.textContent = "Chanting";
} else if (ch) {
totF++;
sEl.textContent = "Breath Pause";
} else {
sEl.textContent = "Listening";
}
var dur = ch ? (tLast - t0) : 0;
var pau = ch ? (now - tLast) : 0;
tEl.textContent = "Chant: " + dur.toFixed(1) + "s | Pause: " + pau.toFixed(1) + "s";
if (ch && (pau >= pauseMax || (now - t0) >= maxM)) {
ch = false;
var ratio = totF > 0 ? (actF / totF) : 0;
var wordsOk = checkWords(spokenText);
if (dur >= minM && ratio > 0.35 && curSpecs.length > 0 && wordsOk) {
var roundSpec = avgSpec(curSpecs);
if (vp) {
var score = sim(roundSpec, vp);
if (score >= strict) {
addOne();
lg.textContent = "Counted 16 words (" + dur.toFixed(1) + "s, " + Math.round(score * 100) + "% match)";
} else {
lg.textContent = "Ignored (" + Math.round(score * 100) + "% match < " + Math.round(strict * 100) + "%)";
}
} else {
addOne();
lg.textContent = "Counted 16 words (" + dur.toFixed(1) + "s)";
}
} else if (!wordsOk) {
lg.textContent = "Incomplete mantra ignored (need both Rama & Krishna)";
} else {
lg.textContent = "Half/short chant ignored (" + dur.toFixed(1) + "s < " + minM.toFixed(1) + "s)";
}
spokenText = "";
}
}, 35);
} catch (err) {
stopAudio();
lg.textContent = "Mic error: " + (err.message || "Permission denied");
}
busy = false;
}
btn.onclick = async function() {
if (run) {
stopAudio();
lg.textContent = "Stopped.";
} else {
await startAudio();
}
};
lg.textContent = "v23 Android Ready. Tap Start Voice Counting or Calibrate.";
