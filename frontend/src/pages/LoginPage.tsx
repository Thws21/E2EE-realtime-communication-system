import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import "./AuthPages.css";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error: authError } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!identifier || !password) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }

    try {
      await login(identifier, password);
      navigate("/home");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Đăng nhập thất bại";
      setError(errorMsg);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <h1>E2EE Chat</h1>
        </div>
        <p className="auth-subtitle">Đăng nhập để tiếp tục</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="identifier">Email hoặc tên đăng nhập</label>
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="email@example.com"
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
            />
          </div>
          {(error || authError) && (
            <div className="error-message">{error || authError}</div>
          )}
          <button type="submit" className="auth-submit" disabled={isLoading}>
            {isLoading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
        <p className="auth-footer">
          Chưa có tài khoản?{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => navigate("/register")}
          >
            Tạo tài khoản
          </button>
        </p>
      </div>
    </div>
  );
}
