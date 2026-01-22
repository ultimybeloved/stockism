// ============================================
// Loading Component
// Reusable loading spinner and states
// ============================================

import React from 'react';

/**
 * Loading Spinner component
 * @param {Object} props
 * @param {string} props.size - Spinner size: 'sm' | 'md' | 'lg'
 * @param {string} props.color - Spinner color class
 * @param {string} props.className - Additional class names
 */
export const Spinner = ({
  size = 'md',
  color = 'text-blue-600',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <svg
      className={`
        animate-spin
        ${sizeClasses[size] || sizeClasses.md}
        ${color}
        ${className}
      `}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
};

/**
 * Loading overlay component
 * @param {Object} props
 * @param {string} props.message - Loading message
 * @param {boolean} props.darkMode - Dark mode flag
 */
export const LoadingOverlay = ({
  message = 'Loading...',
  darkMode = false
}) => (
  <div className={`
    fixed inset-0 z-50 flex items-center justify-center
    ${darkMode ? 'bg-gray-900/80' : 'bg-white/80'}
    backdrop-blur-sm
  `}>
    <div className="flex flex-col items-center gap-4">
      <Spinner size="lg" />
      <p className={`text-lg font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {message}
      </p>
    </div>
  </div>
);

/**
 * Loading state for content areas
 * @param {Object} props
 * @param {string} props.message - Loading message
 * @param {string} props.height - Container height class
 * @param {boolean} props.darkMode - Dark mode flag
 */
export const LoadingState = ({
  message = 'Loading...',
  height = 'h-64',
  darkMode = false
}) => (
  <div className={`
    ${height} flex flex-col items-center justify-center gap-3
    ${darkMode ? 'text-gray-400' : 'text-gray-500'}
  `}>
    <Spinner />
    <p className="text-sm">{message}</p>
  </div>
);

/**
 * Skeleton loader for text
 */
export const SkeletonText = ({
  width = 'w-full',
  height = 'h-4',
  darkMode = false,
  className = ''
}) => (
  <div
    className={`
      ${width} ${height}
      rounded animate-pulse
      ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}
      ${className}
    `}
  />
);

/**
 * Skeleton loader for cards
 */
export const SkeletonCard = ({
  darkMode = false,
  className = ''
}) => (
  <div className={`
    p-4 rounded-xl
    ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}
    ${className}
  `}>
    <div className="animate-pulse space-y-3">
      <SkeletonText width="w-1/2" darkMode={darkMode} />
      <SkeletonText darkMode={darkMode} />
      <SkeletonText width="w-3/4" darkMode={darkMode} />
    </div>
  </div>
);

const Loading = {
  Spinner,
  Overlay: LoadingOverlay,
  State: LoadingState,
  SkeletonText,
  SkeletonCard
};

export default Loading;
