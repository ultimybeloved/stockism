import React, { useState, useMemo } from "react";

export default function PriceAlertModal({
  ticker,
  currentPrice,
  characterName,
  darkMode,
  onClose,
  user,
  existingAlerts = [],
  onCreateAlert,
  onDeleteAlert,
}) {
  const [direction, setDirection] = useState("above");
  const [targetPrice, setTargetPrice] = useState("");

  const cardClass = darkMode
    ? "bg-zinc-900 border-zinc-800 text-zinc-100"
    : "bg-white border-amber-200 text-slate-900";
  const mutedClass = darkMode ? "text-zinc-400" : "text-zinc-600";
  const inputClass = darkMode
    ? "bg-zinc-950 border-zinc-800 text-zinc-100"
    : "bg-white border-amber-200 text-slate-900";

  const parsedTarget = parseFloat(targetPrice);
  const isValid = !isNaN(parsedTarget) && parsedTarget > 0;

  const pctDiff = useMemo(() => {
    if (!isValid || !currentPrice) return null;
    return (((parsedTarget - currentPrice) / currentPrice) * 100).toFixed(2);
  }, [parsedTarget, currentPrice, isValid]);

  const handleCreate = () => {
    if (!isValid) return;
    onCreateAlert({ ticker, targetPrice: parsedTarget, direction });
    setTargetPrice("");
  };

  const getPctFromCurrent = (price) => {
    if (!currentPrice) return "0.00";
    return (((price - currentPrice) / currentPrice) * 100).toFixed(2);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={`${cardClass} border rounded-sm p-4 max-w-md w-full`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">Price Alert</h2>
            <span className={`text-sm ${mutedClass}`}>{ticker}</span>
          </div>
          <button
            onClick={onClose}
            className={`${mutedClass} hover:text-orange-600 text-xl`}
          >
            ✕
          </button>
        </div>

        {/* Current Price */}
        <div className={`text-sm ${mutedClass} mb-4`}>
          Current Price:{" "}
          <span className="text-orange-600 font-semibold">
            ${currentPrice?.toFixed(2) ?? "—"}
          </span>
        </div>

        {/* Direction Selector */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setDirection("above")}
            className={`flex-1 py-1.5 rounded-sm text-sm font-medium border transition-colors ${
              direction === "above"
                ? "bg-orange-600 text-white border-orange-600"
                : `${inputClass} border hover:border-orange-600`
            }`}
          >
            Above
          </button>
          <button
            onClick={() => setDirection("below")}
            className={`flex-1 py-1.5 rounded-sm text-sm font-medium border transition-colors ${
              direction === "below"
                ? "bg-orange-600 text-white border-orange-600"
                : `${inputClass} border hover:border-orange-600`
            }`}
          >
            Below
          </button>
        </div>

        {/* Target Price Input */}
        <div className="mb-3">
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Target price..."
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className={`${inputClass} border rounded-sm w-full px-3 py-2 text-sm outline-none focus:border-orange-600`}
          />
          {isValid && pctDiff !== null && (
            <div className={`text-xs mt-1 ${mutedClass}`}>
              {pctDiff > 0 ? "+" : ""}
              {pctDiff}% from current price
            </div>
          )}
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreate}
          disabled={!isValid}
          className={`w-full py-2 rounded-sm text-sm font-medium transition-colors ${
            isValid
              ? "bg-orange-600 text-white hover:bg-orange-700"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          Create Alert
        </button>

        {/* Max alerts info */}
        <div className={`text-xs ${mutedClass} mt-2 text-center`}>
          {existingAlerts.length}/10 alerts for {ticker}
        </div>

        {/* Existing Alerts */}
        {existingAlerts.length > 0 && (
          <div className="mt-4">
            <div className={`text-xs font-medium ${mutedClass} mb-2`}>
              Active Alerts
            </div>
            <div className="space-y-1.5">
              {existingAlerts.map((alert, i) => {
                const pct = getPctFromCurrent(alert.targetPrice);
                const isAbove = alert.direction === "above";
                return (
                  <div
                    key={alert.id || i}
                    className={`flex items-center justify-between px-3 py-2 rounded-sm border text-sm ${
                      darkMode
                        ? "border-zinc-800 bg-zinc-950"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={isAbove ? "text-green-500" : "text-red-500"}
                      >
                        {isAbove ? "▲" : "▼"}
                      </span>
                      <span className="font-medium">
                        ${alert.targetPrice.toFixed(2)}
                      </span>
                      <span className={`text-xs ${mutedClass}`}>
                        {pct > 0 ? "+" : ""}
                        {pct}%
                      </span>
                    </div>
                    <button
                      onClick={() => onDeleteAlert(alert)}
                      className="text-red-500 hover:text-red-400 text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
