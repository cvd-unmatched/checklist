'use strict';

(function(){
  var token = localStorage.getItem('token');
  var lists = [];
  var currentListId = null;
  window.currentListId = null;
  var editing = false;
  var currentItems = [];

  function safeLog(){ if (window.loggingEnabled) { try { console.log.apply(console, arguments); } catch(_){} } }
  function log(action, details){ if (window.loggingEnabled) { var ts=new Date().toLocaleTimeString(); console.log('['+ts+'] '+action+': '+details); } }

  function fmtDate(d){
    if (!d) return '\u2014';
    if (d instanceof Date){ if (isNaN(d.getTime())) return '\u2014'; return d.toLocaleDateString('en-GB'); }
    if (typeof d === 'string'){
      if (!d) return '\u2014';
      var dt = d.includes('T') ? new Date(d) : new Date(d + 'T00:00:00');
      if (isNaN(dt.getTime())) return d;
      return dt.toLocaleDateString('en-GB');
    }
    return '\u2014';
  }
  function fmtRange(s,e){ return '\ud83d\udcc5 ' + fmtDate(s) + ' \u2192 ' + fmtDate(e); }

  async function checkLoggingStatus(){
    try {
      var r = await fetch('/api/logging-status');
      var data = await r.json();
      window.loggingEnabled = data.logging === 'ON';
      if (window.loggingEnabled) {
        console.log('\ud83d\udcdd Logging enabled - user actions will be logged');
        console.log('[init] Client script loaded');
      }
    } catch (_) {
      window.loggingEnabled = false;
    }
  }

  async function checkDBStatus(){
    try { var r = await fetch('/api/status'); var data = await r.json(); var dot = document.getElementById('dbDot'); dot.className = 'dot ' + (data.db==='connected'?'green': data.db==='busy'?'orange':'red'); }
    catch { document.getElementById('dbDot').className = 'dot red'; }
  }

  async function handleLogin(){
    var password = document.getElementById('password').value;
    log('Login attempt', 'User trying to login');
    try {
      var r = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: password })});
      if(r.ok){ var d=await r.json(); token=d.token; localStorage.setItem('token', d.token); log('Login success', 'User logged in successfully'); showApp(); loadLists(); }
      else { var e=await r.json().catch(function(){return{error:'Login failed'}}); alert(e.error||'Login failed'); }
    }catch(e){ log('Login error', 'Login failed'); if (window.loggingEnabled) console.error('Failed to login'); }
  }

  function showApp(){ document.getElementById('login').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); log('UI', 'Showing main app'); }
  function showOverview(){ document.getElementById('overview').classList.remove('hidden'); document.getElementById('detail').classList.add('hidden'); log('Navigation', 'Showing lists overview'); }
  function showDetail(){ document.getElementById('overview').classList.add('hidden'); document.getElementById('detail').classList.remove('hidden'); log('Navigation', 'Showing list detail'); }
  function backToOverview(){ currentListId=null; window.currentListId=null; showOverview(); log('Navigation', 'Back to overview'); }

  async function loadLists(){ log('Data', 'Loading lists'); try{ var r = await fetch('/api/lists',{ headers:{ Authorization:'Bearer ' + token }}); lists = await r.json(); renderListsGrid(); log('Data', 'Loaded ' + lists.length + ' lists'); } catch(e){ log('Error', 'Failed to load lists'); if (window.loggingEnabled) console.error('Failed to load lists'); } }
  function renderListsGrid(){ var grid = document.getElementById('listsGrid'); if(!lists.length){ grid.innerHTML = '<div class="muted">No lists yet. Create your first list.</div>'; return; } grid.innerHTML = lists.map(function(l){ return '<div class="list-card" onclick="openList(' + l.id + ')">'+ '<div style="font-weight:700; margin-bottom:8px; font-size:16px">' + l.name + '</div>' + '<div class="badge">' + fmtRange(l.start_date, l.end_date) + '</div>' + '</div>'; }).join(''); }
  async function createList(){ var name = document.getElementById('newListName').value; var startDate = document.getElementById('newStart').value; var endDate = document.getElementById('newEnd').value; if(!name) return; log('Create', 'Creating list: ' + name + ' (' + startDate + ' to ' + endDate + ')'); try{ var r=await fetch('/api/lists',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:startDate, endDate:endDate })}); if(r.ok){ document.getElementById('newListName').value=''; document.getElementById('newStart').value=''; document.getElementById('newEnd').value=''; log('Create', 'List created successfully'); loadLists(); } }catch(e){ log('Error', 'Failed to create list'); if (window.loggingEnabled) console.error('Failed to create list'); } }

  async function openList(id){ currentListId=id; window.currentListId=id; var list = lists.find(function(x){return x.id===id}); log('Navigation', 'Opening list: ' + (list ? list.name : 'Unknown') + ' (ID: ' + id + ')'); document.getElementById('detailTitle').textContent = list ? list.name : 'List'; document.getElementById('detailDates').textContent = fmtRange(list && list.start_date, list && list.end_date); document.getElementById('editName').value = list ? list.name : ''; document.getElementById('editStart').value = (list && list.start_date) ? String(list.start_date) : ''; document.getElementById('editEnd').value = (list && list.end_date) ? String(list.end_date) : ''; document.getElementById('editForm').classList.add('hidden'); editing=false; showDetail(); await loadItems(id); }
  function toggleEdit(){ editing=!editing; log('Edit', editing ? 'Entering edit mode' : 'Exiting edit mode'); document.getElementById('editForm').classList.toggle('hidden', !editing); }
  async function saveEdits(){ if(!currentListId) return; var name=document.getElementById('editName').value; var start=document.getElementById('editStart').value; var end=document.getElementById('editEnd').value; if(!name) return; log('Edit', 'Saving edits: ' + name + ' (' + start + ' to ' + end + ')'); try{ var r=await fetch('/api/lists/'+currentListId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:start||null, endDate:end||null })}); if(r.ok){ var updated = await r.json(); lists = lists.map(function(l){ return l.id===currentListId ? { id:l.id, name:updated.name, start_date:updated.startDate, end_date:updated.endDate } : l }); log('Edit', 'Edits saved successfully'); renderListsGrid(); openList(currentListId); toggleEdit(); } }catch(e){ log('Error', 'Failed to save edits'); if (window.loggingEnabled) console.error('Failed to save edits'); } }

  async function copyCurrentList(){ if(!currentListId) return; log('Copy', 'Copying current list'); try{ var r=await fetch('/api/lists/'+currentListId+'/copy',{ method:'POST', headers:{ Authorization:'Bearer '+token }}); if(r.ok){ var d=await r.json(); log('Copy', 'List copied successfully'); await loadLists(); openList(d.id); } }catch(e){ log('Error', 'Failed to copy list'); if (window.loggingEnabled) console.error('Failed to copy list'); } }

  async function loadItems(listId){ log('Data', 'Loading items for list ' + listId); try{ var r = await fetch('/api/lists/'+listId+'/items',{ headers:{ Authorization:'Bearer '+token }}); var items = await r.json(); currentItems = items; renderItems(items); log('Data', 'Loaded ' + items.length + ' items'); } catch(e){ log('Error', 'Failed to load items'); if (window.loggingEnabled) console.error('Failed to load items'); } }
  function renderItems(items){ var container = document.getElementById('itemsContainer'); if(!items.length){ container.innerHTML = '<div class="muted">No items yet.</div>'; return; } container.innerHTML = items.map(function(item){ return '<div class="item big-checkbox">' + '<input type="checkbox" ' + (item.checked?'checked':'') + ' onchange="toggleItem(' + item.id + ', this.checked)">' + '<div class="item-label" style="'+(item.checked?'text-decoration:line-through; opacity:.7':'')+'">' + item.label + '</div>' + '<input type="number" value="' + item.quantity + '" min="1">' + '<button onclick="updateQuantity(' + item.id + ', this.previousElementSibling.value)">Update</button>' + '<button onclick="deleteItem(' + item.id + ')" style="border-color: var(--danger)">Delete</button>' + '</div>'; }).join(''); }
  async function addItem(listId){ listId = listId || currentListId; if(!listId){ log('Error', 'No list selected for addItem'); return; } var labelEl=document.getElementById('newItemLabel'); var qtyEl=document.getElementById('newItemQty'); var label=labelEl && labelEl.value!==undefined ? labelEl.value : ''; var quantity=qtyEl && qtyEl.value!==undefined ? qtyEl.value : '1'; if(!label) return; log('Create', 'Adding item: ' + label + ' (qty: ' + quantity + ')'); try{ var r=await fetch('/api/lists/'+listId+'/items',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ label:label, quantity: parseInt(quantity) })}); if(r.ok){ if(labelEl && 'value' in labelEl){ labelEl.value=''; } qtyEl.value='1'; log('Create', 'Item added successfully'); loadItems(listId); } }catch(e){ log('Error', 'Failed to add item'); if (window.loggingEnabled) console.error('Failed to add item'); } }
  async function toggleItem(itemId, checked){ log('Item', 'Toggling item ' + itemId + ' to ' + (checked ? 'checked' : 'unchecked')); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ checked:checked })}); if(r.ok){ log('Item', 'Item toggled successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Toggle failed'}}); log('Error', 'Failed to toggle item: ' + (error.error || 'Server error')); alert('Failed to toggle item: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to toggle item'); if (window.loggingEnabled) console.error('Failed to toggle item', e); alert('Failed to toggle item'); } }
  async function updateQuantity(itemId, quantity){ log('Item', 'Updating quantity for item ' + itemId + ' to ' + quantity); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ quantity: parseInt(quantity) })}); if(r.ok){ log('Item', 'Quantity updated successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Update failed'}}); log('Error', 'Failed to update quantity: ' + (error.error || 'Server error')); alert('Failed to update quantity: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to update quantity'); if (window.loggingEnabled) console.error('Failed to update quantity', e); alert('Failed to update quantity'); } }
  async function deleteItem(itemId){ if(!confirm('Delete this item?')) return; log('Delete', 'Deleting item ' + itemId); try{ await fetch('/api/items/'+itemId,{ method:'DELETE', headers:{ Authorization:'Bearer '+token }}); log('Delete', 'Item deleted successfully'); if(currentListId) loadItems(currentListId); } catch(e){ log('Error', 'Failed to delete item'); if (window.loggingEnabled) console.error('Failed to delete item'); } }

  async function copyListText(){ if(!currentListId) return; try { var list = lists.find(function(x){ return x.id===currentListId }); if(!list){ alert('No list selected'); return; } if(!currentItems || !currentItems.length){ await loadItems(currentListId); }
    var header = (list.name || 'List') + '\n' + fmtRange(list && list.start_date, list && list.end_date) + '\n\n';
    var lines = (currentItems || []).map(function(item){ var box = '\u2610'; var qty = item.quantity && item.quantity !== 1 ? ' x' + item.quantity : ''; return box + ' ' + item.label + qty; });
    var text = header + lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); } else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    log('Copy', 'Copied list to clipboard as text'); if (window.loggingEnabled) alert('Copied to clipboard');
  } catch(e){ log('Error', 'Failed to copy list to clipboard'); if (window.loggingEnabled) console.error('Failed to copy to clipboard', e); alert('Failed to copy'); } }

  // Expose globally for inline handlers
  window.handleLogin = handleLogin;
  window.createList = createList;
  window.openList = openList;
  window.backToOverview = backToOverview;
  window.toggleEdit = toggleEdit;
  window.saveEdits = saveEdits;
  window.addItem = addItem;
  window.updateQuantity = updateQuantity;
  window.deleteItem = deleteItem;
  window.copyCurrentList = copyCurrentList;
  window.copyListText = copyListText;
  window.toggleItem = toggleItem;
  // Log that handlers are bound (only when enabled later)
  // This will be printed after LOGGING status is fetched

  // Init
  checkDBStatus(); setInterval(checkDBStatus, 5000);
  checkLoggingStatus();
  if (token) { if (window.loggingEnabled) console.log('[init] Token detected, showing app'); showApp(); loadLists(); }
  else { if (window.loggingEnabled) console.log('[init] No token, showing login'); }
})();


