import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
  const navigate = useNavigate();
  const location = useLocation();
  const [showWinner, setShowWinner] = useState(false);
  const [showCoinShower, setShowCoinShower] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  const isTutorial = location.pathname === '/tutorial';

  const handleTutorialComplete = () => {
    localStorage.setItem('raffletime-tutorial-seen', 'true');
    navigate('/');
  };

  const handleTutorialSkip = () => {
    localStorage.setItem('raffletime-tutorial-seen', 'true');
    navigate('/');
  };

  const handleNavigation = (page: string) => {
    if (page === 'winner') {
      setShowWinner(true);
      navigate('/');
      setTimeout(() => setShowCoinShower(true), 1000);
    } else if (page === 'drawing') {
      navigate('/');
      setIsDrawingMode(true);
      setTimeout(() => setIsDrawingMode(false), 21000);
    } else if (page === 'home') {
      navigate('/');
    } else {
      navigate(`/${page}`);
    }
  };

  const handleTriggerWinner = () => {
    setShowWinner(true);
    setTimeout(() => setShowCoinShower(true), 1000);
  };

  const handleBack = () => navigate('/');

  const handleTicketingSuccess = () => {
    navigate('/');
    toast.success("You've successfully joined the raffle!", {
      style: { backgroundColor: '#bc1f13', color: '#FFFFFF', border: 'none' }
    });
  };

  const handleRaffleCreationSuccess = () => {
    navigate('/');
    toast.success("Your raffle has been submitted!", {
      style: { backgroundColor: '#bc1f13', color: '#FFFFFF', border: 'none' }
    });
  };

  const handleClaimPrize = () => {
    setShowWinner(false);
    toast.success("Prize claimed successfully! 🏆", {
      style: { backgroundColor: '#bc1f13', color: '#FFFFFF', border: 'none' }
    });
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
      {!isTutorial && <Navigation onNavigate={handleNavigation} />}

      <Routes>
        <Route path="/tutorial" element={
          <Tutorial onComplete={handleTutorialComplete} onSkip={handleTutorialSkip} />
        } />
        <Route path="/" element={
          <HomeScreen
            onNavigate={handleNavigation}
            showWinner={showWinner}
            onClaimPrize={handleClaimPrize}
            onTriggerWinner={handleTriggerWinner}
            isDrawingMode={isDrawingMode}
          />
        } />
        <Route path="/account" element={<Account onBack={handleBack} />} />
        <Route path="/tickets" element={<Tickets onBack={handleBack} />} />
        <Route path="/ticketing" element={<Ticketing onBack={handleBack} onSuccess={handleTicketingSuccess} />} />
        <Route path="/ticketing/:address" element={<Ticketing onBack={handleBack} onSuccess={handleTicketingSuccess} />} />
        <Route path="/raffle-creation" element={<RaffleCreation onBack={handleBack} onSuccess={handleRaffleCreationSuccess} />} />
        <Route path="/raffle/:address" element={<RaffleDetails onBack={handleBack} onJoinRaffle={(address) => navigate(`/ticketing/${address}`)} />} />
        <Route path="/raffle-details" element={<RaffleDetails onBack={handleBack} onJoinRaffle={() => handleNavigation('ticketing')} />} />
        <Route path="/team" element={<Team onBack={handleBack} />} />
        <Route path="/transparency" element={<Transparency onBack={handleBack} />} />
        <Route path="*" element={
          <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <h1 className="text-2xl font-bold" style={{ color: '#4c2815' }}>Page not found</h1>
            <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg text-white" style={{ backgroundColor: '#bc1f13' }}>
              Go Home
            </button>
          </div>
        } />
      </Routes>

      <CoinShower
        isActive={showCoinShower}
        onComplete={() => setShowCoinShower(false)}
      />

      <Toaster position="top-center" />
    </div>
  );
}
