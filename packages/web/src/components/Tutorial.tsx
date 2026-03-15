import { useState } from 'react';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import raffleTimeBanner from 'figma:asset/34b54141e85c86801c53340c86d48f1cef44c2b7.png';

interface TutorialProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function Tutorial({ onComplete, onSkip }: TutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const steps = [
    {
      title: "WIN $ WITH RAFFLETIME!",
      subtitle: "Chance to win up to 50% of the pot every hour",
      backgroundPosition: "left"
    },
    {
      title: "INCREASE YOUR CHANCES", 
      subtitle: "Join the raffle by buying one or more tickets",
      backgroundPosition: "center"
    },
    {
      title: "WINNERS EVERY HOUR",
      subtitle: "Join at any time and see the draw in under 60 mins!",
      backgroundPosition: "right"
    }
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Carousel */}
      <div className="h-[75vh] relative overflow-hidden">
        <div 
          className="h-full w-full bg-cover bg-no-repeat transition-all duration-300 flex items-center justify-center"
          style={{
            backgroundImage: `url(${raffleTimeBanner})`,
            backgroundPosition: steps[currentStep].backgroundPosition
          }}
        >
          <div className="bg-black/65 absolute inset-0"></div>
          <div className="relative z-10 text-center text-white p-8 max-w-md">
            <h1 className="mb-2 drop-shadow-2xl" style={{ fontSize: '2.5rem', textShadow: '2px 2px 8px rgba(0,0,0,0.8)' }}>{steps[currentStep].title}</h1>
            <p className="text-xl mb-8 drop-shadow-xl" style={{ textShadow: '1px 1px 6px rgba(0,0,0,0.7)' }}>{steps[currentStep].subtitle}</p>
            
            {/* Navigation arrows */}
            <div className="flex justify-between items-center mb-8">
              <Button
                variant="ghost"
                size="icon"
                onClick={prevStep}
                disabled={currentStep === 0}
                className="text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              
              {/* Step indicators */}
              <div className="flex space-x-2">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`w-3 h-3 rounded-full ${
                      index === currentStep ? 'bg-white' : 'bg-white/40'
                    }`}
                  />
                ))}
              </div>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={nextStep}
                disabled={currentStep === steps.length - 1}
                className="text-white hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="p-6 space-y-4">
        <div className="flex justify-center">
          <Button 
            onClick={onComplete}
            className="py-4 text-lg px-12"
            style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
          >
            🔥 LET'S GO 🔥
          </Button>
        </div>
        
        <button
          onClick={onSkip}
          className="w-full text-sm opacity-60 hover:opacity-100 transition-opacity text-center"
          style={{ color: '#4c2815' }}
        >
          SKIP TUTORIAL
        </button>
      </div>
    </div>
  );
}