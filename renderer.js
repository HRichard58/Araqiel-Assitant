const API_URL = "http://127.0.0.1:5000";
window.ARAQIEL_API = API_URL;

let currentUser = null;
let userRole = "user";
let currentChatId = null;
let selectedFile = null;
let codeMode = false; // true = mode codage (agent défini dans coder.json)

const sectionAuth = document.getElementById("section-auth");
const btnToggleLogin = document.getElementById("btn-toggle-login");
const btnToggleRegister = document.getElementById("btn-toggle-register");
const authFormLogin = document.getElementById("auth-form-login");
const authFormRegister = document.getElementById("auth-form-register");
const authDoLogin = document.getElementById("auth-do-login");
const authDoRegister = document.getElementById("auth-do-register");
const authError = document.getElementById("page-auth-error");
const userDisplayName = document.getElementById("user-display-name");
const logoutBtn = document.getElementById("logout-btn");

const messagesContainer = document.getElementById("chat");
const userInput = document.getElementById("input");
const sendBtn = document.getElementById("send");
const newChatBtn = document.getElementById("new");
const historyContainer = document.getElementById("history");

const jarvisContainer = document.getElementById("jarvis-container");
const quickContainer = document.getElementById("quick");

const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn");

toggleSidebarBtn.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

// --- MODE CODAGE (agent coder.json) ---
const codeModeBtn = document.getElementById("code-mode-btn");
codeModeBtn?.addEventListener("click", () => {
  codeMode = !codeMode;
  codeModeBtn.classList.toggle("on", codeMode);
  document.body.classList.toggle("code-mode", codeMode);
  document.getElementById("input").placeholder = codeMode
    ? "Agent code : décris le programme à créer, colle une erreur, ou joins un fichier"
    : "Écris ici…";
});

function updateUIMode() {
  const hasMessages = messagesContainer.children.length > 0;
  if (hasMessages) {
    if (jarvisContainer) jarvisContainer.style.display = "none";
    if (quickContainer) quickContainer.style.display = "none";
  } else {
    if (jarvisContainer) jarvisContainer.style.display = "flex";
    if (quickContainer) quickContainer.style.display = "grid";
  }
}

async function loadHistory() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/history?username=${encodeURIComponent(currentUser)}`);
    const data = await res.json();
    historyContainer.innerHTML = "";

    if (res.ok && data.chats) {
      data.chats.forEach((chat) => {
        const itemContainer = document.createElement("div");
        itemContainer.classList.add("history-item");

        const btn = document.createElement("button");
        btn.classList.add("nav");
        if (chat.id === currentChatId) btn.classList.add("active");
        btn.textContent = chat.title || `Discussion ${chat.id}`;
        btn.addEventListener("click", () => openChat(chat.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.classList.add("delete-chat-btn");
        deleteBtn.innerHTML = "×";
        deleteBtn.title = "Supprimer";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteChat(chat.id);
        });

        itemContainer.appendChild(btn);
        itemContainer.appendChild(deleteBtn);
        historyContainer.appendChild(itemContainer);
      });
    }
  } catch (e) {
    console.error("Erreur historique", e);
  }
}

async function openChat(chatId) {
  currentChatId = chatId;
  messagesContainer.innerHTML = "";
  try {
    const res = await fetch(`${API_URL}/chat/${chatId}?username=${encodeURIComponent(currentUser)}`);
    const data = await res.json();
    if (res.ok && data.messages) {
      data.messages.forEach((m) => appendMessage(m.role, m.content));
    }
  } catch (e) {
    console.error("Erreur ouverture chat", e);
  }
  updateUIMode();
  loadHistory();
}

async function deleteChat(chatId) {
  if (!confirm("Supprimer cette conversation ?")) return;

  try {
    const res = await fetch(`${API_URL}/chat/${chatId}?username=${encodeURIComponent(currentUser)}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (res.ok && data.status === "success") {
      if (currentChatId === chatId) {
        currentChatId = null;
        messagesContainer.innerHTML = "";
        updateUIMode();
      }
      loadHistory();
    }
  } catch (e) {
    console.error("Erreur suppression", e);
  }
}

newChatBtn.addEventListener("click", () => {
  currentChatId = null;
  messagesContainer.innerHTML = "";
  updateUIMode();
  loadHistory();
});

// Réduit la fenêtre Araqiel pour laisser l'utilisateur voir l'écran pendant
// qu'une tâche s'exécute (ouverture d'appli, navigateur piloté, commande système...).
function minimizeForTask() {
  window.araqielWindow?.minimize();
}

// Détection rapide (côté interface) des messages qui démarrent clairement une
// tâche sur le PC, pour réduire la fenêtre dès l'envoi plutôt que d'attendre
// la réponse du serveur. Les tâches détectées uniquement par l'IA (function
// calling) sont, elles, signalées après coup par le champ "pc_task" de /chat.
const PC_TASK_TRIGGER = /^(ouvre|ouvrir|lance|lancer|démarre|demarre|ferme|fermer|quitte|arrête|arrete|exécute|execute|supprime|efface|éteins|eteins|redémarre|redemarre|verrouille)\b/i;

// Traitement des commandes de fichiers locales
async function handleLocalCommands(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!window.araqielSystem) return null;

  let folderPath = null;
  if (lower.startsWith('/dossier ')) folderPath = raw.slice(9).trim();
  else {
    const m = raw.match(/^(?:cr[ée]e?r|cr[ée]er|fais|fait)\s+(?:un\s+)?dossier\s+(?:appel[ée]\s+)?(.+)$/i);
    if (m) folderPath = m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  if (folderPath) {
    const res = await window.araqielSystem.createFolder(folderPath);
    minimizeForTask();
    return res.message;
  }

  let filePath = null, content = '';
  if (lower.startsWith('/fichier ')) {
    const parts = raw.slice(9).split('|');
    filePath = parts.shift().trim(); content = parts.join('|').trim();
  } else {
    const m = raw.match(/^(?:cr[ée]e?r|cr[ée]er|fais|fait)\s+(?:un\s+)?fichier\s+(.+?)(?:\s+avec\s+(?:le\s+)?contenu\s*[:=]\s*(.*))?$/i);
    if (m) { filePath = m[1].trim().replace(/^['"]|['"]$/g, ''); content = (m[2] || '').trim(); }
  }
  if (filePath) {
    const res = await window.araqielSystem.createFile(filePath, content);
    minimizeForTask();
    return res.message;
  }
  return null;
}

window.ARAQIEL_TRANSCRIBE = async function(blob) {
  const form = new FormData();
  form.append('audio', blob, 'araqiel-voice.webm');
  let res;
  try {
    res = await fetch(`${API_URL}/transcribe`, { method: 'POST', body: form });
  } catch (e) {
    throw new Error("Serveur IA injoignable (IA.py est-il lancé sur le port 5000 ?)");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* réponse non JSON */ }
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || `Transcription impossible (HTTP ${res.status})`);
  }
  return data.text || '';
};

async function sendMessage(textOverride = null, opts = {}) {
  const text = textOverride !== null ? textOverride.trim() : userInput.value.trim();
  if (!text && !selectedFile) return;

  let userDisplay = text;
  if (selectedFile) userDisplay += `\n📄 [Fichier] ${selectedFile.name}`;
  appendMessage("user", userDisplay);

  userInput.value = "";
  userInput.style.height = "auto";
  updateUIMode();

  // Réduction immédiate si la formulation indique clairement une tâche PC
  // (ouvrir/fermer une appli, exécuter une commande, etc.).
  if (!codeMode && PC_TASK_TRIGGER.test(text.trim())) {
    minimizeForTask();
  }

  // Traitement d'une commande système directe
  const localRes = codeMode ? null : await handleLocalCommands(text);
  if (localRes) {
    appendMessage("assistant", localRes);
    notifyReply(localRes);
    return localRes;
  }

  const isNewChat = currentChatId === null;
  const payload = {
    message: text,
    attachment: selectedFile,
    username: currentUser,
    chat_id: currentChatId,
    voice: !!opts.voice,
    mode: codeMode ? "code" : "chat"
  };
  clearAttachment();

  try {
    const response = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (response.ok && data.status === "success") {
      appendMessage("assistant", data.response);
      currentChatId = data.chat_id;
      if (isNewChat) loadHistory();
      if (data.pc_task && !codeMode) minimizeForTask();
      notifyReply(data.response);
      return data.response;
    } else {
      const msg = "Erreur : " + (data.message || "Erreur serveur.");
      appendMessage("assistant", msg);
      notifyReply(msg);
      return msg;
    }
  } catch (err) {
    const msg = "Erreur de connexion au serveur.";
    appendMessage("assistant", msg);
    notifyReply(msg);
    return msg;
  }
}

// ÉCOUTE DES MESSAGES ENVOYÉS DEPUIS LE TÉLÉPHONE
if (window.araqielSystem) {
  window.araqielSystem.onMobileMessage(async (payload) => {
    const text = typeof payload === "string" ? payload : payload.text;
    const phone = typeof payload === "string" ? null : payload.phone;
    const label = phone?.name ? `📱 [${phone.name}]` : "📱 [Mobile]";
    appendMessage("user", `${label} ${text}`);
    const response = await sendMessage(text);
    if (response) {
      window.araqielSystem.replyToMobile(response, phone?.id);
    }
  });
}

function notifyReply(text) {
  window.dispatchEvent(new CustomEvent("araqiel:reply", { detail: { text } }));
}

// Affiche un texte en découpant les blocs ```langage ... ``` : chaque bloc devient
// un <pre><code> avec un bouton "Copier". Tout est inséré via textContent (pas de HTML injecté).
function renderWithCodeBlocks(container, text) {
  const regex = /```([\w+#.-]*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  const addText = (t) => {
    if (!t) return;
    const span = document.createElement("span");
    span.style.whiteSpace = "pre-wrap";
    span.textContent = t;
    container.appendChild(span);
  };
  while ((m = regex.exec(text)) !== null) {
    addText(text.slice(last, m.index));
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    const head = document.createElement("div");
    head.className = "code-block-head";
    const lang = document.createElement("span");
    lang.textContent = m[1] || "code";
    const copy = document.createElement("button");
    copy.textContent = "Copier";
    const code = m[2].replace(/\n$/, "");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = "Copié !"; }
      catch (e) { copy.textContent = "Échec"; }
      setTimeout(() => (copy.textContent = "Copier"), 1500);
    });
    head.append(lang, copy);
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    wrap.append(head, pre);
    container.appendChild(wrap);
    last = regex.lastIndex;
  }
  addText(text.slice(last));
}

function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.classList.add("message", role === "assistant" ? "bot" : "user");
  if (role === "assistant" && text.includes("```")) renderWithCodeBlocks(msg, text);
  else msg.innerText = text;
  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

window.ARAQIEL = {
  send: sendMessage,
  appendMessage,
  get user() { return currentUser; }
};

sendBtn.addEventListener("click", () => sendMessage());
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

btnToggleLogin.addEventListener("click", () => {
  btnToggleLogin.classList.add("active");
  btnToggleRegister.classList.remove("active");
  authFormLogin.style.display = "block";
  authFormRegister.style.display = "none";
  authError.textContent = "";
});

btnToggleRegister.addEventListener("click", () => {
  btnToggleRegister.classList.add("active");
  btnToggleLogin.classList.remove("active");
  authFormRegister.style.display = "block";
  authFormLogin.style.display = "none";
  authError.textContent = "";
});

authDoLogin.addEventListener("click", async () => {
  const username = document.getElementById("auth-login-user").value.trim();
  const password = document.getElementById("auth-login-pass").value.trim();

  if (!username || !password) {
    authError.textContent = "Champs requis.";
    return;
  }

  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (response.ok && data.status === "success") {
      currentUser = username;
      userRole = data.role;
      // textContent (et non innerHTML) : un nom d'utilisateur ne doit jamais être interprété comme du HTML.
      userDisplayName.textContent = currentUser;
      if (userRole === "admin") {
        const badge = document.createElement("span");
        badge.style.cssText = "color:#f59e0b; font-size:10px; margin-left:6px;";
        badge.textContent = "(Admin)";
        userDisplayName.appendChild(badge);
      }
      sectionAuth.style.display = "none";
      loadHistory();
    } else {
      authError.textContent = data.message || "Identifiants invalides.";
    }
  } catch (e) {
    authError.textContent = "Serveur indisponible.";
  }
});

authDoRegister.addEventListener("click", async () => {
  const username = document.getElementById("auth-reg-user").value.trim();
  const password = document.getElementById("auth-reg-pass").value.trim();

  if (!username || !password) {
    authError.textContent = "Champs requis.";
    return;
  }

  try {
    const response = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (response.ok && data.status === "success") {
      authError.style.color = "#10b981";
      authError.textContent = "Compte créé ! Connectez-vous.";
      btnToggleLogin.click();
    } else {
      authError.style.color = "#ef4444";
      authError.textContent = data.message || "Erreur d'inscription.";
    }
  } catch (e) {
    authError.textContent = "Serveur indisponible.";
  }
});

logoutBtn.addEventListener("click", () => {
  if (window.ARAQIEL_VOICE) window.ARAQIEL_VOICE.toggle(false);
  currentUser = null;
  currentChatId = null;
  sectionAuth.style.display = "flex";
  messagesContainer.innerHTML = "";
  historyContainer.innerHTML = "";
  updateUIMode();
});

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = userInput.scrollHeight + "px";
});

const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");
const attachmentPreview = document.getElementById("attachment-preview");
const attachmentName = document.getElementById("attachment-name");
const removeAttachmentBtn = document.getElementById("remove-attachment-btn");

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    selectedFile = { name: file.name, content: evt.target.result };
    attachmentName.textContent = file.name;
    attachmentPreview.style.display = "flex";
  };
  reader.readAsText(file);
});

removeAttachmentBtn.addEventListener("click", clearAttachment);
function clearAttachment() {
  selectedFile = null;
  fileInput.value = "";
  attachmentPreview.style.display = "none";
}

document.querySelectorAll("#quick button").forEach((btn) => {
  btn.addEventListener("click", () => sendMessage(btn.getAttribute("data-p")));
});

// --- CONNEXION TÉLÉPHONE ---
const connectPhoneBtn = document.getElementById("connect-phone-btn");
const phoneModalOverlay = document.getElementById("phone-modal-overlay");
const phoneModalClose = document.getElementById("phone-modal-close");
const phoneQrImg = document.getElementById("phone-qr-img");
const phoneQrFallback = document.getElementById("phone-qr-fallback");
const phoneUrlValue = document.getElementById("phone-url-value");
const phoneUrlCopy = document.getElementById("phone-url-copy");
const phoneModalStatus = document.getElementById("phone-modal-status");

async function openPhoneModal() {
  phoneModalOverlay.classList.add("open");
  phoneQrImg.style.display = "none";
  phoneQrFallback.style.display = "block";
  phoneQrFallback.textContent = "Génération du QR code...";
  phoneUrlValue.value = "";
  phoneModalStatus.textContent = "";

  if (!window.araqielSystem?.getMobileConnectInfo) {
    phoneQrFallback.textContent = "Fonction indisponible dans cette version.";
    return;
  }

  try {
    const info = await window.araqielSystem.getMobileConnectInfo();
    phoneUrlValue.value = info.url;

    if (info.qrDataUrl) {
      phoneQrImg.src = info.qrDataUrl;
      phoneQrImg.style.display = "block";
      phoneQrFallback.style.display = "none";
    } else {
      phoneQrFallback.textContent = "QR code indisponible : utilisez l'adresse ci-dessous.";
    }
  } catch (e) {
    console.error("Erreur récupération info connexion téléphone", e);
    phoneQrFallback.textContent = "Impossible de récupérer l'adresse de connexion.";
  }

  refreshAccessPin();
  refreshRemoteAccessStatus();
}

function closePhoneModal() {
  phoneModalOverlay.classList.remove("open");
}

// --- CODE D'ACCÈS (PIN) ---
const phonePinValue = document.getElementById("phone-pin-value");
const phonePinRegenerate = document.getElementById("phone-pin-regenerate");

async function refreshAccessPin() {
  if (!window.araqielSystem?.getAccessPin) return;
  try {
    const pin = await window.araqielSystem.getAccessPin();
    phonePinValue.textContent = pin;
  } catch (e) {
    console.error("Erreur récupération code d'accès", e);
  }
}

phonePinRegenerate?.addEventListener("click", async () => {
  if (!window.araqielSystem?.regenerateAccessPin) return;
  if (!confirm("Générer un nouveau code ? Les téléphones pas encore validés devront saisir le nouveau code.")) return;
  const pin = await window.araqielSystem.regenerateAccessPin();
  phonePinValue.textContent = pin;
});

// --- ACCÈS À DISTANCE (hors Wi-Fi) ---
const phoneRemoteToggle = document.getElementById("phone-remote-toggle");
const phoneRemoteBadge = document.getElementById("phone-remote-badge");
const phoneRemoteQrWrap = document.getElementById("phone-remote-qr-wrap");
const phoneRemoteQrImg = document.getElementById("phone-remote-qr-img");
const phoneRemoteUrlRow = document.getElementById("phone-remote-url-row");
const phoneRemoteUrlValue = document.getElementById("phone-remote-url-value");
const phoneRemoteUrlCopy = document.getElementById("phone-remote-url-copy");
const phoneRemoteStatus = document.getElementById("phone-remote-status");

function setRemoteUI(active, url, qrDataUrl) {
  phoneRemoteBadge.textContent = active ? "Activé" : "Désactivé";
  phoneRemoteBadge.classList.toggle("on", active);
  phoneRemoteBadge.classList.toggle("off", !active);
  phoneRemoteToggle.textContent = active ? "Désactiver l'accès hors Wi-Fi" : "Activer l'accès hors Wi-Fi";

  if (active && url) {
    phoneRemoteUrlValue.value = url;
    phoneRemoteUrlRow.style.display = "flex";
    if (qrDataUrl) {
      phoneRemoteQrImg.src = qrDataUrl;
      phoneRemoteQrWrap.style.display = "flex";
    }
  } else {
    phoneRemoteUrlRow.style.display = "none";
    phoneRemoteQrWrap.style.display = "none";
  }
}

window.araqielSystem?.onRemoteAccessStatus?.((status) => {
  setRemoteUI(!!status?.active, status?.url || null, null);
  if (!status?.active) phoneRemoteStatus.textContent = "Le tunnel distant a été fermé.";
});

async function refreshRemoteAccessStatus() {
  if (!window.araqielSystem?.getRemoteAccessStatus) return;
  try {
    const status = await window.araqielSystem.getRemoteAccessStatus();
    setRemoteUI(status.active, status.url, null);
  } catch (e) {
    console.error("Erreur statut accès distant", e);
  }
}

phoneRemoteToggle?.addEventListener("click", async () => {
  if (!window.araqielSystem?.startRemoteAccess || !window.araqielSystem?.stopRemoteAccess) return;
  const isActive = phoneRemoteBadge.classList.contains("on");
  phoneRemoteToggle.disabled = true;
  phoneRemoteStatus.textContent = "";

  try {
    if (isActive) {
      await window.araqielSystem.stopRemoteAccess();
      setRemoteUI(false, null, null);
    } else {
      phoneRemoteStatus.textContent = "Connexion sécurisée au tunnel distant...";
      const res = await window.araqielSystem.startRemoteAccess();
      if (res.success) {
        setRemoteUI(true, res.url, res.qrDataUrl);
        phoneRemoteStatus.textContent = "";
      } else {
        phoneRemoteStatus.textContent = res.message || "Impossible d'activer l'accès à distance.";
      }
    }
  } finally {
    phoneRemoteToggle.disabled = false;
  }
});

connectPhoneBtn?.addEventListener("click", openPhoneModal);

const viewLogsBtn = document.getElementById("view-logs-btn");
viewLogsBtn?.addEventListener("click", async () => {
  if (!window.araqielSystem?.openLogsFolder) return;
  try {
    await window.araqielSystem.openLogsFolder();
  } catch (e) {
    console.error("Erreur ouverture dossier logs", e);
  }
});

phoneModalClose?.addEventListener("click", closePhoneModal);
phoneModalOverlay?.addEventListener("click", (e) => {
  if (e.target === phoneModalOverlay) closePhoneModal();
});
phoneUrlCopy?.addEventListener("click", async () => {
  if (!phoneUrlValue.value) return;
  try {
    await navigator.clipboard.writeText(phoneUrlValue.value);
    phoneModalStatus.style.color = "#10b981";
    phoneModalStatus.textContent = "Adresse copiée !";
  } catch (e) {
    phoneUrlValue.select();
    document.execCommand("copy");
  }
});

updateUIMode();