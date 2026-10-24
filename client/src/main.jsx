import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './theme.css';
import './live.css';
import './notifications.css';

const savedTheme = localStorage.getItem('hcm-theme');
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
