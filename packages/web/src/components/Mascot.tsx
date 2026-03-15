import { useState } from 'react';
import raffyMascot from 'figma:asset/2a61dec880337bad6b73ca5008c4efb24fb1f972.png';

export function Mascot() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const encouragements = [
    "You've got this! 🎲",
    "Feeling lucky today? ✨",
    "The next winner could be you! 🏆",
    "Keep playing, keep winning! 🎉",
    "Your lucky moment is coming! 🍀",
    "Trust the process! 💪",
    "Big wins ahead! 🚀",
    "Stay positive, stay winning! ⭐"
  ];

  const handleClick = () => {
    setIsExpanded(true);
    setShowDialog(true);
    
    setTimeout(() => {
      setShowDialog(false);
      setTimeout(() => setIsExpanded(false), 500);
    }, 3000);
  };

  const randomEncouragement = encouragements[Math.floor(Math.random() * encouragements.length)];

  return (
    <div 
      className="fixed z-40"
      style={{ 
        bottom: '-16px', 
        left: '-16px',
        transform: 'scale(2)'
      }}
    >
      <div className="relative">
        {/* Dialog bubble */}
        {showDialog && (
          <div 
            className="absolute bg-white rounded-lg shadow-lg p-2 min-w-[140px] transform transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 text-xs"
            style={{
              bottom: '60px',
              left: '60px',
              fontSize: '10px'
            }}
          >
            <div className="font-medium leading-tight" style={{ color: '#514444' }}>
              {randomEncouragement}
            </div>
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-white rotate-45 border-b border-l border-gray-200" style={{ marginBottom: '-1px', marginLeft: '8px' }}></div>
          </div>
        )}
        
        {/* Mascot character */}
        <button
          onClick={handleClick}
          className={`transition-all duration-500 transform hover:scale-110 ${
            isExpanded ? '-translate-y-2 translate-x-2' : 'translate-y-0 translate-x-0'
          }`}
          style={{ transform: 'rotate(30deg)' }}
        >
          <img
            src={raffyMascot}
            alt="Raffy the mascot"
            className="w-16 h-16 object-contain cursor-pointer drop-shadow-lg"
          />
        </button>
      </div>
    </div>
  );
}