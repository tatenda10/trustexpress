import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AgentAuthProvider } from './auth/AgentAuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AgentAuthProvider>
      <App />
    </AgentAuthProvider>
  </StrictMode>,
)
