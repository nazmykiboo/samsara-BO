import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { login as loginRequest, loginPin as loginPinRequest } from "../api/auth";
import { getToken, setToken as persistToken } from "../api/client";
import type { AuthUser, LoginResponse } from "../api/types";

const USER_STORAGE_KEY = "samsara_user";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginPin: (userId: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/** Satu tempat untuk menyimpan hasil login -- dipakai sama-sama oleh login
 * password dan login PIN supaya persistensinya tidak pernah dobel-tulis. */
function persistSession(result: LoginResponse): void {
  persistToken(result.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? loadStoredUser() : null));

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest(username, password);
    persistSession(result);
    setUser(result.user);
  }, []);

  const loginPin = useCallback(async (userId: string, pin: string) => {
    const result = await loginPinRequest(userId, pin);
    persistSession(result);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    persistToken(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, loginPin, logout }),
    [user, login, loginPin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth dipakai di luar <AuthProvider>");
  return ctx;
}
