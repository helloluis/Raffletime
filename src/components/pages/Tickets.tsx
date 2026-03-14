import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

interface TicketsProps {
  onBack: () => void;
}

interface Ticket {
  id: string;
  raffleTitle: string;
  ticketNumber: string; // Single 4-digit string
  purchaseDate: string;
  status: 'active' | 'completed' | 'won';
  prizeAmount?: string;
}

export function Tickets({ onBack }: TicketsProps) {
  // Mock ticket data - each ticket now has a single 4-digit number
  const tickets: Ticket[] = [
    {
      id: '1',
      raffleTitle: 'Eyes on the Prize 👁️💰',
      ticketNumber: '4237',
      purchaseDate: '2025-01-20 14:30',
      status: 'active',
    },
    {
      id: '2',
      raffleTitle: 'Eyes on the Prize 👁️💰',
      ticketNumber: '1579',
      purchaseDate: '2025-01-20 14:30',
      status: 'active',
    },
    {
      id: '3',
      raffleTitle: 'Eyes on the Prize 👁️💰',
      ticketNumber: '2986',
      purchaseDate: '2025-01-20 14:30',
      status: 'active',
    },
    {
      id: '4',
      raffleTitle: 'Golden Opportunity 🏆',
      ticketNumber: '2389',
      purchaseDate: '2025-01-18 09:15',
      status: 'won',
      prizeAmount: '500 WLD'
    },
    {
      id: '5',
      raffleTitle: 'Golden Opportunity 🏆',
      ticketNumber: '8912',
      purchaseDate: '2025-01-18 09:15',
      status: 'completed',
    },
    {
      id: '6',
      raffleTitle: 'Lucky Strike ⚡',
      ticketNumber: '1564',
      purchaseDate: '2025-01-15 16:45',
      status: 'completed',
    },
    {
      id: '7',
      raffleTitle: 'Lucky Strike ⚡',
      ticketNumber: '2347',
      purchaseDate: '2025-01-15 16:45',
      status: 'completed',
    },
    {
      id: '8',
      raffleTitle: 'Lucky Strike ⚡',
      ticketNumber: '3451',
      purchaseDate: '2025-01-15 16:45',
      status: 'completed',
    },
    {
      id: '9',
      raffleTitle: 'Lucky Strike ⚡',
      ticketNumber: '4567',
      purchaseDate: '2025-01-15 16:45',
      status: 'completed',
    },
    {
      id: '10',
      raffleTitle: 'Treasure Hunt 💎',
      ticketNumber: '7812',
      purchaseDate: '2025-01-12 11:20',
      status: 'completed',
    },
    {
      id: '11',
      raffleTitle: 'Treasure Hunt 💎',
      ticketNumber: '1234',
      purchaseDate: '2025-01-12 11:20',
      status: 'completed',
    },
    {
      id: '12',
      raffleTitle: 'Weekend Special 🎪',
      ticketNumber: '5678',
      purchaseDate: '2025-01-10 20:10',
      status: 'completed',
    },
    {
      id: '13',
      raffleTitle: 'Weekend Special 🎪',
      ticketNumber: '6789',
      purchaseDate: '2025-01-10 20:10',
      status: 'completed',
    },
    {
      id: '14',
      raffleTitle: 'Weekend Special 🎪',
      ticketNumber: '7891',
      purchaseDate: '2025-01-10 20:10',
      status: 'completed',
    }
  ];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500 text-white">Active</Badge>;
      case 'won':
        return <Badge className="bg-yellow-500 text-black">Won! 👑</Badge>;
      case 'completed':
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="hover:bg-white/20"
            style={{ color: '#FFFFFF' }}
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <h1 className="text-3xl font-bold" style={{ color: '#FFFFFF' }}>
            My Tickets
          </h1>
        </div>

        {/* Tickets List */}
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <Card 
              key={ticket.id} 
              className="border-2 shadow-md"
              style={{ 
                borderColor: '#4c2815',
                backgroundColor: '#FFFFFF'
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 mb-1" style={{ color: '#4c2815' }}>
                      {ticket.status === 'won' && <span className="text-2xl">👑</span>}
                      {ticket.raffleTitle}
                    </CardTitle>
                    <p className="text-sm" style={{ color: '#4c2815' }}>
                      {formatDate(ticket.purchaseDate)}
                    </p>
                  </div>
                  {getStatusBadge(ticket.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  {/* Single Ticket Number */}
                  <div>
                    <h4 className="font-semibold mb-2" style={{ color: '#4c2815' }}>
                      Ticket Number
                    </h4>
                    <div className="flex items-center gap-2">
                      <span
                        className="px-4 py-2 rounded-lg text-xl font-bold tracking-wider"
                        style={{ 
                          backgroundColor: ticket.status === 'won' ? '#ffcd18' : '#F5EFE6',
                          color: '#4c2815',
                          border: `2px solid ${ticket.status === 'won' ? '#bc1f13' : '#4c2815'}`
                        }}
                      >
                        #{ticket.ticketNumber}
                      </span>
                    </div>
                  </div>

                  {/* Prize Amount (if won) */}
                  <div className="space-y-2">
                    {ticket.status === 'won' && ticket.prizeAmount && (
                      <div>
                        <h4 className="font-semibold mb-1" style={{ color: '#4c2815' }}>
                          Prize Won
                        </h4>
                        <p className="text-lg font-bold" style={{ color: '#bc1f13' }}>
                          {ticket.prizeAmount}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Winner Message */}
                {ticket.status === 'won' && (
                  <div 
                    className="mt-3 p-3 rounded-lg text-center"
                    style={{ backgroundColor: '#ffcd18' }}
                  >
                    <p className="font-bold" style={{ color: '#4c2815' }}>
                      🎉 Congratulations! You won this raffle! 🎉
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Summary Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card style={{ backgroundColor: '#F5EFE6', borderColor: '#4c2815' }}>
            <CardContent className="p-4 text-center">
              <h3 className="font-bold text-lg" style={{ color: '#4c2815' }}>
                Total Tickets
              </h3>
              <p className="text-2xl font-bold" style={{ color: '#bc1f13' }}>
                {tickets.length}
              </p>
            </CardContent>
          </Card>
          
          <Card style={{ backgroundColor: '#F5EFE6', borderColor: '#4c2815' }}>
            <CardContent className="p-4 text-center">
              <h3 className="font-bold text-lg" style={{ color: '#4c2815' }}>
                Raffles Joined
              </h3>
              <p className="text-2xl font-bold" style={{ color: '#bc1f13' }}>
                {new Set(tickets.map(ticket => ticket.raffleTitle)).size}
              </p>
            </CardContent>
          </Card>
          
          <Card style={{ backgroundColor: '#ffcd18', borderColor: '#4c2815' }}>
            <CardContent className="p-4 text-center">
              <h3 className="font-bold text-lg" style={{ color: '#4c2815' }}>
                Wins
              </h3>
              <p className="text-2xl font-bold" style={{ color: '#4c2815' }}>
                👑 {tickets.filter(ticket => ticket.status === 'won').length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Empty State (if no tickets) */}
        {tickets.length === 0 && (
          <Card className="mt-8 text-center p-8" style={{ borderColor: '#F5EFE6' }}>
            <h3 className="text-xl font-bold mb-4" style={{ color: '#4c2815' }}>
              No tickets yet!
            </h3>
            <p className="mb-4" style={{ color: '#4c2815' }}>
              Join your first raffle to start collecting tickets.
            </p>
            <Button
              onClick={onBack}
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              Browse Raffles
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}