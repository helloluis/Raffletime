import { useEffect, useState } from 'react';
import coinImage from 'figma:asset/f1054ca8ada7d0f7b03c5900672de020c4e43267.png';

interface Coin {
  id: number;
  x: number;
  size: number;
  delay: number;
  duration: number;
  rotationSpeed: number;
  rotationDirection: number;
}

interface CoinShowerProps {
  isActive: boolean;
  onComplete: () => void;
}

export function CoinShower({ isActive, onComplete }: CoinShowerProps) {
  const [coins, setCoins] = useState<Coin[]>([]);

  useEffect(() => {
    if (isActive) {
      // Generate 70 coins for maximum spectacular effect
      const coinCount = 100;
      const newCoins: Coin[] = [];
      
      for (let i = 0; i < coinCount; i++) {
        newCoins.push({
          id: i,
          x: Math.random() * 120 - 10, // Random horizontal position (-10% to 110%) - extends beyond viewport
          size: Math.random() * 40 + 15, // Random size between 15-55px (wider range)
          delay: Math.random() * 1.5, // Random delay up to 1.5s (more staggered)
          duration: Math.random() * 0.8 + 2.7, // Random duration 2.7-3.5s (consistent with gravity)
          rotationSpeed: Math.random() * 2 + 1, // Random rotation speed 1-3s
          rotationDirection: Math.random() > 0.5 ? 1 : -1 // Random clockwise or counterclockwise
        });
      }
      
      setCoins(newCoins);
      
      // Complete animation after 4 seconds to ensure coins fully exit viewport
      const timer = setTimeout(() => {
        setCoins([]);
        onComplete();
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [isActive, onComplete]);

  if (!isActive || coins.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {coins.map((coin) => (
        <div
          key={coin.id}
          className="absolute"
          style={{
            left: `${coin.x}%`,
            top: '-60px',
            width: `${coin.size}px`,
            height: `${coin.size}px`,
            animationDelay: `${coin.delay}s`,
            animationDuration: `${coin.duration}s`,
            animationTimingFunction: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', // Smooth gravity acceleration
            animationIterationCount: '1',
            animationFillMode: 'forwards',
            transform: 'translateY(0)',
            animation: `coinGravityFall ${coin.duration}s ${coin.delay}s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
          }}
        >
          <img
            src={coinImage}
            alt="Gold coin"
            className="w-full h-full object-contain"
            style={{
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
              animation: `coinSpin ${coin.duration * 1.5}s linear infinite, coinRotate ${coin.rotationSpeed}s linear infinite`,
              animationDirection: coin.rotationDirection === 1 ? 'normal' : 'reverse'
            }}
          />
        </div>
      ))}
      

    </div>
  );
}