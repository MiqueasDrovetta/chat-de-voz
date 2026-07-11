# Plan del Proyecto: Chat de Voz con WebRTC en React

## Visión General

Aplicación de chat de voz multiusuario basada en salas automáticas, construida con React, Material-UI, PeerJS (WebRTC) y Firebase Realtime Database. Los usuarios se asignan automáticamente a salas con espacio disponible y cuentan con un sistema de votación avanzado para gestionar la sala.

## Funcionalidades Principales

*   **Chat Basado en Salas Automáticas:** Los usuarios son asignados automáticamente a salas con espacio disponible (o se crea una sala nueva si ninguna tiene cupo).
*   **Límite de Usuarios por Sala:** Cada sala está limitada a un máximo de **9** participantes concurrentes (`MAX_USERS_PER_ROOM`).
*   **Conexiones P2P Automáticas:** Conecta sin problemas a los usuarios dentro de la misma sala usando WebRTC (PeerJS).
*   **Nombre de Usuario de Invitado:** Los usuarios ingresan un nombre base, y el sistema anexa 4 caracteres aleatorios para garantizar un nombre de usuario único.
*   **Señalización sin Servidor:** Utiliza Firebase Realtime Database para la señalización y coordinar las conexiones entre pares.
*   **Reconexión con Gracia (10s):** Ante un microcorte, la sala reserva el cupo, nombre y sufijo del usuario por hasta 10 segundos (`RECONNECT_GRACE_MS`) antes de liberarlo.
*   **Interfaz de Usuario Moderna:** Interfaz limpia, responsive y con animaciones, construida con React y Material-UI.

## Sistema de Votación Avanzado

1.  **Inicio de la Votación:** Requiere 3+ participantes activos (`MIN_USERS_FOR_VOTE`). Dura 20 segundos (`VOTE_DURATION`), con recuento anónimo en tiempo real vía Firebase.
2.  **Cooldowns:** 2 minutos de cooldown local para quien inicia la votación (`USER_VOTE_COOLDOWN`, se reactiva si se une un nuevo usuario), y 5 minutos de cooldown global por sala (`GLOBAL_VOTE_COOLDOWN`), validado exclusivamente contra la hora del servidor de Firebase (`ServerValue.TIMESTAMP` + `.info/serverTimeOffset`) para evitar manipulación del reloj local.
3.  **Resultado:** Un usuario es expulsado si supera el 50% de los votos de los participantes activos presentes.
4.  **Historial de Nominaciones:** Acumulativo y visible para todos vía `Badge` en cada tarjeta de participante. Se destruye por completo (junto con el cooldown global) en el momento en que la sala queda con 0 participantes.
5.  **Flujo Post-Expulsión:** Diálogo modal persistente con opciones para buscar otra sala automáticamente o ir al inicio; si no hay salas disponibles, ofrece crear una nueva sala.

## Pila Tecnológica

*   **React 19** + **React Router 7** para la UI y el enrutamiento.
*   **Material-UI (MUI) 7** para los componentes de interfaz.
*   **Framer Motion** para las animaciones de la pantalla de bienvenida.
*   **WebRTC / PeerJS** para la comunicación de voz punto a punto.
*   **Firebase Realtime Database** para señalización, presencia y estado de la votación.
*   **Vite** como bundler, desplegado en GitHub Pages bajo la base `/chat-de-voz/`.

## Arquitectura de Código

```
src/
├── firebase.js                 # Inicialización de la app de Firebase y export de `db`
├── constants.js                 # Reglas de negocio (límites, duraciones, cooldowns)
├── utils/rooms.js               # Búsqueda/creación de salas, helpers de presencia
├── hooks/
│   ├── useServerTime.js         # Sincroniza el reloj local con el offset del servidor
│   ├── useWebRTCChat.js         # PeerJS, streams de audio, presencia y reconexión con gracia
│   └── useVoteSystem.js         # Ciclo de vida de la votación y cooldowns
├── components/
│   ├── ParticipantCard.jsx      # Tarjeta de participante (mic, badge de nominaciones, botón de expulsión)
│   ├── VoteBanner.jsx           # Banner superior con progreso de la votación activa
│   └── KickedDialog.jsx         # Diálogo modal post-expulsión
└── pages/
    ├── Home.jsx                 # Pantalla de bienvenida
    └── Room.jsx                 # Página de la sala, compone los hooks + componentes
```

Las instancias de PeerJS, las conexiones P2P activas y los `MediaStream` viven en `useRef` (nunca en `useState`) dentro de `useWebRTCChat`, para que los re-renders de React nunca corten el audio. Cada efecto limpia sus listeners de Firebase (`unsubscribe`/`.off()`), detiene los tracks del micrófono y destruye la instancia de `Peer` al desmontar o cambiar de sala.

## Estructura del Árbol de Firebase Realtime Database

```
rooms/
  {roomId}/
    lastGlobalVoteTime: number            # ServerValue.TIMESTAMP del inicio de la última votación (0 si nunca hubo)
    nominations/
      {peerId}: number                    # Historial acumulado de nominaciones de ese peer en la sesión
    users/
      {peerId}/
        username: string                  # "{nombreBase}-{sufijo4}"
        isMuted: boolean
        nominations: number                # Copia del historial al momento de unirse (para sobrevivir a un peerId reciclado)
        hasInitiatedVote: boolean
        status: "connected" | "disconnected"
        disconnectedAt: ServerValue.TIMESTAMP | null   # Se setea vía onDisconnect() al perder conexión
    vote:                                   # null cuando no hay votación activa
      initiator: peerId
      endTime: number                      # epoch ms (server-relative) en que cierra la ronda
      votes/
        {targetPeerId}/
          {voterPeerId}: true
```

Cuando `users` queda vacío (0 participantes, tras una salida explícita o tras expirar la ventana de gracia del último fantasma), `nominations`, `lastGlobalVoteTime` y `vote` se resetean atómicamente en la misma transacción que remueve al último usuario.

## Limitaciones Conocidas

La app es 100% cliente (sin Cloud Functions ni backend propio), lo cual implica dos límites arquitectónicos aceptados conscientemente:

*   **Purga de fantasmas dependiente de un cliente vivo:** la expiración de la ventana de gracia de 10s (y por lo tanto el reseteo de `nominations`/`vote`/`lastGlobalVoteTime` al vaciarse la sala) corre vía `setTimeout` en el navegador de cualquier cliente suscrito a esa sala. Si el último participante de una sala se desconecta de forma abrupta (cierre de laptop, corte de red) sin que quede nadie más conectado, ese fantasma puede persistir indefinidamente (reservando 1 de los 9 cupos) hasta que un futuro usuario se una a esa misma sala, momento en el cual su propio cliente lo purga casi al instante. No hay barrido del lado del servidor; resolverlo de forma completa requeriría una Cloud Function programada.
*   **Condición de carrera en la asignación de sala (TOCTOU):** `findAvailableRoom`/`initializeRoom` leen la ocupación con un `get()` simple (no transaccional) y recién reservan el cupo más tarde, tras el handshake de PeerJS. Dos usuarios que se unen casi simultáneamente a una sala que está justo en el límite podrían ambos pasar el chequeo y terminar empujando la sala 1 cupo por encima de `MAX_USERS_PER_ROOM`. Es una condición preexistente (no introducida por refactors posteriores) de baja probabilidad; una solución completa requeriría reservar el cupo dentro de una `runTransaction` antes de iniciar el handshake.

## Estado Actual

Todas las funcionalidades descritas arriba están implementadas y en uso. Este documento se actualiza como fuente de verdad de la arquitectura vigente; los cambios futuros deben reflejarse aquí.
