// ============================================
// Modal Component
// Reusable modal wrapper with consistent styling
// ============================================

import React, { useEffect, useCallback } from 'react';

/**
 * Modal wrapper component
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.title - Modal title
 * @param {React.ReactNode} props.children - Modal content
 * @param {string} props.size - Modal size: 'sm' | 'md' | 'lg' | 'xl' | 'full'
 * @param {boolean} props.darkMode - Dark mode flag
 * @param {boolean} props.showCloseButton - Show close button (default true)
 * @param {string} props.className - Additional class names
 */
const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  darkMode = false,
  showCloseButton = true,
  className = ''
}) => {
  // Handle escape key
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && onClose) {
      onClose();
    }
  }, [onClose]);

  // Add/remove event listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Size classes
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    full: 'max-w-full mx-4'
  };

  const maxWidthClass = sizeClasses[size] || sizeClasses.md;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal content */}
      <div
        className={`
          relative z-10 w-full ${maxWidthClass}
          ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}
          rounded-xl shadow-2xl overflow-hidden
          max-h-[90vh] flex flex-col
          ${className}
        `}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={`
            flex items-center justify-between p-4 border-b
            ${darkMode ? 'border-gray-700' : 'border-gray-200'}
          `}>
            {title && (
              <h2 className="text-xl font-bold">{title}</h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className={`
                  p-2 rounded-lg transition-colors
                  ${darkMode
                    ? 'hover:bg-gray-700 text-gray-400 hover:text-white'
                    : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
                  }
                `}
                aria-label="Close modal"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * Modal Header component for custom headers
 */
export const ModalHeader = ({ children, darkMode = false }) => (
  <div className={`
    p-4 border-b
    ${darkMode ? 'border-gray-700' : 'border-gray-200'}
  `}>
    {children}
  </div>
);

/**
 * Modal Body component for custom body styling
 */
export const ModalBody = ({ children, className = '' }) => (
  <div className={`flex-1 overflow-y-auto p-4 ${className}`}>
    {children}
  </div>
);

/**
 * Modal Footer component for actions
 */
export const ModalFooter = ({ children, darkMode = false }) => (
  <div className={`
    p-4 border-t
    ${darkMode ? 'border-gray-700' : 'border-gray-200'}
    flex justify-end gap-2
  `}>
    {children}
  </div>
);

export default Modal;
