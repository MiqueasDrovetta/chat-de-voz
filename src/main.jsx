import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* 
      Le pasamos el `basename` al BrowserRouter.
      `import.meta.env.BASE_URL` es una variable que Vite nos da automáticamente.
      En desarrollo, será '/'.
      En producción (build), será '/chat-de-voz'.
      Esto sincroniza el enrutador de React con la configuración de Vite.
    */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
