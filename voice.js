(function () {
  const micBtn = document.getElementById('mic-btn');
  const overlay = document.getElementById('voice-overlay');
  const status = document.getElementById('voice-status');
  const caption = document.getElementById('voice-caption');
  const closeBtn = document.getElementById('voice-close');
  const stopBtn = document.getElementById('voice-stop');
  const continuousBtn = document.getElementById('voice-continuous');
  const wakeBtn = document.getElementById('voice-wake');

  let active = false;
  let continuous = false;
  let wakeMode = false;
  let speaking = false;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let audio = null;
  let audioCtx = null;
  let analyser = null;
  let raf = null;
  let silenceTimer = null;
  let speechStarted = false;
  let lastVoiceAt = 0;

  // Mot de réveil : on transcrit chaque phrase et on ne garde que celles qui contiennent « Araqiel »
  // (variantes d'orthographe incluses, la transcription n'écrit pas toujours le nom pareil).
  const WAKE_RE = /\b(ara[kq]u?[iy]?[eè]l+e?|ara[kq]i[eè]l)\b/i;
  const keepListening = () => active && (continuous || wakeMode);

  function setState(state, text) {
    document.body.dataset.voice = state;
    if (text) status.textContent = text;
  }

  async function ensureStream() {
    if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return stream;
  }

  function stopAnalyser() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function monitorSilence() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      if (!recorder || recorder.state !== 'recording') return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 5);
      document.documentElement.style.setProperty('--voice-level', level.toFixed(3));
      if (level > 0.045) { speechStarted = true; lastVoiceAt = performance.now(); setState('listening', 'Araqiel écoute...'); }
      if (speechStarted && performance.now() - lastVoiceAt > 1050) stopRecording();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  async function startRecording() {
    if (!active || speaking || (recorder && recorder.state === 'recording')) return;
    try {
      await ensureStream();
      chunks = []; speechStarted = false; lastVoiceAt = performance.now();
      recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stopAnalyser();
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 2000 || !speechStarted) { if (keepListening()) setTimeout(startRecording, 250); return; }
        setState('thinking', 'Transcription...');
        try {
          const text = await window.ARAQIEL_TRANSCRIBE(blob);
          let heard = text.trim();
          if (heard && wakeMode) {
            if (!WAKE_RE.test(heard)) {
              caption.textContent = '';
              setState('listening', 'En attente du mot « Araqiel »...');
              heard = '';
            } else {
              heard = heard.replace(WAKE_RE, '').replace(/^[\s,.;:!?-]+/, '').trim();
              if (!heard) { setState('listening', 'Je t\'écoute...'); }
            }
          }
          if (heard) {
            caption.textContent = heard;
            setState('thinking', 'Araqiel réfléchit...');
            await window.ARAQIEL.send(heard, { voice: true });
          }
        } catch (e) {
          console.error(e); setState('listening', 'Impossible de transcrire.'); caption.textContent = (e && e.message) ? e.message : String(e);
        } finally {
          if (keepListening() && !speaking) setTimeout(startRecording, 300);
        }
      };
      recorder.start(120);
      setState('listening', 'Araqiel écoute...');
      audioCtx = audioCtx || new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      monitorSilence();
    } catch (e) {
      console.error(e); setState('idle', 'Accès au microphone refusé ou indisponible.');
    }
  }

  function stopRecording() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  async function speak(text) {
    speaking = true; stopRecording(); stopAnalyser();
    setState('speaking', 'Araqiel parle...'); caption.textContent = text;
    try {
      const res = await fetch(`${window.ARAQIEL_API}/tts`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); }
      audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => { speaking = false; if (active) { const again = keepListening(); setState(again ? 'listening' : 'idle', again ? "Je t'écoute..." : "Terminé."); if (again) setTimeout(startRecording, 250); } };
      await audio.play();
    } catch (e) {
      console.error('TTS', e);
      speaking = true;  // reste vrai pendant la lecture : le micro ne doit pas capter la voix de synthèse
      const done = () => { speaking = false; if (keepListening()) setTimeout(startRecording, 250); else if (active) setState('idle', 'Terminé.'); };
      const u = new SpeechSynthesisUtterance(text); u.lang='fr-FR'; u.rate=0.92; u.pitch=0.82;
      u.onend = done; u.onerror = done;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    }
  }

  window.addEventListener('araqiel:reply', e => { if (active) speak(e.detail.text); });

  async function openVoice() {
    active = true; overlay.style.display='flex'; micBtn?.classList.add('active');
    setState('listening', wakeMode ? 'Dis « Araqiel » pour me parler...' : continuous ? "Conversation continue : je t'écoute..." : "Araqiel écoute...");
    await startRecording();
  }
  function closeVoice() {
    active=false; continuous=false; wakeMode=false; speaking=false;
    stopRecording(); stopAnalyser();
    if (audio) audio.pause(); window.speechSynthesis.cancel();
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
    continuousBtn?.classList.remove('on'); wakeBtn?.classList.remove('on');
    overlay.style.display='none'; micBtn?.classList.remove('active'); document.body.dataset.voice='idle';
  }

  micBtn?.addEventListener('click', openVoice);
  closeBtn?.addEventListener('click', closeVoice);
  stopBtn?.addEventListener('click', () => { if(audio) audio.pause(); window.speechSynthesis.cancel(); speaking=false; stopRecording(); setState('idle','Interrompu.'); if(keepListening()) setTimeout(startRecording,300); });
  continuousBtn?.addEventListener('click', async () => { continuous=!continuous; continuousBtn.classList.toggle('on', continuous); setState('listening', continuous ? 'Conversation continue activée.' : 'Mode vocal simple.'); if(continuous && active && !speaking) startRecording(); });
  wakeBtn?.addEventListener('click', () => {
    wakeMode=!wakeMode; wakeBtn.classList.toggle('on',wakeMode);
    setState('listening',wakeMode ? 'Réveil activé : dis « Araqiel » avant ta phrase.' : 'Réveil désactivé.');
    if (wakeMode && active && !speaking) startRecording();
  });
  window.addEventListener('keydown', e => { if(e.ctrlKey && e.code==='Space'){e.preventDefault();openVoice();} if(e.key==='Escape') closeVoice(); });
  window.ARAQIEL_VOICE = { toggle: show => show ? openVoice() : closeVoice(), speak };
})();
