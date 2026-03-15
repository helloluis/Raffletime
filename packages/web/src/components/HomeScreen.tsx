import { FeaturedRafflesCarousel } from './FeaturedRafflesCarousel';
import { PreviousWinners } from './PreviousWinners';
import { FloatingCreateButton } from './FloatingCreateButton';
import { Mascot } from './Mascot';
import { Winner } from './Winner';
import { useCurrentRaffle, useActiveRafflesApi } from '../web3/useAgentApi';

interface HomeScreenProps {
  onNavigate: (page: string) => void;
  showWinner?: boolean;
  onClaimPrize?: () => void;
  onTriggerWinner?: () => void;
  isDrawingMode?: boolean;
}

export function HomeScreen({ onNavigate, showWinner = false, onClaimPrize, onTriggerWinner, isDrawingMode = false }: HomeScreenProps) {
  const { data: currentRaffle } = useCurrentRaffle();
  const { data: activeRaffles } = useActiveRafflesApi();

  return (
    <div className="min-h-screen pb-20">
      <div className="p-6">
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold mb-2" style={{ color: '#FFFFFF' }}>
            RaffleTime!
          </h1>
        </div>

        {/* Featured Raffles Carousel */}
        <FeaturedRafflesCarousel
          onJoinRaffle={(address) => onNavigate(address ? `ticketing/${address}` : 'ticketing')}
          onCreateRaffle={() => onNavigate('raffle-creation')}
          onNavigate={onNavigate}
          onTriggerWinner={onTriggerWinner}
          isDrawingMode={isDrawingMode}
          currentRaffle={currentRaffle}
          activeRaffles={activeRaffles}
        />

        {/* Winner Container (hidden unless showWinner is true) */}
        <Winner 
          isVisible={showWinner} 
          onClaim={onClaimPrize || (() => {})} 
        />

        {/* Previous Winners */}
        <PreviousWinners />

        {/* Footer Links */}
        <div className="text-center space-y-2">
          <div className="flex justify-center space-x-6 text-sm">
            <button
              onClick={() => onNavigate('team')}
              className="hover:underline"
              style={{ color: '#4c2815' }}
            >
              Team
            </button>
            <button
              onClick={() => onNavigate('transparency')}
              className="hover:underline"
              style={{ color: '#4c2815' }}
            >
              Transparency
            </button>
            <a
              href="mailto:teamraffletime@gmail.com"
              className="hover:underline"
              style={{ color: '#4c2815' }}
            >
              Support
            </a>
            <button
              onClick={() => onNavigate('tutorial')}
              className="hover:underline"
              style={{ color: '#4c2815' }}
            >
              Tutorial
            </button>
          </div>
        </div>
      </div>

      {/* Floating Elements */}
      <FloatingCreateButton onCreateRaffle={() => onNavigate('raffle-creation')} />
      <Mascot />
    </div>
  );
}