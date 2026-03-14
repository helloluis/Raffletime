interface ProgressStepperProps {
  currentStep: number;
  totalSteps: number;
  steps: string[];
}

export function ProgressStepper({ currentStep, totalSteps, steps }: ProgressStepperProps) {
  return (
    <div className="w-full max-w-md mx-auto mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index < currentStep
                    ? 'bg-green-500 text-white'
                    : index === currentStep
                    ? 'text-white'
                    : 'bg-gray-300 text-gray-600'
                }`}
                style={
                  index === currentStep
                    ? { backgroundColor: '#bc1f13', color: '#FFFFFF', border: '2px solid #FFFFFF' }
                    : { border: '2px solid #FFFFFF' }
                }
              >
                {index < currentStep ? '✓' : index + 1}
              </div>
              <span
                className={`text-xs mt-2 text-center ${
                  index <= currentStep ? 'font-medium' : 'text-gray-500'
                }`}
                style={
                  index <= currentStep
                    ? { color: '#514444' }
                    : { color: '#999' }
                }
              >
                {step}
              </span>
            </div>
            {index < totalSteps - 1 && (
              <div
                className={`h-0.5 w-16 mx-2 ${
                  index < currentStep ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}