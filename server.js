/**
 * Thrones Monopoly — Server
 * ---------------------------------------------------------------------------
 * Authoritative game server. Every rule (turn order, dice, rent, building,
 * jail, bankruptcy) is decided here; clients only render state and send
 * intents. Rooms live in memory (Map), keyed by a 4-character room code.
 *
 * Sections:
 *   1. Setup (express, http, socket.io, cors)
 *   2. Board & card data
 *   3. Room store + helpers
 *   4. Game rules (movement, rent, buildings, jail, bankruptcy)
 *   5. Socket event handlers
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 1. Setup
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;

// Comma-separated list of allowed origins, e.g.
// "https://yourname.github.io,http://localhost:5500"
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',')
  .map((s) => s.trim());

const corsOptions = {
  origin(origin, callback) {
    // Allow same-origin / curl / server-to-server requests with no origin header.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not permitted by CORS policy`));
  },
  methods: ['GET', 'POST'],
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptimeSeconds: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// ---------------------------------------------------------------------------
// 2. Board & card data
// ---------------------------------------------------------------------------

const TILE_TYPES = {
  GO: 'go',
  PROPERTY: 'property',
  RAILROAD: 'railroad',
  UTILITY: 'utility',
  TAX: 'tax',
  CHANCE: 'chance',
  CHEST: 'chest',
  JAIL: 'jail',
  FREE_PARKING: 'free_parking',
  GO_TO_JAIL: 'go_to_jail',
};

// Color used by the client to tint each region's tiles / house banners.
const GROUP_COLORS = {
  north: '#5c6b73',
  wall: '#8fd9e0',
  riverlands: '#c0577a',
  reach: '#d69a2d',
  dorne: '#d1592a',
  westerlands: '#a8862e',
  vale: '#4f7fae',
  crownlands: '#5b4a86',
};

const GO_SALARY = 200;
const JAIL_FINE = 50;
const STARTING_BALANCE = 1500;
const MAX_HOUSES_PER_PROPERTY = 4; // a 5th level upgrades to a Castle (hotel)
const HOUSE_SUPPLY_TOTAL = 32;
const CASTLE_SUPPLY_TOTAL = 12;

/**
 * 40 tiles, indices 0-39, matching classic Monopoly's structural layout
 * (8 color groups / 4 railroads / 2 utilities / 3 tax-or-corner specials)
 * re-skinned as the geography of Westeros.
 */
const BOARD = [
  { id: 0, type: TILE_TYPES.GO, name: 'The Iron Throne' },
  { id: 1, type: TILE_TYPES.PROPERTY, name: 'Winterfell', group: 'north', price: 60, houseCost: 50 },
  { id: 2, type: TILE_TYPES.CHEST, name: 'A Debt Must Be Paid' },
  { id: 3, type: TILE_TYPES.PROPERTY, name: 'Winter Town', group: 'north', price: 60, houseCost: 50 },
  { id: 4, type: TILE_TYPES.TAX, name: "The Crown's Tax", amount: 200 },
  { id: 5, type: TILE_TYPES.RAILROAD, name: "King's Road: White Harbor Docks", price: 200 },
  { id: 6, type: TILE_TYPES.PROPERTY, name: 'The Wall', group: 'wall', price: 100, houseCost: 50 },
  { id: 7, type: TILE_TYPES.CHANCE, name: 'Valar Morghulis' },
  { id: 8, type: TILE_TYPES.PROPERTY, name: 'Castle Black', group: 'wall', price: 100, houseCost: 50 },
  { id: 9, type: TILE_TYPES.PROPERTY, name: 'Eastwatch-by-the-Sea', group: 'wall', price: 120, houseCost: 50 },
  { id: 10, type: TILE_TYPES.JAIL, name: 'The Black Cells' },
  { id: 11, type: TILE_TYPES.PROPERTY, name: 'Riverrun', group: 'riverlands', price: 140, houseCost: 100 },
  { id: 12, type: TILE_TYPES.UTILITY, name: "The Citadel's Raven", price: 150 },
  { id: 13, type: TILE_TYPES.PROPERTY, name: 'The Twins', group: 'riverlands', price: 140, houseCost: 100 },
  { id: 14, type: TILE_TYPES.PROPERTY, name: 'Harrenhal', group: 'riverlands', price: 160, houseCost: 100 },
  { id: 15, type: TILE_TYPES.RAILROAD, name: "King's Road: Riverrun Crossing", price: 200 },
  { id: 16, type: TILE_TYPES.PROPERTY, name: 'Highgarden', group: 'reach', price: 180, houseCost: 100 },
  { id: 17, type: TILE_TYPES.CHEST, name: 'A Debt Must Be Paid' },
  { id: 18, type: TILE_TYPES.PROPERTY, name: 'Oldtown', group: 'reach', price: 180, houseCost: 100 },
  { id: 19, type: TILE_TYPES.PROPERTY, name: 'The Arbor', group: 'reach', price: 200, houseCost: 100 },
  { id: 20, type: TILE_TYPES.FREE_PARKING, name: 'The Great Hall Feast' },
  { id: 21, type: TILE_TYPES.PROPERTY, name: 'Sunspear', group: 'dorne', price: 220, houseCost: 150 },
  { id: 22, type: TILE_TYPES.CHANCE, name: 'Valar Morghulis' },
  { id: 23, type: TILE_TYPES.PROPERTY, name: 'The Water Gardens', group: 'dorne', price: 220, houseCost: 150 },
  { id: 24, type: TILE_TYPES.PROPERTY, name: 'The Boneway', group: 'dorne', price: 240, houseCost: 150 },
  { id: 25, type: TILE_TYPES.RAILROAD, name: "King's Road: Sunspear Docks", price: 200 },
  { id: 26, type: TILE_TYPES.PROPERTY, name: 'Casterly Rock', group: 'westerlands', price: 260, houseCost: 150 },
  { id: 27, type: TILE_TYPES.PROPERTY, name: 'Lannisport', group: 'westerlands', price: 260, houseCost: 150 },
  { id: 28, type: TILE_TYPES.UTILITY, name: "The Old Gods' Weirwood", price: 150 },
  { id: 29, type: TILE_TYPES.PROPERTY, name: 'The Golden Tooth', group: 'westerlands', price: 280, houseCost: 150 },
  { id: 30, type: TILE_TYPES.GO_TO_JAIL, name: 'Beyond the Wall' },
  { id: 31, type: TILE_TYPES.PROPERTY, name: 'The Eyrie', group: 'vale', price: 300, houseCost: 200 },
  { id: 32, type: TILE_TYPES.PROPERTY, name: 'Gates of the Moon', group: 'vale', price: 300, houseCost: 200 },
  { id: 33, type: TILE_TYPES.CHEST, name: 'A Debt Must Be Paid' },
  { id: 34, type: TILE_TYPES.PROPERTY, name: 'Runestone', group: 'vale', price: 320, houseCost: 200 },
  { id: 35, type: TILE_TYPES.RAILROAD, name: "King's Road: Eyrie Ascent", price: 200 },
  { id: 36, type: TILE_TYPES.CHANCE, name: 'Valar Morghulis' },
  { id: 37, type: TILE_TYPES.PROPERTY, name: 'Dragonstone', group: 'crownlands', price: 350, houseCost: 200 },
  { id: 38, type: TILE_TYPES.TAX, name: "Master of Coin's Levy", amount: 100 },
  { id: 39, type: TILE_TYPES.PROPERTY, name: "King's Landing", group: 'crownlands', price: 400, houseCost: 200 },
];

const GROUP_TILE_IDS = BOARD.reduce((acc, tile) => {
  if (tile.type === TILE_TYPES.PROPERTY) {
    acc[tile.group] = acc[tile.group] || [];
    acc[tile.group].push(tile.id);
  }
  return acc;
}, {});

const CHANCE_CARDS = [
  { text: 'The Iron Bank calls in a favor. Collect 50 Gold Dragons.', action: 'COLLECT', amount: 50 },
  { text: "You've been named Hand of the King. Collect 150 Gold Dragons.", action: 'COLLECT', amount: 150 },
  { text: 'Advance to The Iron Throne. Collect 200 Gold Dragons as you pass.', action: 'ADVANCE_TO', tileId: 0 },
  { text: "A raven summons you to King's Landing.", action: 'ADVANCE_TO', tileId: 39 },
  { text: 'Winter is coming. Advance directly to Winterfell.', action: 'ADVANCE_TO', tileId: 1 },
  { text: "A dragon's shadow crosses the field. Go directly to the Black Cells.", action: 'GO_TO_JAIL' },
  { text: 'You have been granted a pardon. Get out of the Black Cells free. Keep this card.', action: 'JAIL_FREE_CARD' },
  { text: 'Pay for repairs to the Kingsroad: 25 Gold Dragons per Keep, 100 per Castle.', action: 'REPAIRS', perHouse: 25, perCastle: 100 },
  { text: 'The smallfolk riot in your name. Pay each other player 20 Gold Dragons.', action: 'PAY_EACH_PLAYER', amount: 20 },
  { text: 'A tourney is held in your honor. Collect 10 Gold Dragons from each player.', action: 'COLLECT_FROM_EACH', amount: 10 },
];

const CHEST_CARDS = [
  { text: 'The Maester audits your ledger. Collect 200 Gold Dragons.', action: 'COLLECT', amount: 200 },
  { text: "You've inherited a modest holdfast. Collect 100 Gold Dragons.", action: 'COLLECT', amount: 100 },
  { text: "A physician's fee is owed. Pay 50 Gold Dragons.", action: 'PAY', amount: 50 },
  { text: "You've won a jousting wager! Collect 100 Gold Dragons.", action: 'COLLECT', amount: 100 },
  { text: "Pay the Citadel's chain fee: 100 Gold Dragons.", action: 'PAY', amount: 100 },
  { text: 'A hostage is ransomed to you. Collect 25 Gold Dragons from each player.', action: 'COLLECT_FROM_EACH', amount: 25 },
  { text: 'You have been imprisoned by the Faith Militant. Go directly to the Black Cells.', action: 'GO_TO_JAIL' },
  { text: 'A pardon scroll bearing the royal seal. Get out of the Black Cells free. Keep this card.', action: 'JAIL_FREE_CARD' },
  { text: 'Advance to The Iron Throne. Collect 200 Gold Dragons as you pass.', action: 'ADVANCE_TO', tileId: 0 },
  { text: "It is a season of plenty. Collect 50 Gold Dragons from the Great Hall Feast pool.", action: 'COLLECT', amount: 50 },
];

const HOUSE_SIGILS = ['Stark', 'Lannister', 'Targaryen', 'Baratheon', 'Tyrell', 'Martell', 'Arryn', 'Greyjoy'];

// ---------------------------------------------------------------------------
// 3. Room store + helpers
// ---------------------------------------------------------------------------

/** @type {Map<string, Room>} */
const rooms = new Map();

const RECONNECT_GRACE_MS = 30 * 1000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createPlayer({ name, house, token }) {
  return {
    id: crypto.randomUUID(),
    name: name.slice(0, 20),
    house,
    token,
    socketId: null,
    connected: true,
    position: 0,
    balance: STARTING_BALANCE,
    properties: [], // tile ids owned
    getOutOfJailFreeCards: 0,
    inJail: false,
    jailTurns: 0,
    bankrupt: false,
  };
}

function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: null, // set once the host's player object exists
    players: [],
    turnOrder: [],
    currentTurnIndex: 0,
    phase: 'lobby', // 'lobby' | 'in-progress' | 'ended'
    doublesStreak: 0,
    lastRoll: null,
    pendingPurchase: null, // tileId awaiting a buy/decline decision
    buildings: {}, // tileId -> house count (1-4) or 5 for castle
    mortgaged: new Set(),
    houseSupply: HOUSE_SUPPLY_TOTAL,
    castleSupply: CASTLE_SUPPLY_TOTAL,
    log: [],
    disconnectTimers: new Map(), // playerId -> Timeout
    emptyRoomTimer: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function addLog(room, message) {
  room.log.push({ message, ts: Date.now() });
  if (room.log.length > 150) room.log.shift();
}

function getActivePlayers(room) {
  return room.turnOrder.map((id) => room.players.find((p) => p.id === id)).filter((p) => p && !p.bankrupt);
}

function currentPlayer(room) {
  if (room.phase !== 'in-progress') return null;
  const id = room.turnOrder[room.currentTurnIndex];
  return room.players.find((p) => p.id === id) || null;
}

function ownerOf(room, tileId) {
  return room.players.find((p) => p.properties.includes(tileId)) || null;
}

function ownsFullGroup(room, player, group) {
  if (!player) return false;
  const tileIds = GROUP_TILE_IDS[group] || [];
  return tileIds.length > 0 && tileIds.every((id) => player.properties.includes(id));
}

function countOwnedOfType(room, player, type) {
  if (!player) return 0;
  return player.properties.filter((id) => BOARD[id].type === type).length;
}

/** Serializes a room for broadcast, converting the mortgaged Set to an array. */
function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ ...p }) => p),
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    phase: room.phase,
    lastRoll: room.lastRoll,
    pendingPurchase: room.pendingPurchase,
    buildings: room.buildings,
    mortgaged: Array.from(room.mortgaged),
    houseSupply: room.houseSupply,
    castleSupply: room.castleSupply,
    log: room.log.slice(-40),
    board: BOARD,
    groupColors: GROUP_COLORS,
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', serializeRoom(room));
}

function scheduleEmptyRoomCleanup(room) {
  if (room.emptyRoomTimer) clearTimeout(room.emptyRoomTimer);
  room.emptyRoomTimer = setTimeout(() => {
    const anyConnected = room.players.some((p) => p.connected);
    if (!anyConnected) rooms.delete(room.code);
  }, EMPTY_ROOM_TTL_MS);
}

// ---------------------------------------------------------------------------
// 4. Game rules
// ---------------------------------------------------------------------------

function calculateRent(room, tile, diceTotal) {
  const owner = ownerOf(room, tile.id);
  if (!owner || room.mortgaged.has(tile.id)) return 0;

  if (tile.type === TILE_TYPES.RAILROAD) {
    const owned = countOwnedOfType(room, owner, TILE_TYPES.RAILROAD);
    return 25 * Math.pow(2, owned - 1); // 25 / 50 / 100 / 200
  }

  if (tile.type === TILE_TYPES.UTILITY) {
    const owned = countOwnedOfType(room, owner, TILE_TYPES.UTILITY);
    return diceTotal * (owned >= 2 ? 10 : 4);
  }

  // Standard property: rent scales with price, houses, and monopoly status.
  const baseRent = Math.round(tile.price * 0.1);
  const houses = room.buildings[tile.id] || 0;
  if (houses === 0) {
    const monopoly = ownsFullGroup(room, owner, tile.group);
    return monopoly ? baseRent * 2 : baseRent;
  }
  if (houses <= MAX_HOUSES_PER_PROPERTY) {
    return baseRent * (houses + 1) * 1.5; // Small Keeps
  }
  return baseRent * 10; // Imposing Castle (houses === 5)
}

/** Moves a player forward by `steps` tiles, paying GO salary on wraparound. */
function movePlayer(room, player, steps) {
  const previous = player.position;
  player.position = (player.position + steps) % BOARD.length;
  if (player.position < previous) {
    player.balance += GO_SALARY;
    addLog(room, `${player.name} passes The Iron Throne and collects ${GO_SALARY} Gold Dragons.`);
  }
}

function sendToJail(room, player) {
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  addLog(room, `${player.name} is dragged to the Black Cells.`);
}

/**
 * Deducts `amount` from a player's balance. If they can't cover it, they're
 * declared bankrupt: their properties/buildings are released (to the
 * creditor if one is given, otherwise back to the bank) and they're removed
 * from the turn order but remain connected as a spectator.
 */
function chargePlayer(room, player, amount, creditor = null) {
  player.balance -= amount;
  if (player.balance >= 0) return;

  // Simple liquidation policy for a real-time game: sell all buildings at
  // half their cost, then hand remaining assets to the creditor (or the
  // bank) and mark bankrupt if the player still can't cover the debt.
  for (const tileId of player.properties) {
    const houses = room.buildings[tileId] || 0;
    if (houses > 0) {
      const tile = BOARD[tileId];
      const refund = houses <= MAX_HOUSES_PER_PROPERTY ? (tile.houseCost / 2) * houses : (tile.houseCost / 2) * 5;
      player.balance += refund;
      room.houseSupply += Math.min(houses, MAX_HOUSES_PER_PROPERTY);
      if (houses > MAX_HOUSES_PER_PROPERTY) room.castleSupply += 1;
      delete room.buildings[tileId];
    }
  }

  if (player.balance < 0) {
    player.bankrupt = true;
    addLog(room, `${player.name} has been declared bankrupt and is out of the game.`);
    for (const tileId of player.properties) {
      room.mortgaged.delete(tileId);
      if (creditor) {
        creditor.properties.push(tileId);
      }
    }
    player.properties = [];
    player.balance = 0;
    room.turnOrder = room.turnOrder.filter((id) => id !== player.id);
    checkForGameOver(room);
  }
}

function checkForGameOver(room) {
  const remaining = getActivePlayers(room);
  if (remaining.length === 1 && room.phase === 'in-progress') {
    room.phase = 'ended';
    addLog(room, `${remaining[0].name} rules the Seven Kingdoms. Victory!`);
  }
}

function drawCard(deck) {
  return deck[crypto.randomInt(deck.length)];
}

function applyCardEffect(room, player, card) {
  addLog(room, `${player.name} draws: "${card.text}"`);
  switch (card.action) {
    case 'COLLECT':
      player.balance += card.amount;
      break;
    case 'PAY':
      chargePlayer(room, player, card.amount);
      break;
    case 'ADVANCE_TO':
      movePlayer(room, player, (card.tileId - player.position + BOARD.length) % BOARD.length);
      resolveTileLanding(room, player, room.lastRoll?.total ?? 0);
      break;
    case 'GO_TO_JAIL':
      sendToJail(room, player);
      break;
    case 'JAIL_FREE_CARD':
      player.getOutOfJailFreeCards += 1;
      break;
    case 'REPAIRS': {
      let total = 0;
      for (const tileId of player.properties) {
        const houses = room.buildings[tileId] || 0;
        total += houses <= MAX_HOUSES_PER_PROPERTY ? houses * card.perHouse : card.perCastle;
      }
      if (total > 0) chargePlayer(room, player, total);
      break;
    }
    case 'PAY_EACH_PLAYER':
      for (const other of getActivePlayers(room)) {
        if (other.id === player.id) continue;
        chargePlayer(room, player, card.amount, other);
        other.balance += card.amount;
      }
      break;
    case 'COLLECT_FROM_EACH':
      for (const other of getActivePlayers(room)) {
        if (other.id === player.id) continue;
        chargePlayer(room, other, card.amount, player);
        player.balance += card.amount;
      }
      break;
    default:
      break;
  }
}

/** Resolves whatever tile a player has just landed on. */
function resolveTileLanding(room, player, diceTotal) {
  const tile = BOARD[player.position];

  switch (tile.type) {
    case TILE_TYPES.TAX:
      chargePlayer(room, player, tile.amount);
      addLog(room, `${player.name} pays ${tile.amount} Gold Dragons in tribute at ${tile.name}.`);
      break;
    case TILE_TYPES.GO_TO_JAIL:
      sendToJail(room, player);
      break;
    case TILE_TYPES.CHANCE:
      applyCardEffect(room, player, drawCard(CHANCE_CARDS));
      break;
    case TILE_TYPES.CHEST:
      applyCardEffect(room, player, drawCard(CHEST_CARDS));
      break;
    case TILE_TYPES.PROPERTY:
    case TILE_TYPES.RAILROAD:
    case TILE_TYPES.UTILITY: {
      const owner = ownerOf(room, tile.id);
      if (!owner) {
        room.pendingPurchase = tile.id;
        addLog(room, `${player.name} lands on ${tile.name} — unclaimed.`);
      } else if (owner.id !== player.id) {
        const rent = calculateRent(room, tile, diceTotal);
        if (rent > 0) {
          chargePlayer(room, player, rent, owner);
          owner.balance += rent;
          addLog(room, `${player.name} pays ${rent} Gold Dragons in rent to ${owner.name} at ${tile.name}.`);
        }
      }
      break;
    }
    case TILE_TYPES.GO:
    case TILE_TYPES.JAIL:
    case TILE_TYPES.FREE_PARKING:
    default:
      break;
  }
}

function advanceTurn(room) {
  room.pendingPurchase = null;
  room.doublesStreak = 0;
  if (room.turnOrder.length === 0) return;
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
}

// ---------------------------------------------------------------------------
// 5. Socket event handlers
// ---------------------------------------------------------------------------

/** Wraps a handler so turn-restricted actions can't be spoofed by other players. */
function requireCurrentPlayer(socket, room) {
  const player = currentPlayer(room);
  if (!player || player.socketId !== socket.id) return null;
  return player;
}

function requireOwner(room, socket, tileId) {
  const player = room.players.find((p) => p.socketId === socket.id);
  if (!player || !player.properties.includes(tileId)) return null;
  return player;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName, house }, callback) => {
    if (!playerName || typeof playerName !== 'string') {
      return callback?.({ error: 'A player name is required.' });
    }
    const room = createRoom(socket.id);
    const player = createPlayer({ name: playerName, house: house || HOUSE_SIGILS[0], token: 0 });
    player.socketId = socket.id;
    room.hostId = player.id;
    room.players.push(player);
    room.turnOrder.push(player.id);

    socket.join(room.code);
    addLog(room, `${player.name} has founded the game as House ${player.house}.`);
    callback?.({ roomCode: room.code, playerId: player.id });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ roomCode, playerName, house, rejoinPlayerId }, callback) => {
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return callback?.({ error: 'That room code does not exist.' });

    // Reconnection path: same playerId rejoining an in-progress or lobby room.
    if (rejoinPlayerId) {
      const existing = room.players.find((p) => p.id === rejoinPlayerId);
      if (existing) {
        const timer = room.disconnectTimers.get(existing.id);
        if (timer) {
          clearTimeout(timer);
          room.disconnectTimers.delete(existing.id);
        }
        existing.socketId = socket.id;
        existing.connected = true;
        socket.join(room.code);
        addLog(room, `${existing.name} has returned to the game.`);
        callback?.({ roomCode: room.code, playerId: existing.id });
        broadcastRoom(room);
        return;
      }
    }

    if (room.phase !== 'lobby') return callback?.({ error: 'That game has already begun.' });
    if (room.players.length >= 8) return callback?.({ error: 'This room is full (8 players max).' });
    if (!playerName || typeof playerName !== 'string') {
      return callback?.({ error: 'A player name is required.' });
    }

    const player = createPlayer({ name: playerName, house: house || HOUSE_SIGILS[room.players.length % HOUSE_SIGILS.length], token: room.players.length });
    player.socketId = socket.id;
    room.players.push(player);
    room.turnOrder.push(player.id);

    socket.join(room.code);
    addLog(room, `${player.name} has joined as House ${player.house}.`);
    callback?.({ roomCode: room.code, playerId: player.id });
    broadcastRoom(room);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const requester = room.players.find((p) => p.socketId === socket.id);
    if (!requester || requester.id !== room.hostId) return;
    if (room.players.length < 2) return;

    // Shuffle turn order (Fisher-Yates) so the host doesn't always go first.
    for (let i = room.turnOrder.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [room.turnOrder[i], room.turnOrder[j]] = [room.turnOrder[j], room.turnOrder[i]];
    }
    room.phase = 'in-progress';
    room.currentTurnIndex = 0;
    addLog(room, 'The game begins. Fortune favors the bold.');
    broadcastRoom(room);
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player || room.pendingPurchase !== null) return;

    const d1 = 1 + crypto.randomInt(6);
    const d2 = 1 + crypto.randomInt(6);
    const isDoubles = d1 === d2;
    room.lastRoll = { d1, d2, total: d1 + d2, isDoubles };

    if (player.inJail) {
      if (isDoubles) {
        player.inJail = false;
        player.jailTurns = 0;
        addLog(room, `${player.name} rolls doubles and breaks free from the Black Cells.`);
        movePlayer(room, player, d1 + d2);
        resolveTileLanding(room, player, d1 + d2);
      } else {
        player.jailTurns += 1;
        addLog(room, `${player.name} fails to roll doubles (${player.jailTurns}/3).`);
        if (player.jailTurns >= 3) {
          chargePlayer(room, player, JAIL_FINE);
          player.inJail = false;
          player.jailTurns = 0;
          addLog(room, `${player.name} pays the ${JAIL_FINE} Gold Dragon fine and is released.`);
          movePlayer(room, player, d1 + d2);
          resolveTileLanding(room, player, d1 + d2);
        }
      }
      broadcastRoom(room);
      return;
    }

    if (isDoubles) {
      room.doublesStreak += 1;
      if (room.doublesStreak === 3) {
        addLog(room, `${player.name} rolls doubles three times running — thrown in the Black Cells for cheating.`);
        sendToJail(room, player);
        room.doublesStreak = 0;
        broadcastRoom(room);
        return;
      }
    }

    movePlayer(room, player, d1 + d2);
    resolveTileLanding(room, player, d1 + d2);
    broadcastRoom(room);
  });

  socket.on('buyProperty', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.pendingPurchase === null) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player) return;

    const tile = BOARD[room.pendingPurchase];
    if (player.balance < tile.price) return;
    player.balance -= tile.price;
    player.properties.push(tile.id);
    addLog(room, `${player.name} purchases ${tile.name} for ${tile.price} Gold Dragons.`);
    room.pendingPurchase = null;
    broadcastRoom(room);
  });

  socket.on('declineProperty', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.pendingPurchase === null) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player) return;
    const tile = BOARD[room.pendingPurchase];
    addLog(room, `${player.name} declines to purchase ${tile.name}.`);
    room.pendingPurchase = null;
    broadcastRoom(room);
  });

  socket.on('buildKeep', ({ roomCode, tileId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    const owner = requireOwner(room, socket, tileId);
    if (!player || !owner || owner.id !== player.id) return;

    const tile = BOARD[tileId];
    if (tile.type !== TILE_TYPES.PROPERTY || !ownsFullGroup(room, player, tile.group)) return;
    const current = room.buildings[tileId] || 0;
    if (current >= 5) return; // already a Castle

    // Even-building rule: can't add to this property until siblings in the
    // same group are at least at the same house count.
    const siblings = GROUP_TILE_IDS[tile.group];
    const minSiblingHouses = Math.min(...siblings.map((id) => room.buildings[id] || 0));
    if (current > minSiblingHouses) return;

    const isCastleUpgrade = current === MAX_HOUSES_PER_PROPERTY;
    if (isCastleUpgrade) {
      if (room.castleSupply <= 0 || player.balance < tile.houseCost) return;
      room.houseSupply += MAX_HOUSES_PER_PROPERTY; // 4 keeps return to the bank
      room.castleSupply -= 1;
    } else {
      if (room.houseSupply <= 0 || player.balance < tile.houseCost) return;
      room.houseSupply -= 1;
    }

    player.balance -= tile.houseCost;
    room.buildings[tileId] = current + 1;
    addLog(room, `${player.name} builds ${isCastleUpgrade ? 'an Imposing Castle' : 'a Small Keep'} on ${tile.name}.`);
    broadcastRoom(room);
  });

  socket.on('mortgageProperty', ({ roomCode, tileId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    const owner = requireOwner(room, socket, tileId);
    if (!player || !owner || owner.id !== player.id) return;
    if (room.mortgaged.has(tileId) || (room.buildings[tileId] || 0) > 0) return;

    const tile = BOARD[tileId];
    room.mortgaged.add(tileId);
    player.balance += Math.round(tile.price / 2);
    addLog(room, `${player.name} mortgages ${tile.name}.`);
    broadcastRoom(room);
  });

  socket.on('unmortgageProperty', ({ roomCode, tileId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    const owner = requireOwner(room, socket, tileId);
    if (!player || !owner || owner.id !== player.id) return;
    if (!room.mortgaged.has(tileId)) return;

    const tile = BOARD[tileId];
    const cost = Math.round(tile.price / 2 * 1.1); // 10% interest to redeem
    if (player.balance < cost) return;
    player.balance -= cost;
    room.mortgaged.delete(tileId);
    addLog(room, `${player.name} redeems ${tile.name} from mortgage.`);
    broadcastRoom(room);
  });

  socket.on('payJailFine', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player || !player.inJail) return;
    if (player.balance < JAIL_FINE) return;
    chargePlayer(room, player, JAIL_FINE);
    player.inJail = false;
    player.jailTurns = 0;
    addLog(room, `${player.name} pays ${JAIL_FINE} Gold Dragons to leave the Black Cells.`);
    broadcastRoom(room);
  });

  socket.on('useJailFreeCard', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player || !player.inJail || player.getOutOfJailFreeCards < 1) return;
    player.getOutOfJailFreeCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    addLog(room, `${player.name} uses a pardon and leaves the Black Cells.`);
    broadcastRoom(room);
  });

  socket.on('endTurn', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = requireCurrentPlayer(socket, room);
    if (!player || room.pendingPurchase !== null) return;

    // Doubles grant another roll (unless the player just went to jail).
    if (room.lastRoll?.isDoubles && !player.inJail && room.doublesStreak > 0) {
      addLog(room, `${player.name} rolled doubles and goes again.`);
      broadcastRoom(room);
      return;
    }
    advanceTurn(room);
    addLog(room, `It is now ${currentPlayer(room)?.name}'s turn.`);
    broadcastRoom(room);
  });

  socket.on('sendChatMessage', ({ roomCode, message }) => {
    const room = rooms.get(roomCode);
    if (!room || !message || typeof message !== 'string') return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    const text = message.slice(0, 280).trim();
    if (!text) return;
    io.to(room.code).emit('chatMessage', { playerName: player.name, house: player.house, text, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      addLog(room, `${player.name} has lost connection to the raven network.`);
      broadcastRoom(room);

      const timer = setTimeout(() => {
        // Still disconnected after the grace period.
        if (room.phase === 'lobby') {
          room.players = room.players.filter((p) => p.id !== player.id);
          room.turnOrder = room.turnOrder.filter((id) => id !== player.id);
          if (room.hostId === player.id) room.hostId = room.players[0]?.id ?? null;
        } else if (currentPlayer(room)?.id === player.id) {
          advanceTurn(room);
          addLog(room, `${player.name} was skipped due to disconnection. It is now ${currentPlayer(room)?.name}'s turn.`);
        }
        room.disconnectTimers.delete(player.id);
        if (room.players.every((p) => !p.connected)) scheduleEmptyRoomCleanup(room);
        broadcastRoom(room);
      }, RECONNECT_GRACE_MS);
      room.disconnectTimers.set(player.id, timer);
      break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Thrones Monopoly server listening on port ${PORT}`);
});
