import { Icons } from '../components/Icons';
import { InstructionCard } from '../components/InstructionCard';

interface WelcomeStepItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Icons;
}

interface OnboardingWelcomeStepProps {
  steps: WelcomeStepItem[];
  userProfile?: { name?: string; email?: string };
  onStartEmailSync: () => void;
  onSkipEmail: () => void;
}

export const OnboardingWelcomeStep: React.FC<OnboardingWelcomeStepProps> = ({
  steps,
  userProfile,
  onStartEmailSync,
  onSkipEmail,
}) => {
  const firstName = userProfile?.name?.split(' ')[0];

  return (
    <div className="space-y-6">
      <div className="card-arda p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center">
            <Icons.Sparkles className="w-6 h-6 text-arda-accent" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-arda-text-primary">
              {firstName ? `Thanks for signing up, ${firstName}.` : 'Thanks for signing up for Arda.'}
            </h2>
            <p className="text-sm text-arda-text-secondary mt-1">
              Here is the onboarding path. You can skip any step and return later.
            </p>
          </div>
        </div>
      </div>

      <InstructionCard
        title="What you will do"
        icon="MapPin"
        steps={[
          'Start email sync to import orders automatically.',
          'Add items via URLs, barcodes, photos, or CSV.',
          'Review and sync items to Arda.',
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((step, index) => {
          const Icon = Icons[step.icon] || Icons.Circle;
          return (
            <div key={step.id} className="card-arda p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-arda-bg-tertiary border border-arda-border flex items-center justify-center">
                  <Icon className="w-5 h-5 text-arda-text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-arda-text-muted">Step {index + 1}</p>
                  <h3 className="text-base font-semibold text-arda-text-primary">{step.title}</h3>
                </div>
              </div>
              <p className="mt-2 text-sm text-arda-text-secondary">
                {step.description}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onStartEmailSync}
          className="btn-arda-primary flex items-center justify-center gap-2 px-6 py-3"
        >
          <Icons.Mail className="w-4 h-4" />
          Start email sync
        </button>
        <button
          type="button"
          onClick={onSkipEmail}
          className="btn-arda-outline flex items-center justify-center gap-2 px-6 py-3"
        >
          <Icons.ArrowRight className="w-4 h-4" />
          Skip email for now
        </button>
      </div>
    </div>
  );
};
