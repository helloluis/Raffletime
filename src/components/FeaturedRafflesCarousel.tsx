import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Sparkles } from './Sparkles';
import treasureChestImage from 'figma:asset/86dc0db944111e46edd8fb6ac6c74c8f951f497f.png';
import mascotImage from 'figma:asset/2a61dec880337bad6b73ca5008c4efb24fb1f972.png';

interface FeaturedRafflesCarouselProps {
  onJoinRaffle: () => void;
  onCreateRaffle: () => void;
  onNavigate: (page: string) => void;
  onTriggerWinner?: () => void;
  isDrawingMode?: boolean;
}

export function FeaturedRafflesCarousel({ onJoinRaffle, onCreateRaffle, onNavigate, onTriggerWinner, isDrawingMode = false }: FeaturedRafflesCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });
  const [hasTriggeredWinner, setHasTriggeredWinner] = useState(false);
  const [hasCountdownStarted, setHasCountdownStarted] = useState(false);
  const [previousTimeLeft, setPreviousTimeLeft] = useState({ minutes: 0, seconds: 0 });
  const [isInDrawingMode, setIsInDrawingMode] = useState(false);
  const [drawingNumbers, setDrawingNumbers] = useState<number[]>([]);
  const [revealedBoxes, setRevealedBoxes] = useState<boolean[]>([false, false, false, false]);
  const [sparklingBoxes, setSparklingBoxes] = useState<boolean[]>([false, false, false, false]);
  
  // Check if we're in final countdown mode (less than 1 minute remaining)
  const isFinalCountdown = timeLeft.minutes < 1;
  
  // Check if we should show the "Drawing soon!" pill (10 minutes or less remaining)
  const shouldShowDrawingSoon = timeLeft.minutes <= 10;
  
  // Check if countdown has reached zero AFTER it was actively running
  const isCountdownZero = timeLeft.minutes === 0 && timeLeft.seconds === 0;
  const hasJustReachedZero = isCountdownZero && hasCountdownStarted && 
    (previousTimeLeft.minutes > 0 || previousTimeLeft.seconds > 0);

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      
      const diff = nextHour.getTime() - now.getTime();
      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      // Update time using functional updates to avoid dependency issues
      setTimeLeft(prevTime => {
        setPreviousTimeLeft(prevTime);
        return { minutes, seconds };
      });
      
      // Mark countdown as started after first update (prevents immediate trigger on page load)
      if (!hasCountdownStarted && (minutes > 0 || seconds > 0)) {
        setHasCountdownStarted(true);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [hasCountdownStarted]);

  // Trigger drawing mode when countdown reaches zero AFTER being actively running
  useEffect(() => {
    if (hasJustReachedZero && !hasTriggeredWinner) {
      setHasTriggeredWinner(true);
      // Start drawing mode with 1 second delay
      setTimeout(() => {
        startDrawingMode();
      }, 1000);
    }
  }, [hasJustReachedZero, hasTriggeredWinner]);

  // Handle external drawing trigger
  useEffect(() => {
    if (isDrawingMode && !isInDrawingMode) {
      setTimeout(() => {
        startDrawingMode();
      }, 1000);
    }
  }, [isDrawingMode, isInDrawingMode]);

  const startDrawingMode = () => {
    // Generate 4 random numbers between 1-9
    const numbers = Array.from({ length: 4 }, () => Math.floor(Math.random() * 9) + 1);
    setDrawingNumbers(numbers);
    setIsInDrawingMode(true);
    setRevealedBoxes([false, false, false, false]);
    setSparklingBoxes([false, false, false, false]);

    // Wait 2 seconds before starting reveals
    setTimeout(() => {
      // Reveal boxes one by one with 300ms intervals
      numbers.forEach((_, index) => {
        setTimeout(() => {
          // Reveal the box
          setRevealedBoxes(prev => {
            const newRevealed = [...prev];
            newRevealed[index] = true;
            return newRevealed;
          });
          
          // Trigger sparkles for this box
          setSparklingBoxes(prev => {
            const newSparkling = [...prev];
            newSparkling[index] = true;
            return newSparkling;
          });
          
          // Stop sparkles after 1 second
          setTimeout(() => {
            setSparklingBoxes(prev => {
              const newSparkling = [...prev];
              newSparkling[index] = false;
              return newSparkling;
            });
          }, 1000);
        }, 700 * (index + 1));
      });
    }, 2000);

    // Return to normal state after 20 seconds (2s delay + 2.8s reveals + ~15s display)
    setTimeout(() => {
      setIsInDrawingMode(false);
      setHasTriggeredWinner(false);
      setRevealedBoxes([false, false, false, false]);
      setSparklingBoxes([false, false, false, false]);
      
      // Trigger winner sequence if callback is available
      if (onTriggerWinner) {
        onTriggerWinner();
      }
    }, 20000);
  };

  const slides = [
    {
      type: 'raffle',
      title: 'Eyes on the Prize 👁️💰',
      prizeAmount: '1000 WLD',
      totalPool: 'TOTAL POOL 2050 WLD',
      status: 'Drawing soon!',
      background: treasureChestImage
    },
    {
      type: 'create',
      title: 'Create Your Own Raffle',
      subtitle: 'Deposit 5 WLD to start your own public raffle now!',
      background: 'linear-gradient(135deg, #ffcd18 0%, #ff9500 100%)',
      mascot: mascotImage
    }
  ];

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  return (
    <div 
      className="relative w-full h-80 rounded-xl overflow-hidden shadow-lg mb-6" 
      style={{ 
        border: '2px solid #F5EFE6',
        animation: isFinalCountdown && currentSlide === 0 ? 'finalCountdownJitter 0.1s infinite' : 'none'
      }}
    >
      {slides.map((slide, index) => (
        <div
          key={index}
          className={`absolute inset-0 transition-transform duration-300 ${
            index === currentSlide ? 'translate-x-0' : 
            index < currentSlide ? '-translate-x-full' : 'translate-x-full'
          }`}
        >
          {slide.type === 'raffle' ? (
            <div
              className="h-full w-full bg-cover bg-center relative"
              style={{ backgroundImage: `url('${slide.background}')` }}
            >
              <div className="absolute inset-0 bg-black/60"></div>
              <div className="absolute inset-0 bg-yellow-600/20"></div>
              <div className="relative z-10 p-6 h-full flex flex-col justify-between text-white">
                <div className="text-center">
                  <h2 
                    className="text-2xl font-bold mb-2 cursor-pointer hover:text-yellow-300 transition-colors"
                    onClick={() => onNavigate('raffle-details')}
                  >
                    {slide.title}
                  </h2>
                  
                  {!isInDrawingMode && (
                    <div className="flex justify-center mb-4">
                      <div 
                        className={`flex items-center gap-2 text-gray-800 rounded-full shadow-md transition-all duration-300 ${
                          isFinalCountdown 
                            ? 'bg-red-500/95 text-white px-6 py-3 text-2xl font-bold animate-pulse' 
                            : 'bg-white/90 px-4 py-2'
                        }`}
                      >
                        <span className={isFinalCountdown ? 'text-2xl' : ''}>⏰</span>
                        <span className={`font-semibold ${isFinalCountdown ? 'text-2xl font-black' : 'text-lg'}`}>
                          {String(timeLeft.minutes).padStart(2, '0')}:
                          {String(timeLeft.seconds).padStart(2, '0')}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {isInDrawingMode && (
                    <div className="flex justify-center mb-4">
                      <div 
                        className="flex items-center gap-2 px-6 py-3 rounded-full shadow-md"
                        style={{ 
                          backgroundColor: '#bc1f13',
                          color: '#FFFFFF',
                          animation: 'statusBlink 1s infinite'
                        }}
                      >
                        <span className="text-2xl">🎯</span>
                        <span className="font-bold text-lg">DRAWING NOW!</span>
                      </div>
                    </div>
                  )}

                  {!isInDrawingMode && (
                    <>
                      <div 
                        className="text-4xl font-bold mb-1 cursor-pointer hover:text-yellow-300 transition-colors"
                        onClick={() => onNavigate('raffle-details')}
                      >
                        {slide.prizeAmount}
                      </div>
                      <div className="text-sm opacity-80 font-bold">{slide.totalPool}</div>
                      {shouldShowDrawingSoon && (
                        <div 
                          className="mt-2 px-3 py-1 text-black rounded-full inline-block text-sm font-bold"
                          style={{ 
                            backgroundColor: '#ffcd18',
                            animation: 'statusBlink 1.5s infinite'
                          }}
                        >
                          {slide.status}
                        </div>
                      )}
                    </>
                  )}
                  
                  {isInDrawingMode && (
                    <div className="mt-4">
                      <div className="text-2xl font-bold mb-4 text-yellow-300">Winning Numbers</div>
                      <div className="flex justify-center gap-3">
                        {drawingNumbers.map((number, index) => (
                          <div key={index} className="relative w-16 h-16">
                            {/* Black box overlay */}
                            <div 
                              className={`absolute inset-0 bg-black rounded-lg shadow-lg transition-all duration-500 ${
                                revealedBoxes[index] 
                                  ? 'transform translate-y-[-20px] opacity-0' 
                                  : 'transform translate-y-0 opacity-100'
                              }`}
                              style={{ zIndex: 10 }}
                            />
                            {/* Number underneath */}
                            <div 
                              className="w-16 h-16 rounded-lg flex items-center justify-center font-bold text-2xl"
                              style={{ 
                                backgroundColor: '#bc1f13',
                                color: '#ffcd18',
                                animation: revealedBoxes[index] ? 'drawingNumberPulse 1s infinite' : 'none'
                              }}
                            >
                              {number}
                            </div>
                            {/* Sparkles */}
                            <Sparkles 
                              isActive={sparklingBoxes[index]} 
                              duration={1000}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {!isFinalCountdown && !isInDrawingMode && (
                  <div className="flex justify-center">
                    <Button
                      onClick={onJoinRaffle}
                      className="w-full py-3"
                      style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
                    >
                      🎫 JOIN NOW
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="h-full w-full relative cursor-pointer overflow-hidden"
              style={{ background: slide.background }}
              onClick={onCreateRaffle}
            >
              {/* Mascot background image positioned in bottom right */}
              {slide.mascot && (
                <div
                  className="absolute bottom-0 right-0 w-32 h-32 bg-no-repeat bg-contain opacity-60"
                  style={{
                    backgroundImage: `url('${slide.mascot}')`,
                    backgroundPosition: 'bottom right',
                    transform: 'translate(20%, 20%)'
                  }}
                />
              )}
              
              <div className="p-6 h-full flex flex-col justify-center items-center text-center relative z-10">
                <h2 className="text-2xl font-bold mb-4" style={{ color: '#4c2815' }}>
                  {slide.title}
                </h2>
                <p className="text-lg" style={{ color: '#4c2815' }}>
                  {slide.subtitle}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Navigation arrows - hidden during drawing mode */}
      {!isInDrawingMode && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={prevSlide}
            className="absolute left-2 top-1/2 transform -translate-y-1/2 text-white hover:bg-white/20 z-20"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={nextSlide}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-white hover:bg-white/20 z-20"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </>
      )}

      {/* Dots indicator */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2 z-20">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentSlide(index)}
            className={`w-2 h-2 rounded-full transition-colors ${
              index === currentSlide ? 'bg-white' : 'bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}