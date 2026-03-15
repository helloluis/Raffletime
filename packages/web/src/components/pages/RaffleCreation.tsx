import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { ArrowLeft } from 'lucide-react';
import { ProgressStepper } from '../ProgressStepper';

interface RaffleCreationProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function RaffleCreation({ onBack, onSuccess }: RaffleCreationProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [codeHasBeenSent, setCodeHasBeenSent] = useState(false);
  const [depositMade, setDepositMade] = useState(false);
  const [formData, setFormData] = useState({
    yourName: 'Raffy',
    raffleName: 'My New Raffle',
    frequency: '',
    description: '',
    email: '',
    verificationCode: '000000'
  });

  const steps = ['Basic Info', 'Email Verification', 'Deposit'];

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleMoveToEmailVerification = () => {
    if (formData.yourName.trim() && formData.raffleName.trim() && formData.frequency && formData.description.trim()) {
      setCurrentStep(1);
    }
  };

  const handleMoveToDeposit = () => {
    if (formData.email.trim() && formData.verificationCode.trim() && codeHasBeenSent) {
      setCurrentStep(2);
    }
  };

  const handleSendCode = () => {
    if (formData.email.trim()) {
      setCodeHasBeenSent(true);
      console.log('Sending verification code to:', formData.email);
      // Here you would integrate with email service
    }
  };

  const handleDeposit = () => {
    console.log('Processing $5 deposit...');
    setDepositMade(true);
    // Here you would integrate with payment system
  };

  const handleSubmitForReview = () => {
    console.log('Submitting raffle for review:', formData);
    onSuccess();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6 space-y-4">
              <div>
                <Label htmlFor="yourName" className="block mb-2" style={{ color: '#514444' }}>
                  Your Name *
                </Label>
                <Input
                  id="yourName"
                  value={formData.yourName}
                  onChange={(e) => handleInputChange('yourName', e.target.value)}
                  className="w-full"
                  required
                />
              </div>

              <div>
                <Label htmlFor="raffleName" className="block mb-2" style={{ color: '#514444' }}>
                  Raffle Name *
                </Label>
                <Input
                  id="raffleName"
                  value={formData.raffleName}
                  onChange={(e) => handleInputChange('raffleName', e.target.value)}
                  className="w-full"
                  required
                />
              </div>

              <div>
                <Label className="block mb-2" style={{ color: '#514444' }}>
                  Frequency *
                </Label>
                <Select value={formData.frequency} onValueChange={(value) => handleInputChange('frequency', value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="every-4-hours">Every 4 Hours</SelectItem>
                    <SelectItem value="every-day">Every Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="description" className="block mb-2" style={{ color: '#514444' }}>
                  Describe your raffle *
                </Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className="w-full"
                  rows={4}
                  placeholder="Enter a description with simple HTML formatting..."
                  required
                />
                <p className="text-xs mt-1 opacity-60" style={{ color: '#514444' }}>
                  You can use simple HTML tags like &lt;b&gt;, &lt;i&gt;, &lt;u&gt;
                </p>
              </div>
            </div>

            <Button
              onClick={handleMoveToEmailVerification}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
              disabled={!formData.yourName.trim() || !formData.raffleName.trim() || !formData.frequency || !formData.description.trim()}
            >
              Move to Email Verification
            </Button>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6 space-y-4">
              <div>
                <Label htmlFor="email" className="block mb-2" style={{ color: '#514444' }}>
                  Email Address *
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className="w-full mb-2"
                  placeholder="your.email@example.com"
                  required
                />
                <Button
                  onClick={handleSendCode}
                  disabled={!formData.email.trim() || codeHasBeenSent}
                  className="px-4 py-2 whitespace-nowrap"
                  style={{ 
                    backgroundColor: codeHasBeenSent ? '#6b7280' : '#ffcd18', 
                    color: codeHasBeenSent ? '#ffffff' : '#4c2815',
                    minWidth: 'auto'
                  }}
                >
                  {codeHasBeenSent ? 'CODE SENT' : 'SEND CODE'}
                </Button>
              </div>

              <div>
                <Label htmlFor="verificationCode" className="block mb-2" style={{ color: '#514444' }}>
                  6-Digit Verification Code *
                </Label>
                <Input
                  id="verificationCode"
                  value={formData.verificationCode}
                  onChange={(e) => handleInputChange('verificationCode', e.target.value)}
                  className="w-full"
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  required
                />
              </div>
            </div>

            <Button
              onClick={handleMoveToDeposit}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
              disabled={!formData.email.trim() || !formData.verificationCode.trim() || formData.verificationCode.length !== 6 || !codeHasBeenSent}
            >
              Move to Deposit Page
            </Button>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-6" style={{ color: '#514444' }}>
                Required Deposit
              </h2>
              
              <Button
                onClick={handleDeposit}
                disabled={depositMade}
                className="py-3 px-6 mb-6"
                style={{ 
                  backgroundColor: depositMade ? '#6b7280' : '#ffcd18', 
                  color: depositMade ? '#ffffff' : '#4c2815',
                  minWidth: 'auto'
                }}
              >
                {depositMade ? 'DEPOSIT COMPLETE ✓' : 'Deposit $5'}
              </Button>
            </div>

            <div className="bg-white rounded-lg p-6">
              <ul className="space-y-3" style={{ color: '#514444' }}>
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mt-2 mr-3 flex-shrink-0"></span>
                  <span>To start a raffle, you will need to deposit $5.</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mt-2 mr-3 flex-shrink-0"></span>
                  <span>This deposit will not be part of the raffle prize.</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mt-2 mr-3 flex-shrink-0"></span>
                  <span>Once the raffle is live, you may buy as many tickets as allowed for yourself.</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mt-2 mr-3 flex-shrink-0"></span>
                  <span>If the raffle doesn't have enough purchased tickets for three consecutive draws, it will be cancelled and your deposit will be returned minus $1.</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mt-2 mr-3 flex-shrink-0"></span>
                  <span>Once you submit this form, your raffle will be reviewed by the RaffleTime team before it goes live.</span>
                </li>
              </ul>
            </div>

            <Button
              onClick={handleSubmitForReview}
              disabled={!depositMade}
              className="w-full py-3"
              style={{ 
                backgroundColor: depositMade ? '#bc1f13' : '#6b7280', 
                color: '#FFFFFF' 
              }}
            >
              Submit for Review
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
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Create Raffle</h1>
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