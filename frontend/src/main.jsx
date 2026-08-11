import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// This is the one place React "plugs in" to the plain HTML page.
// It finds <div id="root"> in index.html and hands control of everything
// inside it over to the <App /> component.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
