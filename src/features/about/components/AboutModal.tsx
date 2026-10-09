import { useState } from 'react';
import { getThemeClasses } from '../../../utils/theme';
import { useTheme } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import AboutTab from './AboutTab';
import FaqTab from './FaqTab';
import PrivacyTab from './PrivacyTab';

type AboutTabKey = 'about' | 'faq' | 'privacy';

const AboutModal = ({ onClose }: { onClose: () => void }) => {
  useEscapeKey(onClose);
  const { darkMode } = useTheme();
  const [activeTab, setActiveTab] = useState<AboutTabKey>('about');

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${cardEdgeClass}`}>
          {(
            [
              { key: 'about', label: '📖 About' },
              { key: 'faq', label: '❓ FAQ' },
              { key: 'privacy', label: '🔒 Privacy' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold ${
                activeTab === tab.key ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ABOUT TAB */}
          {activeTab === 'about' && <AboutTab />}

          {/* FAQ TAB */}
          {activeTab === 'faq' && <FaqTab />}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && <PrivacyTab />}
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
