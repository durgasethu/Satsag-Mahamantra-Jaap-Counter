var key = "jaap_v11_all";
var vpKey = "jaap_vp_v7";
var st = { b: 0, m: 0 };
var vp = null;

try {
  var sv = JSON.parse(localStorage.getItem(key));
  if (sv && !isNaN(sv.b)) st.b = Number(sv.b);
  if (sv && !isNaN(sv.m)) st.m = Number(sv.m);
  var svp = JSON.parse(localStorage.getItem(vpKey));
  if (svp && svp.length === 32) vp = svp;
} catch (e) {}

var bEl = document.getElementById("bEl"), mEl = document.getElementById("mEl"), lg = document.getElementById("lg"), trnBtn = document.getElementById("trn");
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

var r1 = document.getElementById("r1"), r2 = document.getElementById("r2"), r3 = document.getElementById("r3"), r4 = document.getElementById("r4"), r5 = document.getElementById("r5");
function upd() {
  document.getElementById("v1").textContent = r1.value;
  document.getElementById("v2").textContent = Number(r2.value).toFixed(1) + "s";
  document.getElementById("v3").textContent = Number(r3.value).toFixed(1) + "s";
  document.getElementById("v4").textContent = Number(r4.value).toFixed(1) + "s";
  document.getElementById("v5").textContent = r5.value + "%";
  document.getElementById("mk").style.left = r1.value + "%";
}
r1.oninput = upd; r2.oninput = upd; r3.oninput = upd; r4.oninput = upd; r5.oninput = upd; upd();

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
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf("jaap_v") === 0) localStorage.removeItem(k);
      }
    } catch (e) {}
    st = { b: 0, m: 0 };
    draw();
    lg.textContent = "All counts reset to 0.";
  }
};

var run = false, busy = false, stream = null, ctx = null, an = null, raf = null, wakeLock = null;
var ch = false, t0 = 0, tLast = 0, smoothLv = 0, actF = 0, totF = 0, isTrn = false;
var trnList = [], curSpecs = [];
var btn = document.getElementById("btn"), sEl = document.getElementById("sEl"), tEl = document.getElementById("tEl"), fl = document.getElementById("fl");

function updTrn() {
  if (isTrn) { trnBtn.textContent = "Chant Round " + (trnList.length + 1) + " of 3 Now..."; trnBtn.classList.add("active"); }
  else if (vp) { trnBtn.textContent = "Voiceprint Active (Retrain 3 Rounds)"; trnBtn.classList.remove("active"); }
  else { trnBtn.textContent = "Train My Voice (3 Rounds)"; trnBtn.classList.remove("active"); }
}
updTrn();

var clrVpBtn = document.getElementById("clrVp");
var vpConfirm = false;
var vpTimer = null;

clrVpBtn.onclick = function() {
  if (!vp) { lg.textContent = "No voiceprint saved yet."; return; }
  if (!vpConfirm) {
    vpConfirm = true;
    clrVpBtn.textContent = "Tap Again to Clear";
    vpTimer = setTimeout(function() {
      vpConfirm = false;
      clrVpBtn.textContent = "Clear Voiceprint";
    }, 4000);
  } else {
    clearTimeout(vpTimer);
    vpConfirm = false;
    clrVpBtn.textContent = "Clear Voiceprint";
    vp = null; isTrn = false; trnList = [];
    try { localStorage.removeItem(vpKey); } catch (e) {}
    updTrn();
    lg.textContent = "Voiceprint cleared.";
  }
};

trnBtn.onclick = function() {
  if (!run) { lg.textContent = "Tap Start Voice Counting first."; return; }
  isTrn = true; trnList = []; curSpecs = []; ch = false;
  updTrn();
  lg.textContent = "Training: Chant Round 1 of 3 clearly...";
};

function norm(v) {
  var m = 0; for (var i = 0; i < v.length; i++) m += v[i] * v[i];
  m = Math.sqrt(m); if (m === 0) return v;
  var o = []; for (var j = 0; j < v.length; j++) o.push(v[j] / m); return o;
}

function sim(a, b) {
  var d = 0, ma = 0, mb = 0;
  for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; ma += a[i] * a[i]; mb += b[i] * b[i]; }
  return (ma === 0 || mb === 0) ? 0 : d / (Math.sqrt(ma) * Math.sqrt(mb));
}

function avgSpec(list) {
  var a = []; for (var x = 0; x < 32; x++) a.push(0);
  if (list.length === 0) return a;
  for (var i = 0; i < list.length; i++) { for (var b = 0; b < 32; b++) a[b] += list[i][b]; }
  for (var k = 0; k < 32; k++) a[k] /= list.length; return norm(a);
}

async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); } } catch (e) {}
}

function stopAudio() {
  run = false; isTrn = false; ch = false; updTrn();
  if (raf) cancelAnimationFrame(raf);
  if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); stream = null; }
  if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  btn.textContent = "Start Voice Counting";
  btn.classList.remove("on");
  sEl.textContent = "Idle";
  fl.style.width = "0%";
}

btn.onclick = async function() {
  if (busy) return;
  busy = true;
  if (run) {
    stopAudio();
    lg.textContent = "Stopped.";
    busy = false;
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
    });
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
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
    lg.textContent = "Listening... Begin chanting.";
    keepAwake();

    function loop() {
      if (!run) return;
      raf = requestAnimationFrame(loop);
      an.getByteTimeDomainData(timeData);
      an.getByteFrequencyData(freqData);

      var sum = 0;
      for (var i = 0; i < timeData.length; i++) {
        var v = (timeData[i] - 128) / 128;
        sum += v * v;
      }
      var rms = Math.sqrt(sum / timeData.length) * 250;
      smoothLv = smoothLv * 0.65 + rms * 0.35;
      fl.style.width = Math.min(100, smoothLv) + "%";

      var thr = Number(r1.value);
      var minM = Number(r2.value);
      var maxM = Number(r3.value);
      var pauseMax = Number(r4.value);
      var strict = Number(r5.value) / 100;
      var now = performance.now() / 1000;

      var spec = [];
      for (var b = 0; b < 32; b++) {
        var bSum = 0;
        for (var k = 0; k < 4; k++) bSum += freqData[b * 4 + k] || 0;
        spec.push(bSum / 4);
      }

      if (smoothLv > thr) {
        if (!ch) {
          ch = true;
          t0 = now;
          actF = 0;
          totF = 0;
          curSpecs = [];
        }
        tLast = now;
        actF++;
        totF++;
        curSpecs.push(norm(spec));
        sEl.textContent = "Chanting";
      } else if (ch) {
        totF++;
        sEl.textContent = "Pause";
      } else {
        sEl.textContent = "Listening";
      }

      var dur = ch ? (tLast - t0) : 0;
      var pau = ch ? (now - tLast) : 0;
      tEl.textContent = "Chant: " + dur.toFixed(1) + "s | Pause: " + pau.toFixed(1) + "s";

      if (ch && (pau >= pauseMax || (now - t0) >= maxM)) {
        ch = false;
        var ratio = totF > 0 ? (actF / totF) : 0;
        if (dur >= minM && ratio > 0.35) {
          var roundSpec = avgSpec(curSpecs);
          if (isTrn) {
            trnList.push(roundSpec);
            if (trnList.length >= 3) {
              vp = avgSpec(trnList);
              try { localStorage.setItem(vpKey, JSON.stringify(vp)); } catch (e) {}
              isTrn = false;
              updTrn();
              lg.textContent = "Voiceprint saved! Ready to count.";
            } else {
              updTrn();
              lg.textContent = "Round " + trnList.length + " captured. Chant Round " + (trnList.length + 1) + " of 3...";
            }
          } else if (vp) {
            var score = sim(roundSpec, vp);
            if (score >= strict) {
              addOne();
              lg.textContent = "Counted (" + Math.round(score * 100) + "% match)";
            } else {
              lg.textContent = "Ignored (" + Math.round(score * 100) + "% match < " + Math.round(strict * 100) + "%)";
            }
          } else {
            addOne();
            lg.textContent = "Counted (" + dur.toFixed(1) + "s)";
          }
        } else {
          lg.textContent = "Short sound ignored (" + dur.toFixed(1) + "s)";
        }
      }
    }
    loop();
  } catch (err) {
    stopAudio();
    lg.textContent = "Mic error: " + (err.message || "Permission denied");
  }
  busy = false;
};
