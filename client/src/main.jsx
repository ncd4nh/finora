import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import AuthScreens from './pages/Auth.jsx';
import { CatalogProvider, ConfirmProvider, ThemeProvider, ToastProvider } from './components/ui.jsx';
import { AuthProvider, useAuth } from './components/auth.jsx';
import { SyncProvider } from './components/sync.jsx';
import './styles.css';

// Bản prototype (chạy trong 1 trang HTML) dùng HashRouter
const Router = import.meta.env.VITE_MOCK ? HashRouter : BrowserRouter;

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot"><span className="emo">🐝</span></div>;
  if (!user) return <AuthScreens />;
  // key = user.id: đổi tài khoản thì tải lại toàn bộ dữ liệu
  return (
    <CatalogProvider key={user.id}>
      <SyncProvider>
        <App />
      </SyncProvider>
    </CatalogProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <Gate />
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </Router>
  </React.StrictMode>
);

// PWA: cài lên màn hình chính, mở nhanh, vẫn mở được khi mất mạng (chỉ bản chạy thật, không áp dụng bản prototype)
if (!import.meta.env.VITE_MOCK && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
