const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Body-Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static public folder (für HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// ================== PERSISTENZ (data.json) ==================
const DATA_FILE = path.join(__dirname, 'data.json');

let sessions = [];
let wishes = [];

function generateSessionId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// DJ-Key für Einladungslinks
function generateDjKey(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < length; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        wishes = Array.isArray(parsed.wishes) ? parsed.wishes : [];

        // Falls alte Einträge kein "active" oder keinen djKey haben:
        let changed = false;
        for (const s of sessions) {
          if (typeof s.active === 'undefined') {
            s.active = true;
            changed = true;
          }
          if (!s.djKey) {
            s.djKey = generateDjKey();
            changed = true;
          }
        }
        if (changed) {
          saveData();
        }

        console.log(`Daten geladen: ${sessions.length} Sessions, ${wishes.length} Wünsche`);
        return;
      }
    }
    sessions = [];
    wishes = [];
    console.log('Keine vorhandene data.json, starte mit leeren Daten.');
  } catch (err) {
    console.error('Fehler beim Laden von data.json, starte mit leeren Daten:', err);
    sessions = [];
    wishes = [];
  }
}

function saveData() {
  try {
    const payload = { sessions, wishes };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Fehler beim Speichern von data.json:', err);
  }
}

// Beim Start einmal laden
loadData();

// ================== TEST ==================
app.get('/api/test', (req, res) => {
  res.json({
    message: 'DJ Wishboard läuft!',
    sessionsCount: sessions.length,
    wishesCount: wishes.length
  });
});

// ================== SESSIONS ==================

// Neue Session anlegen (mit Einstellungen + djKey)
app.post('/api/sessions', (req, res) => {
  const { name, maxWishesPerGuest, requireName, allowComment } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Session-Name ist Pflicht.'
    });
  }

  const id = generateSessionId();

  const settings = {
    // 0 oder leer = unbegrenzt
    maxWishesPerGuest: Number(maxWishesPerGuest) || 0,
    // Name Pflicht?
    requireName:
      typeof requireName === 'boolean'
        ? requireName
        : requireName === 'true' || requireName === undefined,
    // Kommentar anzeigen?
    allowComment:
      typeof allowComment === 'boolean'
        ? allowComment
        : allowComment === 'true' || allowComment === undefined
  };

  const session = {
    id,
    name: name.trim(),
    active: true,
    createdAt: new Date().toISOString(),
    settings,
    djKey: generateDjKey() // Einladungs-Key für DJs
  };

  sessions.push(session);
  saveData();

  return res.json({
    success: true,
    message: 'Session erstellt.',
    session
  });
});

// Alle Sessions
app.get('/api/sessions', (req, res) => {
  res.json(sessions);
});

// Einzelne Session (für guest.html)
app.get('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const session = sessions.find(s => s.id === id);

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session nicht gefunden.'
    });
  }

  return res.json(session);
});

// Session-Einstellungen nachträglich ändern
app.post('/api/sessions/:id/settings', (req, res) => {
  const { id } = req.params;
  const { maxWishesPerGuest, requireName, allowComment } = req.body;

  const session = sessions.find(s => s.id === id);
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session nicht gefunden.'
    });
  }

  const settings = session.settings || {};

  if (typeof maxWishesPerGuest !== 'undefined') {
    settings.maxWishesPerGuest = Number(maxWishesPerGuest) || 0;
  }

  if (typeof requireName !== 'undefined') {
    settings.requireName =
      typeof requireName === 'boolean'
        ? requireName
        : requireName === 'true';
  }

  if (typeof allowComment !== 'undefined') {
    settings.allowComment =
      typeof allowComment === 'boolean'
        ? allowComment
        : allowComment === 'true';
  }

  session.settings = settings;
  saveData();

  return res.json({
    success: true,
    message: 'Einstellungen aktualisiert.',
    session
  });
});

// Session aktiv / erledigt (de-)aktivieren
app.post('/api/sessions/:id/active', (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  const session = sessions.find(s => s.id === id);
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session nicht gefunden.'
    });
  }

  const isActive =
    active === true ||
    active === 'true' ||
    active === 1 ||
    active === '1';

  session.active = isActive;
  saveData();

  return res.json({
    success: true,
    message: `Session wurde ${isActive ? 'reaktiviert' : 'beendet'}.`,
    session
  });
});

// Session löschen (inkl. zugehöriger Wünsche)
app.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const index = sessions.findIndex(s => s.id === id);

  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: 'Session nicht gefunden.'
    });
  }

  const removed = sessions[index];

  sessions = sessions.filter(s => s.id !== id);
  const beforeCount = wishes.length;
  wishes = wishes.filter(w => w.sessionId !== id);
  const afterCount = wishes.length;

  saveData();

  return res.json({
    success: true,
    message: 'Session und zugehörige Wünsche gelöscht.',
    removedSession: removed,
    removedWishes: beforeCount - afterCount
  });
});

// ================== WÜNSCHE ==================

// Wunsch absenden (mit deviceId)
app.post('/api/wishes', (req, res) => {
  const { name, title, artist, comment, sessionId, deviceId } = req.body;

  if (!title || !artist || !sessionId) {
    return res.status(400).json({
      success: false,
      message: 'Songtitel, Interpret und Session sind Pflicht.'
    });
  }

  const session = sessions.find(s => s.id === sessionId);
  if (!session || !session.active) {
    return res.status(400).json({
      success: false,
      message: 'Diese Session ist ungültig oder nicht aktiv.'
    });
  }

  const settings = session.settings || {};

  // Name-Pflicht je nach Session
  if (settings.requireName && (!name || !name.trim())) {
    return res.status(400).json({
      success: false,
      message: 'In dieser Session ist ein Name Pflicht.'
    });
  }

  const trimmedName = (name || '').trim();

  // Max. Wünsche pro Gerät oder Name
  if (settings.maxWishesPerGuest && settings.maxWishesPerGuest > 0) {
    let existingCount = 0;

    if (deviceId) {
      // Limit pro Gerät
      existingCount = wishes.filter(
        w => w.sessionId === session.id && w.deviceId === deviceId
      ).length;
    } else {
      // Fallback: Limit pro Name
      existingCount = wishes.filter(
        w =>
          w.sessionId === session.id &&
          (w.name || '').trim().toLowerCase() === trimmedName.toLowerCase()
      ).length;
    }

    if (existingCount >= settings.maxWishesPerGuest) {
      return res.status(400).json({
        success: false,
        message: `Du hast das Maximum von ${settings.maxWishesPerGuest} Wünschen für diese Session erreicht.`
      });
    }
  }

  const wish = {
    id: Date.now(),          // einfache ID
    sessionId: session.id,
    sessionName: session.name,
    name: trimmedName || 'Gast',
    title: title.trim(),
    artist: artist.trim(),
    comment: (comment || '').trim(),
    deviceId: deviceId || null,
    status: 'open',          // open | done | rejected
    createdAt: new Date().toISOString()
  };

  wishes.push(wish);
  saveData();

  return res.json({
    success: true,
    message: 'Wunsch erfolgreich gespeichert 🎧',
    wish
  });
});

// Alle Wünsche (optional nach Session)
app.get('/api/wishes', (req, res) => {
  const { sessionId } = req.query;

  if (sessionId) {
    const filtered = wishes.filter(w => w.sessionId === sessionId);
    return res.json(filtered);
  }

  res.json(wishes);
});

// Status ändern (klassisches Admin-Panel – ohne DJ-Key)
app.post('/api/wishes/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;

  const allowedStatuses = ['open', 'done', 'rejected'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Ungültiger Status.'
    });
  }

  const wish = wishes.find(w => w.id === id);

  if (!wish) {
    return res.status(404).json({
      success: false,
      message: 'Wunsch nicht gefunden.'
    });
  }

  wish.status = status;
  saveData();

  return res.json({
    success: true,
    message: 'Status aktualisiert.',
    wish
  });
});

// ================== DJ-API (Session-spezifische Zugänge per djKey) ==================

function getSessionByIdAndKey(sessionId, djKey) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return { error: 'Session nicht gefunden.' };
  if (!session.djKey || session.djKey !== djKey) {
    return { error: 'Kein Zugriff auf diese Session (DJ-Key ungültig).' };
  }
  return { session };
}

// Session-Info nur mit djKey
app.get('/api/dj/session', (req, res) => {
  const { sessionId, djKey } = req.query;

  if (!sessionId || !djKey) {
    return res.status(400).json({
      success: false,
      message: 'SessionId und djKey sind erforderlich.'
    });
  }

  const { session, error } = getSessionByIdAndKey(sessionId, djKey);
  if (error) {
    return res.status(403).json({
      success: false,
      message: error
    });
  }

  return res.json({
    success: true,
    session
  });
});

// Wünsche nur für diese Session + djKey
app.get('/api/dj/wishes', (req, res) => {
  const { sessionId, djKey } = req.query;

  if (!sessionId || !djKey) {
    return res.status(400).json({
      success: false,
      message: 'SessionId und djKey sind erforderlich.'
    });
  }

  const { session, error } = getSessionByIdAndKey(sessionId, djKey);
  if (error) {
    return res.status(403).json({
      success: false,
      message: error
    });
  }

  const filtered = wishes.filter(w => w.sessionId === session.id);
  return res.json(filtered);
});

// Status ändern – aber nur mit gültigem djKey und passender Session
app.post('/api/dj/wishes/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status, sessionId, djKey } = req.body;

  const allowedStatuses = ['open', 'done', 'rejected'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Ungültiger Status.'
    });
  }

  if (!sessionId || !djKey) {
    return res.status(400).json({
      success: false,
      message: 'SessionId und djKey sind erforderlich.'
    });
  }

  const { session, error } = getSessionByIdAndKey(sessionId, djKey);
  if (error) {
    return res.status(403).json({
      success: false,
      message: error
    });
  }

  const wish = wishes.find(w => w.id === id && w.sessionId === session.id);
  if (!wish) {
    return res.status(404).json({
      success: false,
      message: 'Wunsch nicht gefunden.'
    });
  }

  wish.status = status;
  saveData();

  return res.json({
    success: true,
    message: 'Status aktualisiert.',
    wish
  });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DJ Wishboard Server läuft auf Port ${PORT}`);
});