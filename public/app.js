/* Metro Buddy front-end */
(async function () {
  'use strict';

  const LINE_COLORS = {
    'Red line': '#e53935', 'Yellow line': '#fdd835', 'Blue line': '#1e88e5',
    'Blue line branch': '#42a5f5', 'Green line': '#43a047', 'Green line branch': '#66bb6a',
    'Violet line': '#8e24aa', 'Pink line': '#ec407a', 'Pink line ring': '#ec407a', 'Magenta line': '#c2185b',
    'Aqua line': '#00bcd4', 'Gray line': '#9e9e9e', 'Orange line': '#fb8c00', 'Rapid Metro': '#3949ab',
  };
  const lineColor = l => LINE_COLORS[l] || '#8899bb';
  // Dark text on light line colours (yellow, aqua...) for readable avatars/markers
  function textOn(bg) {
    const m = /^#([0-9a-f]{6})$/i.exec(bg || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1d1440' : '#fff';
  }

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let clientId = store.get('mb_id');
  if (!clientId) { clientId = 'c' + Math.random().toString(36).slice(2, 10); store.set('mb_id', clientId); }

  const network = await fetch('network.json').then(r => r.json());
  const G = window.Metro.build(network);

  const $ = id => document.getElementById(id);
  const joinScreen = $('join'), appScreen = $('app');

  function fillStations(sel, placeholder) {
    sel.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
    for (const name of G.names) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    }
  }
  fillStations($('meStation'), '— detecting… —');
  fillStations($('myTarget'), '— nowhere yet —');
  fillStations($('fromSel'), null);
  fillStations($('toSel'), null);

  let me = { name: '', group: '', station: null, line: null, lat: null, lng: null, target: null };
  let roster = [];
  let socket = null;

  $('nameInput').value = store.get('mb_name') || '';
  $('groupInput').value = store.get('mb_group') || '';

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    let t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast'; t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- JOIN / LEAVE ----------
  $('joinBtn').onclick = () => {
    const name = $('nameInput').value.trim();
    const group = $('groupInput').value.trim().toLowerCase();
    if (!name) { toast('Tell us your name first ✦'); $('nameInput').focus(); return; }
    if (!group) { toast('Pick a group code to share ✦'); $('groupInput').focus(); return; }
    me.name = name; me.group = group;
    store.set('mb_name', name); store.set('mb_group', group);
    startSocket();
    joinScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    $('groupLabel').textContent = group;
    $('emptyCode').textContent = group;
    playVideos();
    startGPS();
    renderAll();
  };

  $('leaveBtn').onclick = () => {
    if (socket) { socket.emit('leave'); socket.disconnect(); socket = null; }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    roster = [];
    $('conn').classList.remove('on');
    appScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
  };

  function playVideos() {
    document.querySelectorAll('video').forEach(v => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
  }

  // ---------- SOCKET ----------
  function startSocket() {
    if (socket) { socket.emit('join', { group: me.group, clientId, name: me.name }); pushUpdate(); return; }
    socket = io();
    socket.on('connect', () => {
      $('conn').classList.add('on');
      socket.emit('join', { group: me.group, clientId, name: me.name });
      pushUpdate();
    });
    socket.on('disconnect', () => $('conn').classList.remove('on'));
    socket.on('roster', list => { roster = list; renderFriends(); renderMapMarkers(); });
  }

  function pushUpdate() {
    if (!socket) return;
    socket.emit('update', { name: me.name, station: me.station, line: me.line, lat: me.lat, lng: me.lng, target: me.target });
  }

  // ---------- GPS ----------
  let watchId = null;
  function startGPS() {
    if (!navigator.geolocation) { $('youStatus').textContent = 'GPS off — pick your station'; return; }
    watchId = navigator.geolocation.watchPosition(
      pos => {
        me.lat = pos.coords.latitude; me.lng = pos.coords.longitude;
        const n = G.nearest(me.lat, me.lng);
        me.station = n.station.name; me.line = n.station.line;
        $('youStatus').textContent = n.km > 3
          ? `${n.km.toFixed(0)} km from ${me.station}`
          : `Near ${me.station} · ${n.km.toFixed(1)} km`;
        pushUpdate(); renderMe(); renderFriends(); renderMapMarkers();
      },
      () => { $('youStatus').textContent = 'Location off — pick your station'; renderMe(); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  // ---------- station / target selects ----------
  $('meStation').onchange = e => {
    if (!e.target.value) return;
    me.station = e.target.value;
    me.line = (G.nameToIds[me.station] || []).map(id => G.byId[id].line)[0] || null;
    pushUpdate(); renderMe(); renderFriends(); renderMapMarkers();
  };
  $('myTarget').onchange = e => { me.target = e.target.value || null; pushUpdate(); renderFriends(); renderMapMarkers(); };

  // ---------- TABS ----------
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    const which = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['friends', 'map', 'route'].forEach(name => $('tab-' + name).classList.toggle('hidden', name !== which));
    if (which === 'map') showMap();
  });

  // ---------- RENDER: ME ----------
  function renderMe() {
    $('meInitials').textContent = initials(me.name);
    $('meName').textContent = me.name || 'You';
    if (me.station) {
      $('meStationText').textContent = me.station;
      $('meLineDot').style.background = lineColor(me.line);
      if ($('meStation').value !== me.station) $('meStation').value = me.station;
    } else {
      $('meStationText').textContent = 'Pick your station below';
      $('meLineDot').style.background = '#888';
    }
  }

  // ---------- RENDER: BANNER ----------
  function updateBanner() {
    const others = roster.filter(r => r.clientId !== clientId);
    $('friendsCount').textContent = others.length;
    const total = Math.max(roster.length, 1);
    $('ridersText').textContent = total <= 1 ? 'just you so far' : `${total} riders on board`;
  }

  // ---------- RENDER: FRIENDS ----------
  let lastFriendsHtml = '';
  function renderFriends() {
    const list = $('friendsList');
    const others = roster.filter(r => r.clientId !== clientId && r.station);
    $('friendsEmpty').classList.toggle('hidden', others.length > 0);
    updateBanner();

    // sort: same station first, then by minutes from me, then name
    const withEta = others.map(f => {
      let mins = null;
      if (me.station && f.station && f.station !== me.station) {
        const r = G.route(f.station, me.station);
        if (r) mins = Math.round(r.minutes);
      }
      return { f, mins };
    }).sort((a, b) => {
      const aTog = me.station && a.f.station === me.station ? 0 : 1;
      const bTog = me.station && b.f.station === me.station ? 0 : 1;
      if (aTog !== bTog) return aTog - bTog;
      if (a.mins != null && b.mins != null && a.mins !== b.mins) return a.mins - b.mins;
      return (a.f.name || '').localeCompare(b.f.name || '');
    });

    let html = '';
    for (const { f, mins } of withEta) {
      let etaHtml = '', pill = '';
      if (me.station && f.station === me.station) pill = `<span class="pill together">together now</span>`;
      else if (mins != null) etaHtml = `<div class="eta-box"><b>${mins}m</b><small>from you</small></div>`;
      const dest = f.target || me.target;
      let destHtml = '';
      if (dest && dest !== f.station) {
        const r = G.route(f.station, dest);
        if (r) destHtml = `<span class="chip-dest">→ ${esc(dest)} ${Math.round(r.minutes)}m</span>`;
      }
      if (me.target && f.target && me.target === f.target && !pill) pill = `<span class="pill same">same stop</span>`;
      const c = lineColor(f.line);
      html += `<div class="fcard">
        <div class="avatar" style="background:${c};color:${textOn(c)}">${initials(f.name)}</div>
        <div class="fmain">
          <div class="fname"><span>${esc(f.name)}</span>${pill}</div>
          <div class="fsub"><span class="line-dot" style="background:${c}"></span><span>${esc(f.station)}</span>${destHtml}</div>
        </div>
        ${etaHtml}</div>`;
    }
    if (html !== lastFriendsHtml) { list.innerHTML = html; lastFriendsHtml = html; }
  }

  // ---------- RENDER: ROUTE ----------
  $('swapBtn').onclick = () => { const a = $('fromSel').value; $('fromSel').value = $('toSel').value; $('toSel').value = a; };
  $('planBtn').onclick = () => renderRoute($('fromSel').value, $('toSel').value);

  function renderRoute(from, to) {
    const box = $('routeResult');
    if (!from || !to || from === to) { box.innerHTML = `<div class="route-msg">Pick two different stations ✦</div>`; return; }
    const r = G.route(from, to);
    if (!r) { box.innerHTML = `<div class="route-msg">No route found between those two.</div>`; return; }
    let html = `<div class="route-summary"><span class="big">${Math.round(r.minutes)} min</span>
      <span class="meta">${r.interchanges} interchange${r.interchanges === 1 ? '' : 's'} · ${r.path.length - 1} stops</span></div><div class="legs">`;
    r.legs.forEach((l, i) => {
      const c = lineColor(l.line);
      html += `<div><div class="leg-row">
        <div class="leg-track" style="background:${c}"></div>
        <div class="leg-body">
          <div class="leg-head"><span class="line-dot" style="background:${c}"></span><span class="leg-name">${esc(l.line)}</span><span class="leg-stops">${l.stops} stop${l.stops === 1 ? '' : 's'}</span></div>
          <div class="leg-detail">${esc(l.from)} → ${esc(l.to)}</div>
        </div></div>`;
      if (i < r.legs.length - 1) html += `<div class="transfer-note">change to ${esc(r.legs[i + 1].line)}</div>`;
      html += `</div>`;
    });
    html += `</div>`;
    box.innerHTML = html;
  }

  function syncRouteFrom() { if (me.station) $('fromSel').value = me.station; }
  function renderAll() { renderMe(); renderFriends(); syncRouteFrom(); renderMapMarkers(); }

  // ---------- MAP ----------
  let map = null, markers = {}, mapReady = false;
  const IN_DELHI = (la, ln) => la > 27.5 && la < 29.5 && ln > 76.5 && ln < 78;

  function showMap() {
    if (!map) initMap();
    setTimeout(() => { map.invalidateSize(); if (!mapReady) { fitToNetwork(); mapReady = true; } renderMapMarkers(); }, 60);
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: false }).setView([28.63, 77.22], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 18, subdomains: 'abcd' }).addTo(map);
    const byId = G.byId;
    network.edges.forEach(e => {
      if (e.type !== 'ride') return;
      const a = byId[e.a], b = byId[e.b];
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: lineColor(e.line), weight: 4.5, opacity: 0.9 }).addTo(map);
    });
    G.stations.forEach(s => {
      L.circleMarker([s.lat, s.lng], { radius: 3.5, color: '#1d1440', weight: 1.4, fillColor: lineColor(s.line), fillOpacity: 1 })
        .bindTooltip(s.name, { className: 'stn-tip', direction: 'top' }).addTo(map);
    });
    const norm = l => l.replace(' line ring', ' line');
    const seen = [...new Set(network.edges.map(e => e.line).filter(Boolean).map(norm))];
    $('mapLegend').innerHTML = seen.sort().map(l => `<span><i style="background:${lineColor(l)}"></i>${esc(l.replace(' line', ''))}</span>`).join('');
  }

  function fitToNetwork() { map.fitBounds(G.stations.map(s => [s.lat, s.lng]), { padding: [30, 30] }); }

  const km = (a, b) => window.Metro.haversineKm(a[0], a[1], b[0], b[1]);
  function pointAlongPath(coords, frac) {
    if (coords.length === 1) return coords[0];
    const segs = []; let total = 0;
    for (let i = 1; i < coords.length; i++) { const d = km(coords[i - 1], coords[i]); segs.push(d); total += d; }
    if (total === 0) return coords[0];
    let target = frac * total, acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= target) {
        const t = segs[i] === 0 ? 0 : (target - acc) / segs[i];
        const A = coords[i], B = coords[i + 1];
        return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      }
      acc += segs[i];
    }
    return coords[coords.length - 1];
  }

  function memberPosition(m) {
    if (m.lat != null && m.lng != null && IN_DELHI(m.lat, m.lng)) return { pos: [m.lat, m.lng], live: true };
    if (!m.station) return null;
    const here = G.nameToIds[m.station] && G.byId[G.nameToIds[m.station][0]];
    if (!here) return null;
    if (m.target && m.target !== m.station) {
      const r = G.route(m.station, m.target);
      if (r && r.path.length > 1) {
        const coords = r.path.map(id => [G.byId[id].lat, G.byId[id].lng]);
        const elapsedMin = (Date.now() - (m.updatedAt || Date.now())) / 60000;
        const frac = Math.max(0, Math.min(1, elapsedMin / Math.max(r.minutes, 1)));
        return { pos: pointAlongPath(coords, frac), live: false };
      }
    }
    return { pos: [here.lat, here.lng], live: false };
  }

  function friendIcon(name, color, isMe, live) {
    return L.divIcon({
      className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div class="friend-marker ${isMe ? 'me' : ''}" style="background:${color};color:${textOn(color)};opacity:${live ? 1 : 0.85}">${initials(name)}</div>`,
    });
  }

  function renderMapMarkers() {
    if (!map) return;
    const all = [];
    if (me.station || me.lat != null) all.push({ ...me, clientId, __me: true });
    roster.forEach(r => { if (r.clientId !== clientId) all.push(r); });
    const live = new Set();
    all.forEach(m => {
      const p = memberPosition(m);
      if (!p) return;
      live.add(m.clientId);
      const color = m.__me ? '#ff7ade' : lineColor(m.line);
      const label = (m.__me ? m.name + ' (you)' : m.name) + (m.station ? ` · ${m.station}` : '') + (p.live ? '' : ' · est.');
      if (markers[m.clientId]) {
        markers[m.clientId].setLatLng(p.pos).setIcon(friendIcon(m.name, color, m.__me, p.live)).setTooltipContent(label);
      } else {
        markers[m.clientId] = L.marker(p.pos, { icon: friendIcon(m.name, color, m.__me, p.live), zIndexOffset: 1000 })
          .bindTooltip(label, { direction: 'top', offset: [0, -14] }).addTo(map);
      }
    });
    Object.keys(markers).forEach(id => { if (!live.has(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
  }

  // ---------- helpers ----------
  function initials(n) { return (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  setInterval(() => { renderFriends(); renderMapMarkers(); }, 5000);
})();
