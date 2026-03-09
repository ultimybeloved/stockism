import { useState, useEffect } from "react";

const DISMISS_KEY = "stockism_install_dismissed";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export default function InstallPrompt({ darkMode }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < SEVEN_DAYS) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border p-4 shadow-lg ${
        darkMode
          ? "border-zinc-700 bg-zinc-900 text-zinc-100"
          : "border-amber-200 bg-white text-zinc-900"
      }`}
    >
      <div className="flex items-center gap-3">
        <img
          src="/favicon.png"
          alt="Stockism"
          className="h-10 w-10 rounded-lg"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">
            Add Stockism to your home screen for quick access
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={handleDismiss}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            darkMode
              ? "text-zinc-400 hover:text-zinc-200"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Not Now
        </button>
        <button
          onClick={handleInstall}
          className="rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-500"
        >
          Install App
        </button>
      </div>
    </div>
  );
}
