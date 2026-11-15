// The exam's voices and microphone. Recordings are spoken by Talkloop's Piper voice when it is
// loaded (one recorded voice, played a little lower or higher so two speakers can be told
// apart), otherwise by the browser's German voices. Nothing can be paused or replayed beyond
// what the exam allows: that is decided by the caller.
import { hasPiperVoice, piperLoaded, piperReady, loadPiperVoice, piperSpeak } from "@static/talkloop/piper.js";

const LOCALE = "de-DE";
let token = 0; // bumps on stop, so audio still being made is dropped
let source = null;
let ctx = null;

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}

// Start loading the recorded voice (a one-time download) so it is there when the audio starts.
export function warmVoice() {
  if (hasPiperVoice(LOCALE) && !piperLoaded(LOCALE)) loadPiperVoice(LOCALE).catch(() => {});
}

const germanVoices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices().filter((v) => /^de([-_]|$)/i.test(v.lang)) : []);
const FEMALE = /katja|hedda|anna|petra|marlene|vicki|helena|female|frau|seraphina|amala|ingrid|gisela/i;

function browserSay(text, gender, rate) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    const voices = germanVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALE;
    const wanted = voices.find((v) => FEMALE.test(v.name) === (gender === "f")) ?? voices[0];
    if (wanted) u.voice = wanted;
    // No voice of that gender: tell the speakers apart by pitch.
    u.pitch = wanted && FEMALE.test(wanted.name) === (gender === "f") ? 1 : gender === "f" ? 1.25 : 0.8;
    u.rate = rate;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// Piper's one voice, played back slower (deeper: a man) or faster (higher: a woman); it is
// generated at the opposite speed, so the speaking pace stays what was asked for.
async function piperSay(text, gender, rate, mine) {
  const shift = gender === "f" ? 1.13 : 0.94;
  await playPcm(await piperSpeak(text, LOCALE, { speed: rate / shift }), shift, mine);
}

// Plays {pcm: 16-bit mono bytes, sampleRate}; resolves when it has ended or was stopped.
async function playPcm({ pcm, sampleRate }, shift, mine) {
  const ac = audioCtx();
  if (mine !== token) return;
  if (!ac) throw new Error("no Web Audio");
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = Math.floor(pcm.byteLength / 2);
  const buffer = ac.createBuffer(1, samples, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  await new Promise((resolve) => {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = shift;
    src.connect(ac.destination);
    src.onended = () => { if (source === src) source = null; resolve(); };
    source = src;
    src.start();
  });
}

// Speaks the lines one after the other; resolves when done or stopped (false when stopped).
// cloud(line), when given, makes a line's audio elsewhere (Gemini's voices); a line it can't
// make (null, or an error such as the day's limit) is spoken by the voices here instead.
export async function playLines(lines, { rate = 1, cloud = null } = {}) {
  stopAudio();
  const mine = token;
  let useCloud = Boolean(cloud);
  // A voice already downloaded but not yet in memory is worth a short wait.
  if (!useCloud && hasPiperVoice(LOCALE) && !piperLoaded(LOCALE) && (!germanVoices().length || (await piperReady(LOCALE)))) {
    await Promise.race([loadPiperVoice(LOCALE).catch(() => {}), new Promise((r) => setTimeout(r, germanVoices().length ? 4000 : 60000))]);
  }
  for (const line of lines) {
    if (mine !== token) return false;
    if (useCloud) {
      try {
        const audio = await cloud(line);
        if (mine !== token) return false;
        if (audio) {
          await playPcm(audio, 1, mine);
          if (mine === token) await new Promise((r) => setTimeout(r, 250));
          continue;
        }
      } catch (error) {
        console.warn("Cloud voice failed, using the voice on this device:", error);
      }
      useCloud = false;
      if (mine !== token) return false;
      if (hasPiperVoice(LOCALE) && !piperLoaded(LOCALE)) await Promise.race([loadPiperVoice(LOCALE).catch(() => {}), new Promise((r) => setTimeout(r, germanVoices().length ? 4000 : 60000))]);
    }
    try {
      if (piperLoaded(LOCALE)) await piperSay(line.text, line.gender, rate, mine);
      else await browserSay(line.text, line.gender, rate);
    } catch {
      if (mine === token) await browserSay(line.text, line.gender, rate);
    }
    if (mine === token) await new Promise((r) => setTimeout(r, 350));
  }
  return mine === token;
}

export function stopAudio() {
  token++;
  try { source?.stop(); } catch { /* already ended */ }
  source = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// ---------- microphone (the browser's speech recognition) ----------
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition);
let recognizer = null;

// Listens until stopListening() or `silence` ms without speech after something was heard.
// onText gets everything heard so far; onEnd the final text (or an error message).
export function listen({ onText, onEnd, silence = 0 }) {
  stopListening();
  if (!Recognition) { onEnd("", "Die Spracheingabe braucht Chrome, Edge oder Safari. Sie können tippen."); return; }
  stopAudio();
  const r = new Recognition();
  recognizer = r;
  r.lang = LOCALE;
  r.interimResults = true;
  r.continuous = true;
  let finalText = "";
  let heard = "";
  let timer = null;
  let problem = "";
  r.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += `${result[0].transcript} `;
      else interim += result[0].transcript;
    }
    heard = (finalText + interim).trim();
    onText(heard);
    if (silence && heard) { clearTimeout(timer); timer = setTimeout(() => r.stop(), silence); }
  };
  r.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") problem = "Das Mikrofon ist nicht erlaubt. Sie können tippen.";
    else if (event.error !== "aborted" && event.error !== "no-speech") problem = `Spracheingabe: ${event.error}. Sie können tippen.`;
  };
  r.onend = () => {
    clearTimeout(timer);
    if (recognizer === r) recognizer = null;
    onEnd(heard.length > finalText.trim().length ? heard : finalText.trim(), problem);
  };
  try { r.start(); } catch { recognizer = null; onEnd("", "Das Mikrofon konnte nicht starten. Sie können tippen."); }
}

export function stopListening() {
  try { recognizer?.stop(); } catch { /* not started */ }
}
