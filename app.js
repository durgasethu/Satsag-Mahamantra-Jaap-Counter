var key = "jaap_v11_" + new Date().toISOString().slice(0, 10);
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
function draw() { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} bEl.textContent = st.b; mEl.textContent = st.m; }
draw();
function addOne() { st.b++; if (st.b >= 108) { st.b = 0; st.m++; } draw(); }

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

document.getElementById("tap").onclick = function() { addOne(); lg.textContent = "Manual +1 added"; };
document.getElementById("rst").onclick = function() {
  if (confirm("Reset today's progress? (" + st.b + " beads, " + st.m + " malas)")) {
    st = { b: 0, m: 0 }; draw(); lg.textContent = "Reset to 0.";
  }
};

var run = false, busy = false, stream = null, ctx = null, an = null, raf = null, wakeLock = null;
var ch = false, t0 = 0, tLast = 0, smoothLv = 0, actF = 0, totF = 0, isTrn = false;
var trnList = new Array(), curSpecs = new Array();
var btn = document.getElementById("btn"), sEl = document.getElementById("sEl"), tEl = document.getElementById("tEl"), fl = document.getElementById("fl");

function updTrn() {
  if (isTrn) { trnBtn.textContent = "Chant Round " + (trnList.length + 1) + " of 3 Now..."; trnBtn.classList.add("active"); }
  else if (vp) { trnBtn.textContent = "Voiceprint Active (Retrain 3 Rounds)"; trnBtn.classList.remove("active"); }
  else { trnBtn.textContent = "Train My Voice (3 Rounds)"; trnBtn.classList.remove("active"); }
}
updTrn();

document.getElementById("clrVp").onclick = function() {
  if (!vp) return alert("No voiceprint saved yet.");
  if (confirm("Clear your saved voiceprint?")) {
    vp = null; isTrn = false; trnList = new Array();
    try { localStorage.removeItem(vpKey); } catch (e) {}
    updTrn(); lg.textContent = "Voiceprint cleared.";
  }
};

trnBtn.onclick = function() {
  if (!run) return alert("Tap Start Voice Counting first.");
  isTrn = true; trnList = new Array(); curSpecs = new Array(); ch = false;
  updTrn(); lg.textContent = "Training: Chant Round 1 of 3 clearly...";
};

function norm(v) {
  var m = 0; for (var i = 0; i < v.length; i++) m += v[i] * v[i];
  m = Math.sqrt(m); if (m === 0) return v;
  var o = new Array(); for (var j = 0; j < v.length; j++) o.push(v[j] / m); return o;
}
function sim(a, b) {
  var d = 0, ma = 0, mb = 0;
  for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; ma += a[i] * a[i]; mb += b[i] * b[i]; }
  return (ma === 0 || mb === 0) ? 0 : d / (Math.sqrt(ma) * Math.sqrt(mb));
}
function avgSpec(list) {
  var a = new Array(); for (var x = 0; x < 32; x++) a.push(0);
  if (list.length === 0) return a;
  for (var i = 0; i < list.length; i++) { for (var b = 0; b < 32; b++) a[b] += list[i][b]; }
  for (var k = 0; k < 32; k++) a[k] /= list.length; return norm(a);
}

async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); } } catch (e) {}
}

btn.onclick = async function() {
  if (busy) return; busy = true;
  if (run) {
    run = false; isTrn = false; updTrn();
    if (raf) cancelAnimationFrame(raf);
    if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); stream = null; }
    if (ctx) ctx.suspend();
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    btn.textContent = "Start Voice Counting"; btn.classList.remove("on"); sEl.textContent = "Idle"; fl.style.width = "0%"; lg.textContent = "Stopped.";
    busy = false; return;
  }
  btn.textContent = "Starting Mic...";
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    var src = ctx.createMediaStreamSource(stream);
    var flt = ctx.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = 1000; flt.Q.value = 0.8;
    var gn = ctx.createGain(); gn.gain.value = 2.0;
    an = ctx.createAnalyser(); an.fftSize = 256;
    src.connect(flt); flt.connect(gn); gn.connect(an);
    run = true; ch = false; smoothLv = 0; keepAwake();
    btn.textContent = "Stop Listening"; btn.classList.add("on"); sEl.textContent = "Listening";
    lg.textContent = vp ? "Listening for YOUR voiceprint..." : "Listening (close-voice filter on)...";
    loop();
  } catch (e) { btn.textContent = "Start Voice Counting"; lg.textContent = "Mic error: " + e.message; }
  busy = false;
};

function loop() {
  if (!run) return;
  var d = new Uint8Array(an.frequencyBinCount), fq = new Uint8Array(an.frequencyBinCount);
  an.getByteTimeDomainData(d); an.getByteFrequencyData(fq);
  var sq = 0; for (var i = 0; i < d.length; i++) { var n = (d[i] - 128) / 128; sq += n * n; }
  var raw = Math.min(100, Math.round(Math.sqrt(sq / d.length) * 800));
  smoothLv = raw > smoothLv ? raw : smoothLv * 0.85;
  var lv = Math.round(smoothLv); fl.style.width = lv + "%";

  var th = Number(r1.value), mn = Number(r2.value), mx = Number(r3.value), ps = Number(r4.value), stc = Number(r5.value) / 100, now = Date.now();
  if (lv >= th) {
    if (!ch) { ch = true; t0 = now; actF = 0; totF = 0; curSpecs = new Array(); }
    tLast = now; actF++;
    var sl = new Array(); for (var b = 0; b < 32; b++) sl.push(fq[b + 2]); curSpecs.push(sl);
  }
  if (ch) {
    totF++;
    var gap = (now - tLast) / 1000, dur = (tLast - t0) / 1000;
    sEl.textContent = isTrn ? "Recording..." : (dur > mx ? "Too Long" : "Chanting...");
    tEl.textContent = "Chant: " + dur.toFixed(1) + "s | Pause: " + gap.toFixed(1) + "s";
    if (gap >= ps) {
      var dens = actF / Math.max(1, totF);
      if (dur >= mn && dur <= mx && dens >= 0.45 && curSpecs.length > 0) {
        var rVec = avgSpec(curSpecs);
        if (isTrn) {
          trnList.push(rVec);
          if (trnList.length < 3) { updTrn(); lg.textContent = "Captured Round " + trnList.length + "/3! Chant next..."; }
          else { vp = avgSpec(trnList); try { localStorage.setItem(vpKey, JSON.stringify(vp)); } catch (e) {} isTrn = false; updTrn(); lg.textContent = "Voiceprint saved! Counting ONLY your voice."; }
        } else if (vp) {
          var sc = sim(rVec, vp), pct = Math.round(sc * 100);
          if (sc >= stc) { addOne(); lg.textContent = "Counted +1 (" + dur.toFixed(1) + "s • Match: " + pct + "%)"; }
          else { lg.textContent = "Ignored noise/other voice (Match: " + pct + "%)"; }
        } else { addOne(); lg.textContent = "Counted +1 (" + dur.toFixed(1) + "s)"; }
      } else { lg.textContent = "Skipped (" + dur.toFixed(1) + "s)"; }
      ch = false; sEl.textContent = "Listening"; tEl.textContent = "Chant: 0.0s | Pause: 0.0s";
    }
  }
  raf = requestAnimationFrame(loop);
}
