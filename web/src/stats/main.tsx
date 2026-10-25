import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatsPage } from './StatsPage';
import '../styles.css';
import './stats.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StatsPage />
  </StrictMode>,
);
