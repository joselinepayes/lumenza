import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui/Feedback';
import { AuthProvider, RedirectIfAuth, RequireAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import ForgotPassword from './pages/ForgotPassword';
import DesignSystem from './pages/DesignSystem';
import Explore from './pages/Explore';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Login from './pages/Login';
import LoginMfa from './pages/LoginMfa';
import SecuritySettings from './pages/SecuritySettings';
import PrivacySettings from './pages/PrivacySettings';
import Notifications from './pages/Notifications';
import NotFound from './pages/NotFound';
import PostPage from './pages/PostPage';
import ProfilePage from './pages/Profile';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import './styles/index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/design" element={<DesignSystem />} />
              <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />
              <Route path="/login/mfa" element={<RedirectIfAuth><LoginMfa /></RedirectIfAuth>} />
              <Route path="/registro" element={<RedirectIfAuth><Register /></RedirectIfAuth>} />
              <Route path="/recuperar" element={<RedirectIfAuth><ForgotPassword /></RedirectIfAuth>} />
              <Route path="/restablecer" element={<ResetPassword />} />
              <Route path="/verificar-correo" element={<VerifyEmail />} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route path="/inicio" element={<Home />} />
                <Route path="/explorar" element={<Explore />} />
                <Route path="/p/:id" element={<PostPage />} />
                <Route path="/u/:username" element={<ProfilePage />} />
                <Route path="/ajustes" element={<Navigate to="/ajustes/seguridad" replace />} />
                <Route path="/ajustes/seguridad" element={<SecuritySettings />} />
                <Route path="/ajustes/privacidad" element={<PrivacySettings />} />
                <Route path="/notificaciones" element={<Notifications />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
