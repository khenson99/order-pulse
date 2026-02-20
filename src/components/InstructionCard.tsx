import { Icons } from './Icons';

interface InstructionCardProps {
  title?: string;
  steps: string[];
  icon?: keyof typeof Icons;
  className?: string;
}

export const InstructionCard: React.FC<InstructionCardProps> = ({
  title = 'What to do',
  steps,
  icon = 'Lightbulb',
  className = '',
}) => {
  const Icon = Icons[icon] || Icons.Lightbulb;

  return (
    <div className={`card-arda p-4 ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-arda-accent">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-arda-text-primary">{title}</p>
          <ul className="mt-2 text-sm text-arda-text-secondary space-y-1 list-disc list-inside">
            {steps.map((step, index) => (
              <li key={`${step}-${index}`}>{step}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
