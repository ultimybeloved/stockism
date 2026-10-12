import { useState } from 'react';
import { themeClasses } from '../../../utils/theme';

import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import AboutTab from './AboutTab';
import FaqTab from './FaqTab';
import PrivacyTab from './PrivacyTab';
import PixelIcon from '../../../shared/components/PixelIcon';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';

type AboutTabKey = 'about' | 'faq' | 'privacy';

const AboutModal = ({ onClose }: { onClose: () => void }) => {
  useEscapeKey(onClose);
  const dialogRef = useModalFocus();
  const [activeTab, setActiveTab] = useState<AboutTabKey>('about');

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = themeClasses;

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button aria-label="Close" onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${cardEdgeClass}`}>
          {(
            [
              { key: 'about', icon: 'book', label: 'About' },
              { key: 'faq', icon: 'faq', label: 'FAQ' },
              { key: 'privacy', icon: 'privacy', label: 'Privacy' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold ${
                activeTab === tab.key ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass
              }`}
            >
              <PixelIcon name={tab.icon} className="w-4 h-4 mr-1 align-[-3px]" />
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
