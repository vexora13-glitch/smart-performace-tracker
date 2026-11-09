import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { VexoraMotionProvider } from './design/motion';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VexoraMotionProvider>
      <App />
    </VexoraMotionProvider>
  </StrictMode>,
);
