import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';

interface FloatingCreateButtonProps {
  onCreateRaffle: () => void;
}

export function FloatingCreateButton({ onCreateRaffle }: FloatingCreateButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <Button
        onClick={isExpanded ? onCreateRaffle : () => setIsExpanded(!isExpanded)}
        className={`transition-all duration-300 shadow-lg ${
          isExpanded 
            ? 'px-6 py-3 rounded-full' 
            : 'w-14 h-14 rounded-full p-0'
        }`}
        style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
        onMouseLeave={() => setTimeout(() => setIsExpanded(false), 2000)}
      >
        {isExpanded ? (
          <span className="whitespace-nowrap">Create Your Own Raffle</span>
        ) : (
          <Plus className="h-6 w-6" />
        )}
      </Button>
    </div>
  );
}