import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import treasureChestImage from 'figma:asset/5ed1db6b8d10144ff4f2aa3804cd5facfce74949.png';

interface RaffleDetailsProps {
  onBack: () => void;
  onJoinRaffle: (address?: string) => void;
}

interface TicketBuyer {
  id: string;
  address: string;
  ticketCount: number;
  timeAgo: string;
}

export function RaffleDetails({ onBack, onJoinRaffle }: RaffleDetailsProps) {
  const { address: vaultAddress } = useParams<{ address: string }>();
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const ticketsPerPage = 10;

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      
      const diff = nextHour.getTime() - now.getTime();
      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // Mock ticket buyers data
  const generateTicketBuyers = (): TicketBuyer[] => {
    // Generate realistic EVM addresses
    const generateAddress = (seed: number): string => {
      const chars = '0123456789abcdef';
      let address = '0x';
      
      // Use seed to make addresses deterministic but varied
      const random = (n: number) => {
        const x = Math.sin(seed * n) * 10000;
        return Math.floor((x - Math.floor(x)) * 16);
      };
      
      for (let i = 0; i < 40; i++) {
        address += chars[random(i + 1)];
      }
      
      // Truncate to show first 6 and last 4 characters
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };
    
    const timeOptions = ['2m ago', '5m ago', '8m ago', '12m ago', '15m ago', '20m ago', '25m ago', '30m ago', '45m ago', '1h ago'];
    
    return Array.from({ length: 50 }, (_, i) => ({
      id: `buyer-${i + 1}`,
      address: generateAddress(i + 1),
      ticketCount: Math.floor(Math.random() * 10) + 1,
      timeAgo: timeOptions[Math.floor(Math.random() * timeOptions.length)]
    }));
  };

  const ticketBuyers = generateTicketBuyers();
  const totalPages = Math.ceil(ticketBuyers.length / ticketsPerPage);
  const startIndex = (currentPage - 1) * ticketsPerPage;
  const currentBuyers = ticketBuyers.slice(startIndex, startIndex + ticketsPerPage);

  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="mr-2 hover:bg-transparent"
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
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Raffle Details</h1>
      </div>

      <div className="max-w-md mx-auto space-y-6">
        {/* Hero Section */}
        <div
          className="h-80 w-full bg-cover bg-center relative rounded-xl overflow-hidden shadow-lg"
          style={{ backgroundImage: `url('${treasureChestImage}')` }}
        >
          <div className="absolute inset-0 bg-black/60"></div>
          <div className="absolute inset-0 bg-yellow-600/20"></div>
          <div className="relative z-10 p-6 h-full flex flex-col justify-between text-white">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Eyes on the Prize 👁️💰</h2>
              <div className="flex justify-center mb-4">
                <div className="flex items-center gap-2 bg-white/90 text-gray-800 px-4 py-2 rounded-full shadow-md">
                  <span>⏰</span>
                  <span className="text-lg font-semibold">
                    {String(timeLeft.minutes).padStart(2, '0')}:
                    {String(timeLeft.seconds).padStart(2, '0')}
                  </span>
                </div>
              </div>
              <div className="text-4xl font-bold mb-1">$1,000</div>
              <div className="text-sm opacity-80">TOTAL POOL $2,050</div>
              <div className="mt-2 px-3 py-1 bg-green-500 text-white rounded-full inline-block text-sm">
                Drawing soon!
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-white rounded-lg p-6">
          <h3 className="text-lg font-bold mb-3" style={{ color: '#514444' }}>About This Raffle</h3>
          <p className="text-sm leading-relaxed mt-3" style={{ color: '#514444' }}><em>Launched 9 Sept 2025</em></p>
          <p className="text-sm leading-relaxed mt-3" style={{ color: '#514444' }}>
            Join our house raffle and get a chance to win up to 50% of the post every hour. 
          </p>
          <p className="text-sm leading-relaxed mt-3" style={{ color: '#514444' }}>
            Each ticket gives you an equal chance to win the full prize amount so the more tickets you buy, the better your odds of taking home the prize!
          </p>
        </div>

        {/* Join Button */}
        <Button
          onClick={() => onJoinRaffle(vaultAddress)}
          className="w-full py-4 text-lg font-bold"
          style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
        >
          🎫 JOIN NOW
        </Button>

        {/* Recent Ticket Buyers */}
        <div className="bg-white rounded-lg p-6">
          <h3 className="text-lg font-bold mb-4" style={{ color: '#514444' }}>
            🎟️ 1734 tickets bought!
          </h3>
          
          <div className="space-y-3">
            {currentBuyers.map((buyer) => (
              <div key={buyer.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex-1">
                  <p className="font-mono text-sm" style={{ color: '#514444' }}>
                    {buyer.address}
                  </p>
                  <p className="text-xs opacity-60" style={{ color: '#514444' }}>
                    {buyer.timeAgo}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold" style={{ color: '#bc1f13' }}>
                    {buyer.ticketCount} ticket{buyer.ticketCount > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <Button
                variant="ghost"
                size="sm"
                onClick={prevPage}
                disabled={currentPage === 1}
                className="flex items-center gap-1"
                style={{ color: currentPage === 1 ? '#9ca3af' : '#514444' }}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              
              <span className="text-sm" style={{ color: '#514444' }}>
                Page {currentPage} of {totalPages}
              </span>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={nextPage}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1"
                style={{ color: currentPage === totalPages ? '#9ca3af' : '#514444' }}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}