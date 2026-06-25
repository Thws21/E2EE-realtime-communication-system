import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { useAuth } from "./context/AuthContext.js";
import { ChatProvider } from "./context/ChatContext.js";
import { CallProvider } from "./context/CallContext.js";
import { CallShell } from "./components/CallShell.js";
import { AppShell } from "./components/AppShell.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import "./App.css";

function ProtectedLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading-page">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <CallProvider>
      <ChatProvider>
        <CallShell />
        <Outlet />
      </ChatProvider>
    </CallProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/home" element={<AppShell />} />
          <Route path="/chat/:conversationId" element={<AppShell />} />
        </Route>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
