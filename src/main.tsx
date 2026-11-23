import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/intake.css';
import './styles/record.css';
import './styles/viewer.css';
import './styles/base.css';
import './styles/trade-design.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
