const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const W = 16, H = 16;
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,1,1,0,0,0,0,1,1,0,0,0,1],
  [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
  [1,0,1,0,0,0,0,1,1,0,0,0,0,1,0,1],
  [1,0,1,0,0,0,0,1,1,0,0,0,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,0,0,0,1,1,0,0,0,0,1,0,1],
  [1,0,1,0,0,0,0,1,1,0,0,0,0,1,0,1],
  [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
  [1,0,0,0,1,1,0,0,0,0,1,1,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const SPAWNS = [
  {x:1.5,y:1.5,angle:0.8},
  {x:14.5,y:14.5,angle:3.9},
  {x:1.5,y:14.5,angle:-0.8},
  {x:14.5,y:1.5,angle:2.3},
];

const MAX_HP = 100;
const MOVE_SPEED = 0.055;
const ROT_SPEED = 0.055;
const SHOOT_DAMAGE = 25;
const SHOOT_COOLDOWN = 20;
const RESPAWN_TICKS = 180;
const MAX_KILLS = 10;

let rooms = {};

function createRoom(id) {
  return { id, players: {}, bullets: [], gameOver: false, winner: null, tick: 0 };
}

function findRoom() {
  for (const id in rooms) {
    const r = rooms[id];
    if (!r.gameOver && Object.keys(r.players).length < 4) return id;
  }
  const id = Math.random().toString(36).substr(2,5).toUpperCase();
  rooms[id] = createRoom(id);
  return id;
}

function spawnPlayer(id, slot) {
  const sp = SPAWNS[slot % SPAWNS.length];
  return {
    id, slot,
    x: sp.x, y: sp.y, angle: sp.angle,
    hp: MAX_HP, alive: true,
    respawnTimer: 0,
    kills: 0, deaths: 0,
    shootCooldown: 0,
    name: `Player ${slot + 1}`,
    color: ['#66aaff','#ff6688','#66ffaa','#ffcc44'][slot % 4],
  };
}

function isWall(x, y) {
  const mx = Math.floor(x), my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= W || my >= H) return true;
  return MAP[my][mx] === 1;
}

function movePlayer(p, fwd, strafe, rot) {
  p.angle += rot * ROT_SPEED;
  const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
  const nx = p.x + (cos * fwd - sin * strafe) * MOVE_SPEED;
  const ny = p.y + (sin * fwd + cos * strafe) * MOVE_SPEED;
  if (!isWall(nx, p.y)) p.x = nx;
  if (!isWall(p.x, ny)) p.y = ny;
}

io.on('connection', socket => {
  const roomId = findRoom();
  const room = rooms[roomId];
  const slot = Object.keys(room.players).length;
  socket.join(roomId);
  socket.roomId = roomId;

  const player = spawnPlayer(socket.id, slot);
  room.players[socket.id] = player;

  socket.emit('init', {
    playerId: socket.id, slot, roomId, map: MAP,
    playerCount: Object.keys(room.players).length,
    maxKills: MAX_KILLS,
  });
  io.to(roomId).emit('playerCount', Object.keys(room.players).length);

  socket.on('input', ({ fwd, strafe, rot, shooting }) => {
    const p = room.players[socket.id];
    if (!p || !p.alive) return;
    movePlayer(p, fwd, strafe, rot);
    if (shooting && p.shootCooldown <= 0) {
      p.shootCooldown = SHOOT_COOLDOWN;
      room.bullets.push({
        x: p.x + Math.cos(p.angle) * 0.3,
        y: p.y + Math.sin(p.angle) * 0.3,
        vx: Math.cos(p.angle) * 0.22,
        vy: Math.sin(p.angle) * 0.22,
        owner: socket.id,
        life: 60,
      });
    }
  });

  socket.on('restart', () => {
    if (!room.gameOver) return;
    room.gameOver = false; room.winner = null; room.bullets = [];
    for (const pid in room.players) {
      const s = room.players[pid].slot;
      room.players[pid] = spawnPlayer(pid, s);
    }
    io.to(roomId).emit('restarted');
  });

  socket.on('disconnect', () => {
    delete room.players[socket.id];
    io.to(roomId).emit('playerCount', Object.keys(room.players).length);
    io.to(roomId).emit('playerLeft', socket.id);
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
  });
});

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const players = Object.values(room.players);
    if (players.length === 0 || room.gameOver) continue;
    room.tick++;

    for (const p of players) {
      if (p.shootCooldown > 0) p.shootCooldown--;
      if (!p.alive) {
        p.respawnTimer--;
        if (p.respawnTimer <= 0) {
          const sp = SPAWNS[p.slot % SPAWNS.length];
          p.x = sp.x; p.y = sp.y; p.angle = sp.angle;
          p.hp = MAX_HP; p.alive = true;
        }
      }
    }

    for (const b of room.bullets) {
      b.x += b.vx; b.y += b.vy; b.life--;
      if (isWall(b.x, b.y)) { b.life = 0; continue; }
      for (const p of players) {
        if (!p.alive || p.id === b.owner) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx*dx + dy*dy < 0.18) {
          b.life = 0;
          p.hp -= SHOOT_DAMAGE;
          if (p.hp <= 0) {
            p.alive = false; p.hp = 0; p.deaths++;
            p.respawnTimer = RESPAWN_TICKS;
            const shooter = room.players[b.owner];
            if (shooter) {
              shooter.kills++;
              io.to(roomId).emit('kill', { killer: shooter.name, victim: p.name, killerSlot: shooter.slot });
              if (shooter.kills >= MAX_KILLS) {
                room.gameOver = true;
                room.winner = shooter;
                io.to(roomId).emit('gameOver', { winnerId: shooter.id, winnerName: shooter.name, winnerSlot: shooter.slot });
              }
            }
          }
          io.to(roomId).emit('hit', { victimId: p.id, hp: p.hp });
          break;
        }
      }
    }
    room.bullets = room.bullets.filter(b => b.life > 0);

    const state = {
      players: players.map(p => ({ id:p.id, x:p.x, y:p.y, angle:p.angle, hp:p.hp, alive:p.alive, kills:p.kills, deaths:p.deaths, color:p.color, slot:p.slot, name:p.name, respawnTimer:p.respawnTimer })),
      bullets: room.bullets.map(b => ({ x:b.x, y:b.y, owner:b.owner })),
    };
    io.to(roomId).emit('state', state);
  }
}, 1000/60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`FPS server on port ${PORT}`));
