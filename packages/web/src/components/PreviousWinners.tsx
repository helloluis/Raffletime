import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';

interface Winner {
  time: string;
  address: string;
  amount: string;
  details: string;
}

export function PreviousWinners() {
  const winners: Winner[] = [
    { time: '19:00', address: '0x1234...5678', amount: '$500', details: 'Won the "Eyes on the Prize" raffle with ticket #147. Prize pool was $1,000.' },
    { time: '18:00', address: '0x2345...6789', amount: '$750', details: 'Won the "Eyes on the Prize" raffle with ticket #89. Prize pool was $1,500.' },
    { time: '17:00', address: '0x3456...7890', amount: '$425', details: 'Won the "Eyes on the Prize" raffle with ticket #256. Prize pool was $850.' },
    { time: '16:00', address: '0x4567...8901', amount: '$600', details: 'Won the "Eyes on the Prize" raffle with ticket #12. Prize pool was $1,200.' },
    { time: '15:00', address: '0x5678...9012', amount: '$300', details: 'Won the "Eyes on the Prize" raffle with ticket #378. Prize pool was $600.' },
    { time: '14:00', address: '0x6789...0123', amount: '$450', details: 'Won the "Eyes on the Prize" raffle with ticket #199. Prize pool was $900.' },
    { time: '13:00', address: '0x7890...1234', amount: '$350', details: 'Won the "Eyes on the Prize" raffle with ticket #67. Prize pool was $700.' },
    { time: '12:00', address: '0x8901...2345', amount: '$525', details: 'Won the "Eyes on the Prize" raffle with ticket #445. Prize pool was $1,050.' },
  ];

  return (
    <div className="mb-8">
      <Accordion type="single" collapsible className="w-full" defaultValue="winners">
        <AccordionItem value="winners">
          <AccordionTrigger className="text-lg" style={{ color: '#514444' }}>
            Previous Winners
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              {winners.map((winner, index) => (
                <Accordion key={index} type="single" collapsible>
                  <AccordionItem value={`winner-${index}`} className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center space-x-3">
                          <span>🕛</span>
                          <span style={{ color: '#514444' }}>{winner.time}</span>
                          <span style={{ color: '#4c2815' }}>{winner.address}</span>
                        </div>
                        <span className="font-semibold" style={{ color: '#514444' }}>
                          {winner.amount}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <p className="text-sm" style={{ color: '#514444' }}>
                        {winner.details}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}