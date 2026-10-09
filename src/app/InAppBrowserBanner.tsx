import { memo, useState } from 'react';

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Discord|Twitter|Snapchat|TikTok|Line|WeChat|MicroMessenger|Pinterest/i;

// Apps like Discord and Instagram open links in their own browser, where sign-in
// and trading can break. Suggest a real browser, once, dismissible.
const InAppBrowserBanner = () => {
  const [show, setShow] = useState(() => IN_APP_BROWSER.test(navigator.userAgent || ''));
  if (!show) return null;

  return (
    <div className="mx-4 mt-3 p-3 rounded-sm border text-sm flex items-center justify-between gap-2 light:bg-amber-50 light:border-amber-300 light:text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200">
      <span>For the best experience, open this page in your browser. Trading may not work in this app.</span>
      <button
        onClick={() => setShow(false)}
        className="shrink-0 font-bold text-lg leading-none opacity-60 hover:opacity-100"
      >
        &times;
      </button>
    </div>
  );
};

export default memo(InAppBrowserBanner);
