import { useState } from 'react';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '../../firebase';

const EmailVerificationModal = ({ user, darkMode, userData }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleResendVerification = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      await sendEmailVerification(user);
      setMessage('Verification email sent! Please check your inbox.');
    } catch (err) {
      setMessage('Error sending email. Please try again later.');
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleCheckVerification = () => {
    // Force reload user to check verification status
    if (user) {
      user.reload().then(() => {
        if (user.emailVerified) {
          window.location.reload(); // Refresh to update state
        } else {
          setMessage('Email not yet verified. Please check your inbox.');
        }
      });
    }
  };

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">📧</div>
          <h2 className={`text-xl font-semibold mb-2 ${textClass}`}>Verify Your Email</h2>
          <p className={`text-sm ${mutedClass}`}>
            We sent a verification link to <span className={`font-semibold ${textClass}`}>{user?.email}</span>
          </p>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-sm text-sm ${
            message.includes('sent')
              ? darkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-800'
              : darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}

        <div className={`mb-6 p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
          <p className={`text-sm ${textClass} mb-2`}>📋 Next steps:</p>
          <ol className={`text-sm ${mutedClass} space-y-1 list-decimal list-inside`}>
            <li>Check your email inbox (and spam folder)</li>
            <li>Click the verification link in the email</li>
            <li>Return here and click "I've Verified"</li>
          </ol>
        </div>

        <div className="space-y-2">
          <button
            onClick={handleCheckVerification}
            className="w-full py-2.5 px-4 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            I've Verified My Email
          </button>

          <button
            onClick={handleResendVerification}
            disabled={loading}
            className={`w-full py-2.5 px-4 rounded-sm border ${
              darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
            } disabled:opacity-50`}
          >
            {loading ? 'Sending...' : 'Resend Verification Email'}
          </button>

          <button
            onClick={handleSignOut}
            className={`w-full py-2 px-4 text-sm ${mutedClass} ${userData?.colorBlindMode ? 'hover:text-purple-500' : 'hover:text-red-500'}`}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationModal;
