import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Database connection
let db: mysql.Connection | null = null;
let dbStatus: 'connected' | 'error' | 'busy' = 'busy';

async function connectDB() {
  try {
    const host = process.env.DB_HOST || '127.0.0.1';
    const port = Number(process.env.DB_PORT) || 3306;
    const user = process.env.DB_USER || 'root';
    console.log(`Connecting to MySQL ${user}@${host}:${port} db=${process.env.DB_NAME || 'checklist'}`);

    db = await mysql.createConnection({
      host,
      port,
      user,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'checklist',
      dateStrings: true
    });
    
    // Create tables if they don't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS lists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        country VARCHAR(2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        list_id INT NOT NULL,
        label VARCHAR(255) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        checked TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
      )
    `);
    
    dbStatus = 'connected';
    console.log('✅ Database connected');
  } catch (error) {
    dbStatus = 'error';
    console.error('❌ Database connection failed:', error);
    // Do not exit; keep server up so status/login can show errors in UI
  }
}

// Check database status
async function checkDBStatus() {
  if (!db) { dbStatus = 'error'; return; }
  try { await db.query('SELECT 1'); dbStatus = 'connected'; } catch { dbStatus = 'error'; }
}

// Auth middleware
function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { jwt.verify(token, process.env.JWT_SECRET || 'secret'); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Routes
app.get('/api/status', async (_req, res) => { await checkDBStatus(); res.json({ db: dbStatus }); });

app.get('/api/logging-status', (_req, res) => { res.json({ logging: process.env.LOGGING || 'OFF' }); });

app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) return res.status(500).json({ error: 'Server not configured: APP_PASSWORD missing' });
  if (password !== appPassword) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ user: 'admin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
  res.json({ token });
});

app.get('/api/lists', requireAuth, async (_req, res) => {
  try {
    const [rows] = await db!.query(
      'SELECT id, name, start_date, end_date, country FROM lists ORDER BY (start_date IS NULL), start_date DESC, id DESC'
    );
    res.json(rows);
  }
  catch { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/lists', requireAuth, async (req, res) => {
  try {
    const { name, startDate, endDate, country } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ error: 'End date cannot be before start date' });
    }
    const [result] = await db!.execute('INSERT INTO lists (name, start_date, end_date, country) VALUES (?, ?, ?, ?)', [name, startDate || null, endDate || null, country || null]);
    res.json({ id: (result as any).insertId, name, startDate, endDate, country });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/lists/:id', requireAuth, async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const { name, startDate, endDate, country } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ error: 'End date cannot be before start date' });
    }
    await db!.execute('UPDATE lists SET name = ?, start_date = ?, end_date = ?, country = ? WHERE id = ?', [name, startDate || null, endDate || null, country || null, listId]);
    res.json({ id: listId, name, startDate, endDate, country });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/lists/:id/copy', requireAuth, async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const [[list]]: any = await db!.query('SELECT name, start_date, end_date, country FROM lists WHERE id = ?', [listId]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    const [ins] = await db!.execute('INSERT INTO lists (name, start_date, end_date, country) VALUES (?, ?, ?, ?)', [list.name + ' (copy)', list.start_date, list.end_date, list.country]);
    const newId = (ins as any).insertId as number;
    const [items]: any = await db!.query('SELECT label, quantity, checked FROM items WHERE list_id = ?', [listId]);
    for (const it of items) { await db!.execute('INSERT INTO items (list_id, label, quantity, checked) VALUES (?, ?, ?, ?)', [newId, it.label, it.quantity, it.checked]); }
    res.json({ id: newId });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/lists/:id/items', requireAuth, async (req, res) => {
  try { 
    const [rows] = await db!.query('SELECT * FROM items WHERE list_id = ? ORDER BY id', [req.params.id]); 
    res.json(rows); 
  } catch (error) { 
    console.error('Error loading items:', error);
    res.status(500).json({ error: 'Database error' }); 
  }
});

app.post('/api/lists/:id/items', requireAuth, async (req, res) => {
  try {
    const { label, quantity } = req.body;
    const [result] = await db!.execute('INSERT INTO items (list_id, label, quantity) VALUES (?, ?, ?)', [req.params.id, label, quantity || 1]);
    res.json({ id: (result as any).insertId, label, quantity: quantity || 1 });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/items/:id', requireAuth, async (req, res) => {
  try { 
    const { checked, quantity } = req.body; 
    const updates = [];
    const values = [];
    
    if (checked !== undefined) {
      updates.push('checked = ?');
      values.push(checked);
    }
    
    if (quantity !== undefined) {
      updates.push('quantity = ?');
      values.push(quantity);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(req.params.id);
    await db!.execute(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true }); 
  } catch (error) { 
    console.error('Error updating item:', error);
    res.status(500).json({ error: 'Database error' }); 
  }
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try { await db!.execute('DELETE FROM items WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Database error' }); }
});

// Serve the HTML app
app.get('*', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Checklist App</title>
    <style>
                 :root{
           --bg: #0f1419;
           --panel: #1a1f2e;
           --elev: #232b3d;
           --text: #f8fafc;
           --muted: #cbd5e1;
           --border: #334155;
           --accent: #22d3ee;
           --accent-2: #8b5cf6;
           --danger: #ef4444;
           --warn: #f59e0b;
         }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
        .container { max-width: 960px; margin: 0 auto; padding: 12px; }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 12px; }
        .row{ display:flex; align-items:center; gap: 8px; flex-wrap: wrap }
        .stack{ display:flex; flex-direction: column; gap: 12px }
        .space{ flex: 1; min-width: 0 }
                 input, button { background: #1e293b; color: var(--text); border: 1px solid var(--border); border-radius: 12px; padding: 12px; font-size: 16px; }
        input[type="date"]{ min-width: 140px; max-width: 100% }
        input[type="number"]{ width: 80px; text-align: center }
                 button { cursor: pointer; background: #334155; white-space: nowrap; min-width: 60px; }
         button:hover { background: #475569; }
        .muted{ color: var(--muted) }
        .grid{ display:grid; gap: 12px; }
        .lists-grid{ grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
        .list-card{ background: var(--elev); border:1px solid var(--border); border-radius: 16px; padding: 16px; cursor: pointer; }
        .list-card:hover{ outline: 2px solid var(--accent); }
                 .badge{ padding: 6px 10px; border:1px solid var(--border); border-radius: 999px; font-size: 12px; color: var(--muted); background: #1e293b; word-break: break-word }
        .headline{ font-size: 20px; margin-bottom: 12px; word-break: break-word }
        .toolbar{ display:flex; gap:8px; flex-wrap: wrap; align-items:center }
        .big-checkbox input[type="checkbox"]{ width: 24px; height: 24px; accent-color: var(--accent); }
        .item{ display:flex; align-items:center; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap }
        .item:last-child{ border-bottom:0 }
        .item-label{ flex: 1; min-width: 0; word-break: break-word }
                 .db-status { position: fixed; top: 12px; right: 12px; display: flex; align-items: center; gap: 6px; z-index: 10; background: rgba(11, 15, 20, 0.9); padding: 6px 8px; border-radius: 8px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }
        .dot.green { background: var(--accent); }
        .dot.orange { background: var(--warn); }
        .dot.red { background: var(--danger); }
        .db-label { font-size: 11px; color: var(--muted); }
                 .actions button{ background:#475569 }
        .accent{ color: var(--accent) }
        .hidden{ display: none !important }
        
        /* Mobile-first responsive design */
        @media (max-width: 640px){
          .container{ padding: 8px }
          .card{ padding: 12px; margin-bottom: 8px }
          .lists-grid{ grid-template-columns: 1fr }
          .toolbar{ flex-direction: column; align-items: stretch }
          .toolbar input, .toolbar button{ width: 100%; margin: 0 }
          .row{ flex-direction: column; align-items: stretch }
          .row input, .row button{ width: 100%; margin: 0 }
          .item{ flex-direction: column; align-items: stretch; gap: 8px }
          .item > *{ width: 100% }
          .item input[type="checkbox"]{ align-self: flex-start }
          .item input[type="number"]{ width: 100% }
          .headline{ font-size: 18px }
                     .db-status{ top: 8px; right: 8px; padding: 4px 6px }
        }
        
        @media (max-width: 480px){
          .container{ padding: 6px }
          .card{ padding: 10px }
          .toolbar{ gap: 6px }
          .stack{ gap: 8px }
        }
    </style>
</head>
<body>
    <div class="db-status">
        <div id="dbDot" class="dot orange"></div>
        <div class="db-label">DB</div>
    </div>

    <div class="container">
        <div id="login" class="card" style="text-align:center">
            <h2 style="margin-bottom:16px">🔐 Sign in</h2>
            <div class="stack">
              <input type="password" id="password" placeholder="Password">
              <button onclick="handleLogin()">Enter</button>
            </div>
        </div>
        
        <div id="app" class="hidden">
            <!-- Overview -->
            <div id="overview" class="stack">
              <div class="card">
                <div class="stack">
                  <div class="row">
                    <h2 class="headline">📋 Lists</h2>
                    <div class="space"></div>
                    <button onclick="logout()" style="background: var(--danger); border-color: var(--danger);">🚪 Logout</button>
                  </div>
                  <div class="stack">
                    <input id="newListName" placeholder="New list name">
                    <div class="row">
                      <input type="date" id="newStart" placeholder="Start date">
                      <input type="date" id="newEnd" placeholder="End date">
                    </div>
                    <div class="row">
                      <select id="newCountry" style="min-width: 140px; padding: 12px; font-size: 14px; background: #1e293b; color: var(--text); border: 1px solid var(--border); border-radius: 12px;">
                        <option value="">🌍 Select country</option>
                        <option value="AR">🇦🇷 Argentina</option>
                        <option value="AU">🇦🇺 Australia</option>
                        <option value="AT">🇦🇹 Austria</option>
                        <option value="BE">🇧🇪 Belgium</option>
                        <option value="BF">🇧🇫 Burkina Faso</option>
                        <option value="BR">🇧🇷 Brazil</option>
                        <option value="CA">🇨🇦 Canada</option>
                        <option value="CI">🇨🇮 Ivory Coast</option>
                        <option value="CL">🇨🇱 Chile</option>
                        <option value="CN">🇨🇳 China</option>
                        <option value="CO">🇨🇴 Colombia</option>
                        <option value="DK">🇩🇰 Denmark</option>
                        <option value="DZ">🇩🇿 Algeria</option>
                        <option value="EG">🇪🇬 Egypt</option>
                        <option value="EC">🇪🇨 Ecuador</option>
                        <option value="ET">🇪🇹 Ethiopia</option>
                        <option value="FK">🇫🇰 Falkland Islands</option>
                        <option value="FI">🇫🇮 Finland</option>
                        <option value="FR">🇫🇷 France</option>
                        <option value="GF">🇬🇫 French Guiana</option>
                        <option value="DE">🇩🇪 Germany</option>
                        <option value="GH">🇬🇭 Ghana</option>
                        <option value="GB">🇬🇧 United Kingdom</option>
                        <option value="GY">🇬🇾 Guyana</option>
                        <option value="IN">🇮🇳 India</option>
                        <option value="ID">🇮🇩 Indonesia</option>
                        <option value="IE">🇮🇪 Ireland</option>
                        <option value="IT">🇮🇹 Italy</option>
                        <option value="JP">🇯🇵 Japan</option>
                        <option value="KE">🇰🇪 Kenya</option>
                        <option value="KR">🇰🇷 South Korea</option>
                        <option value="LY">🇱🇾 Libya</option>
                        <option value="MA">🇲🇦 Morocco</option>
                        <option value="ML">🇲🇱 Mali</option>
                        <option value="MY">🇲🇾 Malaysia</option>
                        <option value="MX">🇲🇽 Mexico</option>
                        <option value="NE">🇳🇪 Niger</option>
                        <option value="NG">🇳🇬 Nigeria</option>
                        <option value="NL">🇳🇱 Netherlands</option>
                        <option value="NO">🇳🇴 Norway</option>
                        <option value="NZ">🇳🇿 New Zealand</option>
                        <option value="PE">🇵🇪 Peru</option>
                        <option value="PH">🇵🇭 Philippines</option>
                        <option value="PT">🇵🇹 Portugal</option>
                        <option value="PY">🇵🇾 Paraguay</option>
                        <option value="RU">🇷🇺 Russia</option>
                        <option value="SA">🇸🇦 Saudi Arabia</option>
                        <option value="SD">🇸🇩 Sudan</option>
                        <option value="SE">🇸🇪 Sweden</option>
                        <option value="SG">🇸🇬 Singapore</option>
                        <option value="SN">🇸🇳 Senegal</option>
                        <option value="SR">🇸🇷 Suriname</option>
                        <option value="ES">🇪🇸 Spain</option>
                        <option value="CH">🇨🇭 Switzerland</option>
                        <option value="TD">🇹🇩 Chad</option>
                        <option value="TH">🇹🇭 Thailand</option>
                        <option value="TN">🇹🇳 Tunisia</option>
                        <option value="TR">🇹🇷 Turkey</option>
                        <option value="TZ">🇹🇿 Tanzania</option>
                        <option value="UG">🇺🇬 Uganda</option>
                        <option value="US">🇺🇸 United States</option>
                        <option value="UY">🇺🇾 Uruguay</option>
                        <option value="VE">🇻🇪 Venezuela</option>
                        <option value="VN">🇻🇳 Vietnam</option>
                        <option value="ZA">🇿🇦 South Africa</option>
                      </select>
                    </div>
                    <button onclick="createList()">➕ Create List</button>
                  </div>
                </div>
              </div>
              <div id="listsGrid" class="grid lists-grid"></div>
            </div>

            <!-- Detail -->
            <div id="detail" class="hidden stack">
              <div class="card">
                <div class="stack">
                  <div class="row">
                    <button onclick="backToOverview()">⬅️ Back</button>
                    <div class="space"></div>
                    <button id="editToggle" onclick="toggleEdit()">✏️ Edit</button>
                    <button id="copyBtn" onclick="copyCurrentList()">📄 Copy</button>
                    <button id="copyTextBtn" onclick="copyListText()">📋 Copy text</button>
                  </div>
                  <h2 id="detailTitle" class="headline"></h2>
                  <div id="detailDates" class="badge"></div>
                </div>
              </div>

              <div id="editForm" class="card hidden">
                <div class="stack">
                  <input id="editName" placeholder="List name">
                  <div class="row">
                    <input type="date" id="editStart">
                    <input type="date" id="editEnd">
                  </div>
                  <div class="row">
                    <select id="editCountry" style="min-width: 140px; padding: 12px; font-size: 14px; background: #1e293b; color: var(--text); border: 1px solid var(--border); border-radius: 12px;">
                      <option value="">🌍 Select country</option>
                      <option value="AR">🇦🇷 Argentina</option>
                      <option value="AU">🇦🇺 Australia</option>
                      <option value="AT">🇦🇹 Austria</option>
                      <option value="BE">🇧🇪 Belgium</option>
                      <option value="BF">🇧🇫 Burkina Faso</option>
                      <option value="BR">🇧🇷 Brazil</option>
                      <option value="CA">🇨🇦 Canada</option>
                      <option value="CI">🇨🇮 Ivory Coast</option>
                      <option value="CL">🇨🇱 Chile</option>
                      <option value="CN">🇨🇳 China</option>
                      <option value="CO">🇨🇴 Colombia</option>
                      <option value="DK">🇩🇰 Denmark</option>
                      <option value="DZ">🇩🇿 Algeria</option>
                      <option value="EG">🇪🇬 Egypt</option>
                      <option value="EC">🇪🇨 Ecuador</option>
                      <option value="ET">🇪🇹 Ethiopia</option>
                      <option value="FK">🇫🇰 Falkland Islands</option>
                      <option value="FI">🇫🇮 Finland</option>
                      <option value="FR">🇫🇷 France</option>
                      <option value="GF">🇬🇫 French Guiana</option>
                      <option value="DE">🇩🇪 Germany</option>
                      <option value="GH">🇬🇭 Ghana</option>
                      <option value="GB">🇬🇧 United Kingdom</option>
                      <option value="GY">🇬🇾 Guyana</option>
                      <option value="IN">🇮🇳 India</option>
                      <option value="ID">🇮🇩 Indonesia</option>
                      <option value="IE">🇮🇪 Ireland</option>
                      <option value="IT">🇮🇹 Italy</option>
                      <option value="JP">🇯🇵 Japan</option>
                      <option value="KE">🇰🇪 Kenya</option>
                      <option value="KR">🇰🇷 South Korea</option>
                      <option value="LY">🇱🇾 Libya</option>
                      <option value="MA">🇲🇦 Morocco</option>
                      <option value="ML">🇲🇱 Mali</option>
                      <option value="MY">🇲🇾 Malaysia</option>
                      <option value="MX">🇲🇽 Mexico</option>
                      <option value="NE">🇳🇪 Niger</option>
                      <option value="NG">🇳🇬 Nigeria</option>
                      <option value="NL">🇳🇱 Netherlands</option>
                      <option value="NO">🇳🇴 Norway</option>
                      <option value="NZ">🇳🇿 New Zealand</option>
                      <option value="PE">🇵🇪 Peru</option>
                      <option value="PH">🇵🇭 Philippines</option>
                      <option value="PT">🇵🇹 Portugal</option>
                      <option value="PY">🇵🇾 Paraguay</option>
                      <option value="RU">🇷🇺 Russia</option>
                      <option value="SA">🇸🇦 Saudi Arabia</option>
                      <option value="SD">🇸🇩 Sudan</option>
                      <option value="SE">🇸🇪 Sweden</option>
                      <option value="SG">🇸🇬 Singapore</option>
                      <option value="SN">🇸🇳 Senegal</option>
                      <option value="SR">🇸🇷 Suriname</option>
                      <option value="ES">🇪🇸 Spain</option>
                      <option value="CH">🇨🇭 Switzerland</option>
                      <option value="TD">🇹🇩 Chad</option>
                      <option value="TH">🇹🇭 Thailand</option>
                      <option value="TN">🇹🇳 Tunisia</option>
                      <option value="TR">🇹🇷 Turkey</option>
                      <option value="TZ">🇹🇿 Tanzania</option>
                      <option value="UG">🇺🇬 Uganda</option>
                      <option value="US">🇺🇸 United States</option>
                      <option value="UY">🇺🇾 Uruguay</option>
                      <option value="VE">🇻🇪 Venezuela</option>
                      <option value="VN">🇻🇳 Vietnam</option>
                      <option value="ZA">🇿🇦 South Africa</option>
                    </select>
                  </div>
                  <div class="row">
                    <button onclick="saveEdits()" class="accent">💾 Save</button>
                    <button onclick="toggleEdit()">Cancel</button>
                  </div>
                </div>
              </div>

              <div class="card">
                <div class="stack">
                  <input id="newItemLabel" placeholder="Add item (e.g., T-shirt)">
                  <div class="row">
                    <input id="newItemQty" type="number" min="1" value="1" placeholder="Qty">
                    <button onclick="addItem(currentListId)">Add Item</button>
                  </div>
                </div>
              </div>
              <div id="itemsContainer" class="card"></div>
            </div>
        </div>
    </div>

    <script src="/app.js" defer></script>
</body>
</html>
  `);
});

// Start server
const port = process.env.PORT ? Number(process.env.PORT) : 8080;
connectDB().then(() => { app.listen(port, () => { console.log(`🚀 Checklist app running on http://localhost:${port}`); }); });