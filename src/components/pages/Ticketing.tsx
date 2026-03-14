import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { ArrowLeft, Check } from 'lucide-react';
import { ProgressStepper } from '../ProgressStepper';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface TicketingProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function Ticketing({ onBack, onSuccess }: TicketingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>(['', '', '', '']);
  const [selectedCharity, setSelectedCharity] = useState('');
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });

  const steps = ['Sign In', 'Pick Numbers', 'Choose Charity'];

  const charities = [
    {
      name: 'UNICEF',
      logo: 'https://images.unsplash.com/photo-1617783919077-f86206a0f495?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxVTklDRUYlMjBsb2dvJTIwb2ZmaWNpYWx8ZW58MXx8fHwxNzU4Njc0NDAwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    },
    {
      name: 'Save the Children',
      logo: 'https://images.unsplash.com/photo-1584441405886-bc91be61e56a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxTYXZlJTIwdGhlJTIwQ2hpbGRyZW4lMjBjaGFyaXR5JTIwbG9nb3xlbnwxfHx8fDE3NTg2NzQ0MDN8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    },
    {
      name: 'ChildFund International',
      logo: 'https://images.unsplash.com/photo-1530290634303-ec5bd373e292?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxDaGlsZEZ1bmQlMjBJbnRlcm5hdGlvbmFsJTIwbG9nb3xlbnwxfHx8fDE3NTg2NzQ0MDV8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    },
    {
      name: 'WorldVision International',
      logo: 'https://images.unsplash.com/photo-1570358934836-6802981e481e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxXb3JsZCUyMFZpc2lvbiUyMEludGVybmF0aW9uYWwlMjBjaGFyaXR5JTIwbG9nb3xlbnwxfHx8fDE3NTg2NzQ0MDh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    }
  ];

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      
      const diff = nextHour.getTime() - now.getTime();
      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSignIn = () => {
    console.log('Signing in with World ID...');
    setCurrentStep(1);
  };

  const handleBuyTicket = () => {
    console.log(`Buying ticket with numbers: ${selectedNumbers.join('')}`);
    setCurrentStep(2);
  };

  const handleNumberChange = (index: number, value: string) => {
    const newNumbers = [...selectedNumbers];
    newNumbers[index] = value;
    setSelectedNumbers(newNumbers);
  };

  const isTicketComplete = selectedNumbers.every(num => num !== '');

  const handleVote = () => {
    console.log(`Voting for ${selectedCharity}`);
    onSuccess();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4" style={{ color: '#514444' }}>
                Sign in to RaffleTime
              </h2>
              <p className="mb-4" style={{ color: '#514444' }}>
                Sign in to confirm wallet ownership and authenticate to RaffleTime.
              </p>
              <p className="mb-6" style={{ color: '#514444' }}>
                This app will see:
              </p>
              
              <div className="bg-white rounded-lg p-4 mb-6 text-left">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <Check className="h-5 w-5 text-green-500" />
                    <span style={{ color: '#514444' }}>Your wallet</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Check className="h-5 w-5 text-green-500" />
                    <span style={{ color: '#514444' }}>Your verification level</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between bg-white rounded-lg p-4 mb-6">
                <span style={{ color: '#514444' }}>Keep me signed in for future sessions</span>
                <Switch
                  checked={keepSignedIn}
                  onCheckedChange={setKeepSignedIn}
                />
              </div>
            </div>

            <Button
              onClick={handleSignIn}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              SIGN IN
            </Button>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#514444' }}>
                Eyes on the Prize 👁️💰
              </h2>
              <div className="text-3xl font-bold mb-1" style={{ color: '#514444' }}>
                Win 1000 WLD
              </div>
              <div className="text-sm opacity-80 mb-4" style={{ color: '#514444' }}>
                Total pool 2050 WLD
              </div>
              
              <div className="flex items-center justify-center gap-2 mb-6">
                <span>⏰</span>
                <span className="text-lg font-bold text-red-500">
                  {String(timeLeft.minutes).padStart(2, '0')}:
                  {String(timeLeft.seconds).padStart(2, '0')}
                </span>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 space-y-6">
              <div>
                <Label className="block mb-4 text-center" style={{ color: '#514444' }}>
                  Pick Your Lucky Numbers!
                </Label>
                
                {/* 4 Number Selectors Grid */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {selectedNumbers.map((number, index) => (
                    <div key={index} className="text-center">
                      <Label className="block mb-2 text-sm" style={{ color: '#514444' }}>
                        #{index + 1}
                      </Label>
                      <Select 
                        value={number} 
                        onValueChange={(value) => handleNumberChange(index, value)}
                      >
                        <SelectTrigger className="w-full h-12">
                          <SelectValue placeholder="?" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 9 }, (_, i) => i + 1).map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                {/* Selected Numbers Display */}
                <div className="text-center">
                  <Label className="block mb-2" style={{ color: '#514444' }}>
                    Your Ticket Number
                  </Label>
                  <div 
                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg border-2 min-w-32"
                    style={{ 
                      backgroundColor: isTicketComplete ? '#ffcd18' : '#F5EFE6',
                      borderColor: isTicketComplete ? '#bc1f13' : '#D1D5DB',
                      color: '#4c2815'
                    }}
                  >
                    <span className="text-2xl font-bold tracking-wider">
                      {selectedNumbers.join('') || '????'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-center py-2">
                <span className="text-lg" style={{ color: '#514444' }}>
                  1 Ticket = 0.1 WLD
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleBuyTicket}
                disabled={!isTicketComplete}
                className="w-full py-3"
                style={{ 
                  backgroundColor: isTicketComplete ? '#bc1f13' : '#D1D5DB', 
                  color: '#FFFFFF',
                  opacity: isTicketComplete ? 1 : 0.6
                }}
              >
                BUY TICKET
              </Button>
              
              <button
                onClick={onBack}
                className="w-full text-sm opacity-60 hover:opacity-100 transition-opacity"
                style={{ color: '#4c2815' }}
              >
                CANCEL
              </button>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4" style={{ color: '#514444' }}>
                Choose a charity
              </h2>
              <p style={{ color: '#514444' }}>
                The charity with the most votes will receive 50 WLD.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6">
              <RadioGroup value={selectedCharity} onValueChange={setSelectedCharity}>
                <div className="space-y-4">
                  {charities.map((charity, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <RadioGroupItem value={charity.name} id={charity.name} />
                      <ImageWithFallback
                        src={charity.logo}
                        alt={`${charity.name} logo`}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <Label
                        htmlFor={charity.name}
                        className="flex-1 cursor-pointer"
                        style={{ color: '#514444' }}
                      >
                        {charity.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>

            <Button
              onClick={handleVote}
              disabled={!selectedCharity}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              VOTE
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="mr-2 hover:bg-transparent"
          style={{ 
            color: '#FFFFFF',
            backgroundColor: 'transparent',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#bc1f13';
            e.currentTarget.style.backgroundColor = '#FFFFFF';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#FFFFFF';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Join Raffle</h1>
      </div>

      <ProgressStepper
        currentStep={currentStep}
        totalSteps={steps.length}
        steps={steps}
      />

      <div className="max-w-md mx-auto">
        {renderStep()}
      </div>
    </div>
  );
}