import React, { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { User, AuthContext as AuthContextType } from "../types/index.js";
import { apiClient } from "../api/client.js";
import { uploadDevicePublicKeyWithRetry } from "../crypto/deviceKey.js";
import { setActiveCryptoUserId } from "../crypto/conversationKeys.js";
import { socketManager } from "../socket/manager.js";
import { getJwtClaim } from "../utils/jwt.js";

interface AuthContextValue extends AuthContextType {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string,
    displayName: string,
  ) => Promise<{
    otpRequestId: string;
    expiresInSec: number;
    cooldownSec: number;
  }>;
  verifyOtp: (otpRequestId: string, otpCode: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

const STORAGE_KEY_ACCESS_TOKEN = "auth:accessToken";
const STORAGE_KEY_REFRESH_TOKEN = "auth:refreshToken";
const STORAGE_KEY_USER = "auth:user";

async function uploadPrekeyForUser(
  userId: User["userId"],
  onResult: (failed: boolean) => void,
): Promise<void> {
  try {
    await uploadDevicePublicKeyWithRetry(
      (publicKey) => apiClient.putDeviceEcdhPublicKey(publicKey),
      userId,
    );
    onResult(false);
  } catch (err) {
    console.warn("[Auth] Device ECDH prekey upload failed after retries:", err);
    onResult(true);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prekeyUploadFailed, setPrekeyUploadFailed] = useState(false);
  const prekeyUploadedForSessionRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    const storedAccessToken = localStorage.getItem(STORAGE_KEY_ACCESS_TOKEN);
    const storedRefreshToken = localStorage.getItem(STORAGE_KEY_REFRESH_TOKEN);
    const storedUser = localStorage.getItem(STORAGE_KEY_USER);

    if (storedAccessToken && storedUser) {
      try {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setUser(JSON.parse(storedUser));
        apiClient.setAccessToken(storedAccessToken);
      } catch (err) {
        console.error("Failed to load auth from storage:", err);
        localStorage.removeItem(STORAGE_KEY_ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEY_USER);
      }
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (accessToken && user) {
      localStorage.setItem(STORAGE_KEY_ACCESS_TOKEN, accessToken);
      if (refreshToken) {
        localStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, refreshToken);
      }
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      apiClient.setAccessToken(accessToken);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACCESS_TOKEN);
      localStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
      apiClient.setAccessToken(null);
    }
  }, [accessToken, user, refreshToken]);

  useEffect(() => {
    if (!accessToken || !refreshToken || !user) {
      apiClient.setRefreshHandler(null);
      prekeyUploadedForSessionRef.current = null;
      setActiveCryptoUserId(null);
      return;
    }

    // Refresh dung chung cho ca 401-path lan refresh chu dong; in-flight guard tranh
    // refresh kep (refresh token dung 1 lan -> refresh kep se bi replay-reject).
    const doRefresh = (forceReconnect: boolean): Promise<string> => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      const p = (async () => {
        try {
          const response = await apiClient.refreshToken(refreshToken);
          setAccessToken(response.accessToken);
          setRefreshToken(response.refreshToken);
          // Token moi cho lan auto-reconnect ke tiep; chi force reconnect o 401-path.
          socketManager.updateAuthToken(response.accessToken);
          if (forceReconnect) {
            socketManager.reconnectWithToken(response.accessToken).catch((err) =>
              console.error("[Auth] Failed to reconnect socket with refreshed token:", err),
            );
          }
          return response.accessToken;
        } catch {
          setUser(null);
          setAccessToken(null);
          setRefreshToken(null);
          socketManager.disconnect();
          throw new Error("Session expired. Please log in again.");
        } finally {
          refreshInFlightRef.current = null;
        }
      })();
      refreshInFlightRef.current = p;
      return p;
    };

    apiClient.setRefreshHandler(() => doRefresh(true));

    setActiveCryptoUserId(user.userId);

    const sessionKey = `${user.userId}:${accessToken}`;
    if (prekeyUploadedForSessionRef.current !== sessionKey) {
      prekeyUploadedForSessionRef.current = sessionKey;
      void uploadPrekeyForUser(user.userId, setPrekeyUploadFailed);
    }

    socketManager.connect(accessToken).catch((err) =>
      console.error("[Auth] Failed to connect socket:", err),
    );

    // Refresh chu dong ~60s truoc khi access token het han -> token + socket luon tuoi,
    // khong dinh 401 dau tien khi idle dai (khong can blip reconnect).
    const expSec = getJwtClaim(accessToken, "exp") as number | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof expSec === "number") {
      const msUntilRefresh = expSec * 1000 - Date.now() - 60_000;
      refreshTimer = setTimeout(() => {
        void doRefresh(false).catch(() => undefined);
      }, Math.max(msUntilRefresh, 1_000));
    }

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [accessToken, refreshToken, user]);

  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        deviceName: `${navigator.platform} Browser`,
      };

      const response = await apiClient.login(identifier, password, deviceInfo);

      setUser(response.user);
      setAccessToken(response.accessToken);
      setRefreshToken(response.refreshToken);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Login failed";
      setError(errorMsg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);

    try {
      if (refreshToken) {
        await apiClient.logout(refreshToken);
      }
      socketManager.disconnect();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      prekeyUploadedForSessionRef.current = null;
      setActiveCryptoUserId(null);
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  }, [refreshToken]);

  const register = useCallback(
    async (
      email: string,
      username: string,
      password: string,
      displayName: string,
    ) => {
      setError(null);

      try {
        const response = await apiClient.requestOtp(
          email,
          username,
          password,
          displayName,
        );
        return response;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Registration failed";
        setError(errorMsg);
        throw err;
      }
    },
    [],
  );

  const verifyOtp = useCallback(async (otpRequestId: string, otpCode: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await apiClient.verifyOtp({
        otpRequestId: otpRequestId as any,
        otpCode,
      });

      setUser(response.user);
      setAccessToken(response.accessToken);
      setRefreshToken(response.refreshToken);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "OTP verification failed";
      setError(errorMsg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    accessToken,
    refreshToken: refreshToken || null,
    isLoading,
    error,
    prekeyUploadFailed,
    login,
    logout,
    register,
    verifyOtp,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
