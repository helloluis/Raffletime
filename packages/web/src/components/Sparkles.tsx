import { useEffect, useState } from 'react';

interface SparklesProps {
  isActive: boolean;
  duration?: number;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
}

export function Sparkles({ isActive, duration = 1000 }: SparklesProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    if (isActive) {
      // Generate 6-8 sparkles around the box
      const newSparkles = Array.from({ length: 7 }, (_, i) => ({
        id: i,
        x: Math.random() * 100 - 50, // -50% to +50%
        y: Math.random() * 100 - 50, // -50% to +50%
        size: Math.random() * 8 + 4, // 4px to 12px
        delay: Math.random() * 200, // 0 to 200ms delay
      }));
      
      setSparkles(newSparkles);

      // Clear sparkles after duration
      const timeout = setTimeout(() => {
        setSparkles([]);
      }, duration);

      return () => clearTimeout(timeout);
    } else {
      setSparkles([]);
    }
  }, [isActive, duration]);

  if (!isActive || sparkles.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="absolute rounded-full bg-yellow-300"
          style={{
            left: `calc(50% + ${sparkle.x}px)`,
            top: `calc(50% + ${sparkle.y}px)`,
            width: `${sparkle.size}px`,
            height: `${sparkle.size}px`,
            animation: `sparkleAppear 0.6s ease-out ${sparkle.delay}ms forwards`,
            transform: 'translate(-50%, -50%)',
            zIndex: 20,
          }}
        />
      ))}
    </div>
  );
}