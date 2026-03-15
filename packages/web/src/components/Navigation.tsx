import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from './ui/button';

interface NavigationProps {
  onNavigate: (page: string) => void;
}

export function Navigation({ onNavigate }: NavigationProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const handleNavigation = (page: string) => {
    onNavigate(page);
    setIsMenuOpen(false);
  };

  return (
    <div className="relative">
      {/* Burger Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMenu}
        className="fixed top-4 right-4 z-50 hover:bg-transparent"
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
        {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </Button>

      {/* Menu Overlay */}
      {isMenuOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsMenuOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-64 bg-white shadow-lg z-50 p-6 flex flex-col">
            {/* Main Menu Items */}
            <div className="pt-16 space-y-4 flex-1">
              <button
                onClick={() => handleNavigation('account')}
                className="block w-full text-left p-3 hover:bg-gray-100 rounded-lg transition-colors"
                style={{ color: '#4c2815' }}
              >
                Account
              </button>
              
              <button
                onClick={() => handleNavigation('tickets')}
                className="block w-full text-left p-3 hover:bg-gray-100 rounded-lg transition-colors"
                style={{ color: '#4c2815' }}
              >
                Tickets
              </button>
              
              <a
                href="mailto:teamraffletime@gmail.com"
                className="block w-full text-left p-3 hover:bg-gray-100 rounded-lg transition-colors"
                style={{ color: '#4c2815' }}
              >
                Help
              </a>
            </div>

            {/* Developer Mode Section — only visible in dev builds */}
            {import.meta.env.DEV && (
              <div className="border-t border-gray-200 pt-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider px-3 py-1" style={{ color: '#4c2815', opacity: 0.6 }}>
                  Developer Mode
                </div>

                <button
                  onClick={() => handleNavigation('drawing')}
                  className="block w-full text-left p-3 hover:bg-gray-100 rounded-lg transition-colors"
                  style={{ color: '#4c2815' }}
                >
                  Drawing ...
                </button>

                <button
                  onClick={() => handleNavigation('winner')}
                  className="block w-full text-left p-3 hover:bg-gray-100 rounded-lg transition-colors"
                  style={{ color: '#4c2815' }}
                >
                  Winner! 🎉
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}