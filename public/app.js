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

  // Helper function to handle 401 errors (expired tokens)
  async function handleAuthError(response){
    if(response && response.status === 401){
      log('Auth', 'Token expired, logging out');
      logout();
      return true;
    }
    return false;
  }

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

  async function loadLists(){ log('Data', 'Loading lists'); try{ var r = await fetch('/api/lists',{ headers:{ Authorization:'Bearer ' + token }}); if(await handleAuthError(r)) return; if(!r.ok){ var error = await r.json().catch(function(){return{error:'Failed to load lists'}}); log('Error', 'Failed to load lists: ' + (error.error || 'Server error')); return; } lists = await r.json(); renderListsGrid(); log('Data', 'Loaded ' + lists.length + ' lists'); } catch(e){ log('Error', 'Failed to load lists'); if (window.loggingEnabled) console.error('Failed to load lists'); } }
  function renderListsGrid(){ var grid = document.getElementById('listsGrid'); if(!lists.length){ grid.innerHTML = '<div class="muted">No lists yet. Create your first list.</div>'; return; } grid.innerHTML = lists.map(function(l){ var flag = l.country ? getCountryFlag(l.country) : ''; var countryName = l.country ? getCountryName(l.country) : ''; var countryDisplay = l.country ? (flag + ' ' + countryName) : ''; var titleLine = l.name + (countryDisplay ? ' - ' + countryDisplay : ''); return '<div class="list-card" onclick="openList(' + l.id + ')">'+ '<div style="font-weight:700; margin-bottom:8px; font-size:16px">' + titleLine + '</div>' + '<div class="badge">' + fmtRange(l.start_date, l.end_date) + '</div>' + '</div>'; }).join(''); ensureTwemojiLoaded(function(){ try { if (window.twemoji) { window.twemoji.parse(grid, { folder: 'svg', ext: '.svg' }); } } catch(e){ if (window.loggingEnabled) console.warn('Twemoji parse failed, using native emojis'); } }); }
  async function createList(){ var name = document.getElementById('newListName').value; var startDate = document.getElementById('newStart').value; var endDate = document.getElementById('newEnd').value; var country = document.getElementById('newCountry').value; if(!name) return; if (startDate && endDate && endDate < startDate) { if (window.loggingEnabled) console.warn('Invalid date range'); alert('End date cannot be before start date'); return; } log('Create', 'Creating list: ' + name + ' (' + startDate + ' to ' + endDate + ', country: ' + country + ')'); try{ var r=await fetch('/api/lists',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:startDate || null, endDate:endDate || null, country:country || null })}); if(await handleAuthError(r)) return; if(r.ok){ document.getElementById('newListName').value=''; document.getElementById('newStart').value=''; document.getElementById('newEnd').value=''; document.getElementById('newCountry').value=''; log('Create', 'List created successfully'); loadLists(); } else { var err=await r.json().catch(function(){return{error:'Create failed'}}); alert(err.error||'Create failed'); } }catch(e){ log('Error', 'Failed to create list'); if (window.loggingEnabled) console.error('Failed to create list'); } }

  async function openList(id){ currentListId=id; window.currentListId=id; var list = lists.find(function(x){return x.id===id}); log('Navigation', 'Opening list: ' + (list ? list.name : 'Unknown') + ' (ID: ' + id + ')'); document.getElementById('detailTitle').textContent = list ? list.name : 'List'; document.getElementById('detailDates').textContent = fmtRange(list && list.start_date, list && list.end_date); document.getElementById('editName').value = list ? list.name : ''; document.getElementById('editStart').value = (list && list.start_date) ? String(list.start_date) : ''; document.getElementById('editEnd').value = (list && list.end_date) ? String(list.end_date) : ''; document.getElementById('editCountry').value = list && list.country ? list.country : ''; document.getElementById('editForm').classList.add('hidden'); editing=false; showDetail(); await loadItems(id); }
  function toggleEdit(){ editing=!editing; log('Edit', editing ? 'Entering edit mode' : 'Exiting edit mode'); document.getElementById('editForm').classList.toggle('hidden', !editing); }
  async function saveEdits(){ if(!currentListId) return; var name=document.getElementById('editName').value; var start=document.getElementById('editStart').value; var end=document.getElementById('editEnd').value; var country=document.getElementById('editCountry').value; if(!name) return; if (start && end && end < start) { if (window.loggingEnabled) console.warn('Invalid date range'); alert('End date cannot be before start date'); return; } log('Edit', 'Saving edits: ' + name + ' (' + start + ' to ' + end + ', country: ' + country + ')'); try{ var r=await fetch('/api/lists/'+currentListId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ name:name, startDate:start||null, endDate:end||null, country:country||null })}); if(await handleAuthError(r)) return; if(r.ok){ var updated = await r.json(); lists = lists.map(function(l){ return l.id===currentListId ? { id:l.id, name:updated.name, start_date:updated.startDate, end_date:updated.endDate, country:updated.country } : l }); log('Edit', 'Edits saved successfully'); renderListsGrid(); openList(currentListId); toggleEdit(); } else { var err = await r.json().catch(function(){return{error:'Update failed'}}); alert(err.error||'Update failed'); } }catch(e){ log('Error', 'Failed to save edits'); if (window.loggingEnabled) console.error('Failed to save edits'); } }

  async function copyCurrentList(){ if(!currentListId) return; log('Copy', 'Copying current list'); try{ var r=await fetch('/api/lists/'+currentListId+'/copy',{ method:'POST', headers:{ Authorization:'Bearer '+token }}); if(await handleAuthError(r)) return; if(r.ok){ var d=await r.json(); log('Copy', 'List copied successfully'); await loadLists(); openList(d.id); } }catch(e){ log('Error', 'Failed to copy list'); if (window.loggingEnabled) console.error('Failed to copy list'); } }

  async function loadItems(listId){ log('Data', 'Loading items for list ' + listId); try{ var r = await fetch('/api/lists/'+listId+'/items',{ headers:{ Authorization:'Bearer '+token }}); if(await handleAuthError(r)) return; if(!r.ok){ var error = await r.json().catch(function(){return{error:'Failed to load items'}}); log('Error', 'Failed to load items: ' + (error.error || 'Server error')); return; } var items = await r.json(); currentItems = items; renderItems(items); log('Data', 'Loaded ' + items.length + ' items'); } catch(e){ log('Error', 'Failed to load items'); if (window.loggingEnabled) console.error('Failed to load items'); } }
  function renderItems(items){ var container = document.getElementById('itemsContainer'); if(!items.length){ container.innerHTML = '<div class="muted">No items yet.</div>'; return; } container.innerHTML = items.map(function(item){ return '<div class="item big-checkbox" draggable="true" data-item-id="' + item.id + '" ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event)" ondragend="handleDragEnd(event)">' + '<span class="drag-handle" style="cursor: grab; user-select: none; margin-right: 8px; font-size: 18px; color: var(--muted);" title="Drag to reorder">☰</span>' + '<input type="checkbox" ' + (item.checked?'checked':'') + ' onchange="toggleItem(' + item.id + ', this.checked)" ondragstart="event.stopPropagation(); return false;">' + '<div class="item-label" data-item-id="' + item.id + '" style="'+(item.checked?'text-decoration:line-through; opacity:.7':'')+'" ondblclick="startEditLabel(' + item.id + ')" title="Double-click to edit">' + item.label + '</div>' + '<input type="number" value="' + item.quantity + '" min="1" ondragstart="event.stopPropagation(); return false;">' + '<button onclick="updateQuantity(' + item.id + ', this.previousElementSibling.value)" ondragstart="event.stopPropagation(); return false;">Update</button>' + '<button onclick="startEditLabel(' + item.id + ')" ondragstart="event.stopPropagation(); return false;">✏️ Edit</button>' + '<button onclick="deleteItem(' + item.id + ')" style="border-color: var(--danger)" ondragstart="event.stopPropagation(); return false;">Delete</button>' + '</div>'; }).join(''); }
  async function addItem(listId){ listId = listId || currentListId; if(!listId){ log('Error', 'No list selected for addItem'); return; } var labelEl=document.getElementById('newItemLabel'); var qtyEl=document.getElementById('newItemQty'); var label=labelEl && labelEl.value!==undefined ? labelEl.value : ''; var quantity=qtyEl && qtyEl.value!==undefined ? qtyEl.value : '1'; if(!label) return; log('Create', 'Adding item: ' + label + ' (qty: ' + quantity + ')'); try{ var r=await fetch('/api/lists/'+listId+'/items',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ label:label, quantity: parseInt(quantity) })}); if(await handleAuthError(r)) return; if(r.ok){ if(labelEl && 'value' in labelEl){ labelEl.value=''; } qtyEl.value='1'; log('Create', 'Item added successfully'); loadItems(listId); } }catch(e){ log('Error', 'Failed to add item'); if (window.loggingEnabled) console.error('Failed to add item'); } }
  async function toggleItem(itemId, checked){ log('Item', 'Toggling item ' + itemId + ' to ' + (checked ? 'checked' : 'unchecked')); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ checked:checked })}); if(await handleAuthError(r)) return; if(r.ok){ log('Item', 'Item toggled successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Toggle failed'}}); log('Error', 'Failed to toggle item: ' + (error.error || 'Server error')); alert('Failed to toggle item: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to toggle item'); if (window.loggingEnabled) console.error('Failed to toggle item', e); alert('Failed to toggle item'); } }
  async function updateQuantity(itemId, quantity){ log('Item', 'Updating quantity for item ' + itemId + ' to ' + quantity); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ quantity: parseInt(quantity) })}); if(await handleAuthError(r)) return; if(r.ok){ log('Item', 'Quantity updated successfully'); if(currentListId) loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Update failed'}}); log('Error', 'Failed to update quantity: ' + (error.error || 'Server error')); alert('Failed to update quantity: ' + (error.error || 'Server error')); } } catch(e){ log('Error', 'Failed to update quantity'); if (window.loggingEnabled) console.error('Failed to update quantity', e); alert('Failed to update quantity'); } }
  async function deleteItem(itemId){ if(!confirm('Delete this item?')) return; log('Delete', 'Deleting item ' + itemId); try{ var r = await fetch('/api/items/'+itemId,{ method:'DELETE', headers:{ Authorization:'Bearer '+token }}); if(await handleAuthError(r)) return; if(r.ok){ log('Delete', 'Item deleted successfully'); if(currentListId) loadItems(currentListId); } } catch(e){ log('Error', 'Failed to delete item'); if (window.loggingEnabled) console.error('Failed to delete item'); } }

  // Drag and drop for reordering
  var draggedElement = null;
  function handleDragStart(e){ if(e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON'){ e.preventDefault(); return false; } draggedElement = e.currentTarget; e.currentTarget.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', e.currentTarget.innerHTML); }
  function handleDragOver(e){ if(e.preventDefault){ e.preventDefault(); } e.dataTransfer.dropEffect = 'move'; var target = e.currentTarget; if(target !== draggedElement && target.classList.contains('item')){ var rect = target.getBoundingClientRect(); var midpoint = rect.top + rect.height / 2; if(e.clientY < midpoint){ target.style.borderTop = '2px solid var(--accent)'; target.style.borderBottom = ''; } else { target.style.borderTop = ''; target.style.borderBottom = '2px solid var(--accent)'; } } return false; }
  function handleDragEnd(e){ e.currentTarget.style.opacity = ''; var items = document.querySelectorAll('.item'); items.forEach(function(item){ item.style.borderTop = ''; item.style.borderBottom = ''; }); draggedElement = null; }
  async function handleDrop(e){ e.preventDefault(); e.stopPropagation(); if(!draggedElement) return; var target = e.currentTarget; if(target === draggedElement || !target.classList.contains('item')) return; var container = target.parentElement; var items = Array.from(container.querySelectorAll('.item')); var draggedIndex = items.indexOf(draggedElement); var targetIndex = items.indexOf(target); if(draggedIndex === -1 || targetIndex === -1) return; var rect = target.getBoundingClientRect(); var midpoint = rect.top + rect.height / 2; var insertBefore = e.clientY < midpoint; if(insertBefore && draggedIndex > targetIndex){ container.insertBefore(draggedElement, target); } else if(!insertBefore && draggedIndex < targetIndex){ container.insertBefore(draggedElement, target.nextSibling); } else if(insertBefore && draggedIndex < targetIndex){ container.insertBefore(draggedElement, target); } else if(!insertBefore && draggedIndex > targetIndex){ container.insertBefore(draggedElement, target.nextSibling); } await saveItemOrder(); return false; }
  async function saveItemOrder(){ if(!currentListId) return; var items = Array.from(document.querySelectorAll('.item')); var itemIds = items.map(function(item){ return parseInt(item.getAttribute('data-item-id')); }); log('Reorder', 'Saving new item order'); try{ var r = await fetch('/api/lists/'+currentListId+'/items/reorder',{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ itemIds: itemIds })}); if(await handleAuthError(r)) return; if(r.ok){ log('Reorder', 'Item order saved successfully'); await loadItems(currentListId); } else { var error = await r.json().catch(function(){return{error:'Reorder failed'}}); log('Error', 'Failed to reorder items: ' + (error.error || 'Server error')); alert('Failed to reorder items: ' + (error.error || 'Server error')); await loadItems(currentListId); } } catch(e){ log('Error', 'Failed to reorder items'); if (window.loggingEnabled) console.error('Failed to reorder items', e); alert('Failed to reorder items'); await loadItems(currentListId); } }

  // Inline label editing
  function startEditLabel(itemId){ var item = currentItems.find(function(x){ return x.id === itemId; }); if(!item) return; var labelEl = document.querySelector('.item-label[data-item-id="' + itemId + '"]'); if(!labelEl) return; var currentLabel = item.label; var input = document.createElement('input'); input.type = 'text'; input.value = currentLabel; input.style.cssText = 'flex: 1; min-width: 0; padding: 8px; background: #1e293b; color: var(--text); border: 1px solid var(--accent); border-radius: 8px; font-size: 16px;'; input.onblur = function(){ saveLabelEdit(itemId, input.value, labelEl); }; input.onkeydown = function(e){ if(e.key === 'Enter'){ input.blur(); } else if(e.key === 'Escape'){ labelEl.textContent = currentLabel; labelEl.style.display = ''; input.remove(); } }; labelEl.style.display = 'none'; labelEl.parentElement.insertBefore(input, labelEl); input.focus(); input.select(); }
  async function saveLabelEdit(itemId, newLabel, labelEl){ if(!newLabel || newLabel.trim() === ''){ newLabel = currentItems.find(function(x){ return x.id === itemId; }).label; } newLabel = newLabel.trim(); log('Edit', 'Updating label for item ' + itemId + ' to: ' + newLabel); try{ var r = await fetch('/api/items/'+itemId,{ method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ label: newLabel })}); if(await handleAuthError(r)) return; if(r.ok){ labelEl.textContent = newLabel; labelEl.style.display = ''; var input = labelEl.previousElementSibling; if(input && input.tagName === 'INPUT'){ input.remove(); } log('Edit', 'Label updated successfully'); var item = currentItems.find(function(x){ return x.id === itemId; }); if(item){ item.label = newLabel; } } else { var error = await r.json().catch(function(){return{error:'Update failed'}}); log('Error', 'Failed to update label: ' + (error.error || 'Server error')); alert('Failed to update label: ' + (error.error || 'Server error')); await loadItems(currentListId); } } catch(e){ log('Error', 'Failed to update label'); if (window.loggingEnabled) console.error('Failed to update label', e); alert('Failed to update label'); await loadItems(currentListId); } }

  async function copyListText(){ if(!currentListId) return; try { var list = lists.find(function(x){ return x.id===currentListId }); if(!list){ alert('No list selected'); return; } if(!currentItems || !currentItems.length){ await loadItems(currentListId); }
    var header = (list.name || 'List') + '\n' + fmtRange(list && list.start_date, list && list.end_date) + '\n\n';
    var lines = (currentItems || []).map(function(item){ var box = '\u2610'; var qty = item.quantity && item.quantity !== 1 ? ' x' + item.quantity : ''; return box + ' ' + item.label + qty; });
    var text = header + lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); } else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    log('Copy', 'Copied list to clipboard as text'); if (window.loggingEnabled) alert('Copied to clipboard');
  } catch(e){ log('Error', 'Failed to copy list to clipboard'); if (window.loggingEnabled) console.error('Failed to copy to clipboard', e); alert('Failed to copy'); } }

  function logout(){
    log('Logout', 'User logging out');
    localStorage.removeItem('token');
    token = null;
    lists = [];
    currentListId = null;
    window.currentListId = null;
    currentItems = [];
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('password').value = '';
    log('Logout', 'User logged out successfully');
  }

  // Compute flag emoji from ISO alpha-2 code
  function computeFlagEmoji(isoCode){
    if (!isoCode || typeof isoCode !== 'string' || isoCode.length !== 2) return '';
    var A = 0x1F1E6;
    var ch1 = isoCode[0].toUpperCase().charCodeAt(0) - 65;
    var ch2 = isoCode[1].toUpperCase().charCodeAt(0) - 65;
    if (ch1 < 0 || ch1 > 25 || ch2 < 0 || ch2 > 25) return '';
    return String.fromCodePoint(A + ch1) + String.fromCodePoint(A + ch2);
  }

  // Full set of country/region codes: prefer Intl.supportedValuesOf('region'), fallback to static list
  function getAllCountryCodes(){
    var codes = [];
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'){
      try{
        var regions = Intl.supportedValuesOf('region') || [];
        codes = regions.filter(function(r){ return /^[A-Z]{2}$/.test(r); });
      }catch(_){ codes = []; }
    }
    if (codes.length) return codes;
    // Fallback: common ISO-3166-1 alpha-2 list
    return [
      'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
      'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
      'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
      'DE','DJ','DK','DM','DO','DZ',
      'EC','EE','EG','EH','ER','ES','ET',
      'FI','FJ','FK','FM','FO','FR',
      'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
      'HK','HM','HN','HR','HT','HU',
      'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
      'JE','JM','JO','JP',
      'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
      'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
      'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
      'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
      'OM',
      'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
      'QA',
      'RE','RO','RS','RU','RW',
      'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
      'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
      'UA','UG','UM','US','UY','UZ',
      'VA','VC','VE','VG','VI','VN','VU',
      'WF','WS',
      'YE','YT',
      'ZA','ZM','ZW'
    ];
  }

  // Localized country name via Intl.DisplayNames, fallback to code
  var countryDisplayNames = (function(){
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch(_) { return null; }
  })();
  function getCountryName(isoCode){
    if (!isoCode) return '';
    if (countryDisplayNames){ try { return countryDisplayNames.of(isoCode) || isoCode; } catch(_) { return isoCode; } }
    return isoCode;
  }
  // Compute flag from ISO code for full coverage
  function getCountryFlag(countryCode){ return computeFlagEmoji(countryCode); }

  function populateCountrySelects(){
    var codes = getAllCountryCodes();
    // Sort by localized name
    codes.sort(function(a,b){ var na=getCountryName(a); var nb=getCountryName(b); return na.localeCompare(nb); });
    var selects = [ document.getElementById('newCountry'), document.getElementById('editCountry') ];
    selects.forEach(function(sel){
      if (!sel) return;
      // Preserve first placeholder option if present
      var placeholder = sel.querySelector('option[value=""]');
      sel.innerHTML = '';
      var ph = document.createElement('option'); ph.value = ''; ph.textContent = '🌍 Select country'; sel.appendChild(ph);
      codes.forEach(function(code){
        var opt = document.createElement('option');
        opt.value = code;
        var name = getCountryName(code);
        var flag = getCountryFlag(code);
        opt.textContent = (flag ? (flag + ' ') : '') + name;
        sel.appendChild(opt);
      });
      // Parse emojis in this select for consistent rendering
      ensureTwemojiLoaded(function(){ try { if (window.twemoji) { window.twemoji.parse(sel, { folder: 'svg', ext: '.svg' }); } } catch(e){ if (window.loggingEnabled) console.warn('Twemoji parse failed, using native emojis'); } });
    });
  }

  // Inject emoji CSS once
  (function ensureEmojiCss(){
    if (document.getElementById('emoji-css-style')) return;
    var style = document.createElement('style');
    style.id = 'emoji-css-style';
    style.textContent = 'img.emoji{height:1em;width:1em;margin:0 .05em 0 .1em;vertical-align:-0.1em;}';
    document.head.appendChild(style);
  })();

  // Ensure Twemoji is loaded, then run callback
  function ensureTwemojiLoaded(callback){
    if (window.twemoji) { callback && callback(); return; }
    var existing = document.getElementById('twemoji-script');
    if (!existing){
      var s = document.createElement('script');
      s.id = 'twemoji-script';
      s.defer = true;
      s.crossOrigin = 'anonymous';
      // Use jsDelivr CDN which supports CORS
      s.src = 'https://cdn.jsdelivr.net/npm/twemoji@latest/dist/twemoji.min.js';
      s.onload = function(){ if (callback) callback(); };
      s.onerror = function(){ 
        // If Twemoji fails to load, just continue without it (native emojis will be used)
        if (window.loggingEnabled) console.warn('Twemoji failed to load, using native emojis');
        if (callback) callback(); 
      };
      document.head.appendChild(s);
    } else {
      existing.addEventListener('load', function(){ if (callback) callback(); });
      existing.addEventListener('error', function(){ if (callback) callback(); });
    }
  }

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
  window.logout = logout;
  window.handleDragStart = handleDragStart;
  window.handleDragOver = handleDragOver;
  window.handleDrop = handleDrop;
  window.handleDragEnd = handleDragEnd;
  window.startEditLabel = startEditLabel;
  // Log that handlers are bound (only when enabled later)
  // This will be printed after LOGGING status is fetched

  // Init
  checkDBStatus(); setInterval(checkDBStatus, 5000);
  checkLoggingStatus();
  if (token) { 
    if (window.loggingEnabled) console.log('[init] Token detected, showing app'); 
    showApp(); 
    // Try to load lists - if token is expired, handleAuthError will log out
    loadLists().catch(function(e){
      if (window.loggingEnabled) console.error('[init] Failed to load lists on startup', e);
    });
  }
  else { if (window.loggingEnabled) console.log('[init] No token, showing login'); }
  populateCountrySelects(); // Populate country selects on init
})();


