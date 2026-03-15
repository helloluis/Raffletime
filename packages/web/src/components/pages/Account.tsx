import { Button } from '../ui/button';
import { ArrowLeft } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { useCusdBalance } from '../../web3/hooks';

interface AccountProps {
  onBack: () => void;
}

export function Account({ onBack }: AccountProps) {
  const { address, isConnected } = useAccount();
  const { data: balance } = useCusdBalance(address);

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
        {!isConnected ? (
          <div className="text-center space-y-6">
            <div>
              <h2 className="text-xl mb-4" style={{ color: '#514444' }}>
                Welcome to RaffleTime
              </h2>
              <p className="mb-6" style={{ color: '#514444' }}>
                Connect your wallet to start participating in raffles and creating your own.
              </p>
            </div>

            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👤</span>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: '#514444' }}>
                Wallet Connected
              </h2>
              <p className="text-sm opacity-60" style={{ color: '#514444' }}>
                {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
              </p>
            </div>

            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2" style={{ color: '#514444' }}>Wallet</h3>
                <div className="grid grid-cols-1 gap-4 text-sm">
                  <div>
                    <div style={{ color: '#514444' }}>Balance</div>
                    <div className="font-semibold" style={{ color: '#514444' }}>
                      {balance ? `$${parseFloat(formatEther(balance)).toFixed(2)}` : 'Loading...'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <ConnectButton />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
