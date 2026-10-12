const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  console.warn("Module 'qrcode' introuvable (lance 'npm install' pour l'installer). Le QR code de connexion ne sera pas disponible, mais l'adresse restera affichée.");
}

const { spawn, execFileSync } = require('child_process');

const MOBILE_PORT = 3000;
let mainWindow = null;
let backendProcess = null;
let cloudflaredProcess = null;
let currentRemoteUrl = null;

// --- CODE D'ACCÈS (PIN) ---
// Obligatoire pour qu'un téléphone puisse envoyer des commandes à Araqiel :
// sans ça, dès qu'on active l'accès à distance, n'importe qui sur Internet
// disposant du lien pourrait sinon contrôler le PC. Régénéré à chaque
// lancement de l'app ; visible uniquement depuis la fenêtre Araqiel (l'écran
// "Connecter mon téléphone"), jamais renvoyé au navigateur du téléphone tant
// qu'il ne l'a pas saisi correctement.
function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 chiffres
}
let ACCESS_PIN = generatePin();

// --- JOURNALISATION DES TÉLÉPHONES CONNECTÉS ---
// Deux fichiers texte, à côté de l'app, pour pouvoir retrouver facilement
// quel téléphone a fait quoi et quand :
//  - logs/phones-connections.txt : chaque connexion/déconnexion d'un téléphone
//  - logs/phones-commands.txt    : chaque commande envoyée par un téléphone
const LOGS_DIR = path.join(__dirname, 'logs');
const PHONES_LOG_FILE = path.join(LOGS_DIR, 'phones-connections.txt');
const COMMANDS_LOG_FILE = path.join(LOGS_DIR, 'phones-commands.txt');

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeIp(ip) {
  if (!ip) return 'inconnue';
  return ip.replace('::ffff:', '');
}

function appendLog(filePath, line) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(filePath, line + '\n', 'utf-8');
  } catch (err) {
    console.error(`Erreur d'écriture dans ${filePath} :`, err.message);
  }
}

function describePhone(info) {
  const id = info.id || 'non-identifié';
  const name = info.name || 'Téléphone inconnu';
  return `IP=${info.ip} ID=${id} NOM="${name}"`;
}

// --- OUTIL : trouver l'adresse IP locale (Wi-Fi/Ethernet) de la machine ---
// C'est cette adresse que le téléphone doit utiliser (sur le même réseau Wi-Fi)
// pour ouvrir http://<ip>:3000 et se connecter à Araqiel.
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function findCloudflared() {
  const candidates = [
    path.join(__dirname, 'cloudflared.exe'),
    path.join(process.resourcesPath || '', 'cloudflared.exe'),
    path.join(process.cwd(), 'cloudflared.exe')
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  try {
    const result = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['cloudflared'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch (_) {}

  return null;
}

function stopCloudflaredProcess() {
  const child = cloudflaredProcess;
  cloudflaredProcess = null;
  currentRemoteUrl = null;

  if (!child || child.killed) return;

  try {
    child.kill();
  } catch (_) {}

  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (_) {}
  }
}

function startCloudflareQuickTunnel() {
  return new Promise((resolve, reject) => {
    if (cloudflaredProcess && currentRemoteUrl) {
      resolve(currentRemoteUrl);
      return;
    }

    const executable = findCloudflared();
    if (!executable) {
      reject(new Error(
        'cloudflared.exe est introuvable. Place cloudflared.exe à côté de main.js ou installe cloudflared puis ajoute-le au PATH.'
      ));
      return;
    }

    let settled = false;
    let output = '';
    const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

    const child = spawn(
      executable,
      ['tunnel', '--url', `http://127.0.0.1:${MOBILE_PORT}`, '--no-autoupdate'],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    cloudflaredProcess = child;

    const consume = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (output.length > 12000) output = output.slice(-12000);

      const match = text.match(urlPattern) || output.match(urlPattern);
      if (match && !settled) {
        settled = true;
        currentRemoteUrl = match[0];
        resolve(currentRemoteUrl);
      }
    };

    child.stdout.on('data', consume);
    child.stderr.on('data', consume);

    child.on('error', (err) => {
      cloudflaredProcess = null;
      currentRemoteUrl = null;
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      const wasCurrent = cloudflaredProcess === child;
      if (wasCurrent) {
        cloudflaredProcess = null;
        currentRemoteUrl = null;
      }

      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared s'est arrêté avant de fournir une URL (code ${code}).`));
      } else if (wasCurrent && mainWindow) {
        mainWindow.webContents.send('remote-access-status', { active: false, url: null });
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        stopCloudflaredProcess();
        reject(new Error("Délai dépassé : cloudflared n'a pas fourni d'URL publique."));
      }
    }, 30000);
  });
}

// --- BACKEND PYTHON (IA.py) ---
// En développement, `npm start` lance déjà IA.py via concurrently : on ne fait rien.
// Dans la version installée (.exe), Electron démarre lui-même le backend fourni dans
// resources/backend et stocke base de données + clés (.key, coder.json) dans le dossier
// de données utilisateur (affiché dans la console au démarrage).
function startBackend() {
  if (!app.isPackaged || backendProcess) return;

  const backendDir = path.join(process.resourcesPath, 'backend');
  const script = path.join(backendDir, 'IA.py');
  if (!fs.existsSync(script)) {
    console.error(`[Araqiel] IA.py introuvable : ${script}`);
    return;
  }

  const dataDir = app.getPath('userData');
  const python = process.env.ARAQIEL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  console.log(`[Araqiel] Backend : ${python} ${script} (données : ${dataDir})`);

  const child = spawn(python, [script], {
    cwd: backendDir,
    env: Object.assign({}, process.env, { ARAQIEL_DATA_DIR: dataDir, PYTHONUTF8: '1' }),
    windowsHide: true
  });
  backendProcess = child;

  child.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  child.on('error', (err) => {
    console.error(`[Araqiel] Impossible de lancer Python (${python}) : ${err.message}. Installe Python 3 et lance : pip install -r requirements.txt`);
    if (backendProcess === child) backendProcess = null;
  });
  child.on('exit', (code) => {
    console.log(`[Araqiel] Backend arrêté (code ${code}).`);
    if (backendProcess === child) backendProcess = null;
  });
}

function stopBackend() {
  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch (e) { /* déjà arrêté */ }
}

function checkServer(callback) {
  const req = http.get('http://127.0.0.1:5000/api/status', (res) => {
    if (res.statusCode === 200) {
      callback();
    } else {
      setTimeout(() => checkServer(callback), 300);
    }
  });

  req.on('error', () => {
    setTimeout(() => checkServer(callback), 300);
  });
}

function allowMicrophone() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' || permission === 'audioCapture';
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  checkServer(() => {
    mainWindow.loadFile('index.html');
  });
}

// --- GESTION DU SYSTÈME DE FICHIERS ---
// Création fiable de dossiers/fichiers :
// - vérifie que le chemin est valide ;
// - vérifie si le dossier existe déjà ;
// - crée automatiquement tous les dossiers parents manquants ;
// - vérifie que le chemin parent est bien un dossier ;
// - refuse d'écraser un dossier avec un fichier (et inversement).
ipcMain.handle('create-folder', async (event, folderPath) => {
  try {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      return { success: false, message: 'Chemin de dossier vide ou invalide.' };
    }

    folderPath = path.resolve(folderPath.trim());

    if (fs.existsSync(folderPath)) {
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { success: false, message: `Le chemin existe déjà mais ce n'est pas un dossier : ${folderPath}` };
      }
      return {
        success: true,
        alreadyExists: true,
        created: false,
        message: `Le dossier existe déjà : ${folderPath}`,
        path: folderPath
      };
    }

    fs.mkdirSync(folderPath, { recursive: true });

    return {
      success: true,
      alreadyExists: false,
      created: true,
      message: `Dossier créé : ${folderPath}`,
      path: folderPath
    };
  } catch (err) {
    return { success: false, message: `Impossible de créer le dossier : ${err.message}` };
  }
});

ipcMain.handle('create-file', async (event, filePath, content = '') => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, message: 'Chemin de fichier vide ou invalide.' };
    }

    filePath = path.resolve(filePath.trim());
    const parentDir = path.dirname(filePath);
    const parentAlreadyExisted = fs.existsSync(parentDir);

    // 1. Vérifier le chemin parent.
    if (parentAlreadyExisted) {
      const parentStat = fs.statSync(parentDir);
      if (!parentStat.isDirectory()) {
        return {
          success: false,
          message: `Le chemin parent existe mais n'est pas un dossier : ${parentDir}`
        };
      }
    } else {
      // 2. Le dossier n'existe pas : créer toute l'arborescence nécessaire.
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // 3. Vérifier si le chemin final existe déjà.
    if (fs.existsSync(filePath)) {
      const existingStat = fs.statSync(filePath);

      if (existingStat.isDirectory()) {
        return {
          success: false,
          message: `Impossible de créer le fichier : un dossier existe déjà à cet emplacement : ${filePath}`
        };
      }

      // Un fichier existe déjà : on le met à jour avec le contenu demandé.
      fs.writeFileSync(filePath, String(content ?? ''), 'utf-8');

      return {
        success: true,
        alreadyExists: true,
        created: false,
        overwritten: true,
        message: `Le fichier existait déjà, son contenu a été mis à jour : ${filePath}`,
        path: filePath
      };
    }

    // 4. Créer le fichier.
    fs.writeFileSync(filePath, String(content ?? ''), 'utf-8');

    // 5. Vérification finale.
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { success: false, message: `Le fichier n'a pas pu être vérifié après sa création : ${filePath}` };
    }

    return {
      success: true,
      alreadyExists: false,
      created: true,
      overwritten: false,
      parentCreated: !parentAlreadyExisted,
      message: `Fichier créé : ${filePath}`,
      path: filePath,
      parentDirectory: parentDir
    };
  } catch (err) {
    return { success: false, message: `Impossible de créer le fichier : ${err.message}` };
  }
});

// --- SÉLECTEURS DE CHEMINS ---
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('choose-file-path', async (event, suggestedName = 'nouveau_fichier.txt') => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, properties: ['createDirectory', 'showOverwriteConfirmation'] });
  return result.canceled ? null : result.filePath;
});

// --- SERVEUR POUR CONNECTER VOTRE TÉLÉPHONE (PORT 3000) ---
// Map ws -> { id, name, ip, connectedAt } pour savoir qui est qui.
const connectedPhones = new Map();

function initMobileServer() {
  const expressApp = express();
  const server = http.createServer(expressApp);
  const wss = new WebSocket.Server({ server });

  expressApp.use(express.json());

  expressApp.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Araqiel Mobile</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #030712; color: #f0f9ff; padding: 15px; margin: 0; }
          h2 { text-align: center; color: #38bdf8; text-shadow: 0 0 10px rgba(56,189,248,0.5); font-size: 18px; margin-bottom: 4px; }
          #device-name { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 15px; }
          #device-name button { background: none; border: none; color: #38bdf8; text-decoration: underline; cursor: pointer; font-size: 11px; padding: 0; margin-left: 6px; }
          #chat { height: 68vh; overflow-y: auto; border: 1px solid rgba(56,189,248,0.2); background: rgba(6,11,25,0.85); border-radius: 12px; padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px; }
          .msg { padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.4; word-break: break-word; }
          .user { background: linear-gradient(135deg, #0284c7, #38bdf8); color: #030712; font-weight: 600; align-self: flex-end; }
          .bot { background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); color: #f0f9ff; align-self: flex-start; }
          .input-box { display: flex; gap: 8px; }
          input { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid rgba(56,189,248,0.3); background: rgba(0,0,0,0.6); color: white; outline: none; }
          button { padding: 12px 18px; border-radius: 8px; border: none; background: #38bdf8; color: #030712; font-weight: bold; cursor: pointer; }
          #auth-gate { background: rgba(6,11,25,0.85); border: 1px solid rgba(56,189,248,0.2); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
          #auth-gate p { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
          #pin-status { font-size: 12px; color: #f59e0b; margin-top: 8px; min-height: 16px; }
        </style>
      </head>
      <body>
        <h2>ARAQIEL REMOTE OS</h2>
        <div id="device-name"></div>
        <div id="auth-gate">
          <p>Code d'accès (affiché sur le PC, dans "Connecter mon téléphone") :</p>
          <div class="input-box">
            <input type="text" id="pin-input" inputmode="numeric" maxlength="6" placeholder="123456" />
            <button onclick="submitPin()">Valider</button>
          </div>
          <div id="pin-status"></div>
        </div>
        <div id="chat" style="display:none;"></div>
        <div class="input-box" id="msg-box" style="display:none;">
          <input type="text" id="msg" placeholder="Commande ou message..." />
          <button onclick="send()">Envoyer</button>
        </div>
        <script>
          // Identifiant persistant (survit même si l'IP du téléphone change) +
          // nom modifiable, stockés localement sur le téléphone.
          function uuid() {
            if (crypto.randomUUID) return crypto.randomUUID();
            return 'phone-' + Date.now() + '-' + Math.random().toString(16).slice(2);
          }
          let deviceId = localStorage.getItem('araqiel_device_id');
          if (!deviceId) { deviceId = uuid(); localStorage.setItem('araqiel_device_id', deviceId); }
          let deviceName = localStorage.getItem('araqiel_device_name');
          if (!deviceName) { deviceName = 'Téléphone ' + deviceId.slice(0, 4); localStorage.setItem('araqiel_device_name', deviceName); }
          let savedPin = localStorage.getItem('araqiel_pin') || '';

          function renderDeviceName() {
            document.getElementById('device-name').innerHTML =
              'Connecté en tant que : <b>' + deviceName + '</b> <button onclick="renameDevice()">renommer</button>';
          }
          function renameDevice() {
            const next = prompt('Nom de cet appareil :', deviceName);
            if (next && next.trim()) {
              deviceName = next.trim().slice(0, 60);
              localStorage.setItem('araqiel_device_name', deviceName);
              renderDeviceName();
              register();
            }
          }
          renderDeviceName();

          const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
          const ws = new WebSocket(wsProtocol + location.host);
          const chat = document.getElementById('chat');

          function register() {
            ws.send(JSON.stringify({ type: 'register', id: deviceId, name: deviceName, pin: savedPin }));
          }

          function unlock() {
            document.getElementById('auth-gate').style.display = 'none';
            chat.style.display = 'flex';
            document.getElementById('msg-box').style.display = 'flex';
          }

          function submitPin() {
            const val = document.getElementById('pin-input').value.trim();
            if (!val) return;
            savedPin = val;
            document.getElementById('pin-status').textContent = 'Vérification...';
            register();
          }

          ws.onopen = () => {
            if (savedPin) register();
          };

          ws.onmessage = (e) => {
            let data;
            try { data = JSON.parse(e.data); } catch (err) { data = null; }

            if (data && data.type === 'auth') {
              if (data.ok) {
                localStorage.setItem('araqiel_pin', savedPin);
                document.getElementById('pin-status').textContent = '';
                unlock();
              } else {
                localStorage.removeItem('araqiel_pin');
                document.getElementById('pin-status').textContent = '❌ Code incorrect, réessaie.';
              }
              return;
            }

            chat.innerHTML += '<div class="msg bot"><b>Araqiel:</b> ' + e.data + '</div>';
            chat.scrollTop = chat.scrollHeight;
          };

          function send() {
            const input = document.getElementById('msg');
            if(!input.value.trim()) return;
            ws.send(JSON.stringify({ type: 'message', text: input.value }));
            chat.innerHTML += '<div class="msg user"><b>Moi:</b> ' + input.value + '</div>';
            chat.scrollTop = chat.scrollHeight;
            input.value = '';
          }
        </script>
      </body>
      </html>
    `);
  });

  wss.on('connection', (ws, req) => {
    const info = {
      id: null,
      name: null,
      ip: normalizeIp(req.socket.remoteAddress),
      connectedAt: timestamp(),
      authenticated: false
    };
    connectedPhones.set(ws, info);
    appendLog(PHONES_LOG_FILE, `[${timestamp()}] ${describePhone(info)} -> connexion (en attente d'identification)`);

    ws.on('message', (message) => {
      let raw = message.toString();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

      // 1) Message d'identification + code d'accès (envoyé à l'ouverture, à la
      //    saisie du PIN, et à chaque renommage).
      if (parsed && parsed.type === 'register') {
        info.id = (parsed.id || '').slice(0, 80) || info.id || `phone-${Date.now()}`;
        info.name = (parsed.name || info.name || 'Téléphone inconnu').slice(0, 80);

        const pinOk = typeof parsed.pin === 'string' && parsed.pin.trim() === ACCESS_PIN;
        const wasAuthenticated = info.authenticated;
        info.authenticated = pinOk;

        if (pinOk && !wasAuthenticated) {
          appendLog(PHONES_LOG_FILE, `[${timestamp()}] ${describePhone(info)} -> identifié et AUTORISÉ (code correct)`);
        } else if (!pinOk) {
          appendLog(PHONES_LOG_FILE, `[${timestamp()}] ${describePhone(info)} -> code d'accès REFUSÉ (${parsed.pin ? 'code incorrect' : 'aucun code saisi'})`);
        }

        ws.send(JSON.stringify({ type: 'auth', ok: pinOk }));
        return;
      }

      // 2) Commande/message envoyé par l'utilisateur du téléphone : refusée
      //    tant que le bon code d'accès n'a pas été validé pour cette connexion.
      if (!info.authenticated) {
        appendLog(PHONES_LOG_FILE, `[${timestamp()}] ${describePhone(info)} -> commande REFUSÉE (non authentifié) : ${raw.slice(0, 200)}`);
        ws.send(JSON.stringify({ type: 'auth', ok: false }));
        return;
      }

      const text = (parsed && parsed.type === 'message') ? (parsed.text || '') : raw;
      if (!text.trim()) return;

      appendLog(COMMANDS_LOG_FILE, `[${timestamp()}] ${describePhone(info)} COMMANDE: ${text}`);

      if (mainWindow) {
        mainWindow.webContents.send('mobile-message', {
          text,
          phone: { id: info.id, name: info.name, ip: info.ip }
        });
      }
    });

    ws.on('close', () => {
      appendLog(PHONES_LOG_FILE, `[${timestamp()}] ${describePhone(info)} -> déconnecté`);
      connectedPhones.delete(ws);
    });
  });

  // Un seul écouteur (et non un par connexion) : la réponse est envoyée
  // uniquement au téléphone identifié par phoneId, jamais aux autres — et
  // consignée dans le même journal que la commande, pour une trace complète
  // question -> réponse par appareil.
  ipcMain.on('reply-to-mobile', (event, payload) => {
    const { text, phoneId } = (typeof payload === 'object' && payload) ? payload : { text: payload, phoneId: null };
    for (const [ws, info] of connectedPhones.entries()) {
      if (info.id === phoneId) {
        appendLog(COMMANDS_LOG_FILE, `[${timestamp()}] ${describePhone(info)} REPONSE ARAQIEL: ${text}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(text);
        }
        return;
      }
    }
  });

  server.listen(MOBILE_PORT, () => {
    console.log(`Serveur Mobile Araqiel lancé sur le port ${MOBILE_PORT}`);
  });
}

// --- OPTION "CONNECTER MON TÉLÉPHONE" ---
// Renvoie au frontend l'adresse locale + un QR code (data URL) pointant vers
// le petit serveur mobile déjà lancé par initMobileServer(), pour que l'utilisateur
// puisse scanner le code avec son téléphone (sur le même Wi-Fi) plutôt que de
// devoir taper l'adresse IP à la main.
ipcMain.handle('get-mobile-connect-info', async () => {
  const ip = getLocalIPAddress();
  const url = `http://${ip}:${MOBILE_PORT}`;

  let qrDataUrl = null;
  if (QRCode) {
    try {
      qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });
    } catch (err) {
      console.error("Impossible de générer le QR code :", err);
    }
  }

  return { ip, port: MOBILE_PORT, url, qrDataUrl };
});

// --- CODE D'ACCÈS (PIN) ---
ipcMain.handle('get-access-pin', () => ACCESS_PIN);

ipcMain.handle('regenerate-access-pin', () => {
  ACCESS_PIN = generatePin();
  appendLog(PHONES_LOG_FILE, `[${timestamp()}] Code d'accès régénéré manuellement depuis l'app.`);
  return ACCESS_PIN;
});

// --- ACCÈS À DISTANCE (hors Wi-Fi) ---
// Utilise Cloudflare Quick Tunnel au lieu de LocalTunnel.
// Le téléphone peut donc être sur une autre connexion (4G/5G/autre Wi-Fi).
// L'URL est temporaire et change lorsque le tunnel est recréé.
ipcMain.handle('start-remote-access', async () => {
  try {
    const url = await startCloudflareQuickTunnel();

    let qrDataUrl = null;
    if (QRCode) {
      try {
        qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260 });
      } catch (err) {
        console.error('Impossible de générer le QR code du tunnel :', err);
      }
    }

    appendLog(PHONES_LOG_FILE, `[${timestamp()}] Accès à distance ACTIVÉ : ${url}`);
    return { success: true, url, qrDataUrl };
  } catch (err) {
    stopCloudflaredProcess();
    return { success: false, message: err.message };
  }
});

ipcMain.handle('stop-remote-access', async () => {
  if (cloudflaredProcess || currentRemoteUrl) {
    stopCloudflaredProcess();
    appendLog(PHONES_LOG_FILE, `[${timestamp()}] Accès à distance DÉSACTIVÉ.`);
  }
  return { success: true };
});

ipcMain.handle('get-remote-access-status', () => {
  return { active: !!currentRemoteUrl, url: currentRemoteUrl };
});

// Ouvre le dossier "logs" (connexions + commandes téléphones) dans l'explorateur
// de fichiers du PC, pour retrouver facilement qui a fait quoi.
ipcMain.handle('open-logs-folder', async () => {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    // Crée les fichiers s'ils n'existent pas encore, pour que le dossier ne soit pas vide.
    if (!fs.existsSync(PHONES_LOG_FILE)) fs.writeFileSync(PHONES_LOG_FILE, '', 'utf-8');
    if (!fs.existsSync(COMMANDS_LOG_FILE)) fs.writeFileSync(COMMANDS_LOG_FILE, '', 'utf-8');
    await shell.openPath(LOGS_DIR);
    return { success: true, path: LOGS_DIR };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

app.whenReady().then(() => {
  allowMicrophone();
  startBackend();
  createWindow();
  initMobileServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopCloudflaredProcess();
  stopBackend();
});

app.on('window-all-closed', () => {
  stopCloudflaredProcess();
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});