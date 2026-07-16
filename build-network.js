// Builds public/network.json from data/dmrc.csv
// Station coordinates are overridden from the higher-quality data/archive/*.csv where available.
const fs = require('fs');
const path = require('path');

const AVG_SPEED_KMH = 33;
const DWELL_MIN = 0.4;
const TRANSFER_MIN = 3.5;
const SAME_PLATFORM_MIN = 0.8;

function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = [];
    let cur = '', inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// Canonical station name. Keeps directional qualifiers (East/West/North/South) so
// e.g. Paschim Vihar West and Paschim Vihar East stay distinct, but strips other
// parentheticals ("(First station)", "(MIA)", "(Pragati Maidan)") and [Conn: ...] tags.
function baseName(raw) {
  let n = raw.replace(/\[.*?\]/g, '');
  n = n.replace(/\(\s*(east|west|north|south)[^)]*\)/gi, ' $1');
  n = n.replace(/\([^)]*\)/g, '');
  n = n.replace(/Conn\s*:.*$/i, '').replace(/\s+/g, ' ').trim();
  return n;
}

function cleanLine(l) { return l.replace('Voilet', 'Violet'); }

// Normalised key for matching names across datasets (spelling/spacing insensitive)
const norm = s => s.toLowerCase().replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

const csv = fs.readFileSync(path.join(__dirname, 'data', 'dmrc.csv'), 'utf8');
const rows = parseCSV(csv);

const stations = [];
rows.forEach(r => {
  const [id, name, dist, line, , , lat, lng] = r;
  const la = parseFloat(lat), ln = parseFloat(lng);
  if (isNaN(la) || isNaN(ln) || la < 27.5 || la > 29.5 || ln < 76.5 || ln > 78) return;
  stations.push({ id: 's' + id, name: baseName(name), raw: name, line: cleanLine(line), dist: parseFloat(dist), lat: la, lng: ln });
});

// --- Override coordinates from the archive dataset where names match ---
const archDir = path.join(__dirname, 'data', 'archive');
const archive = {};
if (fs.existsSync(archDir)) {
  for (const f of fs.readdirSync(archDir).filter(f => f.endsWith('.csv'))) {
    for (const c of parseCSV(fs.readFileSync(path.join(archDir, f), 'utf8'))) {
      const nm = c[0], la = parseFloat(c[2]), ln = parseFloat(c[3]);
      if (nm && !isNaN(la) && !isNaN(ln)) archive[norm(nm)] = { lat: la, lng: ln };
    }
  }
}
let overridden = 0;
stations.forEach(s => {
  const a = archive[norm(s.name)];
  if (a) { s.lat = a.lat; s.lng = a.lng; overridden++; }
});

const edges = [];
const addEdge = (a, b, w, type, line) => edges.push({ a, b, w: Math.round(w * 100) / 100, type, line });

// 1) Ride edges along each line
const lineGroups = {};
stations.forEach(s => (lineGroups[s.line] ??= []).push(s));
Object.values(lineGroups).forEach(group => {
  group.sort((a, b) => a.dist - b.dist);
  for (let i = 1; i < group.length; i++) {
    const p = group[i - 1], q = group[i];
    let km = Math.abs(q.dist - p.dist);
    if (!(km > 0.05 && km < 6)) km = Math.max(haversineKm(p, q), 0.6);
    addEdge(p.id, q.id, km / AVG_SPEED_KMH * 60 + DWELL_MIN, 'ride', p.line);
  }
});

// 1b) Manual ride edges to close loops/branches the linear model can't express
const MANUAL_EDGES = [
  { a: 'Majlis Park', b: 'Burari', line: 'Pink line' },
  { a: 'Yamuna Vihar', b: 'Maujpur', line: 'Pink line' },
];
const findByName = n => stations.find(s => s.name === n);
MANUAL_EDGES.forEach(({ a, b, line }) => {
  const sa = findByName(a), sb = findByName(b);
  if (!sa || !sb) { console.warn('manual edge skipped, missing:', a, b); return; }
  addEdge(sa.id, sb.id, haversineKm(sa, sb) / AVG_SPEED_KMH * 60 + DWELL_MIN, 'ride', line);
});

// 2) Interchange edges: stations sharing a base name
const nameGroups = {};
stations.forEach(s => (nameGroups[s.name] ??= []).push(s));
Object.values(nameGroups).forEach(group => {
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++) {
      const km = haversineKm(group[i], group[j]);
      const w = km < 0.25 ? SAME_PLATFORM_MIN : TRANSFER_MIN;
      addEdge(group[i].id, group[j].id, w, 'transfer', null);
    }
});

const out = {
  generatedAt: new Date().toISOString(),
  stations: stations.map(({ id, name, raw, line, lat, lng }) => ({ id, name, raw, line, lat, lng })),
  edges,
};
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'network.json'), JSON.stringify(out));

const lineCounts = {};
stations.forEach(s => (lineCounts[s.line] = (lineCounts[s.line] || 0) + 1));
console.log('Stations:', stations.length, '| Edges:', edges.length, '| Unique names:', Object.keys(nameGroups).length);
console.log('Coords overridden from archive:', overridden, '/', stations.length);
console.log('Lines:', lineCounts);
