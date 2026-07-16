// Metro Buddy — live location sharing backend
// Express serves the app; Socket.IO keeps each friend group in sync in real time.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, groups: rooms.size }));

// group code -> Map(clientId -> member state)
const rooms = new Map();

function roster(group) {
  const m = rooms.get(group);
  return m ? [...m.values()] : [];
}

io.on('connection', socket => {
  let group = null, clientId = null;

  socket.on('join', ({ group: g, clientId: cid, name }) => {
    group = String(g || '').trim().toLowerCase();
    clientId = String(cid || socket.id);
    if (!group) return;
    socket.join(group);
    if (!rooms.has(group)) rooms.set(group, new Map());
    const prev = rooms.get(group).get(clientId) || {};
    rooms.get(group).set(clientId, {
      clientId, name: name || prev.name || 'Friend',
      station: prev.station || null, line: prev.line || null,
      lat: prev.lat ?? null, lng: prev.lng ?? null,
      target: prev.target || null, updatedAt: Date.now(),
    });
    io.to(group).emit('roster', roster(group));
  });

  // A friend moved / changed their target station
  socket.on('update', payload => {
    if (!group || !rooms.has(group)) return;
    const m = rooms.get(group);
    const cur = m.get(clientId) || { clientId };
    Object.assign(cur, {
      name: payload.name ?? cur.name,
      station: payload.station ?? cur.station,
      line: payload.line ?? cur.line,
      lat: payload.lat ?? cur.lat,
      lng: payload.lng ?? cur.lng,
      target: payload.target !== undefined ? payload.target : cur.target,
      updatedAt: Date.now(),
    });
    m.set(clientId, cur);
    io.to(group).emit('roster', roster(group));
  });

  socket.on('leave', () => cleanup());
  socket.on('disconnect', () => cleanup());

  function cleanup() {
    if (group && rooms.has(group) && clientId) {
      rooms.get(group).delete(clientId);
      if (rooms.get(group).size === 0) rooms.delete(group);
      else io.to(group).emit('roster', roster(group));
    }
  }
});

// Drop members that went silent for >10 min (closed tab without disconnect)
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [g, m] of rooms) {
    for (const [id, mem] of m) if (mem.updatedAt < cutoff) m.delete(id);
    if (m.size === 0) rooms.delete(g);
    else io.to(g).emit('roster', roster(g));
  }
}, 60 * 1000);

server.listen(PORT, () => console.log(`Metro Buddy running on http://localhost:${PORT}`));
