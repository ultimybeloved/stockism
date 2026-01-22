// ============================================
// Card Component
// Reusable card container with consistent styling
// ============================================

import React from 'react';

/**
 * Card component
 * @param {Object} props
 * @param {string} props.variant - Card variant: 'default' | 'outlined' | 'elevated'
 * @param {string} props.padding - Padding: 'none' | 'sm' | 'md' | 'lg'
 * @param {boolean} props.darkMode - Dark mode flag
 * @param {boolean} props.hover - Enable hover effect
 * @param {boolean} props.clickable - Enable clickable styling
 * @param {string} props.className - Additional class names
 * @param {Function} props.onClick - Click handler
 * @param {React.ReactNode} props.children - Card content
 */
const Card = ({
  variant = 'default',
  padding = 'md',
  darkMode = false,
  hover = false,
  clickable = false,
  className = '',
  onClick,
  children,
  ...props
}) => {
  // Base classes
  const baseClasses = 'rounded-xl overflow-hidden';

  // Variant classes
  const variantClasses = {
    default: darkMode
      ? 'bg-gray-800 border border-gray-700'
      : 'bg-white border border-gray-200',
    outlined: darkMode
      ? 'bg-transparent border-2 border-gray-600'
      : 'bg-transparent border-2 border-gray-300',
    elevated: darkMode
      ? 'bg-gray-800 shadow-lg shadow-black/20'
      : 'bg-white shadow-lg shadow-gray-200'
  };

  // Padding classes
  const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6'
  };

  // Hover and clickable classes
  const interactionClasses = `
    ${hover || clickable ? 'transition-all duration-200' : ''}
    ${hover ? (darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50') : ''}
    ${clickable ? 'cursor-pointer' : ''}
    ${clickable && !hover ? (darkMode ? 'hover:border-gray-600' : 'hover:border-gray-300') : ''}
  `;

  return (
    <div
      className={`
        ${baseClasses}
        ${variantClasses[variant] || variantClasses.default}
        ${paddingClasses[padding] || paddingClasses.md}
        ${interactionClasses}
        ${className}
      `}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
};

/**
 * Card Header component
 */
export const CardHeader = ({ children, className = '', darkMode = false }) => (
  <div className={`
    pb-3 border-b
    ${darkMode ? 'border-gray-700' : 'border-gray-200'}
    ${className}
  `}>
    {children}
  </div>
);

/**
 * Card Title component
 */
export const CardTitle = ({ children, className = '' }) => (
  <h3 className={`text-lg font-semibold ${className}`}>
    {children}
  </h3>
);

/**
 * Card Content component
 */
export const CardContent = ({ children, className = '' }) => (
  <div className={className}>
    {children}
  </div>
);

/**
 * Card Footer component
 */
export const CardFooter = ({ children, className = '', darkMode = false }) => (
  <div className={`
    pt-3 mt-3 border-t
    ${darkMode ? 'border-gray-700' : 'border-gray-200'}
    ${className}
  `}>
    {children}
  </div>
);

export default Card;
