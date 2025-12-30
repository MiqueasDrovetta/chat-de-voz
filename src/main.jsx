import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom';

// Vite proporciona la variable `import.meta.env.PROD`.
// Es `true` para producción (build) y `false` para desarrollo (serve).
// Así, el basename solo se aplica para GitHub Pages.
const basename = import.meta.env.PROD ? '/chat-de-voz' : '/';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
