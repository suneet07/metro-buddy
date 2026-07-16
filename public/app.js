/* Metro Buddy front-end */
(async function () {
  'use strict';

  // Delhi Metro line colours (canonical names from network.json)
  const LINE_COLORS = {
    'Red line': '#e53935', 'Yellow line': '#fdd835', 'Blue line': '#1e88e5',
    'Blue line branch': '#42a5f5', 'Green line': '#43a047', 'Green line branch': '#66bb6a',
    'Violet line': '#8e24aa', 'Pink line': '#ec407a', 'Pink line ring': '#ec407a', 'Magenta line': '#c2185b',
    'Aqua line': '#00bcd4', 'Gray line': '#9e9e9e', 'Orange line': '#fb8c00',
    'Rapid Metro': '#3949ab',
  };
  const lineColor = l => LINE_COLORS[l] || '#8899bb';

  // ---- persistent identity ----
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let clientId = store.get('mb_id');
  if (!clientId) { clientId = 'c' + Math.random().toString(36).slice(2, 10); store.set('mb_id', clientId); }

  // ---- load network + router ----
  const network = await fetch('network.json').then(r => r.json());
  const G = window.Metro.build(network);

  // ---- element refs ----
  const $ = id => document.getElementById(id);
  const joinScreen = $('join'), appScreen = $('app');

  // Populate station dropdowns (unique names, sorted)
  function fillStations(sel, includeNone) {
    sel.innerHTML = includeNone ? '<option value="">— none —</option>' : '';
    for (const name of G.names) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    }
  }
  fillStations($('myTarget'), true);
  fillStations($('fromSel'), false);
  fillStations($('toSel'), false);

  // ---- state ----
  let me = { name: '', group: '', station: null, line: null, lat: null, lng: null, target: null };
  let roster = [];
  let socket = null;

  // Prefill remembered values
  $('nameInput').value = store.get('mb_name') || '';
  $('groupInput').value = store.get('mb_group') || '';

  // ---------- JOIN ----------
  $('joinBtn').onclick = () => {
    const name = $('nameInput').value.trim();
    const group = $('groupInput').value.trim().toLowerCase();
    if (!name || !group) { alert('Enter your name and a group code.'); return; }
    me.name = name; me.group = group;
    store.set('mb_name', name); store.set('mb_group', group);
    startSocket();
    joinScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    $('groupLabel').textContent = group;
    $('emptyCode').textContent = group;
    startGPS();
    renderAll();
  };

  $('leaveBtn').onclick = () => {
    if (socket) socket.emit('leave');
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    appScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
  };

  // ---------- SOCKET ----------
  function startSocket() {
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
    socket.emit('update', {
      name: me.name, station: me.station, line: me.line,
      lat: me.lat, lng: me.lng, target: me.target,
    });
  }

  // ---------- GPS ----------
  let watchId = null;
  function startGPS() {
    if (!navigator.geolocation) { $('youStatus').textContent = 'GPS not supported — pick manually'; return; }
    watchId = navigator.geolocation.watchPosition(
      pos => {
        me.lat = pos.coords.latitude; me.lng = pos.coords.longitude;
        const n = G.nearest(me.lat, me.lng);
        me.station = n.station.name; me.line = n.station.line;
        $('youStatus').textContent = `Near ${me.station} · ${n.km.toFixed(1)} km`;
        pushUpdate(); renderMe(); renderFriends(); renderMapMarkers();
      },
      () => { $('youStatus').textContent = 'Location blocked — pick your station below'; renderMe(); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  // ---------- TARGET ----------
  $('myTarget').onchange = e => { me.target = e.target.value || null; pushUpdate(); renderFriends(); };

  // ---------- TABS ----------
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    const which = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['friends', 'map', 'route'].forEach(name =>
      $('tab-' + name).classList.toggle('hidden', name !== which));
    if (which === 'map') showMap();
  });

  // ---------- RENDER: ME ----------
  function renderMe() {
    const c = $('meCard');
    if (!me.station) {
      c.innerHTML = `<div class="avatar">${initials(me.name)}</div>
        <div class="f-main"><div class="f-name">${esc(me.name)} (you)</div>
        <div class="f-sub">Pick your station:
          <select id="meStationPick" class="station-select" style="width:auto;display:inline-block"></select></div></div>`;
      const pick = $('meStationPick'); fillStations(pick, false);
      pick.onchange = e => {
        me.station = e.target.value;
        me.line = (G.nameToIds[me.station] || []).map(id => G.byId[id].line)[0];
        pushUpdate(); renderMe(); renderFriends();
      };
      return;
    }
    c.innerHTML = `<div class="avatar">${initials(me.name)}</div>
      <div class="f-main">
        <div class="f-name">${esc(me.name)} (you)</div>
        <div class="f-sub"><span class="line-dot" style="background:${lineColor(me.line)}"></span>${esc(me.station)}</div>
      </div>`;
  }

  // ---------- RENDER: FRIENDS ----------
  function renderFriends() {
    const list = $('friendsList');
    const others = roster.filter(r => r.clientId !== clientId);
    $('friendsEmpty').classList.toggle('hidden', others.length > 0);
    list.innerHTML = '';

    for (const f of others) {
      if (!f.station) continue;
      const row = document.createElement('div');
      row.className = 'friend';

      // ETA + relationship to me
      let etaHtml = '', pill = '';
      // If we're at the same station -> together
      if (me.station && f.station === me.station) {
        pill = `<span class="pill together">together now</span>`;
      } else if (me.station && f.station) {
        const between = G.route(f.station, me.station);
        if (between) etaHtml = `<b>${Math.round(between.minutes)}m</b>from you`;
      }
      // ETA for the friend to reach a destination (their target, else my target)
      const dest = f.target || me.target;
      let destHtml = '';
      if (dest && dest !== f.station) {
        const r = G.route(f.station, dest);
        if (r) destHtml = `<span class="pill">→ ${esc(dest)} ${Math.round(r.minutes)}m</span>`;
      }
      // Heading the same way?
      if (me.target && f.target && me.target === f.target && !pill) {
        pill = `<span class="pill together">same destination</span>`;
      }

      row.innerHTML = `
        <div class="avatar">${initials(f.name)}</div>
        <div class="f-main">
          <div class="f-name">${esc(f.name)} ${pill}</div>
          <div class="f-sub">
            <span class="line-dot" style="background:${lineColor(f.line)}"></span>${esc(f.station)}
            ${destHtml}
          </div>
        </div>
        <div class="f-eta">${etaHtml}</div>`;
      list.appendChild(row);
    }
  }

  // ---------- RENDER: ROUTE ----------
  $('swapBtn').onclick = () => {
    const a = $('fromSel').value; $('fromSel').value = $('toSel').value; $('toSel').value = a;
  };
  $('planBtn').onclick = () => renderRoute($('fromSel').value, $('toSel').value);

  function renderRoute(from, to) {
    const box = $('routeResult');
    if (!from || !to || from === to) { box.innerHTML = `<p class="empty">Pick two different stations.</p>`; return; }
    const r = G.route(from, to);
    if (!r) { box.innerHTML = `<p class="empty">No route found.</p>`; return; }
    let html = `<div class="summary">
      <span class="big">${Math.round(r.minutes)} min</span>
      <span class="meta">${r.interchanges} interchange${r.interchanges === 1 ? '' : 's'} · ${r.path.length - 1} stops</span>
    </div>`;
    r.legs.forEach((l, i) => {
      html += `<div class="leg" style="--l:${lineColor(l.line)}">
        <div><div class="l-line">${esc(l.line)}</div>
        <div class="l-detail">${esc(l.from)} → ${esc(l.to)} · ${l.stops} stop${l.stops === 1 ? '' : 's'}</div></div>
      </div>`;
      if (i < r.legs.length - 1) html += `<div class="transfer-note">↳ change to ${esc(r.legs[i + 1].line)}</div>`;
    });
    box.innerHTML = html;
  }

  // Default route "from" follows my current station
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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18, subdomains: 'abcd',
    }).addTo(map);

    // Draw each ride edge as a coloured segment; station dots on top.
    const byId = G.byId;
    network.edges.forEach(e => {
      if (e.type !== 'ride') return;
      const a = byId[e.a], b = byId[e.b];
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: lineColor(e.line), weight: 4, opacity: 0.85,
      }).addTo(map);
    });
    G.stations.forEach(s => {
      L.circleMarker([s.lat, s.lng], {
        radius: 3.5, color: '#fff', weight: 1, fillColor: lineColor(s.line),
        fillOpacity: 1, className: 'stn-marker',
      }).bindTooltip(s.name, { className: 'stn-tip', direction: 'top' }).addTo(map);
    });

    // legend (normalise the Pink ring into Pink so it shows once)
    const norm = l => l.replace(' line ring', ' line');
    const seen = [...new Set(network.edges.map(e => e.line).filter(Boolean).map(norm))];
    $('mapLegend').innerHTML = seen.sort().map(l =>
      `<span><i style="background:${lineColor(l)}"></i>${esc(l.replace(' line', ''))}</span>`).join('');
  }

  function fitToNetwork() {
    const pts = G.stations.map(s => [s.lat, s.lng]);
    map.fitBounds(pts, { padding: [30, 30] });
  }

  // straight-line distance helper
  const km = (a, b) => window.Metro.haversineKm(a[0], a[1], b[0], b[1]);

  // Position a fraction (0..1) along a list of [lat,lng] points, by cumulative distance
  function pointAlongPath(coords, frac) {
    if (coords.length === 1) return coords[0];
    const segs = [];
    let total = 0;
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

  // Hybrid position for a member: real GPS if we have it, else glide along the route.
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
      html: `<div class="friend-marker ${isMe ? 'me' : ''}" style="background:${color};opacity:${live ? 1 : 0.85}">${initials(name)}</div>`,
    });
  }

  function renderMapMarkers() {
    if (!map) return;
    const all = [];
    // me
    if (me.station || me.lat != null) all.push({ ...me, clientId, __me: true });
    roster.forEach(r => { if (r.clientId !== clientId) all.push(r); });

    const live = new Set();
    all.forEach(m => {
      const p = memberPosition(m);
      if (!p) return;
      live.add(m.clientId);
      const color = m.__me ? '#4f8cff' : lineColor(m.line);
      const label = (m.__me ? m.name + ' (you)' : m.name) +
        (m.station ? ` · ${m.station}` : '') + (p.live ? '' : ' · est.');
      if (markers[m.clientId]) {
        markers[m.clientId].setLatLng(p.pos).setIcon(friendIcon(m.name, color, m.__me, p.live))
          .setTooltipContent(label);
      } else {
        markers[m.clientId] = L.marker(p.pos, { icon: friendIcon(m.name, color, m.__me, p.live), zIndexOffset: 1000 })
          .bindTooltip(label, { direction: 'top', offset: [0, -14] }).addTo(map);
      }
    });
    // remove stale
    Object.keys(markers).forEach(id => {
      if (!live.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
    });
  }

  // ---------- helpers ----------
  function initials(n) { return (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // periodically refresh relative ETAs and glide estimated-position markers
  setInterval(() => { renderFriends(); renderMapMarkers(); }, 5000);
})();
