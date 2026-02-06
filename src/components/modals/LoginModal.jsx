import React, { useState } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import { auth, googleProvider, twitterProvider } from '../../firebase';

const LoginModal = ({ onClose, darkMode }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // Don't close modal - let the username modal appear if needed
      // The auth state listener will handle the flow
      onClose();
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup, not an error
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Domain not authorized. Please add this domain to Firebase Auth settings.');
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  };

  const handleTwitterSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, twitterProvider);
      onClose();
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup, not an error
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Domain not authorized. Please add this domain to Firebase Auth settings.');
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        setError('An account already exists with this email. Try signing in with Google instead.');
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  };

  const handleDiscordSignIn = () => {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordAuth');
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20email`;
    window.location.href = discordAuthUrl;
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
        // Create auth account and send verification email
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        setError(''); // Clear any errors
        // Show success message
        alert('Verification email sent! Please check your inbox and verify your email before signing in.');
        // Sign out immediately so they can't bypass verification
        await signOut(auth);
        setIsRegistering(false); // Switch to sign in mode
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err) {
      if (err.code === 'auth/user-not-found') setError('No account found with this email');
      else if (err.code === 'auth/wrong-password') setError('Incorrect password');
      else if (err.code === 'auth/invalid-credential') setError('Invalid email or password');
      else if (err.code === 'auth/email-already-in-use') setError('Email already in use');
      else setError(err.message);
    }
    setLoading(false);
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    if (!email) {
      setError('Please enter your email address');
      setLoading(false);
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccessMessage('Password reset email sent! Check your inbox.');
      setEmail('');
    } catch (err) {
      if (err.code === 'auth/user-not-found') setError('No account found with this email');
      else if (err.code === 'auth/invalid-email') setError('Invalid email address');
      else setError(err.message);
    }
    setLoading(false);
  };

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  const inputClass = darkMode
    ? 'bg-zinc-950 border-zinc-700 text-zinc-100'
    : 'bg-white border-amber-200 text-slate-900';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6`} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-4 right-4 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>

        <h2 className={`text-lg font-semibold mb-6 ${textClass}`}>
          {isForgotPassword ? 'Reset Password' : (isRegistering ? 'Create Account' : 'Sign In')}
        </h2>

        {!isForgotPassword && (
          <>
        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Twitter/X Sign In */}
        <button
          onClick={handleTwitterSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          Continue with X
        </button>

        {/* Discord Sign In */}
        <button
          onClick={handleDiscordSignIn}
          disabled={loading}
          className={`w-full py-2.5 px-4 rounded-sm border flex items-center justify-center gap-2 mb-4 ${
            darkMode ? 'border-zinc-700 text-slate-200 hover:bg-zinc-800' : 'border-amber-200 text-slate-700 hover:bg-amber-50'
          } disabled:opacity-50`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5865F2">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
          Continue with Discord
        </button>

        <div className={`flex items-center gap-3 mb-4 ${mutedClass}`}>
          <div className="flex-1 h-px bg-current opacity-30"></div>
          <span className="text-xs uppercase">or</span>
          <div className="flex-1 h-px bg-current opacity-30"></div>
        </div>
        </>
        )}

        {/* Email Form - Sign in or Register */}
        {!isForgotPassword ? (
        <form onSubmit={handleEmailSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          {isRegistering && (
            <>
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
                disabled={loading}
                required
              />
              <p className={`text-xs ${mutedClass}`}>
                📧 A verification email will be sent to your email address. You must verify your email before you can sign in.
              </p>
            </>
          )}
          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-sm text-sm uppercase disabled:opacity-50"
          >
            {loading ? 'Please wait...' : (isRegistering ? 'Register' : 'Sign In')}
          </button>
          {!isRegistering && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setIsForgotPassword(true); setError(''); }}
                className={`text-xs ${mutedClass} hover:text-orange-600`}
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>
        ) : (
        <form onSubmit={handlePasswordReset} className="space-y-3">
          <p className={`text-sm ${mutedClass} mb-3`}>
            Enter your email address and we'll send you a link to reset your password.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass}`}
            disabled={loading}
            required
          />
          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-100 border border-green-300 text-green-700 px-3 py-2 rounded-sm text-sm">
              {successMessage}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-sm text-sm uppercase disabled:opacity-50"
          >
            {loading ? 'Please wait...' : 'Send Reset Link'}
          </button>
        </form>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              if (isForgotPassword) {
                setIsForgotPassword(false);
              } else {
                setIsRegistering(!isRegistering);
                setConfirmPassword('');
              }
              setError('');
              setSuccessMessage('');
            }}
            className={`text-sm ${mutedClass} hover:text-orange-600`}
          >
            {isForgotPassword ? 'Back to sign in' : (isRegistering ? 'Already have an account? Sign in with email' : "Don't have an account? Register")}
          </button>
        </div>

        <div className={`mt-4 text-center text-xs ${mutedClass}`}>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Terms of Service
          </a>
          {' • '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Privacy Policy
          </a>
          {' • '}
          <a href="https://discord.gg/yxw94uNrYv" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Discord
          </a>
          {' • '}
          <a href="https://reddit.com/r/stockismapp" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 underline">
            Reddit
          </a>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;
