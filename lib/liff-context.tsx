"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffContextValue = {
  ready: boolean;
  error: string;
  isLoggedIn: boolean;
  isInClient: boolean;
  profile: LiffProfile | null;
  login: () => void;
};

const LiffContext = createContext<LiffContextValue | null>(null);

export function LiffProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isInClient, setIsInClient] = useState(false);
  const [profile, setProfile] = useState<LiffProfile | null>(null);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
    if (!liffId) {
      setError("ยังไม่ได้ตั้ง NEXT_PUBLIC_LIFF_ID");
      setReady(true);
      return;
    }

    let cancelled = false;

    const boot = async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });

        if (cancelled) return;

        setIsInClient(liff.isInClient());

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        setIsLoggedIn(true);
        const p = await liff.getProfile();
        if (cancelled) return;
        setProfile({
          userId: p.userId,
          displayName: p.displayName,
          pictureUrl: p.pictureUrl,
        });
        setReady(true);
      } catch (err) {
        console.error("LIFF init failed", err);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "เปิด LIFF ไม่สำเร็จ",
          );
          setReady(true);
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = () => {
    void import("@line/liff").then(({ default: liff }) => {
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
      }
    });
  };

  const value = useMemo(
    () => ({
      ready,
      error,
      isLoggedIn,
      isInClient,
      profile,
      login,
    }),
    [ready, error, isLoggedIn, isInClient, profile],
  );

  return (
    <LiffContext.Provider value={value}>{children}</LiffContext.Provider>
  );
}

export function useLiff() {
  const ctx = useContext(LiffContext);
  if (!ctx) throw new Error("useLiff must be used within LiffProvider");
  return ctx;
}
