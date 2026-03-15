import { Button } from '../ui/button';
import { ArrowLeft } from 'lucide-react';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface TeamProps {
  onBack: () => void;
}

export function Team({ onBack }: TeamProps) {
  const teamMembers = [
    {
      name: 'Beanie',
      role: 'Founder & CEO',
      bio: 'Only eats other people\'s food',
      image: 'https://images.unsplash.com/photo-1575535468632-345892291673?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzaGliYSUyMGludSUyMHBvcnRyYWl0JTIwY3V0ZXxlbnwxfHx8fDE3NTg2ODEwOTJ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    },
    {
      name: 'Barley',
      role: 'CTO & Co-founder',
      bio: 'Doesn\'t have balls',
      image: 'https://images.unsplash.com/photo-1688902126779-fa4f27e91fdc?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzaGliYSUyMGludSUyMGhhcHB5JTIwZG9nfGVufDF8fHx8MTc1ODY4MTA5NXww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    },
    {
      name: 'Biscuit',
      role: 'Head of Product',
      bio: 'Loves liver, hates carrots',
      image: 'https://images.unsplash.com/photo-1745215745078-6ef0e0102d65?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzaGliYSUyMGludSUyMHNtaWxpbmclMjBwcm9mZXNzaW9uYWx8ZW58MXx8fHwxNzU4NjgxMDk3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    }
  ];

  return (
    <div className="min-h-screen p-6">
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
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Our Team</h1>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-xl mb-4" style={{ color: '#514444' }}>
            Team RaffleTime!
          </h2>
          <p style={{ color: '#514444' }}>
            All over the metaverse, vibe-coding our own dog food
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {teamMembers.map((member, index) => (
            <div key={index} className="bg-white rounded-lg shadow-lg p-6 text-center">
              <div className="mb-4">
                <ImageWithFallback
                  src={member.image}
                  alt={member.name}
                  className="w-24 h-24 rounded-full mx-auto object-cover"
                />
              </div>
              
              <h3 className="text-lg font-semibold mb-1" style={{ color: '#514444' }}>
                {member.name}
              </h3>
              
              <p className="text-sm font-medium mb-3" style={{ color: '#4c2815' }}>
                {member.role}
              </p>
              
              <p className="text-sm leading-relaxed" style={{ color: '#514444' }}>
                {member.bio}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 mt-8 text-center">
          <h3 className="text-lg font-semibold mb-4" style={{ color: '#514444' }}>
            Redistribute Wealth with Us
          </h3>
          <p className="mb-4" style={{ color: '#514444' }}>
            We think random distributions are cool
          </p>
          <a
            href="mailto:teamraffletime@gmail.com"
            className="inline-block px-6 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: '#ffcd18', color: '#4c2815' }}
          >
            Get In Touch
          </a>
        </div>
      </div>
    </div>
  );
}