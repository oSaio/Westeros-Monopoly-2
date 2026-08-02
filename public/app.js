/**
 * Thrones Monopoly — Client
 * ---------------------------------------------------------------------------
 * Thin rendering layer over the server's authoritative state. This file
 * never decides game rules; it only sends intents ("I'd like to roll the
 * dice") and re-renders whatever `roomUpdate` payload comes back.
 * ---------------------------------------------------------------------------
 */
import { io } from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Point this at your deployed backend (Render/Railway). Falls back to a
// local dev server when running the client on localhost.
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : 'https://YOUR-BACKEND-DOMAIN.onrender.com';

const socket = io(SERVER_URL, { autoConnect: true, transports: ['websocket', 'polling'] });

// ---------------------------------------------------------------------------
// Session persistence (survives a page refresh mid-game)
// ---------------------------------------------------------------------------

const session = {
  get roomCode() { return sessionStorage.getItem('tm_roomCode'); },
  get playerId() { return sessionStorage.getItem('tm_playerId'); },
  save(roomCode, playerId) {
    sessionStorage.setItem('tm_roomCode', roomCode);
    sessionStorage.setItem('tm_playerId', playerId);
  },
  clear() {
    sessionStorage.removeItem('tm_roomCode');
    sessionStorage.removeItem('tm_playerId');
  },
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  connectionStatus: $('connection-status'),
  lobbyScreen: $('lobby-screen'),
  waitingScreen: $('waiting-screen'),
  gameScreen: $('game-screen'),
  lobbyError: $('lobby-error'),

  createName: $('create-name'),
  createHouse: $('create-house'),
  createGameBtn: $('create-game-btn'),

  joinName: $('join-name'),
  joinHouse: $('join-house'),
  joinCode: $('join-code'),
  joinGameBtn: $('join-game-btn'),

  roomCodeDisplay: $('room-code-display'),
  copyLinkBtn: $('copy-link-btn'),
  waitingPlayersList: $('waiting-players-list'),
  startGameBtn: $('start-game-btn'),
  waitingHint: $('waiting-hint'),

  boardGrid: $('board-grid'),
  playersList: $('players-list'),
  turnBanner: $('turn-banner'),
  diceDisplay: $('dice-display'),
  rollDiceBtn: $('roll-dice-btn'),
  payJailBtn: $('pay-jail-btn'),
  useJailCardBtn: $('use-jail-card-btn'),
  endTurnBtn: $('end-turn-btn'),
  purchasePanel: $('purchase-panel'),
  purchaseText: $('purchase-text'),
  buyBtn: $('buy-btn'),
  declineBtn: $('decline-btn'),
  propertyPanel: $('property-panel'),
  ownedPropertiesList: $('owned-properties-list'),

  eventLog: $('event-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),

  gameOverModal: $('game-over-modal'),
  gameOverText: $('game-over-text'),
  returnToLobbyBtn: $('return-to-lobby-btn'),
};

/** Maps a 40-tile board index to a [row, col] cell in an 11x11 CSS grid perimeter. */
function tileIdToGridPosition(id) {
  if (id <= 10) return [11, 11 - id];       // bottom row, right-to-left
  if (id <= 20) return [11 - (id - 10), 1]; // left column, bottom-to-top
  if (id <= 30) return [1, id - 20 + 1];    // top row, left-to-right
  return [id - 30 + 1, 11];                // right column, top-to-bottom
}

let currentRoom = null; // last roomUpdate payload
let myPlayerId = null;

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

socket.on('connect', () => {
  el.connectionStatus.textContent = 'Connected to the Citadel';
  el.connectionStatus.classList.remove('text-crimson');

  // Auto-rejoin if we have a saved session (e.g. after a page refresh).
  if (session.roomCode && session.playerId) {
    socket.emit('joinRoom', { roomCode: session.roomCode, rejoinPlayerId: session.playerId }, (res) => {
      if (res?.error) session.clear();
    });
  } else {
    const params = new URLSearchParams(window.location.search);
    const roomFromLink = params.get('room');
    if (roomFromLink) el.joinCode.value = roomFromLink.toUpperCase();
  }
});

socket.on('disconnect', () => {
  el.connectionStatus.textContent = 'Disconnected — attempting to reconnect…';
  el.connectionStatus.classList.add('text-crimson');
});

socket.on('connect_error', () => {
  el.connectionStatus.textContent = 'Could not reach the server';
  el.connectionStatus.classList.add('text-crimson');
});

// ---------------------------------------------------------------------------
// Lobby actions
// ---------------------------------------------------------------------------

el.createGameBtn.addEventListener('click', () => {
  const playerName = el.createName.value.trim();
  if (!playerName) return showLobbyError('Enter your name first.');
  socket.emit('createRoom', { playerName, house: el.createHouse.value }, (res) => {
    if (res?.error) return showLobbyError(res.error);
    myPlayerId = res.playerId;
    session.save(res.roomCode, res.playerId);
  });
});

el.joinGameBtn.addEventListener('click', () => {
  const playerName = el.joinName.value.trim();
  const roomCode = el.joinCode.value.trim().toUpperCase();
  if (!playerName) return showLobbyError('Enter your name first.');
  if (roomCode.length !== 4) return showLobbyError('Room codes are 4 characters.');
  socket.emit('joinRoom', { roomCode, playerName, house: el.joinHouse.value }, (res) => {
    if (res?.error) return showLobbyError(res.error);
    myPlayerId = res.playerId;
    session.save(res.roomCode, res.playerId);
  });
});

function showLobbyError(message) {
  el.lobbyError.textContent = message;
  el.lobbyError.classList.remove('hidden');
}

el.copyLinkBtn.addEventListener('click', async () => {
  const url = `${window.location.origin}${window.location.pathname}?room=${currentRoom?.code ?? ''}`;
  await navigator.clipboard.writeText(url);
  el.copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => { el.copyLinkBtn.textContent = 'Copy Invite Link'; }, 1500);
});

el.startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', { roomCode: currentRoom.code });
});

// ---------------------------------------------------------------------------
// In-game actions
// ---------------------------------------------------------------------------

el.rollDiceBtn.addEventListener('click', () => socket.emit('rollDice', { roomCode: currentRoom.code }));
el.payJailBtn.addEventListener('click', () => socket.emit('payJailFine', { roomCode: currentRoom.code }));
el.useJailCardBtn.addEventListener('click', () => socket.emit('useJailFreeCard', { roomCode: currentRoom.code }));
el.endTurnBtn.addEventListener('click', () => socket.emit('endTurn', { roomCode: currentRoom.code }));
el.buyBtn.addEventListener('click', () => socket.emit('buyProperty', { roomCode: currentRoom.code }));
el.declineBtn.addEventListener('click', () => socket.emit('declineProperty', { roomCode: currentRoom.code }));

el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = el.chatInput.value.trim();
  if (!message) return;
  socket.emit('sendChatMessage', { roomCode: currentRoom.code, message });
  el.chatInput.value = '';
});

el.returnToLobbyBtn.addEventListener('click', () => {
  session.clear();
  window.location.href = window.location.pathname;
});

// ---------------------------------------------------------------------------
// Server -> client state sync
// ---------------------------------------------------------------------------

socket.on('roomUpdate', (room) => {
  currentRoom = room;
  render(room);
});

socket.on('chatMessage', ({ playerName, house, text }) => {
  appendLogLine(`💬 ${playerName} (House ${house}): ${text}`, 'text-parchment');
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(room) {
  const me = room.players.find((p) => p.id === myPlayerId);

  if (room.phase === 'lobby') {
    showScreen('waiting');
    renderWaitingRoom(room, me);
  } else {
    showScreen('game');
    renderBoard(room);
    renderPlayers(room);
    renderControls(room, me);
    renderLog(room);
  }

  if (room.phase === 'ended') {
    const winner = room.players.find((p) => !p.bankrupt);
    el.gameOverText.textContent = winner
      ? `${winner.name} of House ${winner.house} has claimed the Seven Kingdoms.`
      : 'The game has ended.';
    el.gameOverModal.classList.remove('hidden');
  }
}

function showScreen(name) {
  el.lobbyScreen.classList.toggle('hidden', name !== 'lobby');
  el.waitingScreen.classList.toggle('hidden', name !== 'waiting');
  el.gameScreen.classList.toggle('hidden', name !== 'game');
}

function renderWaitingRoom(room, me) {
  el.roomCodeDisplay.textContent = room.code;
  el.waitingPlayersList.innerHTML = room.players.map((p) => `
    <li class="flex items-center justify-between bg-void border border-bordercol rounded px-3 py-2">
      <span>${escapeHtml(p.name)} <span class="text-muted text-sm">— House ${escapeHtml(p.house)}</span></span>
      ${p.id === room.hostId ? '<span class="text-gold text-xs uppercase tracking-wide">Host</span>' : ''}
    </li>`).join('');

  const isHost = me?.id === room.hostId;
  el.startGameBtn.classList.toggle('hidden', !isHost);
  el.startGameBtn.disabled = room.players.length < 2;
  el.waitingHint.textContent = isHost
    ? (room.players.length < 2 ? 'Need at least 2 players to begin.' : 'Ready when you are.')
    : 'Waiting for the host to begin…';
}

function renderBoard(room) {
  // Only rebuild the tile grid once (it's static); afterwards just move tokens.
  if (!el.boardGrid.dataset.built) {
    el.boardGrid.innerHTML = room.board.map((tile) => {
      const [row, col] = tileIdToGridPosition(tile.id);
      const groupColor = tile.group ? room.groupColors[tile.group] : null;
      const isCorner = [0, 10, 20, 30].includes(tile.id);
      return `
        <div class="tile relative flex flex-col ${isCorner ? 'items-center justify-center text-center' : ''} p-1 bg-panel"
             style="grid-row:${row}; grid-column:${col};" data-tile-id="${tile.id}">
          ${groupColor ? `<div class="h-2 w-full rounded-sm mb-1" style="background:${groupColor}"></div>` : ''}
          <span class="tile-name text-[9px] leading-tight text-parchment">${escapeHtml(tile.name)}</span>
          ${tile.price ? `<span class="text-[8px] text-muted">${tile.price}g</span>` : ''}
          <div class="tokens absolute bottom-0.5 right-0.5 flex flex-wrap gap-0.5 justify-end"></div>
        </div>`;
    }).join('');
    el.boardGrid.dataset.built = 'true';
  }

  // Clear existing tokens, then re-place them per player position.
  el.boardGrid.querySelectorAll('.tokens').forEach((n) => { n.innerHTML = ''; });
  const palette = ['#c9a227', '#7a1f2b', '#4f7fae', '#5c6b73', '#d69a2d', '#c0577a', '#8fd9e0', '#a8862e'];
  room.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const container = el.boardGrid.querySelector(`[data-tile-id="${p.position}"] .tokens`);
    if (!container) return;
    const dot = document.createElement('div');
    dot.className = 'token w-2.5 h-2.5 rounded-full';
    dot.style.background = palette[i % palette.length];
    dot.title = p.name;
    container.appendChild(dot);
  });

  // Tint ownership: add a thin border in the owner's token color.
  el.boardGrid.querySelectorAll('.tile').forEach((tileEl) => {
    const tileId = Number(tileEl.dataset.tileId);
    const owner = room.players.find((p) => p.properties.includes(tileId));
    const ownerIndex = owner ? room.players.indexOf(owner) : -1;
    tileEl.style.outline = ownerIndex >= 0 ? `2px solid ${palette[ownerIndex % palette.length]}` : 'none';
    tileEl.style.opacity = room.mortgaged.includes(tileId) ? '0.5' : '1';
  });
}

function renderPlayers(room) {
  const currentId = room.turnOrder[room.currentTurnIndex];
  el.playersList.innerHTML = room.players.map((p) => `
    <li class="rounded border ${p.id === currentId ? 'border-gold' : 'border-bordercol'} bg-void p-3 ${p.bankrupt ? 'opacity-40' : ''}">
      <div class="flex items-center justify-between">
        <span class="font-semibold ${p.id === myPlayerId ? 'text-gold' : ''}">${escapeHtml(p.name)}</span>
        <span class="text-xs text-muted">${p.connected ? '' : '⚠ offline'}</span>
      </div>
      <div class="text-xs text-muted">House ${escapeHtml(p.house)}</div>
      <div class="mt-1 text-sm">${p.balance} Gold Dragons</div>
      ${p.inJail ? '<div class="text-xs text-crimson mt-1">In the Black Cells</div>' : ''}
      ${p.bankrupt ? '<div class="text-xs text-crimson mt-1">Bankrupt</div>' : ''}
    </li>`).join('');
}

function renderControls(room, me) {
  const currentId = room.turnOrder[room.currentTurnIndex];
  const isMyTurn = me && me.id === currentId && room.phase === 'in-progress';

  el.turnBanner.textContent = room.phase === 'ended'
    ? 'The game has ended.'
    : isMyTurn ? 'Your turn — roll the dice!' : `Waiting on ${room.players.find((p) => p.id === currentId)?.name ?? '…'}…`;

  if (room.lastRoll) {
    el.diceDisplay.textContent = `⚀ ${room.lastRoll.d1}  ⚀ ${room.lastRoll.d2}`;
  }

  // Rolling always works as the "act" button, whether free or trying to
  // escape the Black Cells with doubles; paying/pardon are extra jail exits.
  const canAct = isMyTurn && room.pendingPurchase === null;
  el.rollDiceBtn.classList.remove('hidden');
  el.rollDiceBtn.disabled = !canAct;
  el.endTurnBtn.disabled = !canAct;

  el.payJailBtn.classList.toggle('hidden', !(isMyTurn && me?.inJail));
  el.payJailBtn.disabled = !(me && me.balance >= 50);
  el.useJailCardBtn.classList.toggle('hidden', !(isMyTurn && me?.inJail && me.getOutOfJailFreeCards > 0));

  const pendingTile = room.pendingPurchase !== null ? room.board[room.pendingPurchase] : null;
  el.purchasePanel.classList.toggle('hidden', !(isMyTurn && pendingTile));
  if (pendingTile) {
    el.purchaseText.textContent = `Purchase ${pendingTile.name} for ${pendingTile.price} Gold Dragons?`;
    el.buyBtn.disabled = me.balance < pendingTile.price;
  }

  renderOwnedProperties(room, me);
}

function renderOwnedProperties(room, me) {
  if (!me || me.properties.length === 0) {
    el.propertyPanel.classList.add('hidden');
    return;
  }
  el.propertyPanel.classList.remove('hidden');
  el.ownedPropertiesList.innerHTML = me.properties.map((tileId) => {
    const tile = room.board[tileId];
    const houses = room.buildings[tileId] || 0;
    const isMortgaged = room.mortgaged.includes(tileId);
    const canBuild = tile.type === 'property' && !isMortgaged;
    return `
      <li class="flex items-center justify-between gap-2 border-b border-bordercol pb-1">
        <span>${escapeHtml(tile.name)} ${houses > 0 ? `<span class="text-gold">${houses > 4 ? '🏰' : '🏠'.repeat(houses)}</span>` : ''} ${isMortgaged ? '<span class="text-crimson text-xs">(mortgaged)</span>' : ''}</span>
        <span class="flex gap-1">
          ${canBuild ? `<button data-action="build" data-tile="${tileId}" class="text-xs border border-bordercol rounded px-2 py-0.5 hover:border-gold hover:text-gold">Build</button>` : ''}
          ${!isMortgaged ? `<button data-action="mortgage" data-tile="${tileId}" class="text-xs border border-bordercol rounded px-2 py-0.5 hover:border-crimson hover:text-crimson">Mortgage</button>`
                          : `<button data-action="unmortgage" data-tile="${tileId}" class="text-xs border border-bordercol rounded px-2 py-0.5 hover:border-gold hover:text-gold">Redeem</button>`}
        </span>
      </li>`;
  }).join('');
}

el.ownedPropertiesList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !currentRoom) return;
  const tileId = Number(btn.dataset.tile);
  const eventName = { build: 'buildKeep', mortgage: 'mortgageProperty', unmortgage: 'unmortgageProperty' }[btn.dataset.action];
  if (eventName) socket.emit(eventName, { roomCode: currentRoom.code, tileId });
});

function renderLog(room) {
  el.eventLog.innerHTML = room.log.map((entry) => `<li>${escapeHtml(entry.message)}</li>`).join('');
  el.eventLog.scrollTop = el.eventLog.scrollHeight;
}

function appendLogLine(text, className) {
  const li = document.createElement('li');
  li.textContent = text;
  if (className) li.className = className;
  el.eventLog.appendChild(li);
  el.eventLog.scrollTop = el.eventLog.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
