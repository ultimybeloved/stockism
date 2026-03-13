import { useState, useCallback } from "react";

const STEPS = [
  {
    title: "Welcome to Stockism!",
    emoji: "📈",
    description:
      "You start with $1,000 in cash. Trade Lookism characters like stocks — buy low, sell high, and grow your portfolio. Every character has a live price that changes based on what players do.",
    spotlight: false,
  },
  {
    title: "Join a Crew",
    emoji: null,
    emojiImg: "/crews/wtjc.png",
    description:
      "Pick a crew to join! Each crew gives you unique missions and bonus rewards. Work together with your crewmates to climb the leaderboard and earn extra cash.",
    spotlight: "down",
  },
  {
    title: "Start Trading",
    emoji: "💰",
    description:
      "Tap any character card to see their price chart. Hit the Trade button, choose Buy or Sell, and pick how many shares you want. Prices go up when people buy and down when they sell. Timing is everything.",
    spotlight: false,
  },
  {
    title: "Complete Missions",
    emoji: "🎯",
    description:
      "Check your missions daily! You'll get daily and weekly challenges that earn you bonus cash when completed. Missions reset on a timer so keep coming back.",
    spotlight: false,
  },
  {
    title: "You're Ready!",
    emoji: "🚀",
    description:
      "Explore the leaderboard to see top traders, unlock achievements as you play, try the ladder game for quick cash, and make predictions on character prices. Good luck out there!",
    spotlight: false,
    isFinal: true,
  },
];

export default function OnboardingTutorial({ onComplete, darkMode }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [animating, setAnimating] = useState(false);

  const current = STEPS[step];

  const goTo = useCallback(
    (next) => {
      if (animating || next < 0 || next >= STEPS.length) return;
      setDirection(next > step ? 1 : -1);
      setAnimating(true);
      setTimeout(() => {
        setStep(next);
        setAnimating(false);
      }, 200);
    },
    [step, animating]
  );

  const card = darkMode ? "bg-zinc-900 text-zinc-100" : "bg-white text-slate-900";
  const subtleText = darkMode ? "text-zinc-400" : "text-slate-600";
  const subtleBtn = darkMode
    ? "text-zinc-400 hover:text-zinc-200"
    : "text-slate-500 hover:text-slate-700";

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
      {/* Skip button — top right */}
      <button
        onClick={onComplete}
        className={`absolute top-4 right-4 text-sm ${subtleBtn} transition-colors cursor-pointer`}
      >
        Skip tutorial
      </button>

      {/* Card */}
      <div
        className={`relative max-w-md w-full mx-auto rounded-sm shadow-xl p-6 ${card} transition-all duration-200 ${
          animating
            ? direction > 0
              ? "opacity-0 translate-x-4"
              : "opacity-0 -translate-x-4"
            : "opacity-100 translate-x-0"
        }`}
      >
        {/* Step indicator dots */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors duration-200 ${
                i === step ? "bg-orange-600" : darkMode ? "bg-zinc-700" : "bg-slate-300"
              }`}
            />
          ))}
        </div>

        {/* Illustration emoji */}
        <div className="text-5xl text-center mb-4">
          {current.emojiImg ? (
            <img src={current.emojiImg} alt="" className="w-12 h-12 mx-auto object-contain" />
          ) : (
            current.emoji
          )}
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-center mb-2">{current.title}</h2>

        {/* Spotlight hint */}
        {current.spotlight === "down" && (
          <div className="flex justify-center mb-2">
            <span className={`text-xs ${subtleText}`}>↓ You can pick one below after the tutorial</span>
          </div>
        )}

        {/* Description */}
        <p className={`text-sm text-center leading-relaxed mb-6 ${subtleText}`}>
          {current.description}
        </p>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          {step > 0 ? (
            <button
              onClick={() => goTo(step - 1)}
              className={`text-sm px-4 py-2 rounded-sm transition-colors cursor-pointer ${subtleBtn}`}
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {current.isFinal ? (
            <button
              onClick={onComplete}
              className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm transition-colors cursor-pointer"
            >
              Start Trading!
            </button>
          ) : (
            <button
              onClick={() => goTo(step + 1)}
              className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm transition-colors cursor-pointer"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
