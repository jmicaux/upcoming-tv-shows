"use strict";
/* ---------- Optional account: Supabase auth + preference sync ----------
   Loaded after app.js. Everything here is additive: without a configured Supabase project
   (or when the CDN script fails to load) the account button stays hidden and the app
   behaves exactly as before. */
(function () {
  const cfg = window.UPCOMING_SUPABASE || {};
  const accountBtn = document.getElementById("accountBtn");
  if (!accountBtn || !window.supabase || !window.SyncCore || !cfg.URL || !cfg.ANON_KEY) return;

  const client = window.supabase.createClient(cfg.URL, cfg.ANON_KEY, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  const redirectTo = location.origin + location.pathname;
  const RETURN_HASH_KEY = "tv:authReturnHash";
  function rememberRoute() {
    try { sessionStorage.setItem(RETURN_HASH_KEY, location.hash); } catch (_) {}
  }
  const SYNCED_KEYS = ["tv:followedNetworks", "tv:knownNetworks", "tv:favorites", "tv:watchOverrides", "tv:theme", SyncCore.MARKER_KEY];

  let user = null;          // { id, email } | null
  let syncStatus = "idle";
  let pendingEmail = "";    // email a code was sent to (email flow)

  /* ---------- Sync engine wiring ---------- */
  async function fetchRemote() {
    const { data, error } = await client.from("preferences").select("data,updated_at").maybeSingle();
    if (error) throw error;
    return data; // null when the user has no row yet
  }
  async function pushRemote(prefs, updatedAt) {
    const { error } = await client.from("preferences").upsert({ user_id: user.id, data: prefs, updated_at: updatedAt });
    if (error) throw error;
  }
  const STATUS_TITLE = { idle: "Account", syncing: "Syncing…", synced: "Synced", error: "Sync failed — will retry", offline: "Sync unavailable" };
  function onStatus(s) {
    if (s === "error" && syncStatus !== "error") toast("Sync failed — will retry on your next change");
    syncStatus = s;
    accountBtn.dataset.sync = s;
    accountBtn.title = STATUS_TITLE[s] || "Account";
    // The coloured dot alone must not carry the state (WCAG 1.4.1).
    accountBtn.setAttribute("aria-label", s === "idle" ? "Account" : `Account — ${STATUS_TITLE[s]}`);
    const line = document.getElementById("accountSyncLine");
    if (line) line.textContent = STATUS_TITLE[s] || "";
  }
  const sync = SyncCore.createSync({
    getLocal: localPrefsForSync,
    applyLocal: (p) => applyPrefs(p, { silent: true }),
    storage: localStorage,
    fetchRemote, pushRemote,
    now: Date.now, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    onStatus,
  });

  document.addEventListener("prefs:changed", () => sync.onLocalChange());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync.onVisible();
    else sync.flush();
  });
  window.addEventListener("pagehide", () => sync.flush());

  client.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
      const first = !user || user.id !== session.user.id;
      user = { id: session.user.id, email: session.user.email || "" };
      if (first && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) sync.onSignedIn(user.id);
    } else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
      user = null;
      sync.onSignedOut();
    }
    if (isAccountDialogOpen()) { renderAccount(); focusAccountDialog(); }
  });

  // After an OAuth / magic-link return, supabase-js exchanges ?code= for a session; then
  // drop the query so a reload does not retry it. The #hash route (e.g. #watchlist) is kept.
  // The redirect URL is registered without a #hash, so the route the user was on (e.g.
  // #watchlist) is saved before leaving and restored here.
  if (/[?&]code=/.test(location.search)) {
    let hash = location.hash;
    try { hash = hash || sessionStorage.getItem(RETURN_HASH_KEY) || ""; sessionStorage.removeItem(RETURN_HASH_KEY); } catch (_) {}
    client.auth.getSession().finally(() => {
      history.replaceState(null, "", location.pathname + hash);
      if (hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  }

  accountBtn.hidden = false;

  /* ---------- Dialog ---------- */
  function isAccountDialogOpen() { return !el.modal.hidden && !!el.modalBody.querySelector(".account"); }

  // Re-rendering replaces the dialog's content, which would drop keyboard focus onto <body>
  // outside the focus trap (WCAG 2.4.3). Put it back on the first action.
  function focusAccountDialog() {
    const target = el.modalBody.querySelector("#signOutBtn, #googleBtn");
    if (target) target.focus();
  }

  function showAccount() {
    state.navCard = null;
    renderAccount();
    revealModal("Account");
    updateModalNav();
  }

  const GOOGLE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10c.8-2.3 3-4.1 5.6-4.1z"/></svg>';

  // GitHub mark, monochrome: currentColor follows the light/dark theme.
  const GITHUB_SVG = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

  function renderAccount() {
    const footer = `<p class="account-footer">What is stored and why: <a href="privacy.html">Privacy</a>. Your TMDB key never leaves this browser.</p>`;
    if (!user) {
      const emailBlock = cfg.EMAIL_LOGIN ? `
        <h3 class="settings-h">Or use your email</h3>
        <p class="settings-note">We send a sign-in link and a 6-digit code. No password.</p>
        <form class="account-row" id="emailForm">
          <input type="email" id="accountEmail" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required value="${escapeAttr(pendingEmail)}">
          <button type="submit" class="account-btn-secondary">Send me a link</button>
        </form>
        <form class="account-row" id="codeForm" ${pendingEmail ? "" : "hidden"}>
          <input type="text" id="accountCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" aria-label="6-digit code from the email" required>
          <button type="submit" class="account-btn-secondary">Verify code</button>
        </form>` : "";
      el.modalBody.innerHTML = `
        <div class="account">
          <h2 class="modal-title">Account</h2>
          <p class="settings-note">Sign in to keep your channels, watchlist and settings on every device. Optional — everything also works without an account.</p>
          <div class="account-row">
            <button type="button" class="account-btn-primary" id="googleBtn" data-provider="google">${GOOGLE_SVG} Continue with Google</button>
            <button type="button" class="account-btn-primary" id="githubBtn" data-provider="github">${GITHUB_SVG} Continue with GitHub</button>
          </div>
          ${emailBlock}
          <p class="account-status" id="accountStatus" role="status" aria-live="polite"></p>
          ${footer}
        </div>`;
      wireSignedOut();
    } else {
      el.modalBody.innerHTML = `
        <div class="account">
          <h2 class="modal-title">Account</h2>
          <p class="settings-note">Signed in as <span class="account-email">${escapeHtml(user.email || user.id)}</span></p>
          <p class="account-status" id="accountSyncLine">${escapeHtml(STATUS_TITLE[syncStatus] || "")}</p>
          <div class="account-row">
            <button type="button" class="account-btn-secondary" id="signOutBtn">Sign out</button>
            <button type="button" class="account-btn-danger" id="deleteBtn" aria-expanded="false" aria-controls="deleteConfirm">Delete account</button>
          </div>
          <div class="account-confirm" id="deleteConfirm" hidden>
            <p class="settings-note">This removes your account and the preferences stored with it. It cannot be undone.</p>
            <label><input type="checkbox" id="clearDevice"> Also clear this device (channels, watchlist, settings, theme)</label>
            <div class="account-row">
              <button type="button" class="account-btn-danger" id="deleteConfirmBtn">Yes, delete my account</button>
              <button type="button" class="account-btn-secondary" id="deleteCancelBtn">Cancel</button>
            </div>
          </div>
          <p class="account-status" id="accountStatus" role="status" aria-live="polite"></p>
          ${footer}
        </div>`;
      wireSignedIn();
    }
  }

  function setStatus(msg, kind) {
    const s = el.modalBody.querySelector("#accountStatus");
    if (!s) return;
    s.textContent = msg;
    if (kind) s.dataset.kind = kind; else delete s.dataset.kind;
  }
  const errMsg = (e) => (e && e.message) ? e.message : "Something went wrong. Please try again.";

  function wireSignedOut() {
    const PROVIDER_NAME = { google: "Google", github: "GitHub" };
    el.modalBody.querySelectorAll("[data-provider]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const provider = btn.dataset.provider;
        setStatus(`Redirecting to ${PROVIDER_NAME[provider]}…`);
        rememberRoute();
        const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
        if (error) setStatus(errMsg(error), "error");
      });
    });
    const emailForm = el.modalBody.querySelector("#emailForm");
    if (!emailForm) return;
    const codeForm = el.modalBody.querySelector("#codeForm");
    emailForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = el.modalBody.querySelector("#accountEmail").value.trim();
      setStatus("Sending…");
      rememberRoute();
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) { setStatus(errMsg(error), "error"); return; }
      pendingEmail = email;
      codeForm.hidden = false;
      setStatus("Check your inbox: open the link, or type the 6-digit code here.");
      el.modalBody.querySelector("#accountCode").focus();
    });
    codeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = el.modalBody.querySelector("#accountCode").value.trim();
      setStatus("Verifying…");
      const { error } = await client.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
      if (error) setStatus(errMsg(error), "error");
      else pendingEmail = "";
    });
  }

  function wireSignedIn() {
    el.modalBody.querySelector("#signOutBtn").addEventListener("click", async () => {
      await sync.flush();
      const { error } = await client.auth.signOut();
      if (error) setStatus(errMsg(error), "error");
      else toast("Signed out — your preferences stay on this device");
    });
    const deleteBtn = el.modalBody.querySelector("#deleteBtn");
    const confirmBox = el.modalBody.querySelector("#deleteConfirm");
    deleteBtn.addEventListener("click", () => {
      confirmBox.hidden = !confirmBox.hidden;
      deleteBtn.setAttribute("aria-expanded", String(!confirmBox.hidden));
      if (!confirmBox.hidden) el.modalBody.querySelector("#clearDevice").focus();
    });
    el.modalBody.querySelector("#deleteCancelBtn").addEventListener("click", () => {
      confirmBox.hidden = true;
      deleteBtn.setAttribute("aria-expanded", "false");
      deleteBtn.focus();
    });
    el.modalBody.querySelector("#deleteConfirmBtn").addEventListener("click", async () => {
      const clearDevice = el.modalBody.querySelector("#clearDevice").checked;
      setStatus("Deleting…");
      const { error } = await client.rpc("delete_my_account");
      if (error) { setStatus(errMsg(error), "error"); return; }
      sync.onSignedOut();
      await client.auth.signOut({ scope: "local" }).catch(() => {});
      if (clearDevice) {
        SYNCED_KEYS.forEach((k) => localStorage.removeItem(k));
        location.reload();
        return;
      }
      localStorage.removeItem(SyncCore.MARKER_KEY);
      user = null;
      toast("Account deleted");
      renderAccount();
      focusAccountDialog();
    });
  }

  accountBtn.addEventListener("click", showAccount);
})();
