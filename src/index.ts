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
  try { const [rows] = await db!.query('SELECT id, name, start_date, end_date FROM lists ORDER BY id DESC'); res.json(rows); }
  catch { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/lists', requireAuth, async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
          const [result] = await db!.execute('INSERT INTO lists (name, start_date, end_date) VALUES (?, ?, ?)', [name, startDate || null, endDate || null]);
    res.json({ id: (result as any).insertId, name, startDate, endDate });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/lists/:id', requireAuth, async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const { name, startDate, endDate } = req.body;
    await db!.execute('UPDATE lists SET name = ?, start_date = ?, end_date = ? WHERE id = ?', [name, startDate || null, endDate || null, listId]);
    res.json({ id: listId, name, startDate, endDate });
  } catch { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/lists/:id/copy', requireAuth, async (req, res) => {
  try {
    const listId = Number(req.params.id);
    const [[list]]: any = await db!.query('SELECT name, start_date, end_date FROM lists WHERE id = ?', [listId]);
    if (!list) return res.status(404).json({ error: 'List not found' });
    const [ins] = await db!.execute('INSERT INTO lists (name, start_date, end_date) VALUES (?, ?, ?)', [list.name + ' (copy)', list.start_date, list.end_date]);
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
              <button onclick="login()">Enter</button>
            </div>
        </div>
        
        <div id="app" class="hidden">
            <!-- Overview -->
            <div id="overview" class="stack">
              <div class="card">
                <div class="stack">
                  <h2 class="headline">📋 Lists</h2>
                  <div class="stack">
                    <input id="newListName" placeholder="New list name">
                    <div class="row">
                      <input type="date" id="newStart" placeholder="Start date">
                      <input type="date" id="newEnd" placeholder="End date">
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

    <script>
        var token = localStorage.getItem('token');
        var lists = [];
        var currentListId = null;
        var editing = false;
        
        function fmtDate(d){
          if (!d) return '—';
          if (d instanceof Date){ if (isNaN(d.getTime())) return '—'; return d.toLocaleDateString('en-GB'); }
          if (typeof d === 'string'){
            if (!d) return '—';
            var dt = d.includes('T') ? new Date(d) : new Date(d + 'T00:00:00');
            if (isNaN(dt.getTime())) return d;
            return dt.toLocaleDateString('en-GB');
          }
          return '—';
        }
        function fmtRange(s,e){ return '📅 ' + fmtDate(s) + ' → ' + fmtDate(e); }

        // Logging function
        function log(action, details) {
          if (window.loggingEnabled) {
            const timestamp = new Date().toLocaleTimeString();
            console.log('[' + timestamp + '] ' + action + ': ' + details);
          }
        }
        
        // Check if logging is enabled
        async function checkLoggingStatus() {
          try {
            const r = await fetch('/api/logging-status');
            const data = await r.json();
            window.loggingEnabled = data.logging === 'ON';
            if (window.loggingEnabled) {
              console.log('📝 Logging enabled - user actions will be logged');
            }
          } catch (e) {
            window.loggingEnabled = false;
          }
        }
        
        // DB Status
        async function checkDBStatus() {
          try { var r = await fetch('/api/status'); var data = await r.json(); var dot = document.getElementById('dbDot'); dot.className = 'dot ' + (data.db==='connected'?'green': data.db==='busy'?'orange':'red'); }
          catch { document.getElementById('dbDot').className = 'dot red'; }
        }
        checkDBStatus(); setInterval(checkDBStatus, 5000);
        checkLoggingStatus();
        
        if (token) { showApp(); loadLists(); }
        async function login(){ var password = document.getElementById('password').value; log('Login attempt', 'User trying to login'); try { var r = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: password })}); if(r.ok){ var d=await r.json(); token=d.token; localStorage.setItem('token', d.token); log('Login success', 'User logged in successfully'); showApp(); loadLists(); } else { var e=await r.json().catch(function(){return{error:'Login failed'}}); alert(e.error||'Login failed'); } }catch(e){ log('Login error', 'Login failed'); console.error('Failed to login'); } }
        function showApp(){ document.getElementById('login').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); log('UI', 'Showing main app'); }
        function showOverview(){ document.getElementById('overview').classList.remove('hidden'); document.getElementById('detail').classList.add('hidden'); log('Navigation', 'Showing lists overview'); }
        function showDetail(){ document.getElementById('overview').classList.add('hidden'); document.getElementById('detail').classList.remove('hidden'); log('Navigation', 'Showing list detail'); }
        function backToOverview(){ currentListId=null; showOverview(); log('Navigation', 'Back to overview'); }

        async function loadLists(){ log('Data', 'Loading lists'); try{ var r = await fetch('/api/lists',{ headers:{ Authorization:'Bearer ' + token }}); lists = await r.json(); renderListsGrid(); log('Data', 'Loaded ' + lists.length + ' lists'); } catch(e){ log('Error', 'Failed to load lists'); console.error('Failed to load lists'); } }
        function renderListsGrid(){ var grid = document.getElementById('listsGrid'); if(!lists.length){ grid.innerHTML = '<div class="muted">No lists yet. Create your first list.</div>'; return; } grid.innerHTML = lists.map(function(l){ return '<div class="list-card" onclick="openList(' + l.id + ')">'+ '<div style="font-weight:700; margin-bottom:8px; font-size:16px">' + l.name + '</div>' + '<div class="badge">' + fmtRange(l.start_date, l.end_date) + '</div>' + '</div>'; }).join(''); }
        async function createList(){ var name = document.getElementById('newListName').value; var startDate = document.getElementById('newStart').value; var endDate = document.getElementById('newEnd').value; if(!name) return; log('Create', 'Creating list: ' + name + ' (' + startDate + ' to ' + endDate + ')'); try{ var r=await fetch('/api/lists',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:startDate, endDate:endDate })}); if(r.ok){ document.getElementById('newListName').value=''; document.getElementById('newStart').value=''; document.getElementById('newEnd').value=''; log('Create', 'List created successfully'); loadLists(); } }catch(e){ log('Error', 'Failed to create list'); console.error('Failed to create list'); } }

        async function openList(id){ currentListId=id; var list = lists.find(function(x){return x.id===id}); log('Navigation', 'Opening list: ' + (list ? list.name : 'Unknown') + ' (ID: ' + id + ')'); document.getElementById('detailTitle').textContent = list ? list.name : 'List'; document.getElementById('detailDates').textContent = fmtRange(list && list.start_date, list && list.end_date); document.getElementById('editName').value = list ? list.name : ''; document.getElementById('editStart').value = (list && list.start_date) ? String(list.start_date) : ''; document.getElementById('editEnd').value = (list && list.end_date) ? String(list.end_date) : ''; document.getElementById('editForm').classList.add('hidden'); editing=false; showDetail(); await loadItems(id); }
        function toggleEdit(){ editing=!editing; log('Edit', editing ? 'Entering edit mode' : 'Exiting edit mode'); document.getElementById('editForm').classList.toggle('hidden', !editing); }
        async function saveEdits(){ if(!currentListId) return; var name=document.getElementById('editName').value; var start=document.getElementById('editStart').value; var end=document.getElementById('editEnd').value; if(!name) return; log('Edit', 'Saving edits: ' + name + ' (' + start + ' to ' + end + ')'); try{ var r=await fetch('/api/lists/'+currentListId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:start||null, endDate:end||null })}); if(r.ok){ var updated = await r.json(); lists = lists.map(function(l){ return l.id===currentListId ? { id:l.id, name:updated.name, start_date:updated.startDate, end_date:updated.endDate } : l }); log('Edit', 'Edits saved successfully'); renderListsGrid(); openList(currentListId); toggleEdit(); } }catch(e){ log('Error', 'Failed to save edits'); console.error('Failed to save edits'); } }

        async function copyCurrentList(){ if(!currentListId) return; log('Copy', 'Copying current list'); try{ var r=await fetch('/api/lists/'+currentListId+'/copy',{ method:'POST', headers:{ Authorization:'Bearer '+token }}); if(r.ok){ var d=await r.json(); log('Copy', 'List copied successfully'); await loadLists(); openList(d.id); } }catch(e){ log('Error', 'Failed to copy list'); console.error('Failed to copy list'); } }

        async function loadItems(listId){ log('Data', 'Loading items for list ' + listId); try{ var r = await fetch('/api/lists/'+listId+'/items',{ headers:{ Authorization:'Bearer '+token }}); var items = await r.json(); renderItems(items); log('Data', 'Loaded ' + items.length + ' items'); } catch(e){ log('Error', 'Failed to load items'); console.error('Failed to load items'); } }
        function renderItems(items){ var container = document.getElementById('itemsContainer'); if(!items.length){ container.innerHTML = '<div class="muted">No items yet.</div>'; return; } container.innerHTML = items.map(function(item){ return '<div class="item big-checkbox">' + '<input type="checkbox" ' + (item.checked?'checked':'') + ' onchange="toggleItem(' + item.id + ', this.checked)">' + '<div class="item-label" style="'+(item.checked?'text-decoration:line-through; opacity:.7':'')+'">' + item.label + '</div>' + '<input type="number" value="' + item.quantity + '" min="1">' + '<button onclick="updateQuantity(' + item.id + ', this.previousElementSibling.value)">Update</button>' + '<button onclick="deleteItem(' + item.id + ')" style="border-color: var(--danger)">Delete</button>' + '</div>'; }).join(''); }
        async function addItem(listId){ var labelEl=document.getElementById('newItemLabel'); var qtyEl=document.getElementById('newItemQty'); var label=labelEl && labelEl.value!==undefined ? labelEl.value : ''; var quantity=qtyEl && qtyEl.value!==undefined ? qtyEl.value : '1'; if(!label) return; log('Create', 'Adding item: ' + label + ' (qty: ' + quantity + ')'); try{ var r=await fetch('/api/lists/'+listId+'/items',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ label:label, quantity: parseInt(quantity) })}); if(r.ok){ if(labelEl && 'value' in labelEl){ labelEl.value=''; } qtyEl.value='1'; log('Create', 'Item added successfully'); loadItems(listId); } }catch(e){ log('Error', 'Failed to add item'); console.error('Failed to add item'); } }
                 async function toggleItem(itemId, checked){ log('Item', 'Toggling item ' + itemId + ' to ' + (checked ? 'checked' : 'unchecked')); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ checked:checked })}); if(r.ok){ log('Item', 'Item toggled successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Toggle failed'}}); log('Error', 'Failed to toggle item: ' + (error.error || 'Server error')); alert('Failed to toggle item: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to toggle item'); console.error('Failed to toggle item', e); alert('Failed to toggle item'); } }
                 async function updateQuantity(itemId, quantity){ log('Item', 'Updating quantity for item ' + itemId + ' to ' + quantity); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ quantity: parseInt(quantity) })}); if(r.ok){ log('Item', 'Quantity updated successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Update failed'}}); log('Error', 'Failed to update quantity: ' + (error.error || 'Server error')); alert('Failed to update quantity: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to update quantity'); console.error('Failed to update quantity', e); alert('Failed to update quantity'); } }
        async function deleteItem(itemId){ if(!confirm('Delete this item?')) return; log('Delete', 'Deleting item ' + itemId); try{ await fetch('/api/items/'+itemId,{ method:'DELETE', headers:{ Authorization:'Bearer '+token }}); log('Delete', 'Item deleted successfully'); if(currentListId) loadItems(currentListId); } catch(e){ log('Error', 'Failed to delete item'); console.error('Failed to delete item'); } }
    </script>
</body>
</html>
  `);
});

// Start server
const port = process.env.PORT ? Number(process.env.PORT) : 8080;
connectDB().then(() => { app.listen(port, () => { console.log(`🚀 Checklist app running on http://localhost:${port}`); }); });