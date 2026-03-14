import { Button } from './ui/button';

interface WinnerProps {
  isVisible: boolean;
  onClaim: () => void;
}

export function Winner({ isVisible, onClaim }: WinnerProps) {
  if (!isVisible) return null;

  return (
    <div className="w-full max-w-md mx-auto mb-6 p-8 rounded-xl relative overflow-hidden shadow-2xl">
      {/* Golden texture background */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at top, #ffd700 0%, #ffb347 30%, #ff8c00 70%, #b8860b 100%),
            linear-gradient(45deg, #ffd700 0%, #ffb347 25%, #ff8c00 50%, #b8860b 75%, #ffd700 100%)
          `,
          backgroundSize: '400% 400%, 200% 200%',
          animation: 'goldenShimmer 3s ease-in-out infinite'
        }}
      />
      
      {/* Texture overlay */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0),
            radial-gradient(circle at 2px 2px, rgba(0,0,0,0.1) 1px, transparent 0)
          `,
          backgroundSize: '20px 20px, 30px 30px'
        }}
      />

      <div className="relative z-10 text-center">
        {/* Title with engraved effect */}
        <h2 
          className="text-4xl font-bold mb-6"
          style={{
            fontFamily: 'Bangers, cursive',
            color: '#FFFFFF', // Start with white, will be animated
            textShadow: `
              0px 1px 0px rgba(0, 0, 0, 0.8),
              0px 2px 0px rgba(0, 0, 0, 0.6),
              0px 3px 0px rgba(0, 0, 0, 0.4),
              0px 4px 0px rgba(0, 0, 0, 0.2),
              0px 5px 5px rgba(0, 0, 0, 0.5),
              inset 0px 1px 0px rgba(255, 255, 255, 0.3),
              inset 0px -1px 0px rgba(0, 0, 0, 0.3)
            `,
            letterSpacing: '0.1em',
            animation: 'winnerTextPulse 3s ease-in-out infinite' // Synced with background
          }}
        >
          YOU WON!!!
        </h2>

        {/* Body text with engraved effect */}
        <p 
          className="text-lg mb-8 leading-relaxed"
          style={{
            color: '#654321',
            textShadow: `
              0px 1px 0px rgba(101, 67, 33, 0.6),
              0px 2px 0px rgba(101, 67, 33, 0.4),
              0px 3px 3px rgba(0, 0, 0, 0.2),
              inset 0px 1px 0px rgba(255, 215, 0, 0.6),
              inset 0px -1px 0px rgba(101, 67, 33, 0.6)
            `,
            fontWeight: '600'
          }}
        >
          🎉Congratulations, true believer! You've won 1000 WLD in the Eyes on the Prize raffle 🎉
        </p>

        {/* Claim button */}
        <Button
          onClick={onClaim}
          className="w-full py-4 text-lg font-bold relative overflow-hidden"
          style={{ 
            backgroundColor: '#bc1f13', 
            color: '#FFFFFF',
            textShadow: '0px 1px 2px rgba(0, 0, 0, 0.5)',
            boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.3), inset 0px 1px 0px rgba(255, 255, 255, 0.2)'
          }}
        >
          🏆 CLAIM YOUR PRIZE
        </Button>
      </div>


    </div>
  );
}