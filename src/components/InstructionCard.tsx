import { Icons } from './Icons';

interface InstructionCardProps {
  title?: string;
  steps: string[];
  icon?: keyof typeof Icons;
  className?: string;
  variant?: 'card' | 'compact';
}

export const InstructionCard: React.FC<InstructionCardProps> = ({
  title = 'What to do',
  steps,
  icon = 'Lightbulb',
  className = '',
  variant = 'card',
}) => {
  const Icon = Icons[icon] || Icons.Lightbulb;
  const isCompact = variant === 'compact';

  return (
    <div className={`card-arda ${isCompact ? 'p-3' : 'p-4'} ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <div
          className={[
            'flex items-center justify-center text-arda-accent bg-orange-50 border border-orange-100',
            isCompact ? 'w-8 h-8 rounded-lg' : 'w-9 h-9 rounded-xl',
          ].join(' ')}
        >
          <Icon className={isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </div>

        <div className="min-w-0">
          <p className={isCompact ? 'text-[11px] font-semibold text-arda-text-muted uppercase tracking-wide' : 'text-sm font-semibold text-arda-text-primary'}>
            {title}
          </p>

          {isCompact ? (
            <p className="mt-1 text-xs text-arda-text-secondary leading-relaxed">
              {steps.map((step, index) => (
                <span key={`${step}-${index}`}>
                  {step}
                  {index < steps.length - 1 ? ' • ' : ''}
                </span>
              ))}
            </p>
          ) : (
            <ul className="mt-2 text-sm text-arda-text-secondary space-y-1 list-disc list-inside">
              {steps.map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
