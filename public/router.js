/* Delhi Metro routing + geo helpers. Works in browser (window.Metro) and Node (module.exports). */
(function (root) {
  'use strict';

  function haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function build(network) {
    const stations = network.stations;
    const byId = Object.fromEntries(stations.map(s => [s.id, s]));

    // adjacency list
    const adj = {};
    stations.forEach(s => (adj[s.id] = []));
    network.edges.forEach(e => {
      adj[e.a].push({ to: e.b, w: e.w, type: e.type, line: e.line });
      adj[e.b].push({ to: e.a, w: e.w, type: e.type, line: e.line });
    });

    // map canonical name -> list of node ids (one per line)
    const nameToIds = {};
    stations.forEach(s => (nameToIds[s.name] ??= []).push(s.id));
    const names = Object.keys(nameToIds).sort();

    function nearest(lat, lng) {
      let best = null, bestD = Infinity;
      for (const s of stations) {
        const d = haversineKm(lat, lng, s.lat, s.lng);
        if (d < bestD) { bestD = d; best = s; }
      }
      return { station: best, km: bestD };
    }

    // Dijkstra from any node named `fromName` to any node named `toName`.
    function route(fromName, toName) {
      const sources = nameToIds[fromName], targets = new Set(nameToIds[toName]);
      if (!sources || !targets.size) return null;
      if (fromName === toName) return { minutes: 0, legs: [], path: [], interchanges: 0 };

      const dist = {}, prev = {}, prevEdge = {};
      const pq = []; // simple binary-less PQ (n is small ~285)
      stations.forEach(s => (dist[s.id] = Infinity));
      sources.forEach(id => { dist[id] = 0; pq.push(id); });

      const visited = new Set();
      while (pq.length) {
        // extract-min
        let bi = 0;
        for (let i = 1; i < pq.length; i++) if (dist[pq[i]] < dist[pq[bi]]) bi = i;
        const u = pq.splice(bi, 1)[0];
        if (visited.has(u)) continue;
        visited.add(u);
        if (targets.has(u)) break;
        for (const e of adj[u]) {
          const nd = dist[u] + e.w;
          if (nd < dist[e.to]) {
            dist[e.to] = nd; prev[e.to] = u; prevEdge[e.to] = e;
            pq.push(e.to);
          }
        }
      }

      // pick best reached target
      let end = null, endD = Infinity;
      targets.forEach(t => { if (dist[t] < endD) { endD = dist[t]; end = t; } });
      if (end == null || endD === Infinity) return null;

      // reconstruct
      const path = [];
      for (let u = end; u != null; u = prev[u]) path.unshift(u);

      // group into legs by line
      const legs = [];
      let cur = null;
      for (let i = 1; i < path.length; i++) {
        const e = prevEdge[path[i]];
        if (e.type === 'transfer') { cur = null; continue; }
        const el = e.line ? e.line.replace(' ring', '') : e.line;
        if (!cur || cur.line !== el) {
          cur = { line: el, from: byId[path[i - 1]].name, to: byId[path[i]].name, stops: 1 };
          legs.push(cur);
        } else { cur.to = byId[path[i]].name; cur.stops++; }
      }
      const interchanges = Math.max(0, legs.length - 1);
      return { minutes: endD, legs, interchanges, path, fromName, toName };
    }

    return { stations, byId, adj, names, nameToIds, nearest, route, haversineKm };
  }

  const api = { build, haversineKm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Metro = api;
})(typeof window !== 'undefined' ? window : globalThis);
