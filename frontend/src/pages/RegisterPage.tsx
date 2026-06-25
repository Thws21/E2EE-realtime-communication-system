import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import "./AuthPages.css";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register, verifyOtp, isLoading, error: authError } = useAuth();
  const [step, setStep] = useState<"register" | "otp">("register");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [countdown, setCountdown] = useState(0);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const [otpCode, setOtpCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  useEffect(() => {
    if (step !== "otp" || countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [step, countdown]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !username || !password || !displayName) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }

    try {
      const response = await register(email, username, password, displayName);
      setOtpRequestId(response.otpRequestId);
      setCountdown(response.expiresInSec);
      setStep("otp");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Đăng ký thất bại";
      setError(errorMsg);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!otpCode || otpCode.length !== 6) {
      setError("Mã OTP phải có 6 chữ số");
      return;
    }

    setVerifyLoading(true);
    try {
      await verifyOtp(otpRequestId, otpCode);
      navigate("/home");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Xác minh OTP thất bại";
      setError(errorMsg);
    } finally {
      setVerifyLoading(false);
    }
  };

  if (step === "otp") {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="auth-logo">
            <h1>E2EE Chat</h1>
          </div>
          <div className="auth-step-indicator">
            <span className="auth-step-dot" />
            <span className="auth-step-dot active" />
          </div>
          <p className="auth-subtitle">Xác nhận email</p>
          <form onSubmit={handleOtpSubmit}>
            <div className="form-group">
              <label htmlFor="otpCode">Mã OTP (kiểm tra hộp thư email)</label>
              <input
                id="otpCode"
                type="text"
                inputMode="numeric"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                disabled={verifyLoading}
                autoFocus
              />
              <small className={countdown <= 0 ? "countdown-expired" : ""}>
                {countdown > 0
                  ? `OTP hết hạn sau ${countdown} giây`
                  : "OTP đã hết hạn"}
              </small>
            </div>
            {(error || authError) && (
              <div className="error-message">{error || authError}</div>
            )}
            <button
              type="submit"
              className="auth-submit"
              disabled={verifyLoading || isLoading}
            >
              {verifyLoading || isLoading ? "Đang xác nhận..." : "Xác nhận"}
            </button>
          </form>
          <p className="auth-footer">
            <button
              type="button"
              className="link-button"
              onClick={() => setStep("register")}
            >
              Quay lại
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <h1>E2EE Chat</h1>
        </div>
        <div className="auth-step-indicator">
          <span className="auth-step-dot active" />
          <span className="auth-step-dot" />
        </div>
        <p className="auth-subtitle">Tạo tài khoản mới</p>
        <form onSubmit={handleRegisterSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="username">Tên đăng nhập</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="displayName">Tên hiển thị</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tên của bạn"
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
            {isLoading ? "Đang đăng ký..." : "Đăng ký"}
          </button>
        </form>
        <p className="auth-footer">
          Đã có tài khoản?{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => navigate("/login")}
          >
            Đăng nhập
          </button>
        </p>
      </div>
    </div>
  );
}
