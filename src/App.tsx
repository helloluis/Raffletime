import { useState, useEffect } from 'react';
import { Tutorial } from './components/Tutorial';
import { HomeScreen } from './components/HomeScreen';
import { Navigation } from './components/Navigation';
import { Account } from './components/pages/Account';
import { Ticketing } from './components/pages/Ticketing';
import { Tickets } from './components/pages/Tickets';
import { RaffleCreation } from './components/pages/RaffleCreation';
import { RaffleDetails } from './components/pages/RaffleDetails';
import { Team } from './components/pages/Team';
import { Transparency } from './components/pages/Transparency';
import { CoinShower } from './components/CoinShower';
import { Toaster } from './components/ui/sonner';
import { toast } from "sonner@2.0.3";
import gradientBackground from 'figma:asset/6a6e048158e4dea516e71628a88b006edf904cfa.png';

export default function App() {
  const [currentPage, setCurrentPage] = useState<string>('tutorial');
  const [hasSeenTutorial, setHasSeenTutorial] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showCoinShower, setShowCoinShower] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  useEffect(() => {
    // Check if user has seen tutorial before
    const tutorialSeen = localStorage.getItem('raffletime-tutorial-seen');
    if (tutorialSeen) {
      setHasSeenTutorial(true);
      setCurrentPage('home');
    }
  }, []);

  const handleTutorialComplete = () => {
    localStorage.setItem('raffletime-tutorial-seen', 'true');
    setHasSeenTutorial(true);
    setCurrentPage('home');
  };

  const handleTutorialSkip = () => {
    localStorage.setItem('raffletime-tutorial-seen', 'true');
    setHasSeenTutorial(true);
    setCurrentPage('home');
  };

  const handleNavigation = (page: string) => {
    if (page === 'winner') {
      // Show winner container immediately
      setShowWinner(true);
      setCurrentPage('home');
      
      // Trigger coin shower after 1 second delay
      setTimeout(() => {
        setShowCoinShower(true);
      }, 1000);
    } else if (page === 'drawing') {
      // Trigger Prize Draw mode
      setCurrentPage('home');
      setIsDrawingMode(true);
      
      // Reset drawing mode after it completes (handled in FeaturedRafflesCarousel)
      setTimeout(() => {
        setIsDrawingMode(false);
      }, 21000); // 1 second delay + 2 seconds pre-reveal + 2.8 seconds reveals + 15 seconds display
    } else {
      setCurrentPage(page);
    }
  };

  const handleTriggerWinner = () => {
    // Show winner container immediately
    setShowWinner(true);
    
    // Trigger coin shower after 1 second delay
    setTimeout(() => {
      setShowCoinShower(true);
    }, 1000);
  };

  const handleBack = () => {
    setCurrentPage('home');
  };

  const handleTicketingSuccess = () => {
    setCurrentPage('home');
    toast.success("You've successfully joined Eyes on the Prize 👁️💰!", {
      style: {
        backgroundColor: '#bc1f13',
        color: '#FFFFFF',
        border: 'none'
      }
    });
  };

  const handleRaffleCreationSuccess = () => {
    setCurrentPage('home');
    toast.success("Your raffle has been submitted and will be reviewed shortly by the team!", {
      style: {
        backgroundColor: '#bc1f13',
        color: '#FFFFFF',
        border: 'none'
      }
    });
  };

  const handleClaimPrize = () => {
    setShowWinner(false);
    toast.success("Prize claimed successfully! 🏆", {
      style: {
        backgroundColor: '#bc1f13',
        color: '#FFFFFF',
        border: 'none'
      }
    });
  };

  const handleCoinShowerComplete = () => {
    setShowCoinShower(false);
  };

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'tutorial':
        return <Tutorial onComplete={handleTutorialComplete} onSkip={handleTutorialSkip} />;
      case 'home':
        return <HomeScreen 
          onNavigate={handleNavigation} 
          showWinner={showWinner}
          onClaimPrize={handleClaimPrize}
          onTriggerWinner={handleTriggerWinner}
          isDrawingMode={isDrawingMode}
        />;
      case 'account':
        return <Account onBack={handleBack} />;
      case 'tickets':
        return <Tickets onBack={handleBack} />;
      case 'ticketing':
        return <Ticketing onBack={handleBack} onSuccess={handleTicketingSuccess} />;
      case 'raffle-creation':
        return <RaffleCreation onBack={handleBack} onSuccess={handleRaffleCreationSuccess} />;
      case 'raffle-details':
        return <RaffleDetails onBack={handleBack} onJoinRaffle={() => handleNavigation('ticketing')} />;
      case 'team':
        return <Team onBack={handleBack} />;
      case 'transparency':
        return <Transparency onBack={handleBack} />;
      default:
        return <HomeScreen 
          onNavigate={handleNavigation}
          showWinner={showWinner}
          onClaimPrize={handleClaimPrize}
          onTriggerWinner={handleTriggerWinner}
          isDrawingMode={isDrawingMode}
        />;
    }
  };

  return (
    <div 
      className="min-h-screen" 
      style={{ 
        backgroundColor: '#F5EFE6',
        backgroundImage: `url(${gradientBackground})`,
        backgroundRepeat: 'repeat-x',
        backgroundPosition: 'top',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* Show navigation only when not on tutorial */}
      {currentPage !== 'tutorial' && <Navigation onNavigate={handleNavigation} />}
      
      {renderCurrentPage()}
      
      {/* Coin Shower Animation */}
      <CoinShower 
        isActive={showCoinShower} 
        onComplete={handleCoinShowerComplete} 
      />
      
      <Toaster position="top-center" />
    </div>
  );
}