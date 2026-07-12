export const MAX_USERS_PER_ROOM = 9;
export const MIN_USERS_FOR_VOTE = 3;
export const VOTE_DURATION = 20; // seconds
export const USER_VOTE_COOLDOWN = 120; // seconds
export const GLOBAL_VOTE_COOLDOWN = 300; // seconds
export const RECONNECT_GRACE_MS = 10000;

// Respaldo de presencia: cada cliente conectado refresca `lastSeen` a este ritmo.
// Si un usuario sigue figurando "connected" pero su lastSeen envejece más que
// PRESENCE_STALE_MS, cualquier otro cliente lo trata como desconectado, sin
// depender exclusivamente de que Firebase detecte el corte de socket (onDisconnect
// puede demorar o, en casos raros, no dispararse nunca ante un cierre abrupto).
export const HEARTBEAT_INTERVAL_MS = 5000;
export const PRESENCE_STALE_MS = 25000;
