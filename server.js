const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

// ── Map: 0=open, 1=wall ──────────────────────────────────────────────────────
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,1],
  [1,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,1,1,0,0,0,0,0,1,1,0,0,0,0,0,1],
  [1,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1],
  [1,0,0,0,0,1,1,0,0,0,0,0,1,1,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1],
  [1,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
const ROWS = MAP.length, COLS = MAP[0].length;
const CELL = 4; // world units per cell

const SPAWNS = [
  {x:1.5*CELL, z:1.5*CELL, ry:0},
  {x:18.5*CELL, z:18.5*CELL, ry:Math.PI},
  {x:18.5*CELL, z:1.5*CELL, ry:-Math.PI/2},
  {x:1.5*CELL, z:18.5*CELL, ry:Math.PI/2},
];

const TICK_RATE = 60;
const MOVE_SPEED = 0.18;
const BULLET_SPEED = 0.55;
const BULLET_LIFE = 80;
const HP = 100;
const DAMAGE = 34;
const RESPAWN_TICKS = 180;
const MAX_KILLS = 10;
const PLAYER_R = 0.8;
const BULLET_R = 0.35;

let rooms = {};

function isWall(x, z) {
  const col = Math.floor(x / CELL), row = Math.floor(z / CELL);
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
  return MAP[row][col] === 1;
}

function wallSlide(x, z, nx, nz, r) {
  const ox = isWall(nx, z) ? x : nx;
  const oz = isWall(ox, nz) ? z : nz;
  return [ox, oz];
}

function makePlayer(id, slot) {
  const sp = SPAWNS[slot % SPAWNS.length];
  return { id, slot, x: sp.x, z: sp.z, ry: sp.ry,
    hp: HP, alive: true, respawnTimer: 0,
    kills: 0, deaths: 0, fireCooldown: 0,
    color: ['#4488ff','#ff4466','#44ffaa','#ffbb22'][slot%4],
    name: `Player ${slot+1}` };
}

function findRoom() {
  for (const id in rooms)
    if (Object.keys(rooms[id].players).length < 4 && !rooms[id].gameOver) return id;
  const id = Math.random().toString(36).substr(2,5).toUpperCase();
  rooms[id] = { id, players:{}, bullets:[], gameOver:false, tick:0 };
  return id;
}

io.on('connection', socket => {
  const roomId = findRoom();
  const room = rooms[roomId];
  const slot = Object.keys(room.players).length;
  socket.join(roomId); socket.roomId = roomId;
  room.players[socket.id] = makePlayer(socket.id, slot);

  socket.emit('init', { playerId: socket.id, slot, roomId, map: MAP, cell: CELL, maxKills: MAX_KILLS, spawns: SPAWNS });
  io.to(roomId).emit('playerCount', Object.keys(room.players).length);

  socket.on('input', ({ fwd, right, ry, shooting }) => {
    const p = room.players[socket.id];
    if (!p || !p.alive) return;
    p.ry = ry;
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const dx = (cos * fwd + sin * right) * MOVE_SPEED;
    const dz = (-sin * fwd + cos * right) * MOVE_SPEED;  // fixed strafe
    const [nx, nz] = wallSlide(p.x, p.z, p.x + dx, p.z + dz, PLAYER_R);
    p.x = nx; p.z = nz;
    if (p.fireCooldown > 0) p.fireCooldown--;
    if (shooting && p.fireCooldown <= 0) {
      p.fireCooldown = 12;
      room.bullets.push({
        id: Math.random().toString(36).substr(2,6),
        x: p.x + cos * 1.0, z: p.z - sin * 1.0,
        vx: cos * BULLET_SPEED, vz: -sin * BULLET_SPEED,
        owner: socket.id, life: BULLET_LIFE
      });
    }
  });

  socket.on('restart', () => {
    if (!room.gameOver) return;
    room.gameOver = false; room.bullets = [];
    for (const pid in room.players) {
      const s = room.players[pid].slot;
      room.players[pid] = makePlayer(pid, s);
    }
    io.to(roomId).emit('restarted');
  });

  socket.on('disconnect', () => {
    delete room.players[socket.id];
    io.to(roomId).emit('playerLeft', socket.id);
    io.to(roomId).emit('playerCount', Object.keys(room.players).length);
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
  });
});

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.gameOver) continue;
    const players = Object.values(room.players);
    if (players.length === 0) continue;
    room.tick++;

    for (const p of players) {
      if (!p.alive) { if (--p.respawnTimer <= 0) { Object.assign(p, makePlayer(p.id, p.slot)); } }
    }

    for (const b of room.bullets) {
      b.x += b.vx; b.z += b.vz; b.life--;
      if (b.life <= 0 || isWall(b.x, b.z)) { b.life = 0; continue; }
      for (const p of players) {
        if (!p.alive || p.id === b.owner) continue;
        const dx = p.x - b.x, dz = p.z - b.z;
        if (dx*dx + dz*dz < (PLAYER_R + BULLET_R) ** 2) {
          b.life = 0; p.hp -= DAMAGE;
          io.to(roomId).emit('hit', { victimId: p.id, hp: p.hp, shooterId: b.owner });
          if (p.hp <= 0) {
            p.alive = false; p.hp = 0; p.deaths++; p.respawnTimer = RESPAWN_TICKS;
            const s = room.players[b.owner];
            if (s) {
              s.kills++;
              io.to(roomId).emit('kill', { killerName: s.name, victimName: p.name, killerSlot: s.slot });
              if (s.kills >= MAX_KILLS) {
                room.gameOver = true;
                io.to(roomId).emit('gameOver', { winnerId: s.id, winnerName: s.name, winnerSlot: s.slot });
              }
            }
          }
          break;
        }
      }
    }
    room.bullets = room.bullets.filter(b => b.life > 0);

    io.to(roomId).emit('state', {
      players: players.map(p => ({ id:p.id, x:p.x, z:p.z, ry:p.ry, hp:p.hp, alive:p.alive, kills:p.kills, deaths:p.deaths, color:p.color, slot:p.slot, name:p.name, respawnTimer:p.respawnTimer })),
      bullets: room.bullets.map(b => ({ id:b.id, x:b.x, z:b.z })),
    });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Three.js FPS server on port ${PORT}`));
