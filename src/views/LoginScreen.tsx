import { Icons } from '../components/Icons';
import { API_BASE_URL } from '../services/api';

interface LoginScreenProps {
  onCheckingAuth?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onCheckingAuth }) => {
  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-500/25 mb-4">
            <Icons.Inbox className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">OrderPulse</h1>
          <p className="text-slate-400">AI-Powered Supply Chain Intelligence</p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">Welcome</h2>
            <p className="text-slate-400 text-sm">
              Sign in with your Google account to automatically analyze your purchase orders
            </p>
          </div>

          {onCheckingAuth ? (
            <div className="flex flex-col items-center py-4">
              <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full mb-3" />
              <span className="text-slate-400 text-sm">Checking authentication...</span>
            </div>
          ) : (
            <>
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-medium py-3 px-4 rounded-xl transition-all shadow-lg hover:shadow-xl"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>

              <div className="mt-6 text-center">
                <p className="text-slate-500 text-xs">
                  We'll read your Gmail to find purchase orders and invoices.
                  <br />
                  Your data stays private and secure.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="text-slate-400">
            <Icons.Mail className="w-5 h-5 mx-auto mb-2 text-orange-400" />
            <span className="text-xs">Email Analysis</span>
          </div>
          <div className="text-slate-400">
            <Icons.TrendingUp className="w-5 h-5 mx-auto mb-2 text-blue-400" />
            <span className="text-xs">Order Tracking</span>
          </div>
          <div className="text-slate-400">
            <Icons.Calendar className="w-5 h-5 mx-auto mb-2 text-green-400" />
            <span className="text-xs">Cadence Insights</span>
          </div>
        </div>
      </div>
    </div>
  );
};
