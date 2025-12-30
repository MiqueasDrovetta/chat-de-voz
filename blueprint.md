# Plan del Proyecto: Chat de Voz con WebRTC en React

## Visión General

Este documento describe el plan para crear una aplicación de chat de voz multiusuario basada en salas utilizando WebRTC. La aplicación contará con un proceso de conexión automático, permitiendo a los usuarios unirse a salas de chat y comunicarse con otros sin configuración manual. Se construirá utilizando React y Firebase, y estará diseñada para un fácil despliegue.

## Funcionalidades Principales

*   **Chat Basado en Salas Automáticas:** Los usuarios son asignados automáticamente a salas con espacio disponible.
*   **Límite de Usuarios por Sala:** Cada sala de chat está limitada a un máximo of 2 participantes.
*   **Conexiones P2P Automáticas:** Conecta sin problemas a los usuarios dentro de la misma sala usando WebRTC.
*   **Lista de Usuarios:** Muestra una lista de los participantes en la sala de chat.
*   **Nombre de Usuario de Invitado:** Los usuarios ingresan un nombre base, y el sistema anexa 4 caracteres aleatorios para garantizar un nombre de usuario único.
*   **Señalización sin Servidor:** Utiliza Firebase Realtime Database para la señalización y coordinar las conexiones entre pares.
*   **Interfaz de Usuario Moderna:** Una interfaz limpia, receptiva y fácil de usar construida con React y Material-UI.

## Sistema de Votación Avanzado

Se implementará un sistema de votación robusto y dinámico para permitir a los usuarios gestionar la sala de chat.

### Flujo de Votación

1.  **Inicio de la Votación:**
    *   Cada usuario tiene un botón "Iniciar Votación".
    *   Al hacer clic, se activa un período de votación de 20 segundos, visible para todos.
    *   Se muestra una notificación global: "¡La votación ha comenzado!".
    *   Durante este período, se habilitan los botones "Votar para Expulsar" junto a cada usuario.

2.  **Gestión del Botón "Iniciar Votación":**
    *   El botón es de un solo uso por usuario.
    *   Se deshabilita y cambia de color después de ser presionado.
    *   Se reactiva automáticamente si un nuevo usuario se une a la sala.
    *   Se reactiva después de un cooldown de 2 minutos, con un temporizador visible para el usuario que lo presionó.
    *   Existe un cooldown global de 5 minutos entre cada sesión de votación para evitar abusos.

3.  **Proceso de Voto:**
    *   La votación es anónima; nadie puede ver quién votó por quién.
    *   El conteo de votos para cada usuario se muestra en tiempo real.
    *   Un usuario no puede votar por sí mismo.

4.  **Resultados de la Votación:**
    *   Al finalizar los 20 segundos, se determina el resultado.
    *   Un usuario es expulsado si recibe una cantidad de votos superior al 50% de los participantes.
    *   Se muestra una notificación clara con el resultado (ej. "UsuarioX ha sido expulsado" o "La votación ha terminado sin un resultado decisivo").

5.  **Historial y Transparencia:**
    *   Se mantendrá un historial del número de veces que un usuario ha sido nominado para expulsión, visible para todos.

## Pila Tecnológica

*   **React:** Para la interfaz de usuario.
*   **React Router:** Para el enrutamiento.
*   **Material-UI (MUI):** Para los componentes de la interfaz de usuario.
*   **WebRTC:** Para la comunicación de voz punto a punto en tiempo real.
*   **PeerJS:** Una biblioteca para simplificar la implementación de WebRTC.
*   **Firebase Realtime Database:** Para la señalización y la gestión del estado de la votación.

## Plan de Implementación

1.  **Configuración del Proyecto:**
    *   Instalar las dependencias necesarias: `react-router-dom`, `firebase`, `peerjs`, `@mui/material`, `@emotion/react`, `@emotion/styled`.
    *   Configurar Firebase y crear un archivo `firebase.js`.
    *   Configurar el enrutamiento básico con `react-router-dom`.

2.  **Creación de Componentes:**
    *   Crear la página de inicio para que los usuarios ingresen su nombre de usuario.
    *   Crear la página de la sala de chat.

3.  **Implementación de WebRTC y Señalización:**
    *   Implementar la lógica de WebRTC con PeerJS.
    *   Utilizar Firebase Realtime Database para la señalización entre pares.

4.  **Implementación del Sistema de Votación:**
    *   Desarrollar la lógica de votación y la interfaz de usuario.

5.  **Estilización y Diseño:**
    *   Aplicar un diseño moderno y receptivo utilizando Material-UI.
