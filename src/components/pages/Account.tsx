import { useState } from 'react';
import { Button } from '../ui/button';
import { ArrowLeft } from 'lucide-react';

interface AccountProps {
  onBack: () => void;
}

export function Account({ onBack }: AccountProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleWorldIDLogin = () => {
    // This would integrate with World ID
    console.log('Initializing World ID authentication...');
    setIsLoggedIn(true);
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
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Account</h1>
      </div>

      <div className="max-w-md mx-auto">
        {!isLoggedIn ? (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-xl mb-4" style={{ color: '#514444' }}>
                Welcome to RaffleTime
              </h2>
              <p className="mb-6" style={{ color: '#514444' }}>
                Sign in with your World ID to start participating in raffles and creating your own.
              </p>
            </div>
            
            <Button
              onClick={handleWorldIDLogin}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              LOGIN WITH WORLD ID
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👤</span>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: '#514444' }}>
                Connected with World ID
              </h2>
              <p className="text-sm opacity-60" style={{ color: '#514444' }}>
                0x1234...5678
              </p>
            </div>

            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2" style={{ color: '#514444' }}>Account Stats</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div style={{ color: '#514444' }}>Raffles Won</div>
                    <div className="font-semibold" style={{ color: '#514444' }}>3</div>
                  </div>
                  <div>
                    <div style={{ color: '#514444' }}>Total Winnings</div>
                    <div className="font-semibold" style={{ color: '#514444' }}>1,250 WLD</div>
                  </div>
                  <div>
                    <div style={{ color: '#514444' }}>Raffles Created</div>
                    <div className="font-semibold" style={{ color: '#514444' }}>1</div>
                  </div>
                  <div>
                    <div style={{ color: '#514444' }}>Tickets Bought</div>
                    <div className="font-semibold" style={{ color: '#514444' }}>47</div>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => setIsLoggedIn(false)}
                variant="outline"
                className="w-full"
                style={{ borderColor: '#bc1f13', color: '#bc1f13' }}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}