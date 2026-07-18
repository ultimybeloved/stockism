import React from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';

const Footer = () => {
  const { darkMode } = useAppContext();
  const links = [
    { href: 'https://discord.gg/yxw94uNrYv', label: 'Discord', external: true },
    { href: 'https://reddit.com/r/stockismapp', label: 'Reddit', external: true },
    { href: '/terms.html', label: 'Terms of Service', external: true },
    { href: '/privacy.html', label: 'Privacy Policy', external: true }
  ];

  return (
    <footer className={`py-6 text-center text-sm border-t ${
      darkMode
        ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
        : 'bg-white border-amber-200 text-zinc-600'
    }`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {links.map((link) => (
            <React.Fragment key={link.href}>
              {link.external ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:underline ${
                    darkMode ? 'hover:text-orange-400' : 'hover:text-orange-500'
                  }`}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  to={link.href}
                  className={`hover:underline ${
                    darkMode ? 'hover:text-orange-400' : 'hover:text-orange-500'
                  }`}
                >
                  {link.label}
                </Link>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          © {new Date().getFullYear()} Stockism. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
