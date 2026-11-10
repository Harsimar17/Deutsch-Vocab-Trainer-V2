import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";

// ---------- BACKEND API ----------
// The page is built into the Spring Boot jar and served by it, so the API is on the same origin.
export const API_BASE = "";
// "Today" and the streak follow the learner's local midnight; the backend needs the zone.
export const TIME_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
})();

// Login session: the backend's JWT. It is the one thing kept in the browser
// (localStorage), so a reload stays logged in. Every API response carries a
// renewed token (X-Auth-Token) — the session ends after 24 h without a request.
// The token's own "exp" is checked before every call: an expired session goes
// straight to the login page without asking the server.
export const session = (() => {
  const KEY = "wortschatz.session";
  let current = null; // { token, user: { uid, email } }
  const save = () => {
    try { if (current) localStorage.setItem(KEY, JSON.stringify(current)); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked: memory only */ }
  };
  // exp from the JWT payload (base64url JSON), in ms; 0 if unreadable
  const expiresAt = (token) => {
    try {
      const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return typeof p.exp === "number" ? p.exp * 1000 : 0;
    } catch (e) { return 0; }
  };
  // drops an expired session; true while the session is usable
  const check = () => {
    if (current && current.token && expiresAt(current.token) > Date.now()) return true;
    if (current) { current = null; save(); }
    return false;
  };
  try { current = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { current = null; }
  check(); // opening the app with an expired token → login page right away
  return {
    user() { return check() ? current.user : null; },
    token() { return check() ? current.token : null; },
    async login(email, password) {
      const res = await fetch(API_BASE + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let body = null;
      try { body = await res.json(); } catch (e) { /* non-JSON body */ }
      if (!res.ok) throw new Error((body && body.message) || "login failed: HTTP " + res.status);
      current = { token: body.token, user: body.user };
      save();
      return current.user;
    },
    renew(token) { if (current && token) { current.token = token; save(); } },
    logout() { current = null; save(); },
  };
})();

// ---------- LOADERS ----------
// A request started while a button is being clicked shows a spinner on that
// button (and blocks double clicks); any other request shows the thin bar at
// the top. Either appears only if the request takes longer than LOADER_DELAY,
// so fast responses don't flicker.
export const LOADER_DELAY = 120;
export let clickedButton = null;
document.addEventListener("click", (e) => {
  const b = e.target && e.target.closest ? e.target.closest("button") : null;
  clickedButton = b;
  setTimeout(() => { if (clickedButton === b) clickedButton = null; }, 0); // only for this click
}, true);

export let barCount = 0;
export function setBar(delta) {
  barCount = Math.max(0, barCount + delta);
  const bar = document.getElementById("net-bar");
  if (bar) bar.classList.toggle("on", barCount > 0);
}
export function setButtonBusy(btn, delta) {
  btn.__busy = Math.max(0, (btn.__busy || 0) + delta);
  if (delta > 0 && btn.__busy === 1) {
    const cs = getComputedStyle(btn);
    btn.style.setProperty("--busy-color", cs.color);
    if (cs.position === "static") { btn.style.position = "relative"; btn.__busyPos = true; }
    btn.classList.add("btn-busy");
    btn.setAttribute("aria-busy", "true");
  } else if (btn.__busy === 0) {
    btn.classList.remove("btn-busy");
    btn.removeAttribute("aria-busy");
    btn.style.removeProperty("--busy-color");
    if (btn.__busyPos) { btn.style.position = ""; btn.__busyPos = false; }
  }
}
// Call when a request starts; returns the function to call when it ends.
export function trackLoading(quiet) {
  if (quiet) return () => {};
  const btn = clickedButton;
  let shownOn = null;
  const timer = setTimeout(() => {
    if (btn && btn.isConnected) { shownOn = btn; setButtonBusy(btn, +1); }
    else { shownOn = "bar"; setBar(+1); }
  }, LOADER_DELAY);
  return () => {
    clearTimeout(timer);
    if (shownOn === "bar") setBar(-1);
    else if (shownOn) setButtonBusy(shownOn, -1);
  };
}

export const api = (() => {
  let onError = null;
  let onLoggedOut = null;
  async function call(method, path, body, extraHeaders, quiet, keepalive) {
    const done = trackLoading(quiet); // runs synchronously, while the click is still being handled
    try {
      return await send(method, path, body, extraHeaders, keepalive);
    } finally {
      done();
    }
  }
  async function send(method, path, body, extraHeaders, keepalive) {
    const headers = Object.assign({ "X-Time-Zone": TIME_ZONE }, extraHeaders);
    const token = session.token(); // null once expired — checked before anything is sent
    if (!token) {
      if (onLoggedOut) onLoggedOut();
      const err = new Error("session expired — please log in again");
      err.status = 401;
      throw err;
    }
    headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(API_BASE + path, { method, headers, keepalive: !!keepalive, body: body === undefined ? undefined : JSON.stringify(body) });
    session.renew(res.headers.get("X-Auth-Token"));
    if (res.status === 401) {
      session.logout();
      if (onLoggedOut) onLoggedOut();
    }
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch (e) { /* non-JSON body */ }
      const err = new Error(msg || method + " " + path.split("?")[0] + " → HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  return {
    setErrorHandler(fn) { onError = fn; },
    setLoggedOutHandler(fn) { onLoggedOut = fn; },
    get: (path, opts) => call("GET", path, undefined, undefined, opts && opts.quiet),
    // opts.keepalive: the request outlives the page (for saving on pagehide)
    post: (path, body, headers, opts) => call("POST", path, body === undefined ? {} : body, headers, opts && opts.quiet, opts && opts.keepalive),
    del: (path, opts) => call("DELETE", path, undefined, undefined, opts && opts.quiet),
    report(e) { if (onError) onError((e && e.message) || String(e)); },
  };
})();
