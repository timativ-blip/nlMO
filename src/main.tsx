import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import './design.css';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TelegramMiniApp } from './ui/TelegramMiniApp';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 520, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
        <h1>Что-то пошло не так</h1>
        <p className="muted">Ваши данные сохранены. Обновите страницу — если ошибка повторится, сообщите в штаб, что вы делали перед этим.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Обновить страницу</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TelegramMiniApp><App /></TelegramMiniApp>
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
