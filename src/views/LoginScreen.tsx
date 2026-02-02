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
    <div className="relative min-h-screen arda-mesh flex items-center justify-center p-6">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 left-6 w-48 h-48 rounded-full bg-orange-400/15 blur-3xl animate-float" />
        <div className="absolute bottom-0 right-12 w-64 h-64 rounded-full bg-blue-500/15 blur-3xl animate-float" />
      </div>

      <div className="relative z-10 w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Left: brand story */}
        <div className="space-y-6">
          <div className="arda-pill w-fit">
            <Icons.Link className="w-4 h-4" />
            Arda Order Intelligence
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-arda-text-primary leading-tight">
            The easiest way to never run out.
          </h1>
          <p className="text-arda-text-secondary text-lg max-w-xl">
            Connect your email and let Arda's AI automatically discover your suppliers,
            track order velocity, and surface replenishment signals before stockouts happen.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-arda-text-secondary">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.ShieldCheck className="w-4 h-4 text-arda-accent" />
              Secure &amp; private
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.Activity className="w-4 h-4 text-arda-accent" />
              Live velocity signals
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.Sparkles className="w-4 h-4 text-arda-accent" />
              AI-powered extraction
            </div>
          </div>
        </div>

        {/* Right: sign-in card */}
        <div className="arda-glass rounded-2xl p-8 lg:p-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm uppercase tracking-wide text-arda-text-muted">Sign in</p>
              <h2 className="text-2xl font-bold text-arda-text-primary">Continue with Arda</h2>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-arda-lg">
              <Icons.Inbox className="w-6 h-6 text-white" />
            </div>
          </div>

          <div className="space-y-4">
            {onCheckingAuth ? (
              <div className="flex flex-col items-center py-6">
                <div className="animate-spin w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full mb-4" />
                <span className="text-arda-text-muted">Checking authentication...</span>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-arda-text-primary font-semibold py-3 px-4 rounded-xl transition-all shadow-arda-lg hover:shadow-arda-hover border border-arda-border"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            )}

            <div className="rounded-xl bg-arda-bg-secondary border border-arda-border p-4 text-sm text-arda-text-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Icons.Lock className="w-4 h-4 text-arda-accent" />
                Your data stays private
              </div>
              <p className="text-arda-text-muted">
                We only request Gmail scopes required for purchase-order detection.
                Your email content is never stored or shared.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 text-center text-xs text-arda-text-muted">
            <div className="flex flex-col items-center gap-1">
              <Icons.Mail className="w-4 h-4 text-arda-accent" />
              Email ingestion
            </div>
            <div className="flex flex-col items-center gap-1">
              <Icons.TrendingUp className="w-4 h-4 text-arda-accent" />
              Velocity models
            </div>
            <div className="flex flex-col items-center gap-1">
              <Icons.Box className="w-4 h-4 text-arda-accent" />
              Kanban-ready items
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
